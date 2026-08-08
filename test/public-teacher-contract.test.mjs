import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (filename) => readFile(new URL(`../${filename}`, import.meta.url), "utf8");

test("public teacher page does not require Google sign-in", async () => {
  const html = await readSource("teacher.html");
  const controller = await readSource("teacher-submissions.mjs");

  assert.doesNotMatch(html, /signInTeacher|resolveTeacherRedirect|teacherSignInBtn/);
  assert.doesNotMatch(controller, /signInButton|signIn\s*\(/);
  assert.doesNotMatch(controller, /isTeacher|currentUser/);
});

test("public teacher list keeps a bounded newest-first Firestore query", async () => {
  const client = await readSource("firebase-client.mjs");

  assert.match(client, /orderBy\(\s*["']submittedAt["']\s*,\s*["']desc["']\s*\)/);
  assert.match(client, /limit\(\s*100\s*\)/);
  assert.match(client, /export\s+async\s+function\s+listSubmissions/);
});

test("student upload still provisions anonymous authentication", async () => {
  const client = await readSource("firebase-client.mjs");

  assert.match(client, /export\s+async\s+function\s+ensureAnonymousUser/);
  assert.match(client, /signInAnonymously\(\s*auth\s*\)/);
});
