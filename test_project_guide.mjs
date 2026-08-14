import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const guidePath = path.join(root, "project-guide.html");
const guide = fs.existsSync(guidePath) ? fs.readFileSync(guidePath, "utf8") : "";
const css = fs.existsSync(path.join(root, "project-guide.css"))
  ? fs.readFileSync(path.join(root, "project-guide.css"), "utf8")
  : "";
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const server = fs.readFileSync(path.join(root, "serve.mjs"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

test("project guide has the required learning sections and route actions", () => {
  assert.ok(guide, "project-guide.html must exist");
  for (const id of [
    "welcome",
    "visual-vocabulary",
    "quick-start",
    "deeper-learning",
    "api-reference",
    "complete-example",
    "troubleshooting",
  ]) assert.match(guide, new RegExp(`id="${id}"`));
  assert.match(guide, /Project guide/);
  assert.match(guide, /href="\/?"/);
  assert.match(guide, /Open IDE/);
});

test("guide documents the board labels, marker, API, and exact arrangements", () => {
  for (const label of ["P1", "P2", "P3", "P4", "P5", "P6", "P7"]) {
    assert.match(guide, new RegExp(`\\b${label}\\b`));
  }
  for (const api of [
    "TechCamp",
    "move_to",
    "move_down",
    "grip",
    "move_up",
    "release",
    "get_positions",
  ]) assert.match(guide, new RegExp(api.replace("_", "[_\\s]")));
  for (const text of ["P2 = dog", "P3 = bird", "P4 = bear", "P5 = cat", "P6 = cow", "P2 = cow"]) {
    assert.match(guide, new RegExp(text));
  }
  assert.match(guide, /orange marker|khối cam|marker cam/i);
});

test("guide contains the complete zero-argument main example", () => {
  assert.match(guide, /def main\(\):/);
  assert.match(guide, /if __name__ == ["']__main__["']:/);
  assert.match(guide, /move_to\("P2"\)/);
  assert.match(guide, /"P6"/);
  assert.doesNotMatch(guide, /def move_block\(/);
  assert.match(guide, /dog: P2 -&gt; P1|dog: P2 -> P1/);
  assert.match(guide, /cow: P6 -&gt; P2|cow: P6 -> P2/);
  assert.doesNotMatch(guide, /PRACTICE|Try these next|practice-prompt|checklist/i);
});

test("student guide has accessible visuals and does not expose competition scoring", () => {
  assert.ok((guide.match(/role="img"/g) || []).length >= 3);
  assert.ok((guide.match(/aria-label="[^"]+"/g) || []).length >= 3);
  for (const forbidden of ["Score", "Steps", "Distance", "Leaderboard", "ranking", "Luật thi"]) {
    assert.doesNotMatch(guide, new RegExp(forbidden, "i"));
  }
  assert.doesNotMatch(guide, /firebase|firestore/i);
});

test("guide assets are root-relative so both slash routes resolve them", () => {
  assert.match(guide, /href="\/project-guide\.css"/);
  assert.doesNotMatch(guide, /(?:href|src)="\.\/project-guide\.css"/);
});

test("IDE and hosting expose the guide without promoting the temporary rules page", () => {
  assert.match(index, /href="\/project-guide"[^>]*>Project guide/);
  assert.doesNotMatch(index, /Luật thi/);
  assert.match(server, /\[\s*['"]\/project-guide['"],\s*['"]\/project-guide\/['"]\s*\]/);
  assert.deepEqual(
    vercel.rewrites.filter((entry) => entry.source.startsWith("/project-guide")),
    [
      { source: "/project-guide", destination: "/project-guide.html" },
      { source: "/project-guide/", destination: "/project-guide.html" },
    ],
  );
});

test("guide stylesheet has responsive layout and visible keyboard focus", () => {
  assert.ok(css.length > 0, "project-guide.css must exist");
  assert.match(css, /@media\s*\(\s*max-width\s*:\s*600px\s*\)/);
  assert.match(css, /focus-visible/);
  assert.match(css, /html\[data-theme="light"\]/);
  assert.match(css, /overflow\s*:\s*auto/);
});
