# Phase 05 — End-to-end verification and rollback

**Dependencies:** Phases 01–04 deployed  
**Stories:** all P1 and P2; validates the accepted P3 exclusions  
**Requirements:** FR-01 through FR-13

## Objective

Demonstrate the complete workshop path under normal and failure conditions, record operational evidence, and prove rollback without deleting submissions.

## Verification matrix

1. **Happy path:** new anonymous user, valid group/source/model, one click; compare browser ID, Firestore document ID, VPS metadata ID, size, SHA-256, and downloaded hash.
2. **Pairing:** submit the same group twice and verify each Firebase row joins only its own model.
3. **Validation/security:** wrong extension, empty/oversized declaration, malformed/traversal ID, invalid/expired/non-anonymous Firebase token, wrong UID ownership attempts on every upload route, wrong origin, repeated bad teacher password, expired/replayed download ticket, offset replay, quotas, disk-full, and duplicate completion.
4. **Recovery:** interrupt mid-body, crash after data fsync/before state commit, create file/state divergence, restart API, verify truncation to committed offset, resume same ID, crash at each final rename boundary, then retry Firestore after a forced failure/reload.
5. **Scale:** upload a generated file over 100 MB through the public tunnel while recording chunk sizes, elapsed time, API RSS, disk growth, and five-concurrent-upload behavior.
6. **Regression:** run all Node, Firestore rule, camera, embed, teacher, and Python API tests. Confirm existing `.py` preview/download and simulator behavior.
7. **Operations:** kill/restart API and tunnel, confirm systemd recovery, capture new tunnel URL behavior, check log hygiene, disk/inode thresholds, and stale-part cleanup dry run.

## Commands

```powershell
cd W:\farino_fr3\tmp\onnx-image-upload
npm test
node --test test/onnx-submission-client.test.mjs test/student-onnx-submission.test.mjs test/teacher-model-join.test.mjs
cd vps\onnx-submissions
.\.venv\Scripts\python -m pytest -q
```

VPS evidence:

```bash
systemctl is-active onnx-submissions.service onnx-quick-tunnel.service
systemctl show onnx-submissions.service -p MainPID -p MemoryCurrent -p NRestarts
df -h /srv/techcamp-onnx && df -i /srv/techcamp-onnx
journalctl -u onnx-submissions.service -u onnx-quick-tunnel.service --since '30 min ago' --no-pager
sha256sum /srv/techcamp-onnx/submissions/SUBMISSION_ID/model.onnx DOWNLOADED_MODEL.onnx
```

## Rollback drill

1. Record current and previous release targets with `readlink -f`; never infer paths through globs.
2. Before mutation record the exact known-good Vercel deployment ID. Roll back to that deployment first; use a surgical follow-up commit instead of reverting unrelated main-branch work.
3. Stop both units, point `/opt/techcamp-onnx/current` to the verified previous release, reload and restart the API; or disable both units if removing the feature entirely.
4. Keep `/srv/techcamp-onnx/submissions` untouched. Do not delete `.part` or completed files during rollback.
5. Verify Firebase source submission/download remains operational and document whether the tunnel is intentionally stopped.

## Final acceptance checks

- Every spec success criterion has timestamped evidence and a named command/manual observation.
- Public >100 MB transfer, restart/resume, bounded memory, five concurrent uploads, exact ID pairing, teacher gate/download, and regression suite pass.
- No secrets appear in git diff, service files, browser config, or logs.
- Out-of-scope items remain absent: no model execution/training, version manager, durable RBAC, retention system, or stable named tunnel.
- Rollback returns the website to Firebase-only submissions without data loss.

## Residual risks accepted for workshop

- Quick Tunnel URL must be manually republished after recreation.
- Fixed password is a convenience gate, not strong authentication.
- Orphan completed models may need manual post-workshop reconciliation if Firestore never succeeds.
- Quick Tunnel is explicitly a development/testing service with a random URL and no SLA; run the operator readiness gate immediately before the workshop and fall back to Firebase-only submission if it fails.
- No malware scanning, retention automation, or long-term backup is included.
