import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const guide = fs.readFileSync(path.join(root, "project-guide.html"), "utf8");
const guideCss = fs.readFileSync(path.join(root, "project-guide.css"), "utf8");

test("project guide uses the static FR5 GIF guide instead of an embedded simulator", () => {
  assert.doesNotMatch(guide, /project-guide-playground|data-playground|<iframe\b/i);
  assert.match(guide, /Open full simulator/i);
  assert.match(guide, /href=["']\/["']/i);
  assert.match(guide, /data-command-card/);
  assert.match(guide, /fr5-command-move-to\.gif/);
});

test("command cards remain accessible and responsive", () => {
  assert.match(guide, /loading=["']lazy["']/i);
  assert.match(guide, /data-gif-fallback/);
  assert.match(guide, /aria-live=["']polite["']/i);
  assert.match(guide, /<button[^>]+(?:aria-label|title|data-action|data-command)/i);
  assert.match(guideCss, /@media\s*\(max-width\s*:\s*600px\)/i);
  assert.match(guideCss, /gif-command-grid[\s\S]{0,1200}grid-template-columns/i);
  assert.match(guideCss, /:focus-visible/);
});
