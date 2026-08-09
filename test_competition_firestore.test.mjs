import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const rules = fs.readFileSync(new URL("./firestore.rules", import.meta.url), "utf8");
const indexes = JSON.parse(fs.readFileSync(new URL("./firestore.indexes.json", import.meta.url), "utf8"));

test("competition results expose public reads and workshop-only better-result writes", () => {
  assert.match(rules, /match \/competition_results\/\{solutionId\}/);
  assert.match(rules, /allow get, list: if true/);
  assert.match(rules, /allow create: if validCompetitionResult/);
  assert.match(rules, /allow delete: if false/);
  assert.match(rules, /betterCompetitionResult/);
});

test("competition leaderboard index sorts score, steps, and distance", () => {
  const index = indexes.indexes.find((entry) => entry.collectionGroup === "competition_results");
  assert.ok(index);
  assert.deepEqual(index.fields.map((field) => [field.fieldPath, field.order]), [
    ["score", "DESCENDING"],
    ["steps", "ASCENDING"],
    ["distance", "ASCENDING"],
  ]);
});
