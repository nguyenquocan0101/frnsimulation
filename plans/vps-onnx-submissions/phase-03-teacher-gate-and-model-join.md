# Phase 03 — Teacher gate and model join

**Dependencies:** Phase 01 teacher API internals; may proceed alongside Phase 02 after API contract stabilizes  
**Stories:** P1 teacher  
**Requirements:** FR-01, FR-07, FR-08, FR-09, FR-11

## Objective

Gate the teacher page with the workshop password and enrich each Firebase row with model metadata/download using exact `submissionId` matching.

## Implementation tasks

1. Implement `POST /v1/teacher/session` in FastAPI. Compare the hard-coded workshop password `090909` using constant-time comparison; issue a random, short-lived in-memory bearer token and never echo/log the password.
2. Require the bearer session for list/detail and download-ticket creation. Exchange it for a cryptographically random one-time ticket lasting at most 60 seconds; native browser navigation consumes the ticket at the download route, which streams with `Content-Disposition`, `nosniff`, correct length/type, and path-safe lookup.
3. Add `teacher-access.mjs` for sessionStorage token handling, password submission, expiry/401 reset, authorized list, ticket acquisition, and native anchor/navigation download. Explicitly forbid `fetch().blob()` for model files.
4. Change `teacher.html` so direct entry cannot start Firestore polling before the backend teacher session succeeds. Remove/bypass the legacy local dual-password behavior (including `stemtechx`) for this route; `090909` is the sole workshop gate for ONNX access. Add model status, size, upload time, SHA-256, and Download ONNX controls. State explicitly that existing Firestore `.py` reads remain public by current policy.
5. Update `teacher-submissions.mjs` to fetch Firebase rows and VPS model metadata, map models by `submissionId`, and render missing/error/present distinctly. Never match by group name/key.
6. Preserve Preview and Download `.py` behavior. Render all model metadata through text nodes, not HTML.
7. Add tests for wrong/right/repeated password attempts, expiry, missing bearer, ticket expiry/replay/wrong model, exact ID join with repeated group names, missing model, API failure, filename headers, no pre-gate Firestore load, and a >100 MB native-download path proving no Blob allocation.

## Verification commands

```powershell
cd W:\farino_fr3\tmp\onnx-image-upload
node --test test/teacher-model-join.test.mjs test_public_teacher_portal.mjs test_public_teacher_preview.test.mjs test_teacher_submissions.mjs
npm test
cd vps\onnx-submissions
.\.venv\Scripts\python -m pytest -q -k "teacher or download or session"
```

## Acceptance checks

- `090909` opens a short session; wrong passwords and expired/unknown tokens cannot list or download.
- Two submissions with the same group name but different IDs show their own model state.
- Every present model shows authoritative filename, byte size, UTC upload time, and a working streamed download.
- Existing Python preview/download remains functional and Firestore list requests do not begin before the gate.

## Risks

- The password is intentionally weak and fixed for the workshop. The UI must describe it as a convenience gate; do not imply durable authorization.
- In-memory sessions vanish on API restart; the expected recovery is entering the password again.
