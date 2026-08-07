import test from "node:test";
import assert from "node:assert/strict";

import {
  createCheckpointToken,
  createInitialSortableBlocks,
  resetCheckpointToken,
  transitionCheckpointToken,
} from "./checkpoint_token.mjs";

const EXPECTED_BLOCKS = [
  { id: "P1", position: "P3", label: "P1", color: 0xf06b62, objectClass: "chicken" },
  { id: "P3", position: "P4", label: "P3", color: 0xe7c85f, objectClass: "dog" },
  { id: "P5", position: "P5", label: "P5", color: 0x56a9d9, objectClass: "chair" },
  { id: "P6", position: "P6", label: "P6", color: 0x7187d8, objectClass: "umbrella" },
  { id: "P7", position: "P2", label: "P7", color: 0xa879d6, objectClass: "elephant" },
];

const blocks = () => createInitialSortableBlocks();
const release = (token, from, to, overrides = {}) =>
  transitionCheckpointToken(
    token,
    { type: "release", tokenId: token.id, from, to },
    { sortableBlocks: blocks(), ...overrides },
  );

test("checkpoint token starts stable at P1 and fixture has exact five semantic blocks", () => {
  const token = createCheckpointToken();
  assert.deepEqual(token, {
    id: "orange-checkpoint-token",
    position: "P1",
    carried: false,
    progress: "READY",
  });
  assert.deepEqual(blocks(), EXPECTED_BLOCKS);
  assert.equal(blocks().some((block) => block.id === "P2"), false);
  assert.equal(blocks().some((block) => ["P1", "P7"].includes(block.position)), false);
  assert.equal(blocks().some((block) => block.position === "P2" && block.id === "P7"), true);
});

test("same token completes only after explicit P1 to P7 then P7 to P1 releases", () => {
  const initial = { ...createCheckpointToken(), carried: true };
  const checkpoint = release(initial, "P1", "P7");
  assert.equal(checkpoint.accepted, true);
  assert.equal(checkpoint.token.progress, "TOKEN_AT_P7");
  assert.equal(checkpoint.token.position, "P7");
  assert.equal(checkpoint.token.carried, false);

  const completed = release(
    { ...checkpoint.token, carried: true },
    "P7",
    "P1",
  );
  assert.equal(completed.accepted, true);
  assert.equal(completed.token.progress, "COMPLETED");
  assert.equal(completed.token.position, "P1");
  assert.equal(completed.token.carried, false);
});

test("invalid, direct, duplicate, unknown, malformed, or occupied releases fail closed", () => {
  const initial = { ...createCheckpointToken(), carried: true };
  const invalidEvents = [
    ["P1", "P1"],
    ["P1", "P3"],
    ["P1", "P2"],
    ["P7", "P1"],
    ["P1", "P8"],
  ];
  for (const [from, to] of invalidEvents) {
    const result = release(initial, from, to);
    assert.equal(result.accepted, false, `${from}->${to}`);
    assert.equal(result.token.progress, "READY", `${from}->${to}`);
    assert.equal(result.token.position, "P1", `${from}->${to}`);
  }

  const unknown = transitionCheckpointToken(
    initial,
    { type: "release", tokenId: "not-the-orange-token", from: "P1", to: "P7" },
    { sortableBlocks: blocks() },
  );
  assert.equal(unknown.accepted, false);
  assert.equal(unknown.token.progress, "READY");

  const checkpoint = release(initial, "P1", "P7");
  const repeated = release({ ...checkpoint.token, carried: true }, "P7", "P7");
  assert.equal(repeated.accepted, false);
  assert.equal(repeated.token.progress, "TOKEN_AT_P7");
  assert.equal(repeated.token.position, "P7");
});

test("reset clears carrying/progress and returns token to P1 READY", () => {
  const token = { ...createCheckpointToken(), carried: true };
  const checkpoint = release(token, "P1", "P7");
  const reset = resetCheckpointToken({ ...checkpoint.token, carried: true });
  assert.deepEqual(reset, {
    id: "orange-checkpoint-token",
    position: "P1",
    carried: false,
    progress: "READY",
  });
});

test("token is separate from sortable records and API position payload", async () => {
  const module = await import("./slot_layout.mjs");
  const apiPositions = module.getApiPositions(blocks());
  assert.deepEqual(Object.keys(apiPositions), ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
  assert.equal(apiPositions.P2, true);
  assert.equal(apiPositions.P7, false);
  assert.equal(Object.prototype.hasOwnProperty.call(apiPositions, "orange-checkpoint-token"), false);
  assert.equal(blocks().length, 5);
});
