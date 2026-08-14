import test from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_SLOT_IDS,
  createInitialSlotLayout,
  getApiPositions,
} from "./slot_layout.mjs";
import {
  BLOCK_ARRANGEMENT_ANIMATION_MS,
  orderBlocksForPalette,
  planBlockPlacement,
} from "./block-arrangement.mjs";

const EXPECTED_BLOCK_AT = {
  P1: null,
  P2: "P7",
  P3: "P1",
  P4: "P3",
  P5: "P5",
  P6: "P6",
  P7: null,
};

test("visible reset layout contains exactly canonical P1 through P7 slots", () => {
  assert.deepEqual(CANONICAL_SLOT_IDS, ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
  const layout = createInitialSlotLayout();
  assert.deepEqual(layout.map((slot) => slot.id), CANONICAL_SLOT_IDS);
  assert.deepEqual(layout.map((slot) => slot.point), CANONICAL_SLOT_IDS);
  assert.equal(new Set(layout.map((slot) => slot.point)).size, 7);
});

test("reset input order keeps five animal blocks while P1/P7 remain empty", () => {
  const layout = createInitialSlotLayout();
  const blocksBySlot = Object.fromEntries(
    layout.map((slot) => [slot.id, slot.block?.id ?? null]),
  );
  assert.deepEqual(blocksBySlot, EXPECTED_BLOCK_AT);

  const p2 = layout.find((slot) => slot.id === "P2");
  const p2Block = p2.block;
  assert.equal(p2Block.label, "P7");
  assert.equal(p2.label, "P2");
  assert.notEqual(p2Block.label, p2.label);
  assert.equal(layout.find((slot) => slot.id === "P7").block, null);
});

test("every slot has an accessible label and unique point source", () => {
  const layout = createInitialSlotLayout();
  for (const slot of layout) {
    assert.equal(typeof slot.label, "string");
    assert.ok(slot.label.length > 0);
    assert.equal(slot.label, slot.id);
    assert.equal(typeof slot.point, "string");
  }
  assert.equal(new Set(layout.map((slot) => slot.label)).size, 7);
});

test("canonical P1-P7 API names remain accepted and token is not an API position", () => {
  const layout = createInitialSlotLayout();
  const positions = getApiPositions(layout);
  assert.deepEqual(Object.keys(positions), CANONICAL_SLOT_IDS);
  assert.equal(positions.P2, true);
  assert.equal(positions.P7, false);
  assert.equal(Object.prototype.hasOwnProperty.call(positions, "orange-checkpoint-token"), false);
});

const arrangementBlocks = () => [
  { name: "dog", position: "P2", carried: false },
  { name: "bird", position: "P3", carried: false },
  { name: "bear", position: "P4", carried: false },
  { name: "cat", position: "P5", carried: false },
  { name: "cow", position: "P6", carried: false },
  { name: "dolphin", position: null, carried: false },
  { name: "elephant", position: null, carried: false },
  { name: "giraffe", position: null, carried: false },
  { name: "horse", position: null, carried: false },
];

test("arrangement placement uses all P1-P7 slots and preserves every block", () => {
  const result = planBlockPlacement(
    arrangementBlocks(),
    "dolphin",
    "P1",
    CANONICAL_SLOT_IDS,
  );
  assert.equal(result.accepted, true);
  assert.equal(result.kind, "place");
  assert.equal(result.blocks.find((block) => block.name === "dolphin").position, "P1");
  assert.equal(result.blocks.length, 9);
  assert.equal(new Set(result.blocks.map((block) => block.name)).size, 9);
});

test("occupied placement atomically swaps both animals", () => {
  const result = planBlockPlacement(
    arrangementBlocks(),
    "dog",
    "P3",
    CANONICAL_SLOT_IDS,
  );
  assert.equal(result.accepted, true);
  assert.equal(result.kind, "swap");
  assert.equal(result.blocks.find((block) => block.name === "dog").position, "P3");
  assert.equal(result.blocks.find((block) => block.name === "bird").position, "P2");
});

test("an outside animal replaces an occupied slot without duplicates", () => {
  const result = planBlockPlacement(
    arrangementBlocks(),
    "horse",
    "P2",
    CANONICAL_SLOT_IDS,
  );
  assert.equal(result.accepted, true);
  assert.equal(result.blocks.find((block) => block.name === "horse").position, "P2");
  assert.equal(result.blocks.find((block) => block.name === "dog").position, null);
  const occupied = result.blocks.filter((block) => block.position);
  assert.equal(new Set(occupied.map((block) => block.position)).size, occupied.length);
});

test("invalid and unchanged drops do not produce a state commit", () => {
  assert.deepEqual(
    planBlockPlacement(arrangementBlocks(), "dog", "P9", CANONICAL_SLOT_IDS),
    { accepted: false, reason: "invalid-position" },
  );
  assert.deepEqual(
    planBlockPlacement(arrangementBlocks(), "dog", "P2", CANONICAL_SLOT_IDS),
    { accepted: false, reason: "unchanged" },
  );
});

test("palette order follows P positions after twenty swaps", () => {
  let blocks = arrangementBlocks();
  for (let index = 0; index < 20; index += 1) {
    const dogPosition = blocks.find((block) => block.name === "dog").position;
    const target = dogPosition === "P2" ? "P3" : "P2";
    const result = planBlockPlacement(blocks, "dog", target, CANONICAL_SLOT_IDS);
    assert.equal(result.accepted, true);
    blocks = result.blocks;
    assert.equal(new Set(blocks.map((block) => block.name)).size, 9);
    const occupied = blocks.filter((block) => block.position);
    assert.equal(new Set(occupied.map((block) => block.position)).size, occupied.length);
  }
  const order = orderBlocksForPalette(
    blocks,
    arrangementBlocks().map((block) => block.name),
    CANONICAL_SLOT_IDS,
  );
  assert.deepEqual(order.slice(0, 5).map((block) => block.position), [
    "P2",
    "P3",
    "P4",
    "P5",
    "P6",
  ]);
  assert.equal(BLOCK_ARRANGEMENT_ANIMATION_MS, 300);
});
