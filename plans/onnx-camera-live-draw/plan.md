Mode: Hard
Risk: normal — multi-file child-window UI/state-machine change with local camera inference, no auth/data/infra or irreversible operation.

# Plan: Live ONNX camera drawing and automatic classification

**Spec:** `plans/onnx-camera-live-draw/spec.md`
**Status:** Implementation complete
**Tests:** default focused tests plus manual localhost/HTTPS camera smoke; recommend `--tdd` when cooking.

## Scope challenge and spec quality

- **Exists?** The dedicated child window already owns model loading, camera lifecycle, frame capture, normalized manual boxes, sequential `Predict all`, and result rendering. It currently assumes `state.captured` before drawing and has no mode state.
- **Minimum?** Add an opt-in two-button mode control, make the existing overlay work over a playing video, snapshot the current video frame on valid live pointer release, and call the existing sequential prediction path for all accepted boxes. Keep the capture/manual path intact.
- **Complexity?** Hard: one controller state machine spans markup, live/captured canvas compositing, pointer geometry, source invalidation, asynchronous inference guards, tests, and accessibility.
- **Spec quality:** PASS. No `[NEEDS CLARIFICATION]` items remain; all P1/P2 acceptance conditions are measurable and P3 is explicitly out of scope.

## Research synthesis and architectural decision

The approved brainstorm and implementation research select a single-controller, opt-in live mode. `Capture frame` remains the default and continues to use a frozen frame plus manual `Predict all`. `Draw live` keeps the same `<video>` playing underneath the existing overlay canvas. A valid `pointerup` is the only live trigger: copy the newest video pixels into the existing frame canvas, append one normalized box, then run the existing sequential classifier over every current box once. There is no timer, `requestVideoFrameCallback`, continuous inference, tracking, queue, or parent-window synchronization.

The controller remains the only owner of camera/model/result state. Add explicit state generations (`mode`, `frameReady`, `sourceToken`, and a prediction generation/guard) so a mode switch, retake, camera change, disconnect, model replacement, or stale async result cannot overwrite the current source. Keep `onnx-camera-core.mjs`, `onnx-camera-launcher.mjs`, parent `app.js`, and the 3D simulator unchanged. Use a shared `displayRect` derived from stage bounds plus intrinsic media aspect ratio for normalized pointer coordinates, overlay drawing, edge clamping, and the 12 px minimum; do not normalize against `object-fit: contain` letterbox bars.

### Rejected alternatives

- **Continuous inference/tracking:** rejected as unnecessary for the workshop click-driven flow and likely to race, consume hardware, and change classification semantics.
- **Separate live controller or parent bridge:** rejected because it duplicates inference/camera logic and risks leaking model bytes, frames, or results across the child-window boundary.
- **Keep selections across mode/source changes:** rejected because boxes would refer to an ambiguous frame; every source reset must clear boxes/results.

## Stories and acceptance mapping

| Story / requirement | Covered by | Evidence required |
| --- | --- | --- |
| P1 choose Capture frame or Draw live; capture remains default | Phase 1 | DOM/controller tests prove labelled keyboard-accessible controls, default state, mode announcement, and reset on switch. |
| P1 draw on running video and snapshot on release | Phase 2 | Live pointer test proves one bounded >=12px box, one `drawImage(video, …)` snapshot, and `frameReady` after pointerup. |
| P1 reclassify all 1/3/7 boxes sequentially after every valid live box | Phase 3 | Fake-session tests record exactly one sequential inference per existing box per release, with no timer/loop. |
| P1 preserve manual capture and explicit Predict all | Phase 1 + 3 | Capture-mode regression proves video freezes, live auto-run is off, manual button remains the only trigger, and boxes/results persist after prediction. |
| P1 clear stale selections on mode/source changes | Phase 1 | Mode, capture/retake, camera switch, disconnect, and model/source generation tests assert empty boxes/results and no active stale run. |
| P2 busy/error status and retryable boxes | Phase 3 | Busy input is ignored; model-not-ready and inference errors announce actionable status while boxes remain available for retry. |
| P3 no tracking/continuous inference | All | Static tests reject timers/video-frame callbacks/tracking; manual smoke confirms no predictions before pointer release. |

## Implementation phases

