# Plan: VPS ONNX submissions linked to Firebase

**Date:** 2026-08-12  
**Mode:** Hard  
**Risk:** high-risk — introduces public large-file upload, authentication checks, persistent VPS storage, and tunnel/service infrastructure.  
**Spec:** `plans/vps-onnx-submissions/spec.md`

## Scope challenge

- **Exists?** Firebase already owns `main.py`, submission IDs, and the teacher list. No ONNX storage API, chunk uploader, model join, or VPS service exists.
- **Minimum?** Keep Firestore schema/source behavior intact; add one VPS model per existing `submissionId`, a resumable raw-chunk client/API, teacher model download, and a Quick Tunnel deployment.
- **Complexity?** Hard. The feature crosses browser UI, Firebase identity, a public API, disk persistence, and system services.

## Spec quality check

- No unresolved `[NEEDS CLARIFICATION]` markers.
- P1/P2/P3 priorities and measurable acceptance criteria are present.
- Deployment unknowns (Linux distribution, capacity, service manager, egress) are explicitly handled by preflight.
- **Verdict:** PASS.

## Selected approach

Use FastAPI on loopback and a sequential resumable upload protocol with raw 8 MiB chunks. This avoids multipart buffering and remains well below Cloudflare's 100 MB request ceiling. The browser uploads the model to completion before writing the existing Firestore document with the same immutable `submissionId`. Models are staged as `.part`, committed by atomic rename, and joined to teacher rows only by `submissionId`.

## Validated workshop constraints

- Capacity target: 10 groups. Preflight must reserve at least 20 GiB for completed submissions plus 5 GiB for temporary uploads, while retaining the separate 20% filesystem safety margin; lower available capacity blocks deployment or requires lowering the 1 GiB/model limit explicitly.
- Concurrency target: support at least 5 simultaneous model uploads and no more than 10 active upload sessions globally, with one active session per Firebase UID.
- Operations: the user accepts that a Quick Tunnel URL can change and requires a web config update plus Vercel redeploy.
- SSH gate: the previously disclosed VPS password is still active. Local implementation/testing may proceed, but no SSH or VPS mutation is authorized until that credential is changed or a trusted SSH public key is installed.

The alternative Node standard-library service would reduce Python dependencies but would duplicate validation, routing, range handling, and test infrastructure. FastAPI is selected for explicit schemas, streaming request handling, and focused API tests.

## Protocol contract

All IDs match the existing `^[A-Za-z0-9_-]{16,64}$` contract. Student routes require `Authorization: Bearer <Firebase anonymous ID token>` and verify project, issuer, audience, expiry, and `firebase.sign_in_provider == "anonymous"`. Init persists `ownerUid`, an immutable metadata fingerprint, and a cryptographically random `uploadId`; status, chunk, and complete require the same authenticated UID. Idempotent resume means the same UID plus the same metadata fingerprint only.

1. `POST /v1/uploads` — JSON metadata (`submissionId`, `groupKey`, `groupName`, `size`, filename); creates or resumes an unfinished upload and returns `uploadId`, `offset`, `chunkSize=8388608`.
2. `GET /v1/uploads/{uploadId}` — returns the authoritative committed offset and expected size for resume.
3. `PUT /v1/uploads/{uploadId}/chunks?offset=<n>` — raw `application/octet-stream`, at most 8 MiB, exact sequential offset, bounded streaming to `.part`; the persisted offset is the commit point. Data is fsynced before an atomically replaced state file advances the offset. A failed request or startup reconciliation truncates `.part` back to the persisted offset.
4. `POST /v1/uploads/{uploadId}/complete` — requires `offset == expectedSize`, streams the temporary file to calculate SHA-256, fsyncs the model and parent directory, atomically places the model, then atomically writes a commit marker/metadata last. List/download expose only entries whose marker and exact model size are valid.
5. `POST /v1/teacher/session` — compares the workshop password `090909` server-side and returns a short-lived bearer session.
6. `GET /v1/teacher/models` and `GET /v1/teacher/models/{submissionId}` — bearer-session-gated metadata.
7. `POST /v1/teacher/models/{submissionId}/download-ticket` — exchanges the teacher session for a random, one-time, short-lived download ticket.
8. `GET /v1/teacher/models/{submissionId}/download?ticket=...` — consumes the ticket and lets native browser navigation stream an attachment to disk; frontend code must never use `fetch().blob()` for ONNX.

