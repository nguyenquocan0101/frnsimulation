import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const assetDir = path.join(root, "assets", "boxpicture");

const expected = [
  ["bird", 1, "sticker-01.jpeg"],
  ["bear", 2, "sticker-02.jpeg"],
  ["cat", 3, "sticker-03.png"],
  ["cow", 4, "sticker-04.jpeg"],
  ["dog", 5, "sticker-05.png"],
  ["dolphin", 6, "sticker-06.jpeg"],
  ["elephant", 7, "sticker-07.jpeg"],
  ["giraffe", 8, "sticker-08.jpeg"],
  ["horse", 9, "sticker-09.jpeg"],
];

test("boxpicture assets and lowercase class values stay aligned", () => {
  assert.deepEqual(fs.readdirSync(assetDir).sort(), expected.map(([, , file]) => file).sort());
  for (const [id, value, file] of expected) {
    assert.match(app, new RegExp(`value: ${value}, id: "${id}", label: "${id}"`));
    assert.match(app, new RegExp(`${id}: "\\.\\/assets\\/boxpicture\\/${file}"`));
  }
});
