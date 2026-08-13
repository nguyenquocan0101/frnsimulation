import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const template = index.match(/<textarea\b[^>]*\bid="program"[^>]*>([\s\S]*?)<\/textarea\s*>/)?.[1] || "";

test("IDE template provides a safe camera smoke test and sorting brief", () => {
  assert.match(template, /SMART TOY FACTORY - CAMERA SORTING CHALLENGE/);
  assert.match(template, /from techcamp_ai_api import TechCampAI/);
  assert.match(template, /bot\.detect\(\)/);
  assert.match(template, /with TechCampAI\(\) as bot/);
  assert.match(template, /Call `bot\.detect\(\)` exactly once/);
  assert.match(template, /P1 -> P7/);
  assert.match(template, /P7 -> P1/);
  assert.match(template, /POSITIONS\s*=\s*\[/);
  assert.match(template, /detected\.get\(position/);
  assert.match(template, /board\.append\(MODEL_TO_ANIMAL\.get\(label, label\)\)/);
  assert.match(template, /board = \[detected\[position\]\[0\]/);
  assert.match(template, /Class array P1-P7/);
  assert.match(template, /ignore the\s+confidence/i);
  assert.match(template, /EASY FOUR-STEP PLAN/);
  assert.match(template, /camera order: animal_5, animal_4, animal_3, animal_1, animal_2/);
  assert.match(template, /target order: animal_1, animal_2, animal_3, animal_4, animal_5/);
  assert.match(template, /CLASS_ORDER\s*=\s*\[/);
  assert.match(template, /animal_1[\s\S]*animal_2[\s\S]*animal_3[\s\S]*animal_4[\s\S]*animal_5/);
  assert.match(template, /MODEL_TO_ANIMAL\s*=\s*\{/);
  assert.match(template, /TEST_ONLY\s*=\s*True/);
  for (const helper of ["get_class_rank", "create_sorting_steps", "create_movement_steps", "validate_movements"]) {
    assert.match(template, new RegExp(`def\\s+${helper}\\s*\\(`));
  }
  assert.match(template, /P1 is the temporary buffer/);
});