- [x] [Phase 1 — Mode state, controls, and source reset](phase-01-mode-state-and-controls.md)
- [x] [Phase 2 — Live video overlay and snapshot-on-release](phase-02-live-overlay-and-snapshot.md)
- [x] [Phase 3 — Guarded auto-Predict, regression tests, and smoke](phase-03-auto-predict-and-regression.md)

## File map and ownership

| File | Planned change |
| --- | --- |
| `onnx-camera-window.html` | Add accessible two-button mode group and live-mode instructions/status hooks; retain all controller IDs and dedicated-window isolation. |
| `onnx-camera-window.css` | Style mode group, live video + overlay stacking, visible/hidden states, focus treatment, busy/disabled states, and responsive 360–1440px layout using existing IDE tokens. |
| `onnx-camera.mjs` | Add mode/source/frame state, reset and display-geometry helpers, live snapshot/draw path, auto-Predict trigger, and stale-write/busy guards while preserving manual behavior. |
| `test_onnx_camera_page.mjs` | Extend static contracts for mode controls, live video/overlay semantics, no continuous inference, and dedicated-page accessibility. |
| `test_onnx_camera_window.mjs` | Preserve bootstrap/theme/bfcache tests; add fixture checks that the child still boots the same controller and surfaces live-mode errors. |
| `test_onnx_camera_core.mjs` | Reuse normalized-box/clamp geometry contracts; add only pure displayRect/aspect helpers if they are extracted from the controller. |
| `test_onnx_camera_live_draw.mjs` (new, mandatory) | Dependency-injected fake DOM/video/canvas/session tests for pointerup snapshot, displayRect/letterbox, mode reset, busy keyboard/pointer lock, source tokens, no-session retention, and sequential auto-Predict. |
| `onnx-camera-core.mjs`, `onnx-camera-launcher.mjs`, `app.js`, parent `index.html` | No planned changes; the live feature is child-window-only. |

## Cross-phase invariants

1. `Capture frame` is selected on initial boot. It freezes the current frame and leaves automatic inference disabled; `Predict all` remains explicit.
2. `Draw live` requires an active stream and keeps the video visible under the overlay. The overlay is focusable, labelled, pointer-capture based, and constrained to the displayed video rectangle.
3. The controller has one source of truth for `mode`, `stream`, and `frameReady`: capture+frame, live+ready, and busy prediction states are explicit. Capture/Retake in live mode switches to capture and freezes the current ready frame.
4. A valid release uses the shared `displayRect` (including non-16:9 letterbox cases), has displayed width/height at least 12 px, and occurs before seven boxes exist. Invalid drafts never snapshot or trigger inference; pointercancel/lost capture discards drafts.
5. Every accepted live release snapshots the latest video exactly once before adding the box, then runs one sequential pass over the full current selection. The pass may run zero times only when no compatible session exists; the box remains and status explains how to retry. A failed `drawImage` is reported before mutating `frameReady`, boxes, or results.
6. While model load, camera transition, or prediction is busy, pointer and keyboard drawing plus conflicting source controls are disabled/ignored. Enter/Space preset creation is capture-only or calls the same guarded live accept path. No overlapping inference may mutate `state.results`.
7. `sourceToken` and `predictionToken` increment for mode switch, capture/retake, camera switch, disconnect, model replacement, live snapshot, and teardown. Every result/status/session/provider/fallback write checks both tokens, mode, session, and controller lifetime. Each prediction captures immutable local session/contract/provider references before its first await; `finally` clears busy/status only when its own prediction token still owns the run.
8. Camera/mode/frame source resets clear boxes, results, drafts, frame readiness, and result DOM; model load/replacement is different: when the camera/source pixels are unchanged it invalidates pending predictions and clears stale results but preserves the accepted frame and boxes so a no-session live draw can be retried after loading a compatible model. Camera teardown stops every media track. Failed inference keeps boxes and the latest valid frame available for manual retry.
9. No model bytes, frame pixels, boxes, results, or camera state cross into the parent IDE. No timer, animation loop, `requestVideoFrameCallback`, detection, tracking, or persistence is introduced.
10. Existing IDs used by `createOnnxCameraController()` remain stable. Theme, local-only model handling, WebGPU/WASM fallback, pagehide teardown, and bfcache bootstrap remain intact.

## Validation and manual smoke

Automated focused checks (after implementation):

```powershell
node --test test_onnx_camera_core.mjs test_onnx_camera_launcher.mjs test_onnx_camera_page.mjs test_onnx_camera_window.mjs test_onnx_camera_live_draw.mjs
node --check onnx-camera.mjs
node --check onnx-camera-window.mjs
git diff --check
```

