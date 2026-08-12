# Spec: VPS ONNX submissions linked to Firebase

**Date:** 2026-08-12
**Status:** Ready

---

## Problem Statement

Students already submit `main.py` source to Firebase, but each submission also needs one ONNX model stored outside Firestore. Teachers need one view that pairs the Firebase source and VPS model for the same team submission.

---

## User Stories

- **[P1]** As a student, I want to submit one `model.onnx` with my existing code submission so that the teacher receives a complete entry.
  Accepted when: one Submit action uses the same `submissionId` for the Firebase document and VPS model, and success is shown only after both uploads finish.

- **[P1]** As a teacher, I want to see whether each Firebase submission has a model and download it so that I can review the complete work.
  Accepted when: every teacher row is joined by `submissionId` and shows model name, size, upload time, and a working download action when present.

- **[P1]** As the workshop operator, I want the VPS API exposed without purchasing a domain so that it can be deployed immediately.
  Accepted when: the API is reachable over HTTPS through a Cloudflare Quick Tunnel and the web app uses the current tunnel URL.

- **[P2]** As a student, I want useful upload progress and errors so that I know whether a large model finished uploading.
  Accepted when: the UI displays byte progress and distinguishes invalid file, oversized file, network failure, and server failure.

- **[P3]** A stable custom domain, durable authentication, model version management, and automatic tunnel URL discovery are out of scope for this workshop build.

---

## Functional Requirements

1. FR-01: Preserve the current Firebase `submissions/{submissionId}` document and `main.py` download behavior.
2. FR-02: Generate one `submissionId` per Submit action and send that exact ID to both Firebase and the VPS API.
3. FR-03: Accept exactly one file named or normalized to `model.onnx`, with `.onnx` extension and a maximum size of 1 GiB.
4. FR-04: Store models at `submissions/<submissionId>/model.onnx`; user-supplied names must never become filesystem paths.
5. FR-05: Store VPS metadata containing `submissionId`, `groupKey`, `groupName`, byte size, SHA-256, and UTC upload time.
6. FR-06: Reject duplicate `submissionId` uploads unless the corresponding Firebase workflow explicitly retries the same unfinished submission.
7. FR-07: Provide API operations to upload a model, list model metadata, read metadata for one submission, and download one model.
8. FR-08: Join teacher rows to VPS metadata using `submissionId`; `groupKey` is display/filter metadata only.
9. FR-09: Gate teacher UI and teacher list/download API with the fixed workshop password `090909`. This is a convenience gate, not a durable security boundary.
10. FR-10: Accept student upload requests only with a valid Firebase anonymous ID token for the existing Firebase project.
11. FR-11: Allow browser requests only from the production simulator origin and configured local-development origins.
12. FR-12: Run the API as a restartable VPS service and expose it via Cloudflare Quick Tunnel without opening ports 80 or 443.
13. FR-13: Document the current Quick Tunnel URL and the one-line web configuration change required whenever that URL changes.

---

## Non-Functional Requirements

- Performance: stream uploads to disk in bounded chunks; do not load an ONNX file into RAM; support one 1 GiB upload and at least five concurrent workshop uploads without process failure.
- Security: validate Firebase tokens server-side; compare the teacher password server-side; enforce exact IDs, extensions, size limits, CORS allow-listing, safe response headers, and no path traversal.
- Availability: the API and tunnel restart automatically after a process failure; a VPS reboot may require obtaining and publishing a new Quick Tunnel URL.
- Integrity: calculate SHA-256 while streaming and return it with metadata; write to a temporary file and atomically rename only after upload completion.

---

## Success Criteria

- [ ] Pairing: 100% of successful test submissions expose the same `submissionId` in Firebase and VPS metadata.
- [ ] File validation: files over 1 GiB, non-ONNX extensions, malformed IDs, and traversal strings are rejected without a committed file.
- [ ] Memory: uploading a test file does not increase backend resident memory by more than 32 MiB beyond baseline.
- [ ] Recovery: an interrupted upload leaves no downloadable final model and can be retried with the same unfinished `submissionId`.
- [ ] Teacher flow: after entering `090909`, a teacher can list and download the model paired with a Firebase row.
- [ ] Public access: production web UI can upload and download through the current HTTPS Quick Tunnel URL.

---

## Out of Scope

- Moving `main.py` source away from Firebase.
- A permanent domain or stable Cloudflare named tunnel.
- Strong role-based teacher authentication or keeping the fixed workshop password secret from browser users.
- Executing, converting, validating graph semantics, or training uploaded ONNX models.
- Long-term backups, retention policies, malware scanning, and multi-workshop tenancy.

---

## Assumptions

- The VPS has enough free disk for all workshop submissions plus incomplete temporary uploads.
- Students submit from the existing simulator and already receive Firebase anonymous authentication.
- The operator accepts that the Quick Tunnel URL changes when the tunnel is recreated.
- The fixed teacher password is temporary and provides only accidental-access protection.

