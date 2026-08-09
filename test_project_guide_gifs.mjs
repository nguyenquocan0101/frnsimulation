import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const guide = fs.readFileSync(path.join(root, "project-guide.html"), "utf8");
const appStyles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const assets = path.join(root, "assets", "guide");
const commands = ["move-to", "move-down", "grip", "move-up", "release", "get-positions"];

test("project guide uses lightweight FR5 GIF cards instead of an embedded simulator", () => {
  assert.doesNotMatch(guide, /data-playground|project-guide-playground|<iframe\b/i);
  assert.match(guide, /href="\/"[^>]*>Open full simulator</i);
  assert.equal((guide.match(/data-command-card/g) || []).length, commands.length);
  for (const command of commands) {
    assert.match(guide, new RegExp(`fr5-command-${command}\\.gif`));
  }
});

test("each GIF command card has lazy media, accessible text, and a fallback", () => {
  const cards = [...guide.matchAll(/data-command-card[\s\S]*?<\/article>/g)].map((match) => match[0]);
  assert.equal(cards.length, commands.length);
  for (const card of cards) {
    assert.match(card, /<img\b[^>]*loading="lazy"/i);
    assert.match(card, /alt="[^"]+"/i);
    assert.match(card, /data-gif-fallback/);
  }
});

test("all six FR5 GIF assets exist and remain below the 1 MB limit", () => {
  const hashes = new Set();
  for (const command of commands) {
    const file = path.join(assets, `fr5-command-${command}.gif`);
    assert.ok(fs.existsSync(file), `${path.basename(file)} is missing`);
    assert.ok(fs.statSync(file).size <= 1024 * 1024, `${path.basename(file)} is too large`);
    hashes.add(crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"));
  }
  assert.ok(hashes.size >= 2, "GIF cards must not all be byte-identical static loops");
});

test("embed capture hides simulator overlays from the GIF frame", () => {
  assert.match(appStyles, /data-embed-mode=["']guide["'][^\n]*#blockStateStrip/i);
  assert.match(appStyles, /data-embed-mode=["']guide["'][^\n]*#homeBtn/i);
  assert.match(appStyles, /data-embed-mode=["']guide["'][^\n]*\.viewport-hud/i);
});
