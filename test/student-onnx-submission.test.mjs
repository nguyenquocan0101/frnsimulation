import test from "node:test";
import assert from "node:assert/strict";
import { createSubmissionController, initStudentSubmissionUi } from "../student-submissions.mjs";

const source = "print('paired')\n";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(String(key), String(value)); },
    removeItem(key) { values.delete(String(key)); },
  };
}

function modelFile() {
  return new File([new Uint8Array([1, 2, 3, 4])], "model.onnx", { type: "application/octet-stream" });
}

test("one submit creates one immutable identity and sends the exact ID to model API then Firebase", async () => {
  const events = [];
  let modelId;
  let firebaseId;
  const controller = createSubmissionController({
    getSource: () => source,
    getModelFile: () => modelFile(),
    ensureUser: async () => ({ uid: "anonymous-user" }),
    uploadModel: async ({ identity, metadata }) => {
      events.push("model");
      modelId = identity.submissionId;
      assert.equal(metadata.submissionId, identity.submissionId);
      return { submissionId: identity.submissionId, size: 4 };
    },
    upload: async ({ metadata }) => {
      events.push("firebase");
      firebaseId = metadata.submissionId;
    },
    onStatus: () => {},
  });

  const result = await controller.submit("Nhom1");

  assert.equal(result.ok, true);
  assert.ok(modelId);
  assert.equal(firebaseId, modelId);
  assert.deepEqual(events, ["model", "firebase"]);
});

test("model completion is persisted and a Firestore failure can retry with the same ID without model bytes", async () => {
  const storage = memoryStorage();
  const modelCalls = [];
  const firebaseCalls = [];
  let firestoreAttempts = 0;
  const makeController = () => createSubmissionController({
    getSource: () => source,
    getModelFile: () => modelFile(),
    ensureUser: async () => ({ uid: "anonymous-user" }),
    storage,
    uploadModel: async ({ identity }) => {
      modelCalls.push(identity.submissionId);
      return { submissionId: identity.submissionId, size: 4 };
    },
    upload: async ({ metadata }) => {
      firestoreAttempts += 1;
      firebaseCalls.push(metadata.submissionId);
      if (firestoreAttempts === 1) {
        const error = new Error("Firestore offline");
        error.stage = "metadata";
        throw error;
      }
    },
    onStatus: () => {},
  });

  const first = await makeController().submit("Nhom1");
  assert.equal(first.ok, false);
  assert.equal(first.reason, "metadata");
  assert.equal(modelCalls.length, 1);
  const saved = JSON.parse(storage.getItem("techcamp-onnx-recovery"));
  assert.equal(saved.modelComplete, true);
  assert.ok(saved.submissionId);
  assert.deepEqual(Object.keys(saved).sort(), ["fileFingerprint", "modelComplete", "submissionId"]);

  const second = await makeController().submit("Nhom1");
  assert.equal(second.ok, true);
  assert.equal(modelCalls.length, 1, "retry must not upload model bytes again");
  assert.equal(firebaseCalls[1], firebaseCalls[0], "Firestore retry must reuse the same submission ID");
});

test("double submit is blocked while the model upload is active", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let modelCalls = 0;
  const controller = createSubmissionController({
    getSource: () => source,
    getModelFile: () => modelFile(),
    ensureUser: async () => ({ uid: "anonymous-user" }),
    uploadModel: async () => { modelCalls += 1; await pending; },
    upload: async () => {},
    onStatus: () => {},
  });

  const first = controller.submit("Nhom1");
  await Promise.resolve();
  assert.deepEqual(await controller.submit("Nhom1"), { ok: false, reason: "busy" });
  release();
  assert.equal((await first).ok, true);
  assert.equal(modelCalls, 1);
});

test("missing, wrong-extension, or empty model is rejected before Firebase sign-in", async () => {
  for (const file of [null, new File([new Uint8Array([1])], "model.pt"), new File([], "model.onnx")]) {
    let ensureCalls = 0;
    let firebaseCalls = 0;
    const controller = createSubmissionController({
      getSource: () => source,
      getModelFile: () => file,
      ensureUser: async () => { ensureCalls += 1; return { uid: "anonymous-user" }; },
      uploadModel: async () => {},
      upload: async () => { firebaseCalls += 1; },
      onStatus: () => {},
    });
    const result = await controller.submit("Nhom1");
    assert.equal(result.ok, false);
    assert.equal(result.reason, "model");
    assert.equal(ensureCalls, 0);
    assert.equal(firebaseCalls, 0);
  }
});

test("submission dialog wiring passes the selected model into the paired controller", async () => {
  const listeners = new Map();
  const makeNode = (extra = {}) => ({
    hidden: false,
    dataset: {},
    value: "Nhom1",
    files: [modelFile()],
    addEventListener(type, handler) { listeners.set(type, handler); },
    querySelectorAll() { return []; },
    focus() {},
    ...extra,
  });
  const form = makeNode({ reset() {}, querySelectorAll() { return []; } });
  const modelInput = makeNode();
  const openButton = makeNode();
  const groupInput = makeNode({ value: "Nhom1" });
  const dialog = makeNode({ showModal() {}, close() {}, open: true });
  const calls = [];
  initStudentSubmissionUi({
    openButton,
    dialog,
    form,
    groupInput,
    modelInput,
    filenamePreview: makeNode(),
    statusNode: makeNode(),
    submitButton: makeNode(),
    getSource: () => source,
    ensureUser: async () => ({ uid: "anonymous-user" }),
    uploadModel: async ({ file, identity }) => { calls.push(["model", file.name, identity.submissionId]); },
    upload: async ({ metadata }) => { calls.push(["firebase", metadata.submissionId]); },
    available: true,
  });
  await listeners.get("submit")?.({ preventDefault() {} });
  assert.equal(calls[0][0], "model");
  assert.equal(calls[0][1], "model.onnx");
  assert.equal(calls[1][0], "firebase");
  assert.equal(calls[0][2], calls[1][1]);
});

test("model progress callback updates the supplied progress element", async () => {
  const progressNode = { hidden: true, max: 0, value: 0 };
  const controller = createSubmissionController({
    getSource: () => source,
    getModelFile: () => modelFile(),
    ensureUser: async () => ({ uid: "anonymous-user" }),
    progressNode,
    uploadModel: async ({ onProgress }) => onProgress(3),
    upload: async () => {},
    onStatus: () => {},
  });
  assert.equal((await controller.submit("Nhom1")).ok, true);
  assert.equal(progressNode.max, 4);
  assert.equal(progressNode.value, 3);
});
