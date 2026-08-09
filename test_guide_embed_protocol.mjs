import test from "node:test";
import assert from "node:assert/strict";

import {
  EMBED_QUERY,
  EVENT_TYPES,
  GUIDE_COMMANDS,
  GUIDE_SAMPLE_IDS,
  PROFILES,
  PROTOCOL_VERSION,
  VIEWS,
  createGuideCommandMessage,
  getGuideSampleSteps,
  createEmbedStorage,
  isAllowedGuideCommand,
  isGuideEmbedUrl,
  isSnapshotPayloadAllowed,
  isTrustedEmbedMessage,
  validateEmbedEvent,
  validateParentMessage,
} from "./guide-embed-protocol.mjs";

test("guide embed URL is query-driven and does not create a public route", () => {
  assert.equal(EMBED_QUERY, "guide");
  assert.equal(isGuideEmbedUrl("/?embed=guide"), true);
  assert.equal(isGuideEmbedUrl("/index.html?embed=guide"), true);
  assert.equal(isGuideEmbedUrl("/project-guide?embed=guide"), false);
  assert.equal(isGuideEmbedUrl("/embed-simulator"), false);
  assert.equal(isGuideEmbedUrl("/?embed=other"), false);
  assert.equal(isGuideEmbedUrl("https://evil.example/?embed=guide"), false);
});

test("protocol exposes stable profiles, camera views, and bounded sample IDs", () => {
  assert.deepEqual(PROFILES, ["fr3", "fr5"]);
  assert.deepEqual(VIEWS, ["home", "front", "right", "back", "left"]);
  assert.deepEqual(GUIDE_SAMPLE_IDS, ["p2-to-p7"]);
  assert.equal(PROTOCOL_VERSION, 1);
  const first = getGuideSampleSteps("p2-to-p7");
  const second = getGuideSampleSteps("p2-to-p7");
  assert.ok(first.length > 0 && first.length <= 32);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(getGuideSampleSteps("unknown"), null);
});

test("single command cards allow only documented API methods", () => {
  assert.deepEqual(GUIDE_COMMANDS, [
    "move_to",
    "move_down",
    "move_up",
    "grip",
    "release",
    "get_positions",
  ]);
  const move = createGuideCommandMessage("move_to", "P7");
  assert.deepEqual(move, {
    protocol: PROTOCOL_VERSION,
    type: "guide:run-command",
    command: "move_to",
    position: "P7",
  });
  assert.deepEqual(createGuideCommandMessage("move_down"), {
    protocol: PROTOCOL_VERSION,
    type: "guide:run-command",
    command: "move_down",
  });
  assert.equal(createGuideCommandMessage("move_to"), null);
  assert.equal(createGuideCommandMessage("move_to", "P8"), null);
  assert.equal(createGuideCommandMessage("eval", "P1"), null);
  assert.equal(isAllowedGuideCommand("move_to", "P7"), true);
  assert.equal(isAllowedGuideCommand("move_to", "P8"), false);
});

test("parent message validation rejects arbitrary source and malformed payloads", () => {
  const init = validateParentMessage({
    protocol: PROTOCOL_VERSION,
    type: "guide:init",
    source: "project-guide",
  });
  assert.deepEqual(init, {
    protocol: PROTOCOL_VERSION,
    type: "guide:init",
    source: "project-guide",
  });
  assert.deepEqual(validateParentMessage({
    protocol: PROTOCOL_VERSION,
    type: "guide:set-profile",
    profile: "fr5",
  }), {
    protocol: PROTOCOL_VERSION,
    type: "guide:set-profile",
    profile: "fr5",
  });
  assert.equal(validateParentMessage({ protocol: 2, type: "guide:init", source: "project-guide" }), null);
  assert.equal(validateParentMessage({ protocol: 1, type: "guide:init", source: "other-page" }), null);
  assert.equal(validateParentMessage({ protocol: 1, type: "guide:run-sample", sampleId: "python:alert(1)" }), null);
  assert.equal(validateParentMessage({ protocol: 1, type: "guide:set-zoom", value: 9999 }), null);
  assert.equal(validateParentMessage({ protocol: 1, type: "guide:capture", view: "sideways" }), null);
});

test("iframe event names are explicitly allowlisted", () => {
  assert.deepEqual(EVENT_TYPES, [
    "guide:ready",
    "guide:state",
    "guide:running",
    "guide:command",
    "guide:step",
    "guide:complete",
    "guide:error",
    "guide:reset",
    "guide:snapshot",
  ]);
  assert.deepEqual(validateEmbedEvent({ protocol: 1, type: "guide:ready" }), {
    protocol: 1,
    type: "guide:ready",
  });
  assert.equal(validateEmbedEvent({ protocol: 2, type: "guide:ready" }), null);
  assert.equal(validateEmbedEvent({ protocol: 1, type: "guide:arbitrary" }), null);
});

test("embed storage is memory-scoped and cannot write parent storage", () => {
  const parent = new Map();
  const parentStorage = {
    getItem: (key) => parent.get(key) ?? null,
    setItem: (key, value) => parent.set(key, String(value)),
    removeItem: (key) => parent.delete(key),
  };
  const scoped = createEmbedStorage({ storage: parentStorage, embed: true });
  scoped.setItem("camera", "fr5");
  assert.equal(scoped.getItem("camera"), "fr5");
  assert.equal(parentStorage.getItem("camera"), null);
  scoped.removeItem("camera");
  assert.equal(scoped.getItem("camera"), null);
});

test("message trust requires exact origin and iframe source", () => {
  const frame = {};
  const event = { origin: "https://fairino-robot-simulator.vercel.app", source: frame };
  assert.equal(isTrustedEmbedMessage(event, event.origin, frame), true);
  assert.equal(isTrustedEmbedMessage({ ...event, origin: "https://evil.example" }, event.origin, frame), false);
  assert.equal(isTrustedEmbedMessage({ ...event, source: {} }, event.origin, frame), false);
  assert.equal(isTrustedEmbedMessage(null, event.origin, frame), false);
});

test("snapshot payload boundary is measured in bytes", () => {
  assert.equal(isSnapshotPayloadAllowed("x".repeat(2_000_000)), true);
  assert.equal(isSnapshotPayloadAllowed("x".repeat(2_000_001)), false);
  assert.equal(isSnapshotPayloadAllowed("😀".repeat(1_000_000)), false);
});
