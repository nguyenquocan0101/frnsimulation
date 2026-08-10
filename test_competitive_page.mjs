import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(root, "competitive.html");
const stylesheetPath = path.join(root, "competitive.css");
const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, "utf8") : "";
const stylesheet = fs.existsSync(stylesheetPath) ? fs.readFileSync(stylesheetPath, "utf8") : "";
const server = fs.readFileSync(path.join(root, "serve.mjs"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));

test("competitive is a standalone static rules document with one semantic page title", () => {
  assert.ok(page, "competitive.html must exist");
  assert.match(page, /<header\b/i);
  assert.match(page, /<main\b/i);
  assert.match(page, /<section\b/i);
  assert.match(page, /<footer\b/i);
  assert.equal((page.match(/<h1\b/gi) || []).length, 1, "the page must expose exactly one h1");
  assert.match(page, /href="\/competitive\.css"/);
  assert.ok(stylesheet.length > 0, "competitive.css must exist");
});

test("competitive route maps both slash forms without changing the legacy competition route", () => {
  assert.match(server, /\[\s*['"]\/competitive['"],\s*['"]\/competitive\/['"]\s*\]/);
  assert.deepEqual(
    vercel.rewrites.filter((entry) => entry.source.startsWith("/competitive")),
    [
      { source: "/competitive", destination: "/competitive.html" },
      { source: "/competitive/", destination: "/competitive.html" },
    ],
  );
  assert.deepEqual(
    vercel.rewrites.filter((entry) => entry.source.startsWith("/competition")),
    [
      { source: "/competition", destination: "/competition.html" },
      { source: "/competition/", destination: "/competition.html" },
    ],
  );
});

test("competitive has the exact shared wordmark and an accessible IDE link", () => {
  assert.match(
    page,
    /<a\s+class="header-brand brand"\s+href="\/"\s+aria-label="[^"]+">\s*<span class="techx-logo">FPTU TECH<span>X<\/span> CAMP<\/span>\s*<span>FAIRINO SIMULATION<\/span>\s*<\/a>/i,
  );
  assert.match(stylesheet, /\.brand \.techx-logo\s*\{[^}]*font-size:\s*30px[^}]*letter-spacing:\s*3px/is);
  assert.match(page, /<a[^>]+href="\/"[^>]*>\s*Open IDE\s*<\/a>/i);
});

test("competitive remains documentation only, without simulator, scores, or application side effects", () => {
  assert.ok(page, "competitive.html must exist");
  for (const forbidden of [
    /firebase/i,
    /firestore/i,
    /auth/i,
    /leaderboard/i,
    /competition-page\.mjs/i,
    /three\.js/i,
    /<canvas\b/i,
    /<iframe\b/i,
    /camera(?:\s|-)?api/i,
    /<input[^>]+(?:accept|type)=[^>]*\.pt/i,
    /\/api\//i,
    /score-calculation/i,
  ]) assert.doesNotMatch(page, forbidden);
});
