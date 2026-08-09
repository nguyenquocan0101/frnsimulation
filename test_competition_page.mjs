import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(new URL("./competition.html", import.meta.url), "utf8");
const script = fs.readFileSync(new URL("./competition-page.mjs", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("./serve.mjs", import.meta.url), "utf8");
const vercel = JSON.parse(fs.readFileSync(new URL("./vercel.json", import.meta.url), "utf8"));

test("competition page contains rules, leaderboard, and IDE links", () => {
  assert.match(page, /Sắp xếp nhanh/);
  assert.match(page, /competitionRows/);
  assert.match(page, /P2 xe/);
  assert.match(page, /href="\.\/"/);
  assert.match(script, /listCompetitionResults/);
});

test("both local and Vercel routes map /competition", () => {
  assert.match(server, /competition\.html/);
  assert.deepEqual(vercel.rewrites.map((entry) => entry.source), ["/competition", "/competition/"]);
});
