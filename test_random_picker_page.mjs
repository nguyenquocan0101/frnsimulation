import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => {
  const target = path.join(root, name);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
};
const page = read("random-picker.html");
const stylesheet = read("random-picker.css");
const moduleSource = read("random-picker.mjs");
const server = read("serve.mjs");
const vercel = JSON.parse(read("vercel.json"));
const assetDirectory = path.join(root, "assets", "random-picker");

test("random-picker routes both slash forms without changing existing named routes", () => {
  assert.match(server, /\[\s*['"]\/random-picker['"],\s*['"]\/random-picker\/['"]\s*\]/);
  assert.match(server, /['"]\.webp['"]\s*:\s*['"]image\/webp/);
  assert.deepEqual(
    vercel.rewrites.filter((entry) => entry.source.startsWith("/random-picker")),
    [
      { source: "/random-picker", destination: "/random-picker.html" },
      { source: "/random-picker/", destination: "/random-picker.html" },
    ],
  );
  for (const route of ["competition", "competitive", "project-guide"]) {
    assert.ok(vercel.rewrites.some((entry) => entry.source === `/${route}`), `/${route} rewrite must remain`);
  }
});

test("random-picker provides a static accessible five-reel IDE shell", () => {
  assert.ok(page, "random-picker.html must exist");
  assert.equal((page.match(/<h1\b/gi) || []).length, 1, "page must have exactly one h1");
  assert.match(page, /<main\b/i);
  assert.match(page, /class="skip-link"/i);
  assert.match(
    page,
    /<a\s+class="header-brand brand"\s+href="\/"\s+aria-label="[^"]+">\s*<span class="techx-logo">FPTU TECH<span>X<\/span> CAMP<\/span>\s*<span>FAIRINO SIMULATION<\/span>\s*<\/a>/i,
  );
  assert.equal((page.match(/<article\b[^>]*class="[^"]*reel/gi) || []).length, 5, "must render five reel articles");
  assert.match(page, /aria-live="polite"/i);
  for (const label of ["Spin", "Copy result", "Reset"]) {
    assert.match(page, new RegExp(`<button[^>]*>\\s*${label}\\s*<\\/button>`, "i"));
  }
  assert.match(page, /href="\/random-picker\.css"/i);
  assert.match(page, /src="\/random-picker\.mjs"/i);
  assert.ok(stylesheet, "random-picker.css must exist");
});

test("random-picker remains an isolated local-only page", () => {
  assert.ok(page, "random-picker.html must exist");
  assert.doesNotMatch(page, /firebase|firestore|auth|fetch\s*\(|XMLHttpRequest|<iframe\b|<canvas\b|three\.js|simulator|Sticker\s*\(\d+\)\.png/i);
  assert.doesNotMatch(moduleSource, /firebase|firestore|fetch\s*\(|XMLHttpRequest|Sticker\s*\(\d+\)\.png/i);
  assert.match(stylesheet, /--bg:\s*#10151b/i);
  assert.match(stylesheet, /aspect-ratio:\s*1\s*\/\s*1/i);
});

test("random-picker shell exposes controller hooks for all five reels and locked actions", () => {
  assert.equal((page.match(/data-reel-window/g) || []).length, 5);
  assert.match(page, /data-reel-group[^>]*aria-busy="false"|aria-busy="false"[^>]*data-reel-group/i);
  assert.match(page, /data-spin/i);
  assert.match(page, /data-copy[^>]*disabled|disabled[^>]*data-copy/i);
  assert.match(page, /data-reset[^>]*disabled|disabled[^>]*data-reset/i);
  assert.match(page, /data-results/i);
  assert.match(page, /data-status/i);
});

test("the immutable sticker manifest contains exactly the first eight optimized sources", () => {
  assert.ok(moduleSource, "random-picker.mjs must exist");
  const sourcePaths = moduleSource.match(/\/assets\/random-picker\/sticker-\d{2}\.webp/g) || [];
  assert.deepEqual(sourcePaths, Array.from({ length: 8 }, (_, index) => `/assets/random-picker/sticker-${String(index + 1).padStart(2, "0")}.webp`));
  assert.doesNotMatch(moduleSource, /sticker-09|Sticker\s*9/i);
});

test("the generated sticker set is exactly eight compact 360 square WebPs", () => {
  assert.ok(fs.existsSync(assetDirectory), "assets/random-picker must exist");
  const assets = fs.readdirSync(assetDirectory).filter((name) => name.endsWith(".webp")).sort();
  assert.deepEqual(assets, Array.from({ length: 8 }, (_, index) => `sticker-${String(index + 1).padStart(2, "0")}.webp`));
  const totalBytes = assets.reduce((sum, name) => sum + fs.statSync(path.join(assetDirectory, name)).size, 0);
  assert.ok(totalBytes <= 1_200_000, `optimized assets should be <= 1.2 MB, got ${totalBytes}`);
  for (const name of assets) {
    const bytes = fs.readFileSync(path.join(assetDirectory, name));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF", `${name} must be a WebP RIFF file`);
    assert.equal(bytes.toString("ascii", 8, 12), "WEBP", `${name} must be a WebP file`);
    const chunkType = bytes.toString("ascii", 12, 16);
    assert.equal(chunkType, "VP8X", `${name} must use an extended WebP header`);
    const width = 1 + bytes.readUIntLE(24, 3);
    const height = 1 + bytes.readUIntLE(27, 3);
    assert.equal(width, 360, `${name} width`);
    assert.equal(height, 360, `${name} height`);
  }
});
