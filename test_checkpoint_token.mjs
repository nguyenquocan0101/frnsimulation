import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECKPOINT_TOKEN_ID,
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

test("orange marker starts at P1 and fixture has five sortable blocks", () => {
  assert.deepEqual(createCheckpointToken(), {
    id: CHECKPOINT_TOKEN_ID,
    position: "P1",
    carried: false,
  });
  assert.deepEqual(blocks(), EXPECTED_BLOCKS);
  assert.equal(blocks().some((block) => block.id === "P2"), false);
  assert.equal(blocks().some((block) => ["P1", "P7"].includes(block.position)), false);
  assert.equal(blocks().some((block) => block.position === "P2" && block.id === "P7"), true);
});

test("marker can be placed freely without completion or route validation", () => {
  const initial = { ...createCheckpointToken(), carried: true };
  const toP1 = release(initial, "P1", "P1");
  assert.equal(toP1.accepted, true);
  assert.deepEqual(toP1.token, {
    id: CHECKPOINT_TOKEN_ID,
    position: "P1",
    carried: false,
  });

  const toP7 = release({ ...toP1.token, carried: true }, "P1", "P7");
  assert.equal(toP7.accepted, true);
  assert.equal(toP7.token.position, "P7");
  assert.equal(Object.prototype.hasOwnProperty.call(toP7.token, "progress"), false);
});

test("invalid or occupied marker drops fail closed, but no success state is created", () => {
  const initial = { ...createCheckpointToken(), carried: true };
  const invalid = release(initial, "P1", "P8");
  assert.equal(invalid.accepted, false);
  assert.deepEqual(invalid.token, initial);

  const occupied = release(initial, "P1", "P3");
  assert.equal(occupied.accepted, false);
  assert.deepEqual(occupied.token, initial);
});

test("reset returns marker to P1 without progress metadata", () => {
  assert.deepEqual(resetCheckpointToken({ position: "P6", carried: true }), {
    id: CHECKPOINT_TOKEN_ID,
    position: "P1",
    carried: false,
  });
});

test("marker stays separate from sortable records and API positions", async () => {
  const module = await import("./slot_layout.mjs");
  const apiPositions = module.getApiPositions(blocks());
  assert.deepEqual(Object.keys(apiPositions), ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
  assert.equal(apiPositions.P2, true);
  assert.equal(apiPositions.P7, false);
  assert.equal(Object.prototype.hasOwnProperty.call(apiPositions, CHECKPOINT_TOKEN_ID), false);
  assert.equal(blocks().length, 5);
});
