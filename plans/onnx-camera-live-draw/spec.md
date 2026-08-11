# Spec: Live ONNX camera drawing

**Date:** 2026-08-11
**Status:** Approved

---

## Problem Statement

The dedicated AI camera currently requires a frozen capture before a participant can draw regions. Workshop users need an opt-in faster path that keeps the camera visible and automatically classifies all selected regions as soon as each live box is completed, while preserving the existing manual capture workflow.

---

## User Stories

- **[P1]** As a workshop participant, I want to choose between Capture frame and Draw live so that I can use the stable manual flow or a faster live demo.
  Accepted when: Capture frame remains the default/manual mode and a clearly labelled, keyboard-accessible Draw live control changes the active mode.

- **[P1]** As a workshop participant, I want to draw a box directly on a running camera so that I can classify an object without manually capturing first.
  Accepted when: in Draw live mode the video remains visible, a valid 12 px minimum box is accepted, and the current video frame is snapshotted at pointer release.

- **[P1]** As a workshop participant, I want every new live box to reclassify all boxes so that the result list always represents the current selection.
  Accepted when: after each valid live box up to seven, one button-triggered inference sequence runs for every existing box exactly once, sequentially, and results identify all boxes.

- **[P1]** As a workshop participant, I want to keep using Capture frame manually so that I can draw stable regions when the camera or object is moving.
  Accepted when: Capture frame/Retake still freezes the frame, live auto-Predict is disabled in capture mode, and Predict all remains available manually.

- **[P1]** As a workshop participant, I want old selections cleared when the source mode changes so that results never refer to an unclear frame.
  Accepted when: switching Capture frame ↔ Draw live clears all boxes and results and announces the new mode without disconnecting the camera.

- **[P2]** As a workshop facilitator, I want an explicit busy/error status so that I can explain why drawing is temporarily locked or why a result is unavailable.
  Accepted when: auto inference locks drawing during the sequential run, reports model-not-ready or prediction errors, and preserves the boxes for retry.

- **[P3]** Automatic tracking, detection-generated boxes, and continuous inference are out of scope.

---

## Functional Requirements

1. FR-01: Add an accessible Capture frame / Draw live mode control to the dedicated camera window; Capture frame is selected by default.
2. FR-02: In Draw live mode, keep the video element visible beneath the overlay canvas and accept normalized pointer boxes constrained to the visible video bounds.
3. FR-03: On each valid live pointer release, snapshot the latest video frame into the existing frame canvas before adding the box to the selection.
4. FR-04: After each valid live box, run the existing Predict all path once for every current box, sequentially, with no timer, animation loop, or per-video-frame inference.
5. FR-05: Keep the existing Capture frame flow and manual Predict all semantics unchanged.
6. FR-06: Disable drawing while auto Predict is busy; ignore boxes below 12 displayed pixels and cap accepted regions at seven.
7. FR-07: Clear boxes and results when switching modes, retaking/capturing a new frame, changing camera, disconnecting, or otherwise changing the source frame.
8. FR-08: Keep results tied to the snapshot used for the latest prediction; do not track or move boxes between video frames.
9. FR-09: If no compatible model/session is ready when a live box is drawn, keep the accepted box, show an actionable status, and allow Predict after the model becomes ready.
10. FR-10: Preserve existing local-only model handling, WebGPU/WASM fallback, camera teardown, accessibility, and dedicated-window isolation.

---

## Non-Functional Requirements

- Performance: live auto-Predict runs at most once per accepted pointer release, processes at most seven boxes sequentially, and starts no inference loop.
- Security: video frames, model bytes, crops, boxes, and results remain in the child browser context and are never uploaded or sent to the parent IDE.
- Availability: a failed auto-Predict keeps the current boxes and leaves manual Predict/retry available; switching back to Capture frame remains possible.
- Accessibility: the mode control is keyboard reachable with `aria-pressed` or equivalent state, the live canvas remains focusable and labelled, and status text announces mode, busy, and error states.

---

## Success Criteria

- [ ] Mode control: Capture frame is selected on load; switching modes updates the visible state and clears boxes/results within one interaction.
- [ ] Live drawing: one valid pointer release on a running video creates exactly one bounded box and snapshots the current frame once.
- [ ] Auto prediction: with 1, 3, and 7 boxes, each completed live box starts exactly one sequential Predict-all run over all current boxes; no continuous inference timer exists.
- [ ] Manual regression: Capture frame still requires an explicit Predict all click and preserves boxes/results after prediction.
- [ ] Busy safety: pointer input during live auto-Predict creates no additional box and no overlapping inference; prediction errors preserve the selection.
- [ ] Source reset: mode switch, Retake, camera switch, and Disconnect clear all prior live/capture results without leaving a media track active.
- [ ] Accessibility/layout: mode controls, status, video, overlay, and results remain usable at 200% zoom and dedicated-window widths from 360 px to 1440 px.

---

## Out of Scope

- Continuous inference while the video is playing.
- Object detection, automatic boxes, tracking, optical flow, or box stabilization.
- Sharing live boxes/results/model state with the parent IDE or another browser context.
- Changing the existing YOLO26-cls model contract or preprocessing.

---

## Assumptions

- The live overlay may contain `object-fit: contain` letterbox bars; a shared visible-media `displayRect` maps pointer coordinates and overlay rendering, while normalized coordinates remain reusable for the hidden snapshot canvas.
- A participant accepts that a live box describes the newest snapshot at pointer release and may not follow a moving object afterward.
- The existing seven-box sequential inference budget remains acceptable for workshop hardware.

---

## [NEEDS CLARIFICATION]

<!-- No blocking questions remain; mode default, auto-predict scope, and reset semantics were confirmed during brainstorm. -->
