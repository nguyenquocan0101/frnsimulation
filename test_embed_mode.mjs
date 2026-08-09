import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmbedStorage, isGuideEmbedUrl } from "./guide-embed-protocol.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");

const hasEmbedBranch = /(?:isGuideEmbedUrl|isEmbedMode|EMBED_QUERY|searchParams\.get\(["']embed["']\))/;

test("the simulator detects the internal ?embed=guide URL before normal UI binding", () => {
  assert.equal(isGuideEmbedUrl("/?embed=guide"), true);
  assert.equal(isGuideEmbedUrl("/index.html?embed=guide"), true);
  assert.equal(isGuideEmbedUrl("/"), false);
  assert.match(app, hasEmbedBranch, "app.js must derive embed mode from the URL");
  assert.match(app, /(?:before|prior|before.*)\s*bindUI|bindUI\(.*isEmbedMode|isEmbedMode.*bindUI/i);
});
test("embed mode exposes stable hooks and hides IDE-only controls", () => {
  assert.match(index, /data-embed-viewport/);
  assert.match(index, /data-embed-profile/);
  assert.match(index, /data-embed-camera-view/);
  assert.match(index, /data-embed-hidden=["'](?:editor|upload|firebase|competition|teacher|navigation)["']/i);
  assert.match(app, /data-embed-mode/);
  assert.match(app, /(?:editor|upload|firebase|competition|teacher|navigation)[^\n]{0,120}(?:hidden|disabled|embed)/i);
});

test("embed mode has no Firebase, upload, teacher, or competition startup side effects", () => {
  assert.match(app, /if\s*\(!?isEmbedMode\)[\s\S]{0,500}(?:firebaseAvailable|uploadSubmission|saveCompetitionResult|bindTeacher|competition)/i);
  assert.match(app, /(?:skip|disable|guard|return)[^\n]{0,100}(?:Firebase|firebase|upload|competition|teacher)/i);
  assert.match(index, /data-embed-hidden=["'](?:firebase|upload|competition|teacher)["']/i);
});

test("embed parent messages validate origin/source and dispatch only allowlisted commands", () => {
  assert.match(app, /addEventListener\(["']message["']/);
  assert.match(app, /event\.origin/);
  assert.match(app, /event\.source/);
  assert.match(app, /validateParentMessage/);
  assert.match(app, /guide:run-command/);
  assert.match(app, /(?:move_to|move_down|move_up|grip|release|get_positions)/);
  assert.match(app, /(?:guide:set-profile|guide:set-view|guide:set-zoom|guide:run-sample|guide:stop|guide:reset|guide:capture)/);
  assert.doesNotMatch(app, /new Function\s*\(|eval\s*\(/i, "embed commands must not execute arbitrary source");
});

test("embed persistence is memory-scoped and normal mode retains localStorage", () => {
  const parentStorage = new Map();
  const parent = {
    getItem: (key) => parentStorage.get(key) ?? null,
    setItem: (key, value) => parentStorage.set(String(key), String(value)),
    removeItem: (key) => parentStorage.delete(String(key)),
    clear: () => parentStorage.clear(),
  };
  parent.setItem("fr3-code", "student code");
  const embedStorage = createEmbedStorage({ storage: parent, embed: true });
  embedStorage.setItem("fr3-code", "guide state");
  embedStorage.setItem("fr3-profile", "fr5");
  assert.equal(parent.getItem("fr3-code"), "student code");
  assert.equal(parent.getItem("fr3-profile"), null);
  assert.match(app, /createEmbedStorage/);
  assert.match(app, /(?:localStorage|storage)[\s\S]{0,240}(?:isEmbedMode|embed)/i);
  assert.match(app, /if\s*\(!?isEmbedMode\)[\s\S]{0,240}localStorage/i);
});

test("normal / keeps the production IDE surface and does not become embed-only", () => {
  assert.match(index, /id=["']runBtn["']/);
  assert.match(index, /id=["']uploadProgramBtn["']/);
  assert.match(index, /id=["']competitionResultPanel["']/);
  assert.match(app, /(?:normal|!isEmbedMode)[^\n]{0,120}(?:runProgram|upload|competition|teacher)/i);
  assert.doesNotMatch(app, /if\s*\(isEmbedMode\)\s*return\s*;\s*\/\/\s*normal/i);
});
