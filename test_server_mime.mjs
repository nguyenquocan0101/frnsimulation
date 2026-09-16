import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const server = fs.readFileSync(new URL("./serve.mjs", import.meta.url), "utf8");

test("local static server serves JavaScript modules with a JavaScript MIME type", () => {
  assert.match(server, /['"]\.js['"]\s*:\s*['"]text\/javascript/);
  assert.match(server, /['"]\.mjs['"]\s*:\s*['"]text\/javascript/);
});

test("local smoke test uses the custom server instead of Python http.server", () => {
  const smoke = fs.readFileSync(
    new URL("./scripts/local-smoke-test.ps1", import.meta.url),
    "utf8",
  );
  assert.match(smoke, /node\.exe/);
  assert.doesNotMatch(smoke, /-m\", \"http\.server/);
});
