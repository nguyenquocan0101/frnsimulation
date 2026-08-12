import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const deployDir = resolve(root, "vps", "onnx-submissions", "deploy");
const apiUnitPath = resolve(deployDir, "onnx-submissions.service");
const tunnelUnitPath = resolve(deployDir, "onnx-quick-tunnel.service");
const envExamplePath = resolve(deployDir, "onnx-submissions.env.example");
const docsPath = resolve(deployDir, "README.md");

function readArtifact(path) {
  assert.ok(existsSync(path), `missing deployment artifact: ${path}`);
  return readFileSync(path, "utf8");
}

test("API systemd unit is loopback-only and least-privilege", () => {
  const unit = readArtifact(apiUnitPath);
  assert.match(unit, /^User=techcamp-onnx$/m);
  assert.match(unit, /^WorkingDirectory=\/opt\/techcamp-onnx\/current$/m);
  assert.match(unit, /--host\s+127\.0\.0\.1\s+--port\s+8787/);
  assert.doesNotMatch(unit, /--host\s+0\.0\.0\.0/);
  assert.doesNotMatch(unit, /(^|\s)(80|443)(\s|$)/);
  assert.match(unit, /^EnvironmentFile=\/etc\/techcamp-onnx\.env$/m);
  assert.match(unit, /^ReadWritePaths=\/srv\/techcamp-onnx$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^NoNewPrivileges=yes$/m);
  assert.match(unit, /^PrivateTmp=yes$/m);
  assert.match(unit, /--no-access-log/);
  assert.match(unit, /Timeout(Start|Stop)Sec=/);
});

test("Quick Tunnel systemd unit targets the local API without embedded credentials", () => {
  const unit = readArtifact(tunnelUnitPath);
  assert.match(unit, /cloudflared\s+tunnel\s+--url\s+http:\/\/127\.0\.0\.1:8787\s+--no-autoupdate/);
  assert.match(unit, /^After=onnx-submissions\.service$/m);
  assert.match(unit, /^Requires=onnx-submissions\.service$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.doesNotMatch(unit, /--token\s+\S+/);
  assert.doesNotMatch(unit, /-----BEGIN/);
  assert.doesNotMatch(unit, /2026uni|090909/);
});

test("production env example contains only non-secret runtime settings", () => {
  const env = readArtifact(envExamplePath);
  assert.match(env, /^ONNX_DATA_ROOT=\/srv\/techcamp-onnx$/m);
  assert.match(env, /^ONNX_ALLOWED_ORIGINS=https:\/\/fairino-robot-simulator\.vercel\.app$/m);
  assert.match(env, /^FIREBASE_PROJECT_ID=frteachxcamp$/m);
  assert.doesNotMatch(env, /PASSWORD|SECRET|TOKEN|PRIVATE_KEY/i);
  assert.doesNotMatch(env, /2026uni|090909|-----BEGIN/);
});

test("deployment runbook documents URL discovery, republish, and rollback checks", () => {
  const docs = readArtifact(docsPath);
  assert.match(docs, /systemctl\s+.*onnx-submissions\.service/i);
  assert.match(docs, /systemctl\s+.*onnx-quick-tunnel\.service/i);
  assert.match(docs, /journalctl.*onnx-quick-tunnel\.service/i);
  assert.match(docs, /trycloudflare\.com/i);
  assert.match(docs, /onnx-submission-config\.mjs/);
  assert.match(docs, /healthz/);
  assert.match(docs, /stale|incomplete/i);
  assert.match(docs, /Firebase-only|Firebase only|fallback/i);
  assert.doesNotMatch(docs, /2026uni|-----BEGIN PRIVATE KEY-----/);
});
