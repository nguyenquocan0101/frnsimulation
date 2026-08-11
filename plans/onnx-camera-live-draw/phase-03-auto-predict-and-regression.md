# Phase 3 — Guarded auto-Predict, regression tests, and smoke

## Goal

Connect accepted live releases to the existing sequential classifier with stale-write protection, preserve boxes on errors/no-session, and finish focused/full regression plus browser smoke.

## Stories covered

- P1: every new live box reclassifies all current boxes sequentially (1, 3, and 7 cases).
- P1: manual Predict all remains explicit in Capture frame.
- P1: source reset removes stale results.
- P2: busy/error status locks drawing and supports retry.
- P3: no continuous inference/tracking.

## Implementation tasks

1. Implement a guarded `predictAll({ trigger, sourceToken })` path. For `trigger: 'live'`, require `mode === 'live'`, `frameReady`, a compatible session, and the captured source generation. Capture immutable local session/contract/provider references and a box snapshot before the first await; for each accepted release, iterate that snapshot sequentially with `await inferBox(box, localSession, localContract, localProvider)` exactly once per box.
2. Set `state.busy = 'predict'` before the run and clear it in `finally` only when the run still owns its prediction token; stale runs must not clear a newer run's busy state or overwrite its status. While busy, ignore pointer input and prevent overlapping capture/mode/camera operations. Announce `Classifying N boxes…` and completion count/duration in the existing polite status region.
3. Before committing results, verify source/prediction tokens, mode, and controller lifetime. Stale runs may finish silently or report a non-destructive status, but must never paint results from an old frame onto the new source.
4. On missing session/model, keep the newly accepted box and frame, report how to load a compatible `.onnx` or use manual Predict after readiness, and allow retry. On inference failure, preserve boxes/frame and leave Predict enabled when possible.
5. Ensure camera switch, retake/capture, disconnect, mode switch, and pagehide invalidate any pending run and clear result rows without leaking tracks/session resources. Model replacement invalidates old runs and clears stale results, but preserves an unchanged frame and accepted boxes so a no-session live selection can be manually retried after a compatible model becomes ready.
6. Extend `test_onnx_camera_page.mjs`, `test_onnx_camera_window.mjs`, and `test_onnx_camera_core.mjs`; add the mandatory `test_onnx_camera_live_draw.mjs` with dependency-injected controller seams. Cover cumulative 1/3/7 sequential calls, stale promise resolution, busy pointer and keyboard lock, no-session retention, model replacement/session guard, error retry, and manual capture regression.
7. Run syntax, focused, and full suites; perform localhost/HTTPS smoke with a real camera and a small `.onnx` model. Record unrelated existing failures separately and do not modify unrelated files.

## Tests to write/update first

- Fake session call-order test for 1, 3, and 7 boxes: each release triggers one ordered pass over all current boxes and no second pass/loop.
- Busy guard test: pointerdown/up during auto-Predict creates no box and does not start another session run.
- Busy keyboard/pointercancel test: Enter/Space cannot mutate live state during auto-Predict and cancel/lost capture never accepts a draft.
- Stale generation test: mode/source reset before delayed inference resolves leaves `state.results` empty for the new source.
- Model replacement test: delayed old session/provider/fallback completion cannot write into the new session or source, while a no-session live box/frame remains after model load and manual Predict can retry it.
- Finally-ownership test: a delayed stale run cannot clear a newer run's busy state/status; each run uses the session/provider captured at its own start.
- Error/no-session test: accepted box remains, status is actionable, and manual Predict/retry can run once the model is ready.
- Full child-page regression: model/camera lifecycle, bfcache bootstrap, theme, accessibility, and dedicated-window isolation remain green.

## Validation gates

```powershell
node --test test_onnx_camera_core.mjs test_onnx_camera_page.mjs test_onnx_camera_window.mjs test_onnx_camera_live_draw.mjs
node --check onnx-camera.mjs
node --check onnx-camera-window.mjs
git diff --check
npm test
```

Manual smoke must cover Capture frame, Draw live, 1/3/7 boxes, rejected eighth/sub-12px boxes, busy/error/no-session states, source resets, camera teardown, keyboard/200% zoom, light/dark theme, and 360/768/1440 px widths.

## Done when

- All spec success criteria have direct automated or manual evidence.
- The mandatory live-draw fake-DOM suite proves cumulative 1/3/7 inference counts and letterbox geometry cases.
- Focused live-draw suite and syntax checks pass; full-suite failures, if any, are proven unrelated.
- Review confirms no parent/launcher/core contract drift, no cross-window data flow, no continuous inference, and no private/unrelated files staged.

## Rollback

Revert the live-draw implementation and tests only. The dedicated ONNX camera window remains available with Capture frame/manual Predict, because no launcher, parent, or 3D simulator files are changed.
