# Phase 1: Protocol and Successful Camera Publication

**Stories:** P1 — latest AI Camera result in the IDE Output console.

## Objective

Create the bounded same-origin text protocol and publish one snapshot only after a current manual or live prediction succeeds, without coupling cross-window delivery to inference success.

## Changes

1. Add `ai-camera-log.mjs` with constants for one versioned channel and message type. Keep the schema exactly `{ type, version, summary, lines }` and expose no generic object forwarding API.
2. Add a single-line normalizer for publisher-owned text: remove/collapse CR/LF and unsafe control characters, normalize surrounding whitespace, and cap each output at 500 characters. Successful snapshots contain 1–7 result lines.
3. Add strict receiver-side validation for plain objects with exactly the four allowed own keys, exact type/version, one non-empty 1–500-character summary, and 1–7 non-empty 1–500-character result strings. Reject unknown fields, CR, LF, C0 controls (`U+0000`–`U+001F`), DEL (`U+007F`), NEL (`U+0085`), and Unicode line/paragraph separators (`U+2028`/`U+2029`) rather than normalizing untrusted input.
4. Add `createAiCameraLogPublisher({ windowRef, ...testDeps })`. Resolve `BroadcastChannel` only from the explicit browser `windowRef` (or explicit injected test constructor), never `globalThis`/Node ambient globals. If the API is absent, construction throws, posting throws, or closing throws, expose an idempotent no-op-safe `{ publish, destroy }` contract and never propagate the transport error into Camera prediction.
5. In `onnx-camera.mjs`, obtain one publisher per controller, passing the controller's dependency-injected `windowRef` to the shared factory and allowing a fake publisher through `deps` for tests. Do not create a second window-global singleton.
6. After `predictAll()` confirms the run is current, commits `state.results`, renders local results, and computes elapsed time, build the same success summary used by Camera status plus one stable line per box from `state.results`, then publish once.
7. Keep manual and live triggers on the same successful publication point. Do not publish from `renderResults()`, because that risks duplicate sends and lacks the final elapsed summary.
8. Publish nothing for classifying/loading, invalid preconditions, stale source/prediction tokens, inference failure, box clear/undo, camera disconnect, model reload, or controller teardown.
9. Extend controller `destroy()` to invalidate tokens, stop the live timer/stream, and call `predictionPublisher.destroy()` synchronously before the function reaches its first `await releaseSession()`. Do not send a disconnected payload. In a deferred `releaseSession()` test, channel closure must already be observable while the returned destroy promise is still pending.

## Acceptance Checks

- A successful manual prediction and successful 2-second live prediction each emit exactly one payload after local results commit.
- Payloads contain only a non-empty summary and 1–7 non-empty textual box lines plus protocol type/version; no ONNX bytes or browser media objects enter the protocol.
- A failed, stale, cancelled, busy, missing-model, or destroyed prediction emits nothing.
- A browser without working `BroadcastChannel` still shows Camera results and success status normally.
- Destroying the controller twice closes the publisher no more than once, closes it before deferred session release completes, and posts no teardown event.

## Verification

```powershell
node --test test_ai_camera_log.mjs test_onnx_camera_live_draw.mjs
node --check ai-camera-log.mjs
node --check onnx-camera.mjs
```

Tests must inject fake windows/channels/publishers and assert exact keys, non-empty bounded single-line strings, receiver rejection of CR/LF/C0/DEL/NEL/Unicode separators, 1–7 lines, forbidden field absence, manual/live success, no-send paths, safe transport failure, no ambient Node/global fallback, synchronous publisher close before a deferred session release, and idempotent destruction. Same-origin scoping must be documented as delivery isolation, not spoofing prevention.

## Rollback

Remove the shared module/import and publisher calls from `onnx-camera.mjs`, restore controller teardown, and delete only the new protocol/controller tests. Camera inference remains local and unchanged.
