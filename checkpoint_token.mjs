export const CHECKPOINT_TOKEN_ID = "orange-checkpoint-token";
export const CHECKPOINT_PROGRESS = Object.freeze({
  READY: "READY",
  AT_P7: "TOKEN_AT_P7",
  COMPLETED: "COMPLETED",
});

const VALID_POSITIONS = new Set(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);

export function createCheckpointToken() {
  return {
    id: CHECKPOINT_TOKEN_ID,
    position: "P1",
    carried: false,
    progress: CHECKPOINT_PROGRESS.READY,
  };
}

export function resetCheckpointToken() {
  return createCheckpointToken();
}

export function createInitialSortableBlocks() {
  return [
    { id: "P1", position: "P3", label: "P1", color: 0xf06b62, objectClass: "chicken" },
    { id: "P3", position: "P4", label: "P3", color: 0xe7c85f, objectClass: "dog" },
    { id: "P5", position: "P5", label: "P5", color: 0x56a9d9, objectClass: "chair" },
    { id: "P6", position: "P6", label: "P6", color: 0x7187d8, objectClass: "umbrella" },
    { id: "P7", position: "P2", label: "P7", color: 0xa879d6, objectClass: "elephant" },
  ];
}

function copyToken(token) {
  return {
    id: CHECKPOINT_TOKEN_ID,
    position: token?.position === "P7" ? "P7" : "P1",
    carried: Boolean(token?.carried),
    progress: Object.values(CHECKPOINT_PROGRESS).includes(token?.progress)
      ? token.progress
      : CHECKPOINT_PROGRESS.READY,
  };
}

export function transitionCheckpointToken(token, event, context = {}) {
  const current = copyToken(token);
  const sortableBlocks = Array.isArray(context.sortableBlocks)
    ? context.sortableBlocks
    : [];
  const eventValid =
    event?.type === "release" &&
    event.tokenId === CHECKPOINT_TOKEN_ID &&
    current.id === CHECKPOINT_TOKEN_ID &&
    VALID_POSITIONS.has(event.from) &&
    VALID_POSITIONS.has(event.to) &&
    current.carried &&
    event.from === current.position &&
    !sortableBlocks.some((block) => !block?.carried && block.position === event.to);

  if (!eventValid) return { accepted: false, token: current, event: null };

  const validStart =
    current.progress === CHECKPOINT_PROGRESS.READY &&
    event.from === "P1" &&
    event.to === "P7";
  const validFinish =
    current.progress === CHECKPOINT_PROGRESS.AT_P7 &&
    event.from === "P7" &&
    event.to === "P1";
  if (!validStart && !validFinish)
    return { accepted: false, token: current, event: null };

  const next = {
    ...current,
    position: event.to,
    carried: false,
    progress: validFinish
      ? CHECKPOINT_PROGRESS.COMPLETED
      : CHECKPOINT_PROGRESS.AT_P7,
  };
  return {
    accepted: true,
    token: next,
    event: validFinish ? "COMPLETED" : "TOKEN_AT_P7",
  };
}
