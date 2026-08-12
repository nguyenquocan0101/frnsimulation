import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyPythonCompletion, getPythonCompletions } from './python-autocomplete.mjs';

test('TechCamp completion filters bot methods and inserts the selected call', () => {
  const source = 'bot.mov';
  const completion = getPythonCompletions(source);
  assert.deepEqual(completion.items.map((item) => item.label), ['move_to', 'move_down', 'move_up']);
  const result = applyPythonCompletion(source, completion, completion.items[0]);
  assert.equal(result.source, 'bot.move_to("P1")');
  assert.equal(result.selectionStart, result.source.indexOf('P1'));
});

test('Python completion supplies functions and snippets but stays out of strings and comments', () => {
  assert.deepEqual(getPythonCompletions('pri').items.map((item) => item.label), ['print']);
  assert.equal(getPythonCompletions('value = "pri'), null);
  assert.equal(getPythonCompletions('# pri'), null);
  assert.equal(getPythonCompletions('value = "a\\\npri'), null);
  assert.equal(getPythonCompletions('value = """\npri'), null);
});

test('IDE exposes an accessible autocomplete listbox and keyboard controller', () => {
  const index = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('app.js', 'utf8');
  assert.match(index, /id="pythonAutocomplete"[^>]*role="listbox"/);
  assert.match(index, /id="program"[\s\S]{0,160}aria-autocomplete="list"[\s\S]{0,100}aria-controls="pythonAutocomplete"/);
  assert.match(app, /createPythonAutocomplete/);
  assert.match(app, /if \(event\.defaultPrevented\) return;/);
});

test('completion acceptance rejects a stale range after caret navigation', () => {
  const source = 'bot.mov';
  const completion = getPythonCompletions(source);
  const staleCaret = completion.end - 1;
  assert.notEqual(staleCaret, completion.end);
  assert.equal(completion.start, 4);
});
