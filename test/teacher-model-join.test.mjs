import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { joinSubmissionModels } from "../teacher-submissions.mjs";

const html = readFileSync(new URL("../teacher.html", import.meta.url), "utf8");
const teacherSource = readFileSync(new URL("../teacher-submissions.mjs", import.meta.url), "utf8");
const accessSource = readFileSync(new URL("../teacher-access.mjs", import.meta.url), "utf8");

test("teacher joins models by exact submissionId, including repeated group names", () => {
  const rows = [
    { id: "submission_a", submissionId: "submission_a", groupName: "Nhóm 1" },
    { id: "submission_b", submissionId: "submission_b", groupName: "Nhóm 1" },
  ];
  const models = [
    { submissionId: "submission_b", filename: "model.onnx", size: 20, sha256: "b" },
  ];
  const joined = joinSubmissionModels(rows, models);
  assert.equal(joined.length, 2);
  assert.equal(joined[0].model?.status, "missing");
  assert.equal(joined[1].model?.filename, "model.onnx");
  assert.equal(joined[1].model?.sha256, "b");
});

test("teacher model join marks API failures distinctly instead of hiding them", () => {
  const [row] = joinSubmissionModels(
    [{ id: "submission_a", submissionId: "submission_a", groupName: "Nhóm 1" }],
    null,
    { error: "VPS unavailable" },
  );
  assert.equal(row.model?.status, "error");
  assert.match(row.model?.message ?? "", /VPS unavailable/);
});

test("teacher page has a password gate and does not start Firestore polling before unlock", () => {
  assert.match(html, /id=["']teacherPassword["']/i);
  assert.match(html, /id=["']teacherUnlockBtn["']/i);
  assert.match(html, /teacher-access\.mjs/i);
  assert.doesNotMatch(html, /stemtechx/i);
  const accessIndex = html.indexOf("teacher-access.mjs");
  const listIndex = html.indexOf("listSubmissions");
  assert.ok(accessIndex >= 0 && listIndex > accessIndex);
  assert.match(html, /requireTeacherSession|unlockTeacher|requestTeacherSession/);
});

test("teacher access uses expiring session storage and native download URLs", () => {
  assert.match(accessSource, /sessionStorage/);
  assert.match(accessSource, /\/v1\/teacher\/session/);
  assert.match(accessSource, /download-ticket/);
  assert.doesNotMatch(accessSource, /\.blob\s*\(/i);
  assert.doesNotMatch(accessSource, /new\s+Blob\s*\(/i);
  assert.match(accessSource, /createElement\(["']a["']\)|location\.href|window\.open/);
});

test("teacher renderer exposes model state and uses text nodes for metadata", () => {
  assert.match(teacherSource, /submissionId/);
  assert.match(teacherSource, /missing/i);
  assert.match(teacherSource, /error/i);
  assert.match(teacherSource, /model\.on(?:nx)?|Download ONNX/i);
  assert.doesNotMatch(teacherSource, /\.innerHTML\s*=/);
});

