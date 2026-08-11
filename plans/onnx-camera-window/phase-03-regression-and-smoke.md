# Phase 3: Regression, Lifecycle, and Workshop Smoke

## Objective

Lock down the cross-document boundary and confirm that the existing workshop classification workflow remains fast and predictable in its larger surface.

## Automated Coverage

1. Update `test_onnx_camera_page.mjs` to assert:
   - `index.html` has the accessible launcher/status but no inline `#onnxCameraCard`;
   - `onnx-camera-window.html` owns every DOM ID consumed by `onnx-camera.mjs` and loads the standalone module;
   - the standalone bootstrap imports/reuses `createOnnxCameraController()`, does not duplicate its `pagehide` cleanup, and recreates once on persisted `pageshow`;
   - the standalone document does not load `app.js`, Three.js, Firebase, or guide/robot modules;
   - dedicated responsive styles are scoped and shared UI tokens/components remain sourced from `styles.css`;
   - the main app initializes the launcher only outside guide embed.
2. Add `test_onnx_camera_launcher.mjs` with injected fake `window`, button, status, document base URI, and screen dimensions. Cover first open, second-click focus without another open, closed-reference reopen, `window.open() === null`, thrown/inaccessible `.closed` or `.focus()`, subpath-safe URL resolution, stable name, clamped width/height/position/features, parent-reload relaunch reset policy, main IDE persisted `pagehide`/restore with exactly one working listener, repeated destroy, and no clicks after non-persisted destroy.
3. Add executable bootstrap tests for init-once, actionable error rendering, sole teardown ownership, and persisted `pageshow` reinitialization; do not rely only on source regex.
4. Retain `test_onnx_camera_core.mjs` coverage unchanged for filename, model contract, preprocessing, normalized boxes, and Top 3 behavior.
5. Run `test_embed_mode.mjs` and the complete suite. Treat unrelated existing failures as pre-existing only when reproduced from the branch baseline and documented; no new camera/window failure may be waived.

## Manual Workshop Matrix

| Scenario | Expected result |
| --- | --- |
| First launcher click | One large named camera context opens from direct user activation. |
| Repeated launcher click | Existing context receives focus; no duplicate context appears. |
| IDE reload then relaunch | Existing named child may navigate/reset; no stale reference error or duplicate context occurs. |
| IDE Back/Forward restore | Persisted pagehide keeps one launcher listener and the next click still opens/focuses. |
| Popup blocked | Polite IDE status explains how to allow popups and retry; IDE remains usable. |
| Child reload | Model, camera, captured frame, boxes, and results reset; local `.onnx` must be selected again. |
| Camera close/navigation | All active/replaced media tracks stop and cannot revive after delayed permission. |
| Back/forward restore | A fresh controller initializes once after persisted `pageshow`; camera remains stopped until reconnect. |
| YOLO26-cls small/large | Renamed compatible models reach ready state; WebGPU/WASM and timing remain visible. |
| One/seven regions | Predict all runs only on click, returns Top 3 for each, and preserves boxes/results for retry. |
| Camera switch/retake/clear | Existing semantics remain unchanged and no stream leaks. |
| Guide embed | No launcher/bootstrap side effect; viewport-only guide remains functional. |
| Light/dark + 200% zoom | Tokens, focus, labels, stage, actions, and results stay readable without overflow. |

## Final Commands

```powershell
node --test test_onnx_camera_core.mjs test_onnx_camera_page.mjs test_onnx_camera_launcher.mjs test_embed_mode.mjs
node --check app.js
node --check onnx-camera.mjs
node --check onnx-camera-core.mjs
node --check onnx-camera-window.mjs
node --check onnx-camera-launcher.mjs
npm test
git diff --check
```

## Completion Gate

- Focused tests pass and the full-suite result introduces no regression relative to the branch baseline.
- The open/focus/blocked/close/reload lifecycle has been manually exercised on the workshop browser under localhost or HTTPS.
- Camera ownership is visibly released on child exit.
- Only intended source/test/plan hunks are staged; unrelated dirty worktree files, assets, temporary output, and `bridge/certs/` remain excluded.

## Rollback

Revert the launcher/dedicated-page commit as one frontend-only change. No migrations, stored model data, backend state, or external resources require cleanup.
