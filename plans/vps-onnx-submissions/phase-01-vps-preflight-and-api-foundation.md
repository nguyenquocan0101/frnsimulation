# Phase 01 — VPS preflight and API foundation

**Dependencies:** none  
**Stories:** P1 student; P2 progress/retry foundation  
**Requirements:** FR-03, FR-04, FR-05, FR-06, FR-07, FR-10, FR-11

## Objective

Prove the target VPS is suitable, then implement and test the bounded raw-chunk FastAPI protocol locally without changing the production website.

## VPS preflight (read-only first)

SSH only after confirming the exposed password has been changed. Record, without printing secrets:

```bash
uname -a
cat /etc/os-release
python3 --version
df -h / /opt /srv 2>/dev/null
df -i / /opt /srv 2>/dev/null
free -h
systemctl --version
ss -lntup
curl -I https://api.cloudflare.com/client/v4/ips
```

For the validated 10-group workshop, confirm at least 20 GiB reserved for completed submissions plus 5 GiB temporary capacity, followed by a separate 20% free-space headroom; also confirm enough inodes, Python 3.11+, systemd, outbound HTTPS/DNS, and no collision on loopback port `8787`. Do not open 80/443. If any check fails, stop deployment and retain local implementation/tests.

## Implementation tasks

1. Add `vps/onnx-submissions/main.py` with configuration for data root, allowed origins, Firebase project ID, maximum 1 GiB file, 8 MiB chunk size, active-upload cap, and free-space margin.
2. Verify Firebase SecureToken JWTs against Google's current certificates/JWKS, with issuer/audience/expiry and anonymous-provider checks. Cache public keys according to response cache headers; fail closed.
3. Implement init/status/raw PUT/complete as specified in `plan.md`; generate an unguessable upload ID, persist `ownerUid` plus an immutable metadata fingerprint, require that same UID on every student route, and reject missing/invalid `Content-Length`, chunks over 8 MiB, non-sequential offsets, extra bytes, malformed IDs, or conflicting resume metadata.
4. Define the persisted offset as the chunk commit point. Stream to `.part`, fsync data, then atomically replace state with the new offset. On disconnect/write failure leave the old offset authoritative and truncate back to it; at startup reconcile every file/state divergence before accepting resume. Serialize writes per upload ID.
5. On completion, stream SHA-256, validate exact expected size, fsync the model and parent directory, atomically place the model, then atomically write metadata/commit marker last. List/download accept only a valid marker plus an exact-size model; startup reconciliation hides/repairs incomplete rename boundaries.
6. Implement list/detail/download internals but expose teacher routes only through the session gate completed in Phase 03.
7. Enforce one active upload per UID, at most 10 active sessions globally, 5 simultaneous writers, 5 GiB temporary and 20 GiB completed byte quotas, free-space margin before init and every chunk, incomplete TTL cleanup, and bounded init/teacher-login rate limits. Handle `ENOSPC` without advancing state.
8. Add pinned requirements and API tests using temporary directories and mocked Firebase certificate/token validation boundaries.

## Verification commands

```powershell
cd W:\farino_fr3\tmp\onnx-image-upload\vps\onnx-submissions
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m pytest -q
```

Linux smoke equivalent:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pytest -q
.venv/bin/uvicorn main:app --host 127.0.0.1 --port 8787
curl -fsS http://127.0.0.1:8787/healthz
```

## Acceptance checks

- Valid chunks append only at the authoritative offset and status survives app restart.
- Non-ONNX, >1 GiB, invalid/traversal ID, unauthenticated, non-anonymous, wrong-origin, oversize chunk, and conflicting duplicate cases are rejected.
- Interrupted upload never creates a downloadable final file; completion returns SHA-256 and metadata and uses atomic rename.
- Five concurrent uploads to different IDs do not corrupt offsets; same-ID concurrent PUTs produce one success and one conflict.
- A different Firebase UID cannot read status, append, resume, or complete another UID's upload; same-UID idempotency requires the exact metadata fingerprint.
- Mid-body disconnect, crash after file fsync/before state replace, startup file/state divergence, disk-full, and every completion rename boundary recover without exposing corrupt final data.
- A generated large sparse/test stream demonstrates bounded RSS and no full-body buffering.

## Risks / stop conditions

- Stop if disk headroom is inadequate or the VPS cannot make outbound HTTPS calls needed for key verification/tunnel.
- Do not weaken auth because live certificate verification is inconvenient; isolate it behind a testable verifier and use real-token smoke testing later.
- Do not accept `UploadFile`/multipart for model chunks; raw request bodies are required to avoid framework/proxy buffering ambiguity.
