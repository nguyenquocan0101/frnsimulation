import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const template = index.match(/<textarea\b[^>]*\bid="program"[^>]*>([\s\S]*?)<\/textarea\s*>/)?.[1] || "";

test("IDE template contains only the basic Python scaffold", () => {
  assert.match(template, /from techcamp_ai_api import TechCampAI/);
  assert.match(template, /def main\(\):/);
  assert.match(template, /with TechCampAI\(\) as bot:/);
  assert.match(template, /\bpass\b/);
  assert.match(template, /if __name__ == "__main__":/);
  assert.match(template, /\n    main\(\)/);
  assert.doesNotMatch(template, /SMART TOY FACTORY|CAMERA SORTING|bot\.detect|CLASS_ORDER|MODEL_TO_ANIMAL|TEST_ONLY|animal_[1-5]/);
});

test("IDE clears the previous stored prompt once with reset version 4", () => {
  const app = fs.readFileSync(new URL("./app.js", import.meta.url), "utf8");
  assert.match(app, /techcamp-workshop-content-reset-v4/);
  assert.match(app, /appStorage\.removeItem\(PROGRAM_STORAGE_KEY\)/);
  assert.doesNotMatch(app, /removeItem\("techcamp-last-group"\)/);
});
