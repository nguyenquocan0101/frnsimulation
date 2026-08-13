import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const template = index.match(/<textarea\b[^>]*\bid="program"[^>]*>([\s\S]*?)<\/textarea\s*>/)?.[1] || "";

test("IDE exam template uses the supported TechCamp API and English ten-class brief", () => {
  assert.match(template, /from techcamp_api import TechCamp/);
  assert.doesNotMatch(template, /techcamp_ai_api|TechCampAI/);
  for (const label of ["bear", "bird", "cat", "cow", "deer", "dog", "dolphin", "elephant", "giraffe", "horse"]) {
    assert.match(template, new RegExp(`\\b${label}\\b`));
  }
  assert.match(template, /P1.*P7|P7.*P1/s);
  assert.match(template, /Assign your own unique values/);
  assert.match(template, /objects\s*=\s*bot\.detect\(\)/);
});
