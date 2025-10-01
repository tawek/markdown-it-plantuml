// Process block-level uml diagrams
//
'use strict';

module.exports = function umlPlugin(md, options) {

  function generateSourceDefault(umlCode, pluginOptions) {
    var imageFormat = pluginOptions.imageFormat || 'svg';
    var diagramName = pluginOptions.diagramName || 'uml';
    var server = pluginOptions.server || 'https://www.plantuml.com/plantuml';
    var deflate = require('./lib/deflate.js');
    var zippedCode = deflate.encode64(
      deflate.zip_deflate(
        unescape(encodeURIComponent(
          '@start' + diagramName + '\n' + umlCode + '\n@end' + diagramName)),
        9
      )
    );

    return server + '/' + imageFormat + '/' + zippedCode;
  }

  options = options || {};

  var openMarker = options.openMarker || '@startuml',
      openChar = openMarker.charCodeAt(0),
      closeMarker = options.closeMarker || '@enduml',
      closeChar = closeMarker.charCodeAt(0),
      render = options.render || md.renderer.rules.image,
      generateSource = options.generateSource || generateSourceDefault;

  function uml(state, startLine, endLine, silent) {
    var nextLine, markup, params, token, i,
        autoClosed = false,
        start = state.bMarks[startLine] + state.tShift[startLine],
        max = state.eMarks[startLine];

    // Check out the first character quickly,
    // this should filter out most of non-uml blocks
    //
    if (openChar !== state.src.charCodeAt(start)) { return false; }

    // Check out the rest of the marker string
    //
    for (i = 0; i < openMarker.length; ++i) {
      if (openMarker[i] !== state.src[start + i]) { return false; }
    }

    markup = state.src.slice(start, start + i);
    params = state.src.slice(start + i, max);

    // Since start is found, we can report success here in validation mode
    //
    if (silent) { return true; }

    // Search for the end of the block
    //
    nextLine = startLine;

    for (;;) {
      nextLine++;
      if (nextLine >= endLine) {
        // unclosed block should be autoclosed by end of document.
        // also block seems to be autoclosed by end of parent
        break;
      }

      start = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];

      if (start < max && state.sCount[nextLine] < state.blkIndent) {
        // non-empty line with negative indent should stop the list:
        // - ```
        //  test
        break;
      }

      if (closeChar !== state.src.charCodeAt(start)) {
        // didn't find the closing fence
        continue;
      }

      if (state.sCount[nextLine] > state.sCount[startLine]) {
        // closing fence should not be indented with respect of opening fence
        continue;
      }

      var closeMarkerMatched = true;
      for (i = 0; i < closeMarker.length; ++i) {
        if (closeMarker[i] !== state.src[start + i]) {
          closeMarkerMatched = false;
          break;
        }
      }

      if (!closeMarkerMatched) {
        continue;
      }

      // make sure tail has spaces only
      if (state.skipSpaces(start + i) < max) {
        continue;
      }

      // found!
      autoClosed = true;
      break;
    }

    var contents = state.src
      .split('\n')
      .slice(startLine + 1, nextLine)
      .join('\n');

    // We generate a token list for the alt property, to mimic what the image parser does.
    var altToken = [];
    // Remove leading space if any.
    var alt = params ? params.slice(1) : 'uml diagram';
    state.md.inline.parse(
      alt,
      state.md,
      state.env,
      altToken
    );

    token = state.push('uml_diagram', 'img', 0);
    // alt is constructed from children. No point in populating it here.
    token.attrs = [ [ 'src', generateSource(contents, options) ], [ 'alt', '' ] ];
    token.block = true;
    token.children = altToken;
    token.info = params;
    token.map = [ startLine, nextLine ];
    token.markup = markup;

    state.line = nextLine + (autoClosed ? 1 : 0);

    return true;
  }

  function fence(state, startLine, endLine, silent) {
    var marker, len, params, nextLine, mem, token, markup,
        haveEndMarker = false,
        pos = state.bMarks[startLine] + state.tShift[startLine],
        max = state.eMarks[startLine];

    // Check out the first character quickly,
    // this should filter out most of non-fence blocks
    //
    if (pos + 3 > max) { return false; }

    marker = state.src.charCodeAt(pos);

    if (marker !== 0x7E/* ~ */ && marker !== 0x60 /* ` */) {
      return false;
    }

    // scan marker length
    mem = pos;
    pos = state.skipChars(pos, marker);

    len = pos - mem;

    if (len < 3) { return false; }

    markup = state.src.slice(mem, pos);
    params = state.src.slice(pos, max);

    // Check if this is a plantuml fence
    if (params.trim().split(/\s+/g)[0] !== 'plantuml') {
      return false;
    }

    // Since start is found, we can report success here in validation mode
    //
    if (silent) { return true; }

    // search end of block
    //
    nextLine = startLine;

    for (;;) {
      nextLine++;
      if (nextLine >= endLine) {
        // reached end of input without finding a closing fence
        break;
      }

      pos = mem = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];

      if (pos < max && state.sCount[nextLine] < state.blkIndent) {
        // non-empty line with negative indent should stop the list:
        break;
      }

      if (state.src.charCodeAt(pos) !== marker) { continue; }

      if (state.sCount[nextLine] - state.blkIndent >= 4) {
        // closing fence should be indented less than 4 spaces
        continue;
      }

      pos = state.skipChars(pos, marker);

      // closing code fence must be at least as long as the opening one
      if (pos - mem < len) { continue; }

      // make sure tail has spaces only
      pos = state.skipSpaces(pos);

      if (pos < max) { continue; }

      haveEndMarker = true;
      // found!
      break;
    }

    // If a fence has heading spaces, they should be removed from its inner block
    len = state.sCount[startLine];

    state.line = nextLine + (haveEndMarker ? 1 : 0);

    var contents = state.src
      .split('\n')
      .slice(startLine + 1, nextLine)
      .map(function (line, idx) {
        // Remove leading spaces equal to opening fence indentation
        var sCountIdx = startLine + 1 + idx;
        var shift = (sCountIdx < state.sCount.length) ? state.sCount[sCountIdx] : 0;
        if (shift > len) { shift = len; }
        return line.slice(shift);
      })
      .join('\n');

    // We generate a token list for the alt property, to mimic what the image parser does.
    var altToken = [];
    var alt = 'uml diagram';
    state.md.inline.parse(
      alt,
      state.md,
      state.env,
      altToken
    );

    token = state.push('uml_diagram', 'img', 0);
    token.attrs = [ [ 'src', generateSource(contents, options) ], [ 'alt', '' ] ];
    token.block = true;
    token.children = altToken;
    token.info = params.trim();
    token.map = [ startLine, state.line ];
    token.markup = markup;

    return true;
  }

  md.block.ruler.before('fence', 'uml_diagram', uml, {
    alt: [ 'paragraph', 'reference', 'blockquote', 'list' ]
  });
  md.block.ruler.before('fence', 'uml_diagram_fence', fence, {
    alt: [ 'paragraph', 'reference', 'blockquote', 'list' ]
  });
  md.renderer.rules.uml_diagram = render;
};
