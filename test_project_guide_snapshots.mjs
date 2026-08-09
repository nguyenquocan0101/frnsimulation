import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
const controller = fs.readFileSync(new URL("./project-guide-playground.mjs", import.meta.url), "utf8");

test("embed capture renders before encoding and rejects oversized payloads", () => {
  assert.match(app, /isSnapshotPayloadAllowed/);
  const render = app.indexOf("function captureEmbedSnapshot");
  const renderCall = app.indexOf("renderScene();", render);
  const encodeCall = app.indexOf("toDataURL(\"image/png\")", render);
  assert.ok(renderCall >= render && renderCall < encodeCall, "render must precede toDataURL");
  assert.match(app.slice(render, encodeCall + 80), /isSnapshotPayloadAllowed\(dataUrl\)/);
});

test("snapshot event includes a safe view and bounded image payload", () => {
  const capture = app.slice(app.indexOf("function captureEmbedSnapshot"), app.indexOf("function initEmbedBridge"));
  assert.match(capture, /CAMERA_VIEW_NAMES/);
  assert.match(capture, /guide:snapshot/);
  assert.match(capture, /dataUrl/);
});

test("guide keeps one preview per camera view and replaces stale previews", () => {
  assert.match(controller, /data-view/);
  assert.match(controller, /replaceChildren|querySelectorAll/);
});

test("run and capture controls are guarded while a sample is active", () => {
  assert.match(controller, /running|busy|pending/i);
  assert.match(controller, /run-sample/);
  assert.match(controller, /capture/);
});

test("reset clears transient step and snapshot state", () => {
  assert.match(controller, /guide:reset/);
  assert.match(controller, /replaceChildren\(\)/);
});