Focused ONNX camera/window suite: **35 passed, 0 failed**. The expanded full
suite reports **204 total, 197 passed, 3 unrelated pre-existing embed/guide
failures, and 4 skipped**; no live-draw or camera/window failures occurred.

Run the broader suite only as a regression signal; report unrelated dirty-worktree failures separately:

```powershell
npm test
```

Manual localhost/HTTPS smoke:

1. Open the named camera window and verify `Capture frame` is selected, keyboard focus/labels work, and the mode announcement is polite.
2. In Capture frame, connect camera, capture, draw 1–7 boxes, click `Predict all`, repeat, and verify the existing results/box persistence.
3. Switch to Draw live; verify video remains playing, overlay follows the visible stage, and no prediction occurs before a valid release.
4. Draw one valid box: verify exactly one snapshot and one inference for box 1. Draw boxes 2, 3, and 7: verify each release reruns all current boxes sequentially, with labels on every box.
5. Attempt a sub-12px box, an eighth box, pointer input while busy, and a draw before model readiness; verify rejection/lock/actionable status and preserved boxes where required.
6. Switch modes, Retake/capture, change camera, disconnect, replace model, and close/reload the child; verify boxes/results clear and all media tracks stop on disconnect/exit.
7. Check model/runtime errors and manual retry, light/dark launch snapshot, 200% zoom, reduced motion, and widths 360/768/1440px with no horizontal overflow.

## Risks, rollback, and dirty-worktree guard

- **Geometry mismatch:** CSS letterboxing can shift pointer coordinates. Derive a shared `displayRect` from stage bounds and intrinsic aspect ratio, use it for pointer/draw/min-size calculations, and test non-16:9 fixtures.
- **Keyboard/pointer cancellation:** keyboard preset boxes or pointer cancellation can bypass live busy rules. Route all box creation through one guarded accept path; cancellation only clears drafts, and test Enter/Space plus lost capture during prediction.
- **Stale async predictions:** mode/source changes during a run can otherwise paint old labels. Guard every result/status write with `sourceToken` plus a prediction generation and test delayed fake promises.
- **Session replacement races:** invalidate tokens before model replacement and guard session/provider assignment and WASM fallback completion, not only final results; model replacement must preserve an unchanged camera frame/boxes while dropping stale results.
- **Moving objects:** boxes are tied to the snapshot taken at each release and are not tracked; document this in status/copy and keep coordinates unchanged between runs.
- **No session/model:** accepted boxes must remain. Show a clear “load a compatible .onnx model, then Predict all” path and avoid silently dropping the selection.
- **Camera lifecycle:** source reset and page teardown must stop tracks; preserve existing camera token and pagehide/bfcache behavior.
- **Rollback:** revert only the live-draw commit/phase changes in the child window (`onnx-camera.mjs`, `onnx-camera-window.html/css`, and live tests). The rollback leaves the dedicated window and original Capture frame/manual Predict workflow intact because no parent or launcher files are in scope.
- **Dirty worktree:** current unrelated changes include `app.js`, `competition.html`, `feature_list.json`, `index.html`, `plans/.current-brainstorm.md`, `styles.css`, untracked assets/PDF/screenshots/payload/tmp files, and `bridge/certs/` (including a private key). Do not stage, overwrite, delete, or commit those items while implementing this plan.

## Handoff

After plan validation and user approval, run:

`$ck-cook --hard plans/onnx-camera-live-draw/plan.md`

No staging or commit is part of this planning task.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-08-12 00:05
**Phase in progress:** none (all three phases complete)
**Status:** Implementation complete. All three phases are checked. The focused ONNX camera/window suite passes **35/35**; the expanded full suite reports **204 total, 197 passed, 3 unrelated pre-existing embed/guide failures, and 4 skipped**.

### Decisions made this session
- Capture frame remains the default; Draw live is opt-in and does not start camera access by itself.
- Model replacement clears stale results but preserves an unchanged frame and accepted boxes for retry.
- Live pointer coordinates use the visible media rectangle, excluding object-fit letterbox bars.
- Auto-Predict snapshots the box list and immutable session context; stale runs cannot clear a newer busy state or paint old results.

### Next immediate action
Hand off the completed implementation and verification evidence without staging or committing unrelated dirty-worktree files.