Committed duplicates return `409`. A matching unfinished upload returns its current offset; mismatched metadata returns `409`. User-controlled names never enter filesystem paths. The authoritative filename is always `model.onnx`.

## Phase dependency map

| Phase | Depends on | Stories | Requirements |
|---|---|---|---|
| 01 — VPS preflight and API foundation | none | P1 student, P2 progress/retry foundation | FR-03–FR-07, FR-10–FR-11 |
| 02 — Student paired submission flow | 01 | P1 student, P2 errors/progress | FR-01–FR-03, FR-06, FR-10–FR-11 |
| 03 — Teacher gate and joined model view | 01 | P1 teacher | FR-01, FR-07–FR-09, FR-11 |
| 04 — Service and Quick Tunnel deployment | 01–03 | P1 operator | FR-11–FR-13 |
| 05 — End-to-end verification and rollback | 01–04 | all P1, P2; preserves P3 exclusions | FR-01–FR-13 |

## Files

### New repository files

- `onnx-submission-config.mjs` — API base URL, chunk size, local/production origin settings.
- `onnx-submission-client.mjs` — Firebase token acquisition, init/status/chunk/complete, progress, typed errors.
- `teacher-access.mjs` — teacher session acquisition/storage and authorized model API calls.
- `vps/onnx-submissions/main.py` — FastAPI application, token verification, raw chunk state machine, metadata, teacher APIs.
- `vps/onnx-submissions/requirements.txt` — pinned runtime/test dependencies.
- `vps/onnx-submissions/tests/test_api.py` — API, disk, authentication, CORS, retry, integrity, and download tests.
- `vps/onnx-submissions/deploy/onnx-submissions.service` — loopback API systemd unit.
- `vps/onnx-submissions/deploy/onnx-quick-tunnel.service` — cloudflared Quick Tunnel systemd unit.
- `vps/onnx-submissions/deploy/onnx-submissions.env.example` — non-secret deployment configuration.
- `docs/vps-onnx-submissions.md` — preflight, install, URL publication, operations, cleanup, rollback.
- `test/onnx-submission-client.test.mjs`, `test/student-onnx-submission.test.mjs`, `test/teacher-model-join.test.mjs`.

### Existing files to modify

- `index.html`, `styles.css` — required `.onnx` picker and progress/status presentation.
- `app.js` — wire the ONNX client without changing embed-mode startup boundaries.
- `student-submissions.mjs` — create one ID, upload model, then persist code using that same ID.
- `firebase-client.mjs` — expose current anonymous ID token to the VPS client while preserving Firestore writes.
- `teacher.html`, `teacher.css`, `teacher-submissions.mjs` — password gate, joined model columns/status, download action.
- `package.json` — focused browser/client verification commands if needed.
- `feature_list.json` — track spec stories without changing completed evidence.

## Sequencing and commit boundaries

1. Commit API protocol/tests and deployment templates.
2. Commit student UI/client pairing and regression tests.
3. Commit teacher session/join/download flow and tests.
4. Deploy versioned VPS release, start services, publish tunnel URL in config, and deploy web.
5. Run end-to-end and failure tests; record release/tunnel evidence.

Never commit VPS credentials, Firebase tokens, SSH passwords, live teacher sessions, or private service-account material. The fixed workshop password is intentionally part of server source/config per the accepted workshop constraint and must not be reused elsewhere.

## Global acceptance checks

- A successful Submit uses one ID for VPS metadata and Firestore and reports success only after both complete.
- A 1 GiB model is transferred in raw chunks no larger than 8 MiB; process RSS stays within 32 MiB over baseline.
- Invalid extension, size, IDs, traversal, token, CORS origin, offsets, and duplicate completion fail without a final model.
- An interrupted upload has only temporary state and resumes using the same `submissionId`.
- Teacher entry `090909` unlocks the session; every Firestore row shows model presence by exact ID and downloads a streamed `model.onnx` when present.
- The public Quick Tunnel passes a payload larger than 100 MB end-to-end because no individual request approaches the Cloudflare limit.
- Existing Firebase source upload/download and the full repository test suite remain passing.

