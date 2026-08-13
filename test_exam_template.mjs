import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const template = index.match(/<textarea\b[^>]*\bid="program"[^>]*>([\s\S]*?)<\/textarea\s*>/)?.[1] || "";

test("IDE exam template is cleared while the workshop is paused", () => {
  assert.match(template, /Workshop code is temporarily disabled/);
  assert.match(template, /restore the saved exam/);
  assert.doesNotMatch(template, /SMART TOY FACTORY|from techcamp_api import TechCamp/);
});
