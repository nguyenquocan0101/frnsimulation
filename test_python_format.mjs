import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { formatPythonSource, formatPythonSourceWithSelection } from './python-format.mjs';

test('save formatter converts mixed leading tabs to four-space tab stops', () => {
  const source = 'def main():\r\n\tif True:\r\n\t  print("ok")  \r\n';
  assert.equal(
    formatPythonSource(source),
    'def main():\n    if True:\n      print("ok")\n',
  );
});

test('save formatter preserves meaningful code and continuation alignment', () => {
  const source = 'values = [1,\n          2]\n\n';
  assert.equal(formatPythonSource(source), source);
});

test('save formatter preserves whitespace inside multiline string literals', () => {
  const source = 'value = """\n\titem  \n    next\t\n"""\n\tprint(value)  \n';
  assert.equal(
    formatPythonSource(source),
    'value = """\n\titem  \n    next\t\n"""\n    print(value)\n',
  );
});

test('save formatter preserves backslash-continued strings and ignores quotes in comments', () => {
  const source = 'value = "a\\\n\titem"\n# """ comment only\n\tprint(value)  \n';
  assert.equal(
    formatPythonSource(source),
    'value = "a\\\n\titem"\n# """ comment only\n    print(value)\n',
  );
});

test('save formatter maps caret and selection after expanded indentation', () => {
  const source = '\tprint("ok")  \n';
  const start = source.indexOf('print') + 'print'.length;
  const formatted = formatPythonSourceWithSelection(source, start, source.length - 3);
  assert.equal(formatted.source, '    print("ok")\n');
  assert.equal(formatted.selectionStart, formatted.source.indexOf('print') + 'print'.length);
  assert.equal(formatted.selectionEnd, formatted.source.indexOf(')') + 1);
});

test('save formatter keeps caret at exact LF and CRLF line starts', () => {
  for (const source of ['a\n\tb', 'a\r\n\tb']) {
    const lineStart = source.indexOf('\t');
    const formatted = formatPythonSourceWithSelection(source, lineStart, lineStart);
    assert.equal(formatted.source, 'a\n    b');
    assert.equal(formatted.selectionStart, 2);
    assert.equal(formatted.selectionEnd, 2);
  }
});

test('save formatter keeps an EOF caret after trailing newlines', () => {
  for (const source of ['a\n', 'a\r\n', 'a\n\n']) {
    const formatted = formatPythonSourceWithSelection(source, source.length, source.length);
    assert.equal(formatted.selectionStart, formatted.source.length);
    assert.equal(formatted.selectionEnd, formatted.source.length);
  }
});

test('IDE exposes Save and wires click plus Ctrl-S to format before persistence', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  assert.match(index, /id="saveProgramBtn"/);
  assert.match(app, /formatPythonSourceWithSelection\(/);
  assert.match(app, /key\.toLowerCase\(\) === "s"/);
  assert.match(app, /saveProgramBtn["']\)\?\.addEventListener\("click", saveAndFormat\)/);
});
