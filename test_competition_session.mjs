import test from "node:test";
import assert from "node:assert/strict";

import { COMPETITION_SOURCE_FIXTURE } from "./competition-engine.mjs";
import { createCompetitionSession, runCompetitionSession } from "./competition-session.mjs";

test("a session starts with the marker at P1 and does not move it automatically", () => {
  const session = createCompetitionSession();
  assert.equal(session.state.steps, 0);
  assert.equal(session.state.distance, 0);
  assert.equal(session.state.phase, "opening");
  assert.equal(session.activateOpening(), true);
  assert.equal(session.state.phase, "scoring");
  assert.deepEqual(session.state.fixture, COMPETITION_SOURCE_FIXTURE);
  assert.equal(session.state.steps, 0);
  assert.equal(session.state.distance, 0);
});

test("preflight errors cause no reset, marker motion, playback, or capture", async () => {
  const calls = [];
  const result = await runCompetitionSession({
    preflight: async () => ({ ok: false, error: { line: 3, message: "bad syntax" } }),
    reset: async () => calls.push("reset"),
    opening: async () => calls.push("opening"),
    replay: async () => calls.push("replay"),
    capture: async () => calls.push("capture"),
  });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, []);
});

test("valid run resets, opens, replays, completes, and captures once", async () => {
  const calls = [];
  const result = await runCompetitionSession({
    preflight: async () => ({ ok: true, actions: [] }),
    reset: async () => calls.push("reset"),
    opening: async (session) => {
      calls.push("opening");
      assert.equal(session.activateOpening(), true);
    },
    replay: async () => calls.push("replay"),
    capture: async ({ state }) => {
      calls.push("capture");
      return { state };
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["reset", "opening", "replay", "capture"]);
  assert.equal(result.state.steps, 0);
});

test("capture failures do not erase the completed score", async () => {
  const result = await runCompetitionSession({
    preflight: async () => ({ ok: true, actions: [] }),
    reset: async () => {},
    opening: async (session) => { session.activateOpening(); },
    replay: async () => {},
    capture: async () => { throw new Error("canvas unavailable"); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.captureError.message, "canvas unavailable");
  assert.equal(result.state.phase, "completed");
});
