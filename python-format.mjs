function indentationWidth(text, tabSize) {
  let width = 0;
  for (const character of text) {
    width = character === '\t' ? width + tabSize - (width % tabSize) : width + 1;
  }
  return width;
}

function isEscaped(line, index) {
  let slashCount = 0;
  for (let position = index - 1; position >= 0 && line[position] === '\\'; position -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function advanceStringState(line, activeQuote) {
  let quote = activeQuote;
  let cursor = 0;
  let containsString = Boolean(activeQuote);
  while (cursor < line.length) {
    if (!quote && line[cursor] === '#') break;
    if (!quote && line[cursor] !== "'" && line[cursor] !== '"') {
      cursor += 1;
      continue;
    }
    if (!quote) {
      const character = line[cursor];
      quote = line.slice(cursor, cursor + 3) === character.repeat(3)
        ? character.repeat(3)
        : character;
      containsString = true;
      cursor += quote.length;
      continue;
    }
    const index = line.indexOf(quote, cursor);
    if (index < 0) break;
    cursor = index + quote.length;
    if (isEscaped(line, index)) continue;
    quote = null;
  }
  return { activeQuote: quote, containsString };
}

function splitSourceLines(source) {
  const lines = [];
  const pattern = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  let match;
  while ((match = pattern.exec(source)) && (match[0] || !lines.length)) {
    lines.push({ text: match[1], newline: match[2], start: match.index });
    if (!match[2]) break;
  }
  return lines;
}

export function formatPythonSourceWithSelection(source, selectionStart = 0, selectionEnd = selectionStart, tabSize = 4) {
  const input = String(source ?? '');
  const width = Number.isInteger(tabSize) && tabSize > 0 ? tabSize : 4;
  const lines = splitSourceLines(input);
  let activeQuote = null;
  let outputOffset = 0;

  for (const line of lines) {
    const startsInsideString = Boolean(activeQuote);
    const quoteState = advanceStringState(line.text, activeQuote);
    activeQuote = quoteState.activeQuote;
    const indentation = line.text.match(/^[ \t]*/)[0];
    const oldIndentLength = indentation.length;
    const newIndentLength = startsInsideString
      ? oldIndentLength
      : indentationWidth(indentation, width);
    let formattedText = line.text;
    if (!startsInsideString) {
      const content = line.text.slice(oldIndentLength);
      const safeContent = quoteState.activeQuote ? content : content.replace(/[ \t]+$/g, '');
      formattedText = safeContent ? `${' '.repeat(newIndentLength)}${safeContent}` : '';
    }
    line.outputStart = outputOffset;
    line.formattedText = formattedText;
    line.oldIndentLength = oldIndentLength;
    line.newIndentLength = newIndentLength;
    line.preserveColumns = startsInsideString;
    outputOffset += formattedText.length + (line.newline ? 1 : 0);
  }

  const mapOffset = (rawOffset) => {
    const offset = Math.max(0, Math.min(Number(rawOffset) || 0, input.length));
    if (offset === input.length) return outputOffset;
    const line = lines.findLast((candidate) => candidate.start <= offset) ?? lines[0];
    if (!line) return 0;
    const column = Math.min(offset - line.start, line.text.length);
    let mappedColumn = column;
    if (!line.preserveColumns) {
      mappedColumn = column <= line.oldIndentLength
        ? indentationWidth(line.text.slice(0, column), width)
        : line.newIndentLength + column - line.oldIndentLength;
    }
    return line.outputStart + Math.min(mappedColumn, line.formattedText.length);
  };

  return {
    source: lines.map((line) => `${line.formattedText}${line.newline ? '\n' : ''}`).join(''),
    selectionStart: mapOffset(selectionStart),
    selectionEnd: mapOffset(selectionEnd),
  };
}

export function formatPythonSource(source, tabSize = 4) {
  return formatPythonSourceWithSelection(source, 0, 0, tabSize).source;
}
