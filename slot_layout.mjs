import { createInitialSortableBlocks } from "./checkpoint_token.mjs";

export const CANONICAL_SLOT_IDS = Object.freeze([
  "P1",
  "P2",
  "P3",
  "P4",
  "P5",
  "P6",
  "P7",
]);

export function createInitialSlotLayout() {
  const blocks = createInitialSortableBlocks();
  return CANONICAL_SLOT_IDS.map((id) => ({
    id,
    point: id,
    label: id,
    block: blocks.find((block) => block.position === id) || null,
  }));
}

export function getApiPositions(blocksOrLayout = []) {
  const blocks = blocksOrLayout.map((entry) => entry?.block || entry).filter(Boolean);
  return Object.fromEntries(
    CANONICAL_SLOT_IDS.map((id) => [
      id,
      blocks.some((block) => !block.carried && block.position === id),
    ]),
  );
}
