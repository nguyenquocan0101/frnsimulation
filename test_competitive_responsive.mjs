import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(root, "competitive.html"), "utf8");
const css = fs.readFileSync(path.join(root, "competitive.css"), "utf8");

test("responsive layout stacks content at phone width without horizontal overflow rules", () => {
  assert.match(css, /min-width:\s*320px/i);
  assert.match(css, /@media\s*\(max-width:\s*680px\)[\s\S]*grid-template-columns:\s*1fr/i);
  assert.match(css, /overflow-x:\s*auto/i);
  assert.doesNotMatch(css, /width:\s*\d{4,}px/i);
});

test("media has stable aspect ratio and reduced-motion poster sources", () => {
  assert.match(css, /\.media-card picture[\s\S]*aspect-ratio:\s*16\s*\/\s*9/i);
  assert.equal((page.match(/prefers-reduced-motion:\s*reduce/g) || []).length, 3);
  assert.equal((page.match(/fr5-command-[^"']+-poster\.png/g) || []).length, 3);
});

test("accessibility landmarks and visible focus treatment are present", () => {
  assert.match(page, /class="skip-link"/i);
  assert.match(page, /aria-labelledby="page-title"/i);
  assert.match(page, /aria-label="cost formula and worked example"/i);
  assert.match(css, /:focus-visible[\s\S]*outline:\s*2px solid var\(--focus\)/i);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)[\s\S]*min-height:\s*44px/i);
});

test("the page keeps the requested deterministic tie-break order", () => {
  const tie = page.slice(page.indexOf("id=\"ranking-title\""));
  assert.match(tie, /lower energy[\s\S]*fewer completed moves[\s\S]*shorter distance/i);
});
