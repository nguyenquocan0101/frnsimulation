import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPETITION_SOURCE_FIXTURE,
  OPTIMAL_DISTANCE,
  OPTIMAL_STEPS,
  POSITIONS,
  POSITION_INDEX,
  SCORED_INITIAL_FIXTURE,
  TARGET_FIXTURE,
  calculateCompetitionScore,
  compareCompetitionMetrics,
  compareCompetitionResults,
  createCompetitionState,
  isBetterCompetitionResult,
  reduceCompetitionEvent,
  roundHalfUpRational,
} from "./competition-engine.mjs";

const SOURCE = {
  P1: "marker",
  P2: "dog",
  P3: "chicken",
  P4: "chair",
  P5: "house",
  P6: "car",
  P7: null,
};

const AFTER_OPENING = {
  P1: null,
  P2: "dog",
  P3: "chicken",
  P4: "chair",
  P5: "house",
  P6: "car",
  P7: "marker",
};

const TARGET = {
  P1: null,
  P2: "car",
  P3: "chicken",
  P4: "dog",
  P5: "chair",
  P6: "house",
  P7: "marker",
};

function event(state, type, position, overrides = {}) {
  return reduceCompetitionEvent(state, {
    type,
    ...(position ? { position } : {}),
    ...overrides,
  });
}

function openAndActivate() {
  let state = createCompetitionState();
  state = event(state, "grip", "P1", { success: true });
  state = event(state, "release", "P7", { success: true });

  assert.equal(state.phase, "opening");
  assert.deepEqual(state.fixture, AFTER_OPENING);
  assert.equal(state.steps, 0);
  assert.equal(state.distance, 0);

  state = event(state, "activate");
  assert.equal(state.phase, "scoring");
  assert.equal(state.steps, 0);
  assert.equal(state.distance, 0);
  return state;
}

function transfer(state, from, to) {
  state = event(state, "grip", from, { success: true });
  state = event(state, "release", to, { success: true });
  return state;
}

test("exports the exact immutable source, post-opening, and target fixtures", () => {
  assert.deepEqual(POSITIONS, ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]);
  assert.deepEqual(POSITION_INDEX, {
    P1: 1,
    P2: 2,
    P3: 3,
    P4: 4,
    P5: 5,
    P6: 6,
    P7: 7,
  });
  assert.deepEqual(COMPETITION_SOURCE_FIXTURE, SOURCE);
  assert.deepEqual(SCORED_INITIAL_FIXTURE, AFTER_OPENING);
  assert.deepEqual(TARGET_FIXTURE, TARGET);
  assert.notDeepEqual(COMPETITION_SOURCE_FIXTURE, TARGET_FIXTURE);
  assert.equal(OPTIMAL_STEPS, 5);
  assert.equal(OPTIMAL_DISTANCE, 10);

  assert.ok(Object.isFrozen(POSITIONS));
  assert.ok(Object.isFrozen(POSITION_INDEX));
  assert.ok(Object.isFrozen(COMPETITION_SOURCE_FIXTURE));
  assert.ok(Object.isFrozen(SCORED_INITIAL_FIXTURE));
  assert.ok(Object.isFrozen(TARGET_FIXTURE));
});

test("fresh-state factory never shares state or fixture objects between runs", () => {
  const first = createCompetitionState();
  const second = createCompetitionState();

  assert.notStrictEqual(first, second);
  assert.notStrictEqual(first.fixture, second.fixture);
  assert.deepEqual(first.fixture, SOURCE);
  assert.deepEqual(second.fixture, SOURCE);
  assert.equal(first.phase, "opening");
  assert.equal(first.steps, 0);
  assert.equal(first.distance, 0);
  assert.equal(first.gripper, null);

  const moved = event(first, "grip", "P1", { success: true });
  assert.deepEqual(first.fixture, SOURCE, "the reducer must not mutate its input state");
  assert.deepEqual(second.fixture, SOURCE, "one run must not leak into another run");
  assert.notStrictEqual(moved, first);
});

test("opening P1 to P7 is excluded and activation starts counters at zero", () => {
  const state = openAndActivate();
  assert.deepEqual(state.fixture, AFTER_OPENING);
  assert.equal(state.gripper, null);
});

