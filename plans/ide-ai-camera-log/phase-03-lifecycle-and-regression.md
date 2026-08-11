# Phase 3: Lifecycle, Isolation, and Regression

**Stories:** P2 — retain the last AI result after Camera closes; P1 — stable latest result/cadence. P3 history persistence remains explicitly out of scope.

## Objective

Prove that Camera/IDE teardown, bfcache restoration, unsupported browsers, and Guide mode do not leak listeners or disturb existing workshop behavior, and that Camera closure retains the last rendered result.

## Changes

1. Extract a testable IDE lifecycle coordinator (in `ai-camera-log.mjs` or a narrowly named side-effect-free helper) and have `app.js` use it rather than owning anonymous lifecycle state. It accepts an explicit fake/browser `windowRef`, `isEmbedMode`, and receiver factory.
2. In normal mode the coordinator constructs exactly one receiver, owns named `pagehide`/`pageshow` handlers, destroys/nulls the receiver on every pagehide, recreates only on persisted pageshow, and removes its listeners on final/non-persisted pagehide. It never clears or replaces `.ai-camera-log-block`.
3. Preserve the existing Camera launcher rule: only final/non-persisted `pagehide` destroys the launcher. Keep launcher cleanup separate from receiver coordination.
4. In guide/embed mode the coordinator must construct zero receivers/channels and register zero page lifecycle listeners. Importing the helper remains side-effect-free.
5. Ensure Camera controller/window teardown closes its publisher synchronously before the first awaited session release. It must not publish `disconnected`, blank results, or a final status. A successful payload already received and buffered by the IDE before Camera close may still render once at its scheduled throttle boundary; that result then remains.
6. If the IDE is bfcache-frozen while Camera publishes, allow those ephemeral messages to be missed; the next live 2-second result restores freshness. Do not add storage or replay.
7. Mandatorily bump the cache token in both `onnx-camera-window.html`'s bootstrap query and `onnx-camera-window.mjs`'s `onnx-camera.mjs` import to the exact same value. Keep existing page layout, camera geometry, and 2-second loop unchanged.
8. Run the focused suite and full baseline, then perform a real two-tab smoke on localhost/HTTPS with light/dark themes, Clear log, Camera close, and bfcache navigation.

## Acceptance Checks

- Closing Camera sends no disconnected/blank message. The current block remains unless one already-received successful payload is waiting in the IDE throttle buffer; that payload may render once after close and then remains unchanged.
- Receiver and publisher destruction clear pending timers, close channels once, and ignore later events/calls.
- Fake-window execution of three persisted pagehide/pageshow cycles still leaves one active receiver and one AI block update per throttle event; final pagehide destroys it and removes both listeners.
- Guide/embed fake-window execution constructs zero receivers/channels and registers zero lifecycle listeners.
- A fake `windowRef` with missing/throwing `BroadcastChannel` leaves normal IDE logs, Camera inference, launcher, and Guide behavior usable even when the Node/global runtime defines `BroadcastChannel`.
- The lifecycle unit test observes initial create count 1; after each of three persisted pagehide/pageshow pairs, the prior receiver is destroyed and exactly one replacement is active (total creates 4); final pagehide destroys the fourth receiver and leaves zero coordinator listeners.
- A static/import-graph test extracts and compares both query values, failing unless the HTML-to-window and window-to-controller cache tokens are equal and changed from `20260812-timed-log`.
- Existing 2-second Camera prediction cadence, result log, box flow, and dedicated window layout remain unchanged.
- Full baseline has no new failures attributable to this feature.

## Verification

```powershell
node --test test_ai_camera_log.mjs test_ide_ai_camera_log.mjs test_onnx_camera_live_draw.mjs test_embed_mode.mjs test_onnx_camera_window.mjs
node --check ai-camera-log.mjs
node --check app.js
node --check onnx-camera.mjs
node --check onnx-camera-window.mjs
npm test
git diff --check
```

Manual: keep IDE and Camera visible, confirm 2-second local predictions and 3-second IDE updates, generate ordinary simulator logs, Clear and repopulate (confirm the console scrolls to the recreated block), then close Camera. Verify no disconnect/blank output and allow at most one final already-buffered success before the result remains. Navigate IDE back/forward and confirm no duplicate updates. Repeat once in `?embed=guide` and once with `BroadcastChannel` disabled in devtools if practical. Confirm the HTML bootstrap and window-to-controller imports use the same new cache token.

## Selective Staging Guard

Before commit, inspect and stage only:

- `ai-camera-log.mjs`
- `onnx-camera.mjs`
- `app.js`
- `styles.css`
- `test_ai_camera_log.mjs`
- `test_ide_ai_camera_log.mjs`
- `test_onnx_camera_live_draw.mjs`
- `test_embed_mode.mjs`
- `onnx-camera-window.html` and `onnx-camera-window.mjs` with the mandatory matching cache-token bump
- `feature_list.json` and this plan directory only when plan artifacts belong in the commit

Camera window version files are mandatory and must share one token. Use partial staging for shared dirty files. Before staging `feature_list.json`, parse it, confirm exactly the three planned IDs are `passing` with final evidence, and review its working diff to ensure every pre-existing entry is preserved. After staging, repeat those checks against the cached file/diff. Verify cached names, cached diff, and `git diff --cached --check`. Never stage `bridge/certs/`, PDFs, object-class images, snapshots, screenshots, payloads, `tmp/`, unrelated plans/reports, or `.playwright-mcp/`.

## Rollback

Remove receiver lifecycle hooks and the shared transport integration, restore the prior pagehide behavior and normal console append implementation, and remove feature CSS/tests. There is no persisted AI data to migrate or clear; refreshing the IDE removes any last DOM block.
