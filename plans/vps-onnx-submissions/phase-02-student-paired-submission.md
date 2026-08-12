# Phase 02 — Student paired submission

**Dependencies:** Phase 01 API contract passing locally  
**Stories:** P1 student; P2 progress and useful errors  
**Requirements:** FR-01, FR-02, FR-03, FR-06, FR-10, FR-11

## Objective

Extend the existing submission modal so one click uploads `model.onnx` and the current Python source under one `submissionId`, while preserving Firestore's existing document/source shape.

## Implementation tasks

1. Add `onnx-submission-config.mjs` as the single editable API URL/config source; allow production simulator and explicit localhost origins only.
2. Add `onnx-submission-client.mjs` with init/status/resume, sequential 8 MiB `XMLHttpRequest` or fetch-stream chunk PUTs, progress callbacks, completion, abort handling, and typed failure categories: invalid file, oversized, auth, network/tunnel, server, conflict.
3. Add a required `.onnx` input, filename/size summary, progress element, and accessible status copy to `index.html`/`styles.css`.
4. Refactor `student-submissions.mjs` so it creates the identity once after anonymous sign-in, obtains a fresh ID token, uploads ONNX fully, then calls the existing Firebase `uploadSubmission` with the same identity. Do not call `createSubmissionIdentity` twice.
5. Preserve an explicit client state machine: `new -> uploading -> modelComplete -> firestoreComplete`. After model completion, retry skips all model bytes and retries Firestore with the same ID. Persist only `{submissionId, file fingerprint, modelComplete}` locally so a reload can offer recovery after the user reselects the matching local file; otherwise document the resulting orphan and start a new submission only after explicit confirmation.
6. Wire through `app.js` only in normal IDE mode; preserve embed-mode's no-Firebase/no-upload side-effect contract.
7. Add focused DOM/client tests for file validation, exact ID pairing, chunk offsets, resume, progress, double-submit blocking, abort/error messages, model-first ordering, and Firestore retry.

## Verification commands

```powershell
cd W:\farino_fr3\tmp\onnx-image-upload
node --test test/onnx-submission-client.test.mjs test/student-onnx-submission.test.mjs test_student_submissions.mjs test_submission_model.mjs test_embed_mode.mjs
npm test
node serve.mjs
```

Manual local checks use a local FastAPI URL: valid small ONNX, wrong extension, empty file, simulated >1 GiB metadata, interrupted third chunk/resume, model-complete plus Firestore failure/retry, and double click.

## Acceptance checks

- The request/Firestore document expose the exact same `submissionId` in 100% of successful test runs.
- Success appears only after model completion and Firestore write both succeed.
- Existing `main.py` source, filename, size validation, Firestore rules, and teacher Python download behavior are unchanged.
- Progress advances by acknowledged bytes and distinguishes all P2 error categories.
- Each HTTP chunk is at most 8 MiB and retries start from server-reported offset.
- A reload/failure after VPS completion never silently generates a second ID or re-uploads the completed model; Firestore-only retry is covered.

## Risks

- Completing the model first can leave an orphan if Firestore permanently fails; preserving the ID makes immediate retry safe, and Phase 05 documents post-workshop cleanup.
- Quick Tunnel URL churn must not be duplicated across modules; only the config file may contain it.
