export const POSITIONS = Object.freeze(["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);

export const POSITION_INDEX = Object.freeze(Object.fromEntries(
  POSITIONS.map((position, index) => [position, index + 1]),
));

export const COMPETITION_SOURCE_FIXTURE = Object.freeze({
  P1: "marker",
  P2: "dog",
  P3: "chicken",
  P4: "chair",
  P5: "house",
  P6: "car",
  P7: null,
});

export const SCORED_INITIAL_FIXTURE = Object.freeze({
  P1: null,
  P2: "dog",
  P3: "chicken",
  P4: "chair",
  P5: "house",
  P6: "car",
  P7: "marker",
});

export const TARGET_FIXTURE = Object.freeze({
  P1: null,
  P2: "car",
  P3: "chicken",
  P4: "dog",
  P5: "chair",
  P6: "house",
  P7: "marker",
});

export const OPTIMAL_STEPS = 5;
export const OPTIMAL_DISTANCE = 10;

const cloneFixture = (fixture) => Object.fromEntries(
  POSITIONS.map((position) => [position, fixture[position] ?? null]),
);

const fixturesEqual = (left, right) => POSITIONS.every(
  (position) => (left?.[position] ?? null) === (right?.[position] ?? null),
);

const invalidState = (state, reason) => ({
  ...state,
  fixture: cloneFixture(state.fixture),
  gripper: state.gripper ? { ...state.gripper } : null,
  phase: "invalid",
  error: reason,
});

export function createCompetitionState() {
  return {
    phase: "opening",
    fixture: cloneFixture(COMPETITION_SOURCE_FIXTURE),
    gripper: null,
    steps: 0,
    distance: 0,
    correct: null,
    score: null,
    error: null,
  };
}

function reduceGrip(state, event) {
  if (event.success === false) return state;
  const position = event.position;
  if (!POSITION_INDEX[position] || state.gripper) {
    return invalidState(state, "Invalid grip state.");
  }
  const blockId = state.fixture[position];
  if (!blockId) return invalidState(state, `Cannot grip an empty slot (${position}).`);
  if (state.phase === "opening" && (position !== "P1" || blockId !== "marker")) {
    return invalidState(state, "Opening must move the marker from P1 to P7.");
  }
  if (state.phase === "scoring" && blockId === "marker") {
    return invalidState(state, "The orange marker is not a scored block.");
  }
  const fixture = cloneFixture(state.fixture);
  fixture[position] = null;
  return {
    ...state,
    fixture,
    gripper: { blockId, source: position },
    error: null,
  };
}

function reduceRelease(state, event) {
  if (event.success === false) return state;
  const destination = event.position;
  if (!POSITION_INDEX[destination] || !state.gripper) {
    return invalidState(state, "release() requires a carried block and a valid slot.");
  }
  if (state.fixture[destination] != null) {
    return invalidState(state, `Destination ${destination} is occupied.`);
  }
  const { blockId, source } = state.gripper;
  if (state.phase === "opening" && (blockId !== "marker" || source !== "P1" || destination !== "P7")) {
    return invalidState(state, "Opening must move the marker from P1 to P7.");
  }
  if (state.phase === "scoring" && blockId === "marker") {
    return invalidState(state, "The orange marker is not a scored block.");
  }

  const fixture = cloneFixture(state.fixture);
  fixture[destination] = blockId;
  const committed = state.phase === "scoring" && source !== destination;
  return {
    ...state,
    fixture,
    gripper: null,
    steps: state.steps + (committed ? 1 : 0),
    distance: state.distance + (committed
      ? Math.abs(POSITION_INDEX[source] - POSITION_INDEX[destination])
      : 0),
    error: null,
  };
}

export function reduceCompetitionEvent(inputState, event = {}) {
  const state = {
    ...inputState,
    fixture: cloneFixture(inputState.fixture),
    gripper: inputState.gripper ? { ...inputState.gripper } : null,
  };
  if (["completed", "cancelled", "invalid"].includes(state.phase)) return state;

  if (event.type === "cancel") {
    return { ...state, phase: "cancelled", error: null };
  }
  if (event.type === "activate") {
    if (state.phase !== "opening" || state.gripper || !fixturesEqual(state.fixture, SCORED_INITIAL_FIXTURE)) {
      return invalidState(state, "Competition opening is incomplete.");
    }
    return { ...state, phase: "scoring", steps: 0, distance: 0, error: null };
  }
  if (event.type === "complete") {
    if (state.phase !== "scoring") {
      return invalidState(state, "Competition is not accepting completion.");
    }
    // Workshop runs may finish mid-action. Keep the run visible and score it
    // as incomplete instead of turning a harmless student experiment into an
    // IDE error.
    const correct = !state.gripper && fixturesEqual(state.fixture, TARGET_FIXTURE);
    return {
      ...state,
      phase: "completed",
      correct,
      score: calculateCompetitionScore({ correct, steps: state.steps, distance: state.distance }),
      error: null,
    };
  }
  if (!["opening", "scoring"].includes(state.phase)) {
    return invalidState(state, "Competition is not accepting actions.");
  }
  if (event.type === "grip") return reduceGrip(state, event);
  if (event.type === "release") return reduceRelease(state, event);
  return invalidState(state, `Unsupported competition event: ${event.type || "unknown"}.`);
}

export function roundHalfUpRational(numerator, denominator, decimals = 0) {
  if (typeof numerator !== "bigint" || typeof denominator !== "bigint" || denominator <= 0n) {
    throw new TypeError("roundHalfUpRational expects BigInt values and a positive denominator.");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
    throw new RangeError("decimals must be an integer from 0 to 8.");
  }
  const scale = 10n ** BigInt(decimals);
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const scaled = absolute * scale;
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const rounded = quotient + (remainder * 2n >= denominator ? 1n : 0n);
  return Number(negative ? -rounded : rounded) / Number(scale);
}

export function calculateCompetitionScore({ correct, steps, distance }) {
  if (![steps, distance].every((value) => Number.isInteger(value) && value >= 0)) {
    throw new TypeError("steps and distance must be non-negative integers.");
  }
  if (!correct) return 0;
  const safeSteps = Math.max(OPTIMAL_STEPS, steps);
  const safeDistance = Math.max(OPTIMAL_DISTANCE, distance);
  const stepDenominator = BigInt(safeSteps);
  const distanceDenominator = BigInt(safeDistance);
  const denominator = stepDenominator * distanceDenominator;
  const numerator = (
    60n * denominator
    + 125n * distanceDenominator
    + 150n * stepDenominator
  );
  return Math.min(100, roundHalfUpRational(numerator, denominator, 2));
}

export function compareCompetitionMetrics(left, right) {
  if (left.score !== right.score) return right.score - left.score;
  if (left.steps !== right.steps) return left.steps - right.steps;
  if (left.distance !== right.distance) return left.distance - right.distance;
  return 0;
}

export function compareCompetitionResults(left, right) {
  return compareCompetitionMetrics(left, right)
    || String(left.solutionName).localeCompare(String(right.solutionName), "en");
}

export function isBetterCompetitionResult(candidate, current) {
  if (!current) return true;
  return compareCompetitionMetrics(candidate, current) < 0;
}
