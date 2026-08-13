export const PYTHON_INDENT_UNIT = "    ";

const DEDENT_KEYWORDS = new Set(["elif", "else", "except", "finally"]);

function lineStartAt(source, offset) {
  const newline = source.lastIndexOf("\n", Math.max(0, offset - 1));
  return newline + 1;
}

function leadingIndent(line) {
  const match = line.match(/^[ \t]*/);
  return (match ? match[0] : "").replaceAll("\t", PYTHON_INDENT_UNIT);
}

export function buildIndentGuideLine(line) {
  const indent = leadingIndent(line);
  const levels = Math.floor(indent.length / PYTHON_INDENT_UNIT.length);
  if (levels === 0) return "";
  const chars = Array.from({ length: levels * PYTHON_INDENT_UNIT.length }, () => " ");
  for (let level = 1; level <= levels; level += 1) {
    chars[level * PYTHON_INDENT_UNIT.length - 1] = "│";
  }
  return chars.join("");
}

export function getPythonAutoIndent(source, cursor) {
  const safeCursor = Math.max(0, Math.min(cursor, source.length));
  const start = lineStartAt(source, safeCursor);
  const lineBeforeCursor = source.slice(start, safeCursor);
  const trimmed = lineBeforeCursor.trim();
  let indent = leadingIndent(lineBeforeCursor);

  const firstWord = trimmed.split(/\s+/)[0].replace(/:$/, "");
  if (DEDENT_KEYWORDS.has(firstWord)) {
    indent = indent.slice(0, Math.max(0, indent.length - PYTHON_INDENT_UNIT.length));
  }

  if (trimmed.endsWith(":")) {
    indent += PYTHON_INDENT_UNIT;
  } else if (/[([{][ \t]*$/.test(trimmed)) {
    indent += PYTHON_INDENT_UNIT;
  }

  return indent;
}

export function indentSelection(source, start, end, direction = "in") {
  const selectionStart = Math.max(0, Math.min(start, source.length));
  const selectionEnd = Math.max(selectionStart, Math.min(end, source.length));
  const firstLineStart = lineStartAt(source, selectionStart);
  const selected = source.slice(firstLineStart, selectionEnd);
  const lines = selected.split("\n");
  const changed = lines.map((line) => {
    if (direction === "out") {
      if (line.startsWith(PYTHON_INDENT_UNIT)) return line.slice(4);
      if (line.startsWith("\t")) return line.slice(1);
      return line;
    }
    return PYTHON_INDENT_UNIT + line;
  });
  const replacement = changed.join("\n");
  const value = source.slice(0, firstLineStart) + replacement + source.slice(selectionEnd);
  const delta = replacement.length - selected.length;
  return { value, start: firstLineStart, end: Math.max(firstLineStart, selectionEnd + delta) };
}

export function deleteIndentBefore(source, cursor) {
  if (cursor < PYTHON_INDENT_UNIT.length) return null;
  const start = lineStartAt(source, cursor);
  const before = source.slice(start, cursor);
  if (before.length === 0 || !/^ +$/.test(before)) return null;
  const remove = Math.min(PYTHON_INDENT_UNIT.length, before.length);
  return { value: source.slice(0, cursor - remove) + source.slice(cursor), cursor: cursor - remove };
}
