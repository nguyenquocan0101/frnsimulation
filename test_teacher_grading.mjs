import test from "node:test";
import assert from "node:assert/strict";

import { gradeStudentSource, replayForGrade } from "./teacher-grading.mjs";

function move(from, to) {
  return [
    { type: "move_to", position: from },
    { type: "move_down" },
    { type: "grip", success: true },
    { type: "move_up" },
    { type: "move_to", position: to },
    { type: "move_down" },
    { type: "release", success: true },
    { type: "move_up" },
  ];
}

const actions = [
  ...move("P1", "P7"),
  ...move("P2", "P1"),
  ...move("P6", "P2"),
  ...move("P5", "P6"),
  ...move("P4", "P5"),
  ...move("P1", "P4"),
];

test("teacher grading reuses the competition engine for the exact action trace", () => {
  const result = replayForGrade({ actions });
  assert.equal(result.ok, true);
  assert.equal(result.correct, true);
  assert.equal(result.score, 100);
  assert.equal(result.steps, 5);
  assert.equal(result.distance, 10);
});

test("teacher grading returns the simulator error without inventing a score", async () => {
  const result = await gradeStudentSource("print('student')", {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: false, error: { message: "main() is required" } }),
    }),
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /main\(\)/);
});
