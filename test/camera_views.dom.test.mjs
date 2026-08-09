import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCameraViews,
  deriveCameraBasis,
  migrateZoomValue,
  nextCameraViewIndex,
} from "../camera-view.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("camera UI exposes the canonical four-view cycle without profile offsets", () => {
  const views = buildCameraViews(deriveCameraBasis());
  assert.deepEqual(views.map((view) => view.name), ["Front", "Right", "Back", "Left"]);
  assert.equal(nextCameraViewIndex(0, 4), 0);
  assert.doesNotMatch(appSource, /CAMERA_VIEW_OFFSET_BY_PROFILE/);
  assert.doesNotMatch(appSource, /HOME_CAMERA_TARGET_BY_PROFILE/);
  assert.match(htmlSource, /id="changeViewBtn"/);
  assert.match(htmlSource, /id="homeViewBtn"/);
});

test("camera state hooks and zoom migration are deterministic", () => {
  assert.match(appSource, /data-camera-view/);
  assert.match(appSource, /data-camera-zoom/);
  assert.match(appSource, /HOME_CAMERA_PRESET_VIEW_INDEX = 2/);
  assert.match(appSource, /HOME_CAMERA_PRESET_ZOOM = 200/);
  assert.match(htmlSource, /id="cameraZoomRange"[\s\S]*max="200"/);
  assert.deepEqual(migrateZoomValue(118), { value: 100, userSet: false, version: 1 });
  assert.deepEqual(migrateZoomValue({ value: 118, userSet: true, version: 1 }), {
    value: 118,
    userSet: true,
    version: 1,
  });
});

test("all board slot labels remain generated independently of camera direction", () => {
  assert.match(appSource, /BLOCK_POSITIONS\.forEach\(\(name\) =>/);
  assert.match(appSource, /const frontLabelName = name/);
  assert.doesNotMatch(appSource, /BLOCK_POSITIONS\[BLOCK_POSITIONS\.length - 1 - index\]/);
  assert.match(appSource, /makeFrontBoardLabel\(/);
  assert.match(appSource, /syncBoardLabelMirroring\(\);/);
  assert.match(appSource, /texture\.flipY = true/);
  assert.match(appSource, /texture\.repeat\.x = 1/);
  assert.doesNotMatch(appSource, /backReferenceView/);
  assert.match(appSource, /label\.scale\.set\(0\.07, 0\.032, 1\)/);
});
