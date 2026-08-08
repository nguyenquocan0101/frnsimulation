import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readRules = (filename) => readFile(new URL(`../${filename}`, import.meta.url), "utf8");

test("Firestore Rules declare the immutable submission contract", async () => {
  const rules = await readRules("firestore.rules");

  assert.match(rules, /match\s+\/submissions\/\{submissionId\}/);
  assert.match(rules, /request\.resource\.data\.uid\s*==\s*request\.auth\.uid/);
  assert.match(rules, /submissionId\.matches/);
  assert.match(rules, /16,64/);
  assert.match(rules, /request\.resource\.data\.submittedAt\s*==\s*request\.time/);
  assert.doesNotMatch(rules, /storagePath/);
  assert.match(rules, /request\.resource\.data\.filename/);
  assert.match(rules, /request\.resource\.data\.byteSize/);
  assert.match(rules, /byteSize\s+is\s+int/);
  assert.match(rules, /request\.resource\.data\.source\s+is\s+string/);
  assert.match(rules, /source\.size\(\)/);
});

test("Firestore submissions are publicly readable but remain immutable", async () => {
  const rules = await readRules("firestore.rules");

  assert.match(rules, /allow\s+get,\s*list\s*:\s*if\s+true\s*;/);
  assert.doesNotMatch(rules, /allow\s+get,\s*list\s*:\s*if\s+isTeacher\s*\(\s*\)\s*;/);
  assert.match(rules, /allow\s+create\s*:\s*if\s+isAnonymous\s*\(\s*\)\s+&&\s+validSubmission/);
  assert.match(rules, /allow\s+update,\s*delete\s*:\s*if\s+false\s*;/);
});
