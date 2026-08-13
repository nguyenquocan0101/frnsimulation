import test from "node:test";
import assert from "node:assert/strict";
import {
  buildIndentGuideLine,
  deleteIndentBefore,
  getPythonAutoIndent,
  indentSelection,
} from "./python-editor-behavior.mjs";

test("Enter keeps indentation and adds one level after a colon", () => {
  const source = "def main():";
  assert.equal(getPythonAutoIndent(source, source.length), "    ");
});

test("Enter dedents before else and keeps nested block indentation", () => {
  assert.equal(getPythonAutoIndent("    else:", 9), "    ");
  assert.equal(getPythonAutoIndent("    if ready:", 13), "        ");
});

test("Tab and Shift+Tab change selected lines by four spaces", () => {
  const source = "one\ntwo";
  const indented = indentSelection(source, 0, source.length, "in");
  assert.equal(indented.value, "    one\n    two");
  const outdented = indentSelection(indented.value, 0, indented.value.length, "out");
  assert.equal(outdented.value, source);
});

test("Backspace removes one indentation level", () => {
  const source = "    print('ok')";
  const result = deleteIndentBefore(source, 4);
  assert.deepEqual(result, { value: "print('ok')", cursor: 0 });
});

test("indentation guides mark every four-space level", () => {
  assert.equal(buildIndentGuideLine("        bot.grip()"), "   │   │");
  assert.equal(buildIndentGuideLine("print('root')"), "");
});
