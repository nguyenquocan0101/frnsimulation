import test from "node:test";
import assert from "node:assert/strict";

import {
  createOnnxSubmissionClient,
  OnnxUploadError,
  validateOnnxFile,
} from "../onnx-submission-client.mjs";

const CHUNK_SIZE = 8 * 1024 * 1024;
const TOKEN = "firebase-anonymous-token";

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

function fileOf(size, name = "model.onnx") {
  // A sparse test file keeps the chunk tests cheap while exercising the real
  // File.slice()/Blob path used by the browser client.
  return new File([new Uint8Array(size)], name, { type: "application/octet-stream" });
}

function baseClient(fetchImpl, overrides = {}) {
  return createOnnxSubmissionClient({
    baseUrl: "https://workshop-tunnel.example",
    getIdToken: async () => TOKEN,
    fetchImpl,
    ...overrides,
  });
}

test("validates exactly one non-empty .onnx file and rejects unsafe/oversized files", () => {
  assert.equal(validateOnnxFile(fileOf(1)), true);
  for (const file of [
    fileOf(0),
    fileOf(1, "model.pt"),
    fileOf(1, "../model.onnx"),
    { name: "model.onnx", size: 1024 ** 3 + 1 },
  ]) {
    assert.throws(() => validateOnnxFile(file), (error) => {
      assert.ok(error instanceof OnnxUploadError);
      assert.ok(["invalid-file", "oversized"].includes(error.category));
      return true;
    });
  }
});

test("uploads sequential raw chunks no larger than 8 MiB and reports acknowledged progress", async () => {
  const calls = [];
  const progress = [];
  const size = CHUNK_SIZE * 2 + 37;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? "GET";
    calls.push({ url: String(url), method, bodySize: options.body?.size ?? options.body?.byteLength ?? 0 });
    if (method === "POST" && String(url).endsWith("/v1/uploads")) {
      return jsonResponse(201, { uploadId: "upload-1", offset: 0, size, chunkSize: CHUNK_SIZE });
    }
    if (method === "PUT") {
      const offset = Number(new URL(url).searchParams.get("offset"));
      return jsonResponse(200, { uploadId: "upload-1", offset: offset + calls.at(-1).bodySize, size });
    }
    if (method === "POST" && String(url).endsWith("/complete")) {
      return jsonResponse(200, { submissionId: "submission-123456", filename: "model.onnx", size });
    }
    throw new Error(`unexpected request: ${method} ${url}`);
  };

  const result = await baseClient(fetchImpl).uploadModel({
    submissionId: "submission-123456",
    file: fileOf(size),
    groupKey: "nhom1",
    groupName: "Nhom1",
    onProgress: (value) => progress.push(value),
  });

  assert.equal(result.submissionId, "submission-123456");
  const chunks = calls.filter((call) => call.method === "PUT");
  assert.deepEqual(chunks.map((call) => call.bodySize), [CHUNK_SIZE, CHUNK_SIZE, 37]);
  assert.deepEqual(chunks.map((call) => Number(new URL(call.url).searchParams.get("offset"))), [0, CHUNK_SIZE, CHUNK_SIZE * 2]);
  assert.ok(chunks.every((call) => call.bodySize <= CHUNK_SIZE));
  assert.deepEqual(progress, [CHUNK_SIZE, CHUNK_SIZE * 2, size]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 2);
});

test("resumes from the server offset without re-uploading acknowledged bytes", async () => {
  const calls = [];
  const size = CHUNK_SIZE + 5;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? "GET";
    calls.push({ url: String(url), method, bodySize: options.body?.size ?? 0 });
    if (method === "POST" && String(url).endsWith("/v1/uploads")) {
      return jsonResponse(201, { uploadId: "upload-resume", offset: CHUNK_SIZE, size, chunkSize: CHUNK_SIZE });
    }
    if (method === "PUT") return jsonResponse(200, { offset: size });
    if (method === "POST" && String(url).endsWith("/complete")) {
      return jsonResponse(200, { submissionId: "submission-resume", size });
    }
    throw new Error("unexpected request");
  };

  await baseClient(fetchImpl).uploadModel({
    submissionId: "submission-resume",
    file: fileOf(size),
    groupKey: "nhom1",
    groupName: "Nhom1",
  });

  const chunks = calls.filter((call) => call.method === "PUT");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].bodySize, 5);
  assert.equal(Number(new URL(chunks[0].url).searchParams.get("offset")), CHUNK_SIZE);
});

test("after a transient chunk failure, refreshes status and retries from the authoritative offset", async () => {
  const calls = [];
  let failed = false;
  const fetchImpl = async (url, options = {}) => {
    const method = options.method ?? "GET";
    calls.push({ url: String(url), method, bodySize: options.body?.size ?? 0 });
    if (method === "POST" && String(url).endsWith("/v1/uploads")) {
      return jsonResponse(201, { uploadId: "upload-retry", offset: 0, size: 4, chunkSize: CHUNK_SIZE });
    }
    if (method === "PUT" && !failed) {
      failed = true;
      throw new TypeError("tunnel reset");
    }
    if (method === "GET") return jsonResponse(200, { uploadId: "upload-retry", offset: 0, size: 4, chunkSize: CHUNK_SIZE, completed: false });
    if (method === "PUT") return jsonResponse(200, { offset: 4 });
    if (method === "POST" && String(url).endsWith("/complete")) {
      return jsonResponse(200, { submissionId: "submission-retry", size: 4 });
    }
    throw new Error("unexpected request");
  };

  const result = await baseClient(fetchImpl).uploadModel({
    submissionId: "submission-retry",
    file: fileOf(4),
    groupKey: "nhom1",
    groupName: "Nhom1",
  });

  assert.equal(result.submissionId, "submission-retry");
  assert.ok(calls.some((call) => call.method === "GET" && call.url.endsWith("/v1/uploads/upload-retry")));
  assert.deepEqual(calls.filter((call) => call.method === "PUT").map((call) => call.bodySize), [4, 4]);
});

test("maps auth, conflict, server, network, and abort failures to typed categories", async (t) => {
  const cases = [
    ["auth", 401],
    ["conflict", 409],
    ["server", 500],
  ];
  for (const [category, status] of cases) {
    await t.test(category, async () => {
      const fetchImpl = async () => jsonResponse(status, { detail: "failure" });
      await assert.rejects(
        baseClient(fetchImpl).uploadModel({
          submissionId: "submission-errors",
          file: fileOf(4),
          groupKey: "nhom1",
          groupName: "Nhom1",
        }),
        (error) => error instanceof OnnxUploadError && error.category === category,
      );
    });
  }

  await t.test("network", async () => {
    await assert.rejects(
      baseClient(async () => { throw new TypeError("offline"); }).uploadModel({
        submissionId: "submission-errors",
        file: fileOf(4),
        groupKey: "nhom1",
        groupName: "Nhom1",
      }),
      (error) => error instanceof OnnxUploadError && error.category === "network",
    );
  });

  await t.test("abort", async () => {
    const aborter = new AbortController();
    const fetchImpl = async (_url, options = {}) => {
      if (options.method === "POST") return jsonResponse(201, { uploadId: "upload-abort", offset: 0, size: 4, chunkSize: CHUNK_SIZE });
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse(200, { offset: 4 });
    };
    const pending = baseClient(fetchImpl).uploadModel({
      submissionId: "submission-abort",
      file: fileOf(4),
      groupKey: "nhom1",
      groupName: "Nhom1",
      signal: aborter.signal,
    });
    aborter.abort();
    await assert.rejects(pending, (error) => error instanceof OnnxUploadError && error.category === "aborted");
  });
});
