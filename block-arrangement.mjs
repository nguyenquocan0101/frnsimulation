export const BLOCK_ARRANGEMENT_ANIMATION_MS = 300;

export function planBlockPlacement(
  blocks,
  blockName,
  targetPosition,
  validPositions,
) {
  if (!Array.isArray(blocks) || !Array.isArray(validPositions)) {
    return { accepted: false, reason: "invalid-state" };
  }
  if (!validPositions.includes(targetPosition)) {
    return { accepted: false, reason: "invalid-position" };
  }

  const source = blocks.find((block) => block.name === blockName);
  if (!source || source.carried) {
    return { accepted: false, reason: "unavailable-block" };
  }
  if (source.position === targetPosition) {
    return { accepted: false, reason: "unchanged" };
  }

  const displaced = blocks.find(
    (block) =>
      block !== source &&
      !block.carried &&
      block.position === targetPosition,
  );
  const sourcePosition = source.position ?? null;
  const displacedPosition = displaced?.position ?? null;
  const nextBlocks = blocks.map((block) => {
    if (block === source) return { ...block, position: targetPosition };
    if (block === displaced) return { ...block, position: sourcePosition };
    return { ...block };
  });

  return {
    accepted: true,
    kind: displaced ? "swap" : "place",
    blockName: source.name,
    displacedBlockName: displaced?.name ?? null,
    sourcePosition,
    targetPosition,
    displacedPosition,
    blocks: nextBlocks,
  };
}

export function orderBlocksForPalette(blocks, classOrder, validPositions) {
  const slotOrder = new Map(
    validPositions.map((position, index) => [position, index]),
  );
  const fallbackOrder = new Map(
    classOrder.map((blockName, index) => [blockName, index]),
  );
  return [...blocks].sort((left, right) => {
    const leftPosition = slotOrder.has(left.position)
      ? slotOrder.get(left.position)
      : Number.MAX_SAFE_INTEGER;
    const rightPosition = slotOrder.has(right.position)
      ? slotOrder.get(right.position)
      : Number.MAX_SAFE_INTEGER;
    return (
      leftPosition - rightPosition ||
      (fallbackOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
        (fallbackOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER)
    );
  });
}
