import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(root, "competitive.html"), "utf8");
const css = fs.readFileSync(path.join(root, "competitive.css"), "utf8");

test("rules explain the physical-arm workflow and cost pool in English", () => {
  for (const phrase of [
    "capture()", "detect()", "1 energy", "Maximum 3", "3 energy", "1 move",
    "1 distance", "Lowest total cost wins", "correct final arrangement", "20",
    "lower energy", "fewer completed moves", "shorter distance",
  ]) assert.match(page, new RegExp(phrase.replace(/[()]/g, "\\$&"), "i"), phrase);
  assert.match(page, /camera/i);
  assert.match(page, /physical arm/i);
});

test("complete transfer example is display-only and contains the full protocol", () => {
  assert.match(page, /<pre[\s\S]*<code[\s\S]*bot\.move_to\(["']P2["']\)[\s\S]*bot\.move_down\(\)[\s\S]*bot\.grip\(\)[\s\S]*bot\.move_up\(\)[\s\S]*bot\.move_to\(["']P5["']\)[\s\S]*bot\.move_down\(\)[\s\S]*bot\.release\(\)[\s\S]*bot\.move_up\(\)/i);
  assert.doesNotMatch(page, /<button[^>]*>[^<]*(?:Run|Execute)/i);
});

test("media uses at most three local FR5 GIFs with reduced-motion posters", () => {
  const gifs = [...page.matchAll(/src="([^\"]+fr5-command-[^\"]+\.gif)"/gi)].map((m) => m[1]);
  assert.ok(gifs.length >= 2 && gifs.length <= 3, `expected 2–3 GIFs, got ${gifs.length}`);
  assert.ok(gifs.every((src) => src.startsWith("/assets/guide/")));
  const figures = [...page.matchAll(/<figure[\s\S]*?<\/figure>/gi)].map((m) => m[0]);
  assert.ok(figures.length >= 2);
  for (const figure of figures) {
    assert.match(figure, /prefers-reduced-motion[^>]+poster/i);
    assert.match(figure, /<img[^>]+(?:width="640"[^>]+height="360")/i);
    assert.match(figure, /<figcaption/i);
  }
});

test("rules page has semantic cost table, process steps, and compact code/media sections", () => {
  assert.match(page, /<table[\s\S]*<th[^>]*>Action/i);
  assert.match(page, /<ol[^>]*class="[^\"]*process/i);
  assert.match(page, /data-media="transfer"/i);
  assert.match(page, /P2\s*→\s*P5\s*=\s*3 distance/i);
});

test("responsive rulebook uses IDE tokens, fixed media ratio, and touch-safe controls", () => {
  for (const token of ["--bg: #10151b", "--surface: #171e26", "--accent: #ee7b30", "--line: #303b47"]) assert.match(css, new RegExp(token.replace(/[#:]/g, "\\$&"), "i"));
  assert.match(css, /aspect-ratio\s*:\s*16\s*\/\s*9/i);
  assert.match(css, /@media\s*\(max-width:\s*680px\)/i);
  assert.match(css, /@media\s*\(pointer:\s*coarse\)/i);
  assert.match(css, /min-height:\s*44px/i);
});
