import test from "node:test";
import assert from "node:assert/strict";
import { filterSubmissions, formatSubmissionTime, normalizeFilter } from "./teacher-submissions.mjs";

test("public teacher helpers normalize and filter group names", () => {
  assert.equal(normalizeFilter("  Robot X "), "robot x");
  const rows = [{ groupName: "RobotX" }, { groupName: "Nhom2" }];
  assert.deepEqual(filterSubmissions(rows, " robotx "), [rows[0]]);
});

test("public teacher helper formats Firestore timestamps safely", () => {
  const timestamp = { toDate: () => new Date("2026-08-08T10:30:00.000Z") };
  assert.equal(formatSubmissionTime(timestamp, "en-US"), new Date("2026-08-08T10:30:00.000Z").toLocaleString("en-US"));
  assert.equal(formatSubmissionTime(null), "Đang chờ thời gian…");
});