test("activation is rejected until the marker has completed P1 to P7", () => {
  const state = event(createCompetitionState(), "activate");
  assert.equal(state.phase, "invalid");
  assert.equal(state.steps, 0);
  assert.equal(state.distance, 0);
  assert.deepEqual(state.fixture, SOURCE);
});

test("the documented five transfers finish at 5 steps, distance 10, and score 100", () => {
  let state = openAndActivate();

  state = transfer(state, "P2", "P1");
  state = transfer(state, "P6", "P2");
  state = transfer(state, "P5", "P6");
  state = transfer(state, "P4", "P5");
  state = transfer(state, "P1", "P4");
  state = event(state, "complete");

  assert.equal(state.phase, "completed");
  assert.deepEqual(state.fixture, TARGET);
  assert.equal(state.gripper, null);
  assert.equal(state.steps, 5);
  assert.equal(state.distance, 10);
  assert.equal(state.correct, true);
  assert.equal(state.score, 100);
});

test("each committed transfer adds one step and absolute slot-gap distance", () => {
  let state = openAndActivate();
  state = transfer(state, "P2", "P1");
  assert.equal(state.steps, 1);
  assert.equal(state.distance, 1);

  state = transfer(state, "P6", "P2");
  assert.equal(state.steps, 2);
  assert.equal(state.distance, 5);
});

test("wrong final arrangement scores zero regardless of efficient metrics", () => {
  let state = openAndActivate();
  state = event(state, "complete");

  assert.equal(state.phase, "completed");
  assert.equal(state.correct, false);
  assert.equal(state.score, 0);
  assert.equal(calculateCompetitionScore({ correct: false, steps: 5, distance: 10 }), 0);
});

test("release without a carried block is invalid and never counts", () => {
  const state = event(openAndActivate(), "release", "P1", { success: true });
  assert.equal(state.phase, "invalid");
  assert.equal(state.steps, 0);
  assert.equal(state.distance, 0);
  assert.deepEqual(state.fixture, AFTER_OPENING);
});

test("occupied-destination release is invalid and never commits a transfer", () => {
  let state = openAndActivate();
  state = event(state, "grip", "P2", { success: true });
  state = event(state, "release", "P3", { success: true });

  assert.equal(state.phase, "invalid");
  assert.equal(state.steps, 0);
  assert.equal(state.distance, 0);
  assert.equal(state.fixture.P3, "chicken");
  assert.deepEqual(state.gripper, { blockId: "dog", source: "P2" });
});

test("same-slot release restores the block but is a zero-count no-op", () => {
  let state = openAndActivate();
  state = event(state, "grip", "P2", { success: true });
  state = event(state, "release", "P2", { success: true });

  assert.equal(state.phase, "scoring");
  assert.equal(state.steps, 0);
  assert.equal(state.distance, 0);
  assert.equal(state.gripper, null);
  assert.deepEqual(state.fixture, AFTER_OPENING);
});

test("failed release and cancelled transfer never increment metrics", () => {
  let failed = openAndActivate();
  failed = event(failed, "grip", "P2", { success: true });
  failed = event(failed, "release", "P1", { success: false });
  assert.equal(failed.steps, 0);
  assert.equal(failed.distance, 0);

  let cancelled = openAndActivate();
  cancelled = event(cancelled, "grip", "P2", { success: true });
  cancelled = event(cancelled, "cancel");
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(cancelled.steps, 0);
  assert.equal(cancelled.distance, 0);
});

test("the marker cannot become a scored student transfer", () => {
  let state = openAndActivate();
  state = event(state, "grip", "P7", { success: true });
  state = event(state, "release", "P1", { success: true });

  assert.equal(state.phase, "invalid");
  assert.equal(state.steps, 0);
  assert.equal(state.distance, 0);
});

