# Phase 1 — Mode state, controls, and source reset

## Goal

Introduce an explicit `capture`/`live` state in the dedicated child window while preserving the existing Capture frame/manual Predict all flow. Make all source-changing actions invalidate old boxes/results before Phase 2 draws over live video.

## Stories covered

- P1: choose Capture frame or Draw live; Capture frame remains default.
- P1: continue using Capture frame manually.
- P1: clear old selections when mode/source changes.
- P2: status surface is ready for busy/error messages.

## Implementation tasks

1. In `onnx-camera-window.html`, add a labelled mode group with keyboard-accessible `Capture frame` and `Draw live` buttons (or equivalent controls) and `aria-pressed`/selected state. Explain that live mode snapshots on box release and does not track objects. Keep all existing IDs consumed by the controller.
2. In `onnx-camera-window.css`, style the mode group using current IDE tokens, visible focus, disabled/busy state, dark theme, reduced motion, and responsive wrapping down to 360 px.
3. In `onnx-camera.mjs`, add `state.mode = 'capture'`, `state.frameReady`, `state.sourceToken`, and `state.predictionToken`. Define explicit capture-without-frame, capture-with-frame, live-not-ready, live-ready, and busy-prediction states. Centralize `clearRegions`/source invalidation so it clears boxes, results, draft pointer state, frame readiness, result DOM, and redraws the overlay.
4. Add a mode setter that increments the source generation, clears regions, switches video/frame/overlay visibility consistently, updates `data-mode`, button state, labels, and status. Mode changes must not disconnect the camera.
5. Preserve current Capture frame semantics: capture/retake freezes a frame, sets canvas dimensions from video metadata, clears prior selections, and leaves `Predict all` manual. In live mode Capture/Retake switches to capture and freezes the current ready video frame. Connect, camera switch, disconnect, and teardown call the clearing invalidation boundary. Model load/replacement invalidates pending prediction generations and clears stale result rows, but preserves the current frame and accepted boxes when the camera/source pixels are unchanged, so a box drawn before model readiness remains retryable.
6. Update `updateControls()` so capture/live buttons, camera/source controls, box actions, and Predict reflect mode, stream, frame readiness, session readiness, and busy state without disabling the ability to return to Capture frame after an error.

## Tests to write/update first

- Static page test finds both mode labels, default Capture frame semantics, accessible state hooks, and live instructions.
- Controller fixture test boots with `mode === 'capture'`, changes mode once, sees exactly one source reset, and does not call `getUserMedia` again.
- State-table fixture covers capture-without-frame, capture-with-frame, live-not-ready, live-ready, and busy states with explicit control locks.
- Reset matrix test covers mode switch, capture/retake, camera switch, and disconnect; each clears boxes/results/draft/frame readiness and invalidates the source token. A separate model-not-ready → model-load test proves replacement clears stale results/pending runs but preserves the accepted frame and boxes for manual Predict.
- Manual regression fixture proves capture mode still requires an explicit Predict button and does not auto-run when a box is completed.

## Done when

- The dedicated page exposes both modes and announces the selected mode.
- Capture mode behavior and existing controller IDs remain compatible.
- Every source change clears stale selection/result state and increments the generation used by later phases.
- Mode, capture/retake, and source controls expose one predictable state machine with no stale state branch.
- Focused phase tests pass without touching parent IDE/launcher files.

## Rollback

Revert only the mode markup/style/controller changes; the page returns to the existing capture-only behavior with no parent-window impact.
