import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCompetitionResult,
  compareCompetitionResults,
  competitionResultDocId,
  isValidCompetitionResult,
  normalizeSolutionName,
} from "./competition-results.mjs";

test("result model keeps exactly the four workshop fields", () => {
  const result = buildCompetitionResult({ solutionName: "Team Alpha", score: 91.55, steps: 6, distance: 14 });
  assert.deepEqual(result, { solutionName: "TechX_TeamAlpha.py", score: 91.55, steps: 6, distance: 14 });
  assert.deepEqual(Object.keys(result).sort(), ["distance", "score", "solutionName", "steps"]);
  assert.equal(competitionResultDocId(result.solutionName), "techx_teamalpha.py");
});

test("invalid values are rejected without coercing a score", () => {
  assert.equal(isValidCompetitionResult({ solutionName: "TechX_A.py", score: 91.55, steps: 6, distance: 14 }), false);
  assert.equal(isValidCompetitionResult({ solutionName: "TechX_TeamAlpha.py", score: 91.551, steps: 6, distance: 14 }), false);
  assert.equal(isValidCompetitionResult({ solutionName: "TechX_TeamAlpha.py", score: 91.55, steps: 6.5, distance: 14 }), false);
});

test("leaderboard comparator prefers score, then steps, then distance", () => {
  assert.ok(compareCompetitionResults({ solutionName: "a", score: 100, steps: 5, distance: 10 }, { solutionName: "b", score: 91.55, steps: 6, distance: 14 }) < 0);
  assert.ok(compareCompetitionResults({ solutionName: "a", score: 91.55, steps: 5, distance: 14 }, { solutionName: "b", score: 91.55, steps: 6, distance: 10 }) < 0);
  assert.equal(normalizeSolutionName(" TechX_Team Alpha.py "), "TechX_TeamAlpha.py");
});
