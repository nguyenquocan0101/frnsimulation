import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSubmissionMetadata,
  canonicalFilename,
  createSubmissionIdentity,
  isSourceSizeValid,
  normalizeGroupKey,
  utf8ByteSize,
  validateGroupName,
} from "./submission-model.mjs";

const repeat = (character, count) => character.repeat(count);

test("group names accept only 2–30 ASCII letters/digits", () => {
  assert.equal(validateGroupName("Ab"), true);
  assert.equal(validateGroupName(repeat("a", 30)), true);

  for (const value of ["", "A", repeat("a", 31), "Team 1", "Team_1", "Nhóm1", "team-1", "team.1"]) {
    assert.equal(validateGroupName(value), false, `expected invalid group: ${value}`);
  }
});

test("canonical filename preserves display casing and fixed extension", () => {
  assert.equal(canonicalFilename("RobotX"), "TechX_RobotX.py");
  assert.equal(canonicalFilename("Nhom1"), "TechX_Nhom1.py");
});

test("group key is lowercase while display group remains unchanged", () => {
  assert.equal(normalizeGroupKey("RobotX"), "robotx");
  assert.equal(normalizeGroupKey("Nhom123"), "nhom123");
});

test("UTF-8 byte size and 1–100 KiB source boundary are exact", () => {
  assert.equal(utf8ByteSize(""), 0);
  assert.equal(utf8ByteSize("a"), 1);
  assert.equal(utf8ByteSize("😀"), 4);
  assert.equal(utf8ByteSize(repeat("a", 102400)), 102400);
  assert.equal(utf8ByteSize(repeat("😀", 25600)), 102400);

  assert.equal(isSourceSizeValid(""), false);
  assert.equal(isSourceSizeValid("a"), true);
  assert.equal(isSourceSizeValid(repeat("a", 102400)), true);
  assert.equal(isSourceSizeValid(repeat("a", 102401)), false);
});

test("each upload receives a unique immutable Firestore identity", () => {
  const first = createSubmissionIdentity({ uid: "anonymous-user-1" });
  const second = createSubmissionIdentity({ uid: "anonymous-user-1" });

  assert.notEqual(first.submissionId, second.submissionId);
  assert.match(first.submissionId, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(Object.keys(first), ["submissionId"]);
  assert.deepEqual(Object.keys(second), ["submissionId"]);
});

test("metadata builder emits the Firestore submission contract", () => {
  const source = "print('xin chao')\n";
  const identity = createSubmissionIdentity({ uid: "anonymous-user-2" });
  const metadata = buildSubmissionMetadata({
    ...identity,
    uid: "anonymous-user-2",
    groupName: "RobotX",
    source,
  });

  assert.deepEqual(metadata, {
    submissionId: identity.submissionId,
    uid: "anonymous-user-2",
    groupKey: "robotx",
    groupName: "RobotX",
    filename: "TechX_RobotX.py",
    byteSize: utf8ByteSize(source),
    contentType: "text/x-python",
    source,
  });
});