test("invalid reducer edges fail closed while incomplete workshop runs remain visible", () => {
  const active = openAndActivate();
  const emptyGrip = event(active, "grip", "P1", { success: true });
  assert.equal(emptyGrip.phase, "invalid");
  assert.equal(emptyGrip.steps, 0);

  let carrying = event(active, "grip", "P2", { success: true });
  const doubleGrip = event(carrying, "grip", "P3", { success: true });
  assert.equal(doubleGrip.phase, "invalid");
  assert.deepEqual(doubleGrip.gripper, { blockId: "dog", source: "P2" });

  const completeWhileCarrying = event(carrying, "complete");
  assert.equal(completeWhileCarrying.phase, "completed");
  assert.equal(completeWhileCarrying.correct, false);
  assert.equal(completeWhileCarrying.score, 0);
  assert.equal(completeWhileCarrying.steps, 0);

  const unsupported = event(active, "dance", "P2");
  assert.equal(unsupported.phase, "invalid");

  let wrongOpening = createCompetitionState();
  wrongOpening = event(wrongOpening, "grip", "P1", { success: true });
  wrongOpening = event(wrongOpening, "release", "P6", { success: true });
  assert.equal(wrongOpening.phase, "invalid");

  const cancelled = event(active, "cancel");
  assert.deepEqual(event(cancelled, "grip", "P2", { success: true }), cancelled);
});

test("correct score vectors are rounded once from the final rational total", () => {
  assert.equal(calculateCompetitionScore({ correct: true, steps: 5, distance: 10 }), 100);
  assert.equal(calculateCompetitionScore({ correct: true, steps: 6, distance: 14 }), 91.55);
  assert.equal(calculateCompetitionScore({ correct: true, steps: 8, distance: 20 }), 83.13);
});

test("ROUND_HALF_UP handles the exact 83.125 boundary and adjacent values", () => {
  assert.equal(roundHalfUpRational(83_124n, 1_000n, 2), 83.12);
  assert.equal(roundHalfUpRational(83_125n, 1_000n, 2), 83.13);
  assert.equal(roundHalfUpRational(83_126n, 1_000n, 2), 83.13);
});

test("score calculation rejects malformed metrics instead of rewarding them", () => {
  for (const sample of [
    { correct: true, steps: -1, distance: 10 },
    { correct: true, steps: 5.5, distance: 10 },
    { correct: true, steps: 5, distance: Number.NaN },
  ]) {
    assert.throws(() => calculateCompetitionScore(sample), /non-negative integers/);
  }
});

test("result ordering is score desc, steps asc, distance asc, then filename asc", () => {
  const rows = [
    { solutionName: "TechX_Zeta.py", score: 91.55, steps: 6, distance: 14 },
    { solutionName: "TechX_Beta.py", score: 100, steps: 6, distance: 10 },
    { solutionName: "TechX_Delta.py", score: 100, steps: 5, distance: 11 },
    { solutionName: "TechX_Alpha.py", score: 100, steps: 5, distance: 10 },
    { solutionName: "TechX_Gamma.py", score: 100, steps: 5, distance: 10 },
  ];

  assert.deepEqual(rows.toSorted(compareCompetitionResults).map((row) => row.solutionName), [
    "TechX_Alpha.py",
    "TechX_Gamma.py",
    "TechX_Delta.py",
    "TechX_Beta.py",
    "TechX_Zeta.py",
  ]);
});

test("metric comparator preserves true ties while filename only stabilizes display", () => {
  const alpha = { solutionName: "TechX_Alpha.py", score: 100, steps: 5, distance: 10 };
  const beta = { solutionName: "TechX_Beta.py", score: 100, steps: 5, distance: 10 };
  const worseSteps = { solutionName: "TechX_Alpha.py", score: 100, steps: 6, distance: 10 };
  const worseDistance = { solutionName: "TechX_Alpha.py", score: 100, steps: 5, distance: 11 };

  assert.equal(compareCompetitionMetrics(alpha, beta), 0);
  assert.ok(compareCompetitionResults(alpha, beta) < 0);
  assert.equal(isBetterCompetitionResult(alpha, beta), false);
  assert.equal(isBetterCompetitionResult(alpha, worseSteps), true);
  assert.equal(isBetterCompetitionResult(alpha, worseDistance), true);
  assert.equal(isBetterCompetitionResult(worseSteps, alpha), false);
});