## Major risks and mitigations

- **Quick URL changes:** capture URL from cloudflared logs, update exactly one config value, redeploy web, and run an HTTPS smoke test after each tunnel restart.
- **Disk exhaustion:** preflight capacity/inodes, reserve free-space margin before init, cap active uploads, reject when insufficient, and document stale `.part` cleanup.
- **Public abuse:** require valid anonymous Firebase tokens, strict CORS, exact limits, one active upload per UID, global temporary/final quotas, free-space checks before every chunk, incomplete-upload TTL/cleanup, and rate limits for init and teacher login. CORS is never treated as authorization.
- **Orphan model if Firestore fails:** model completes first so code is never visible without a model; retry Firestore with the same ID from client state. Document/admin-clean orphan models after the workshop.
- **Teacher password weakness:** treat it only as an accidental-access gate, compare on server, issue expiring in-memory sessions, and avoid using it for SSH or other systems.
- **Partial/corrupt data:** treat persisted offset as the chunk commit point, reconcile/truncate divergence after failure, calculate SHA-256, fsync, and publish a commit marker last so half-committed entries remain invisible.
- **Process/reboot failure:** persist upload offsets/state, systemd restart API/tunnel, verify resume after restart, and accept that Quick Tunnel URL publication is manual.

## Rollback summary

- Web: revert the deployment to the prior known-good main commit; Firebase source submissions continue unchanged because no schema migration is required.
- VPS: stop/disable the two new units, repoint `/opt/techcamp-onnx/current` to the previous release symlink, `daemon-reload`, and restart.
- Data: never delete `submissions/` during rollback; incomplete `.part` files remain recoverable/cleanable after inspection.
- Tunnel: stop the quick-tunnel unit; no firewall ports 80/443 were opened.

## Phase files

- [x] `phase-01-vps-preflight-and-api-foundation.md`
- [x] `phase-02-student-paired-submission.md`
- [x] `phase-03-teacher-gate-and-model-join.md`
- [x] `phase-04-service-and-quick-tunnel-deployment.md` (local artifacts/tests complete; VPS install pending sudo authorization)
- `phase-05-end-to-end-verification-and-rollback.md`

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-08-12 21:20
**Phase in progress:** phase-04-service-and-quick-tunnel-deployment
**Status:** Local Phase 04 artifacts/tests/review pass; VPS mutation is blocked because the SSH user requires an interactive sudo password. Public-key SSH itself works. Do not use the previously exposed password.

### Decisions made this session

- Use a FastAPI factory with injected token verifier and disk provider so security/storage boundaries are testable without live credentials.
- Persist chunk offset only after file fsync; startup repairs crash boundaries and runtime cleanup skips uploads whose per-ID lock is busy.
- Serialize init reservation, bind every upload route to Firebase UID, and enforce 10 active sessions / 5 concurrent writers.
- VPS preflight completed read-only: Ubuntu 26.04, Python 3.14/venv, systemd, 82 GiB free, loopback-only API port available, and outbound HTTPS works. Deployment remains blocked until `anuni` has passwordless sudo or a root/deploy key is installed.
- Phase 04 local artifacts: loopback API and unprivileged Quick Tunnel systemd units, non-secret env example, and operator runbook with URL republish/fallback checks.
- Student UI now uploads model chunks before Firestore source, and keeps a compact recovery record for Firestore-only retry. Backend SHA-256 remains the model integrity check.
- Teacher portal now gates Firestore/competition polling, joins model metadata by exact submissionId, and uses one-time native download tickets with streamed FileResponse.

### Next immediate action

Next action: grant the SSH key a tightly scoped deployment path (prefer passwordless sudo for the required systemctl/install commands) or install a dedicated deploy key. Then rerun the Phase 04 mutation/preflight gate; do not transmit the old password.
