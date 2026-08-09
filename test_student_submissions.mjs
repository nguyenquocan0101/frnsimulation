import test from "node:test";
import assert from "node:assert/strict";

import { createSubmissionController } from "./student-submissions.mjs";

const sourceFixture = "print('workshop')\n";

function harness(overrides = {}) {
  const statuses = [];
  const calls = { ensure: 0, upload: 0 };
  const source = overrides.source ?? sourceFixture;
  const controller = createSubmissionController({
    getSource: overrides.getSource ?? (() => source),
    ensureUser: overrides.ensureUser ?? (async () => {
      calls.ensure += 1;
      return { uid: "anonymous-workshop-user" };
    }),
    upload: overrides.upload ?? (async () => {
      calls.upload += 1;
    }),
    onStatus: (status, message) => statuses.push({ status, message }),
  });
  return { controller, statuses, calls, source };
}

test("invalid group is rejected before Firebase calls", async () => {
  const { controller, calls, statuses } = harness();

  const result = await controller.submit("Nhom 1");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "group");
  assert.equal(calls.ensure, 0);
  assert.equal(calls.upload, 0);
  assert.equal(statuses.at(-1)?.status, "error");
});

test("empty or oversized source is rejected before Firebase calls", async () => {
  for (const source of ["", "x".repeat(102401)]) {
    const { controller, calls, statuses } = harness({ source });

    const result = await controller.submit("Nhom1");

    assert.equal(result.ok, false);
    assert.equal(result.reason, "source");
    assert.equal(calls.ensure, 0);
    assert.equal(calls.upload, 0);
    assert.equal(statuses.at(-1)?.status, "error");
  }
});

test("injected upload saves the source in Firestore metadata", async () => {
  const events = [];
  const { controller } = harness({
    upload: async ({ metadata, source, onMetadata }) => {
      assert.equal(metadata.filename, "TechX_RobotX.py");
      assert.equal(source, sourceFixture);
      events.push("firestore");
      onMetadata?.();
      await Promise.resolve();
      events.push("source-saved");
    },
  });

  const result = await controller.submit("RobotX");

  assert.equal(result.ok, true);
  assert.deepEqual(events, ["firestore", "source-saved"]);
});

test("duplicate submit while upload is pending is suppressed", async () => {
  let releaseUpload;
  const uploadPending = new Promise((resolve) => {
    releaseUpload = resolve;
  });
  let uploadCalls = 0;
  const { controller } = harness({
    upload: async () => {
      uploadCalls += 1;
      await uploadPending;
    },
  });

  const first = controller.submit("Nhom1");
  await Promise.resolve();
  const second = await controller.submit("Nhom1");

  assert.deepEqual(second, { ok: false, reason: "busy" });
  assert.equal(uploadCalls, 1);
  releaseUpload();
  assert.equal((await first).ok, true);
});

test("success reports validating, uploading, then success and keeps source intact", async () => {
  const originalSource = sourceFixture;
  const seenSources = [];
  const { controller, statuses, source } = harness({
    upload: async ({ source: submittedSource, onMetadata }) => {
      seenSources.push(submittedSource);
      onMetadata?.();
    },
  });

  const result = await controller.submit("Nhom1");

  assert.equal(result.ok, true);
  assert.deepEqual(statuses.map(({ status }) => status), ["validating", "uploading", "saving", "success"]);
  assert.deepEqual(seenSources, [originalSource]);
  assert.equal(source, originalSource);
});

test("metadata failure is visible as an unlisted submission", async () => {
  const { controller, statuses } = harness({
    upload: async () => {
      const error = new Error("Firestore unavailable");
      error.stage = "metadata";
      throw error;
    },
  });

  const result = await controller.submit("Nhom1");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "metadata");
  assert.match(statuses.at(-1)?.message ?? "", /not visible|not listed/i);
});

test("Firestore failure reports an error and does not claim success", async () => {
  const { controller, statuses } = harness({
    upload: async () => {
      const error = new Error("Firestore unavailable");
      error.stage = "metadata";
      throw error;
    },
  });

  const result = await controller.submit("Nhom1");

  assert.equal(result.ok, false);
  assert.equal(result.reason, "metadata");
  assert.deepEqual(statuses.map(({ status }) => status), ["validating", "uploading", "error"]);
  assert.doesNotMatch(statuses.at(-1)?.message ?? "", /thành công|success/i);
});
