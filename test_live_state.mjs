import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isLiveStale,
  liveControlsLocked,
  stabilizeJointTarget,
  validateLivePacket,
} from "./live_state.mjs";

const limits = [
  [-360, 360],
  [-360, 360],
  [-360, 360],
  [-360, 360],
  [-360, 360],
  [-360, 360],
];

const packet = (overrides = {}) => ({
  type: "robot_state",
  robot_model: "FR5",
  joints: [-105.1, 102.4, -118.3, -70.1, -22.6, 232.1],
  tcp: [1089.1, 433.3, -142.9, 4.2, -0.98, 0],
  ...overrides,
});

test("valid FR5 packet returns six joints and TCP values", () => {
  const result = validateLivePacket(packet(), limits);
  assert.equal(result.ok, true);
  assert.equal(result.joints.length, 6);
  assert.equal(result.tcp.length, 6);
});

test("wrong model, NaN, and out-of-range joints are rejected", () => {
  assert.equal(validateLivePacket(packet({ robot_model: "FR3" }), limits).ok, false);
  assert.equal(validateLivePacket(packet({ joints: [NaN, 0, 0, 0, 0, 0] }), limits).ok, false);
  assert.equal(validateLivePacket(packet({ joints: [999, 0, 0, 0, 0, 0] }), limits).ok, false);
});

test("invalid TCP is rejected without coercion", () => {
  assert.equal(validateLivePacket(packet({ tcp: [1, 2, Infinity, 4, 5, 6] }), limits).ok, false);
  assert.equal(validateLivePacket(packet({ tcp: [1, 2, 3] }), limits).ok, false);
});

test("live lock covers connecting and open states", () => {
  assert.equal(liveControlsLocked({ connecting: true }), true);
  assert.equal(liveControlsLocked({ socketOpen: true }), true);
  assert.equal(liveControlsLocked({}), false);
});

test("simulator exposes every motion control audited by live lock", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  for (const id of ["enableBtn", "homeBtn", "stopBtn", "modeBtn", "applyBtn", "moveLBtn", "runBtn", "robotProfileSelect", "liveBtn"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /id=["']uploadProgramBtn["']/);
  assert.match(html, /id=["']toggleSceneObjectsBtn["']/);
  assert.match(html, /id=["']blockStateStrip["']/);
});

test("running a program leaves the orange marker at P1 until student code moves it", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const resetStart = app.indexOf("function resetCompetitionFixture");
  const resetEnd = app.indexOf("function switchRobotProfile", resetStart);
  const resetFixture = app.slice(resetStart, resetEnd);

  assert.match(resetFixture, /state\.checkpointToken = resetCheckpointToken\(\)/);
  assert.doesNotMatch(resetFixture, /checkpointToken.*position:\s*["']P7["']/);
  assert.doesNotMatch(app, /!state\.competitionSession\s*&&\s*\n?\s*this\.low/);
});

test("student print output replays in order with motion actions", () => {
  const app = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const preflightStart = app.indexOf("async function runPythonProgram");
  const preflightEnd = app.indexOf("function renderCompetitionResult", preflightStart);
  const preflight = app.slice(preflightStart, preflightEnd);
  const replayStart = app.indexOf("replay: async");
  const replayEnd = app.indexOf("capture: async", replayStart);
  const replay = app.slice(replayStart, replayEnd);

  assert.match(preflight, /some\(\(action\) => action\.type === ["']print["']\)/);
  assert.match(replay, /action\.type === ["']print["']/);
  assert.match(replay, /log\(["']print: ["']/);
});

test("stale detection uses local receipt time", () => {
  assert.equal(isLiveStale(2501, 500), true);
  assert.equal(isLiveStale(2400, 500), false);
  assert.equal(isLiveStale(2501, Number.NaN), false);
});

test("joint deadband holds encoder noise but keeps real motion", () => {
  const previous = [10, 20, 30, 40, 50, 60];
  assert.deepEqual(
    stabilizeJointTarget([10.01, 20, 30, 40, 50, 60], previous, 0.02),
    previous,
  );
  assert.deepEqual(
    stabilizeJointTarget([10.03, 20, 30, 40, 50, 60], previous, 0.02),
    [10.03, 20, 30, 40, 50, 60],
  );
});
