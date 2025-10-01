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

  function pushDiagramToken(state, contents, info, markup, map, altText) {
    var altToken = [];
    var alt = (altText && altText.length) ? altText : 'uml diagram';

    state.md.inline.parse(
      alt,
      state.md,
      state.env,
      altToken
    );

    var token = state.push('uml_diagram', 'img', 0);
    token.attrs = [ [ 'src', generateSource(contents, options) ], [ 'alt', '' ] ];
    token.block = true;
    token.children = altToken;
    token.info = info;
    token.map = map;
    token.markup = markup;

    return token;
  }

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

    // Remove leading space if any.
    var altText = params ? params.slice(1) : '';
    token = pushDiagramToken(
      state,
      contents,
      params,
      markup,
      [ startLine, nextLine ],
      altText
    );

    state.line = nextLine + (autoClosed ? 1 : 0);

    return true;
  }

  /**
   * detectFence quickly verifies that the current line starts a PlantUML fence.
   * Example for 
   * 
   * ```plantuml diagram caption
   * @startuml
   * Alice -> Bob: Authentication Request
   * Bob --> Alice: Authentication Response
   * @enduml
   * ```
   * 
   * Returns:
   *   marker        => 0x60 (the backtick code fence delimiter)
   *   markup        => "```" (the raw fence marker string)
   *   paramsTrim    => "plantuml diagram caption" (info string after markup)
   *   markerLength  => 3 (count of repeated marker characters)
   */
  function detectFence(state, startLine) {
    var mem,
        pos = state.bMarks[startLine] + state.tShift[startLine],
        max = state.eMarks[startLine];

    if (pos + 3 > max) { return null; }

    var marker = state.src.charCodeAt(pos);

    if (marker !== 0x7E/* ~ */ && marker !== 0x60 /* ` */) {
      return null;
    }

    mem = pos;
    pos = state.skipChars(pos, marker);

    var len = pos - mem;

    if (len < 3) { return null; }

    var markup = state.src.slice(mem, pos);
    var paramsTrim = state.src.slice(pos, max).trim();

    if (paramsTrim.split(/\s+/g)[0] !== 'plantuml') {
      return null;
    }

    return {
      marker: marker,
      markup: markup,
      paramsTrim: paramsTrim,
      markerLength: len
    };
  }

  function extractFenceContents(state, startLine, endLine, detection) {
    var nextLine = startLine;
    var pos;
    var mem;
    var max;

    for (;;) {
      nextLine++;
      if (nextLine >= endLine) {
        break;
      }

      pos = mem = state.bMarks[nextLine] + state.tShift[nextLine];
      max = state.eMarks[nextLine];

      if (pos < max && state.sCount[nextLine] < state.blkIndent) {
        break;
      }

      if (state.src.charCodeAt(pos) !== detection.marker) { continue; }

      if (state.sCount[nextLine] - state.blkIndent >= 4) {
        continue;
      }

      pos = state.skipChars(pos, detection.marker);

      if (pos - mem < detection.markerLength) { continue; }

      pos = state.skipSpaces(pos);

      if (pos < max) { continue; }

      break;
    }

    var indent = state.sCount[startLine];

    var endReached = nextLine >= endLine;
    state.line = nextLine + (endReached ? 0 : 1);

    var contents = state.src
      .split('\n')
      .slice(startLine + 1, nextLine)
      .map(function (line, idx) {
        var sCountIdx = startLine + 1 + idx;
        var shift = (sCountIdx < state.sCount.length) ? state.sCount[sCountIdx] : 0;
        if (shift > indent) { shift = indent; }
        return line.slice(shift);
      })
      .join('\n');

    return contents;
  }

  function replaceFenceWithDiagram(state, startLine, contents, detection) {
    var altText = detection.paramsTrim.slice('plantuml'.length).trim();

    pushDiagramToken(
      state,
      contents,
      detection.paramsTrim,
      detection.markup,
      [ startLine, state.line ],
      altText
    );
  }

  function fence(state, startLine, endLine, silent) {
    var detection = detectFence(state, startLine);

    if (!detection) { return false; }

    if (silent) { return true; }

    var contents = extractFenceContents(state, startLine, endLine, detection);

    replaceFenceWithDiagram(state, startLine, contents, detection);

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
