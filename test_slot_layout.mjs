import test from "node:test";
import assert from "node:assert/strict";

import {
  CANONICAL_SLOT_IDS,
  createInitialSlotLayout,
  getApiPositions,
} from "./slot_layout.mjs";

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

test("reset input order is car, chicken, dog, chair, house while P1/P7 remain empty", () => {
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
