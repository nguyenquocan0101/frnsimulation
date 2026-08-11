# Phase 1: Dedicated Page Shell and Bootstrap

## Objective

Host the existing ONNX classification experience in a standalone, same-origin browser document with substantially more usable camera space, while keeping the controller and inference core reusable.

## Changes

1. Add `onnx-camera-window.html` with a descriptive document title, one `<main>` landmark, visible AI camera heading/help, and the exact control IDs currently required by `createOnnxCameraController()`.
2. Keep the local model input explicit that `.onnx` files remain on-device and must be chosen again after reload. Preserve labels, disabled defaults, `role="status"`, `aria-live="polite"`, canvas keyboard label/tab stop, and Top 3 results semantics.
3. Load `styles.css` first for the IDE tokens and shared `.button`, `.panel`, and `.onnx-*` components, then `onnx-camera-window.css` for standalone-only composition. Do not copy color values into a parallel theme.
4. Add `onnx-camera-window.css` with a page-scoped responsive layout: constrained wide desktop canvas/results arrangement where useful, a single-column narrow layout, viewport-safe padding, visible focus, readable status, and no fixed inline-panel height/scroll trap.
5. Add `onnx-camera-window.mjs` around a dependency-injectable bootstrap factory. Read a launch-time snapshot of `fr3-theme` (`light` or `dark`), default safely, find the standalone root, and call `createOnnxCameraController({ root })` exactly once.
6. Keep controller errors isolated: render an actionable bootstrap error in the page status instead of throwing into unrelated code. Do not add a second `pagehide` teardown because the controller already owns it; on `pageshow` with `persisted === true`, create one fresh controller so a bfcache restore is usable.
7. Do not pass model files, streams, frames, or predictions into/out of this page. Native file-input reset on reload is the required behavior.

## Acceptance Checks

- Direct navigation to the relative `onnx-camera-window.html` URL renders a complete keyboard-usable page without loading `app.js`, Three.js, Firebase, robot code, or guide bridge code.
- `onnx-camera.mjs` and `onnx-camera-core.mjs` remain the single implementation of model/camera/box/prediction behavior.
- The shared light/dark tokens visually match the IDE; 200% zoom and a narrow browser width do not hide controls or create horizontal overflow.
- Closing, navigating, or reloading the page while a stream is active stops every owned media track; delayed permission completion cannot revive a destroyed controller.
- Reload starts with no selected model, no connected camera, no boxes, and no results.
- Back/forward bfcache restore creates one usable fresh controller after the prior controller was destroyed.

## Verification

```powershell
node --check onnx-camera-window.mjs
node --check onnx-camera.mjs
node --test test_onnx_camera_core.mjs test_onnx_camera_page.mjs
```

Manual: open the dedicated URL directly under localhost, verify both themes and keyboard order, then connect a camera and close/reload the page while observing the browser camera indicator.

## Rollback

Delete the three standalone files. Existing inline behavior remains untouched until Phase 2 deliberately switches the host.
