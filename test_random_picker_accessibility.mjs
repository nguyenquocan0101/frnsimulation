import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const page = read("random-picker.html");
const stylesheet = read("random-picker.css");
const moduleSource = read("random-picker.mjs");

test("picker uses the exact IDE tokens, panel radius, primary orange, mono labels, and visible focus", () => {
  for (const [token, value] of Object.entries({
    bg: "#10151b",
    surface: "#171e26",
    "surface-2": "#202831",
    line: "#303b47",
    ink: "#edf3f7",
    muted: "#9aa9b7",
    accent: "#ee7b30",
    "accent-2": "#f39a5b",
    focus: "#f5b275",
  })) assert.match(stylesheet, new RegExp(`--${token}:\\s*${value}`, "i"), `missing IDE token --${token}`);
  assert.match(stylesheet, /--radius:\s*14px/i);
  assert.match(stylesheet, /\.picker-panel\s*\{[^}]*border-radius:\s*var\(--radius\)/is);
  assert.match(stylesheet, /\.spin-button\s*\{[^}]*background:\s*var\(--accent\)/is);
  assert.match(stylesheet, /--mono:\s*Consolas/i);
  assert.match(stylesheet, /(?:a|button)[^{]*:focus-visible[^}]*outline:\s*(?!none)[^;}]+/is);
  assert.match(stylesheet, /outline[^;]*var\(--focus\)/i);
});

test("native action buttons, polite status, labelled reels, and ordered result remain accessible", () => {
  const buttons = [...page.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)];
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map((match) => match[2].trim()), ["Spin", "Copy result", "Reset"]);
  for (const [, attributes] of buttons) assert.match(attributes, /type="button"/i);
  assert.match(page, /<p\b[^>]*aria-live="polite"[^>]*data-status|<p\b[^>]*data-status[^>]*aria-live="polite"/i);
  assert.match(page, /<ol\b[^>]*data-results/i);
  assert.equal((page.match(/data-reel-window/g) || []).length, 5);
  assert.match(moduleSource, /(?:\.alt\s*=|setAttribute\(\s*["']alt["'])/i, "runtime-created result images need alt text");
  assert.match(moduleSource, /\.label\b/, "image alt/result labels must come from the neutral manifest labels");
});

test("keyboard source order is skip link, header links, then Spin, Copy, Reset", () => {
  const positions = [
    page.indexOf('class="skip-link"'),
    page.indexOf('class="header-brand brand"'),
    page.indexOf('class="open-ide-link"'),
    page.indexOf("data-spin"),
    page.indexOf("data-copy"),
    page.indexOf("data-reset"),
  ];
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("reel viewports stay square without a fixed desktop-only width", () => {
  assert.match(stylesheet, /\.reel-window\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/is);
  assert.doesNotMatch(stylesheet, /\.reel(?:-window)?\s*\{[^}]*(?:width|min-width):\s*[4-9]\d{2}px/is, "reels cannot require a desktop width");
});

test("page guards against horizontal overflow at 320px", () => {
  assert.match(stylesheet, /(?:body|html)[^{]*\{[^}]*overflow-x:\s*(?:hidden|clip)/is);
});

test("320px phone layout explicitly reflows reel cards to one column", () => {
  const narrowMedia = [...stylesheet.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)(?=\n\}|\}\s*$)/gi)]
    .filter((match) => Number(match[1]) >= 320)
    .map((match) => match[2])
    .join("\n");
  assert.match(narrowMedia, /\.reel-group\s*\{[^}]*grid-template-columns:\s*(?:1fr|repeat\(1\s*,)/is, "phone layout must become one column");
});

test("reduced-motion CSS removes reel animation instead of merely shortening it", () => {
  const motionBlock = stylesheet.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*)\}\s*$/i)?.[1] ?? "";
  assert.ok(motionBlock, "missing prefers-reduced-motion block");
  assert.match(motionBlock, /(?:\.reel-group\.is-spinning\s+\.reel-track|\.reel-track)[^{]*\{[^}]*animation:\s*none\s*!important/is);
  assert.match(motionBlock, /transition(?:-duration)?:\s*(?:none|0s|0ms|\.01ms)\s*!important/i);
});

test("coarse-pointer controls retain at least a 44px target", () => {
  const coarseBlock = stylesheet.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\}\s*(?=@media|$)/i)?.[1] ?? "";
  assert.ok(coarseBlock, "missing coarse-pointer media query");
  assert.match(coarseBlock, /(?:button|\.action-row)[^{]*\{[^}]*min-height:\s*44px/is);
});

test("picker avoids casino claims and remains isolated from app/runtime subsystems", () => {
  const combined = `${page}\n${moduleSource}`;
  assert.doesNotMatch(combined, /\b(?:money|prize|wager|jackpot|payout|betting|casino)\b/i);
  assert.doesNotMatch(combined, /firebase|firestore|XMLHttpRequest|fetch\s*\(|<iframe\b|<canvas\b|three\.js|leaderboard|techcamp_api|robot[_-]?simulator/i);
  assert.doesNotMatch(page, /role="button"/i, "actions must stay native buttons");
});
