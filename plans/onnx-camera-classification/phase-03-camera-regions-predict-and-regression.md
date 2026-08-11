# Phase 3 — Camera regions, Predict all, and regression

**Stories:** P1 connect/switch/disconnect camera; P1 capture and classify 1–7 boxes on demand; P1 preserve boxes/results; P2 show elapsed prediction time; P3 no generated boxes/continuous inference.

## Changes

1. In `onnx-camera.mjs`, request `getUserMedia`, enumerate inputs after permission, stop old tracks before switching, update the selector, disconnect cleanly, and stop all tracks during `destroy()`/page exit.
2. Capture the current video frame into a source-resolution canvas. Retake returns to live video and clears frame/boxes/results; Disconnect performs the same clear plus track cleanup.
3. Implement pointer drawing on a separate overlay with pointer capture. Store bounded normalized rectangles, ignore displayed regions smaller than 12×12 px, number accepted boxes 1–7, reject an eighth, and support Undo/Clear.
4. Enable Predict all only when model, captured frame, and at least one valid box are ready. On one click, disable conflicting actions, crop each normalized region at source resolution, preprocess and run it sequentially exactly once, then render Top 3 labels/confidences beside each box.
5. Preserve captured frame, regions, and latest results after success or retryable prediction error. A second Predict reuses the same regions; no timer, animation-frame inference, object detection, or generated box path is added.
6. Measure total Predict elapsed time with `performance.now()`, announce busy/success/error state, and restore controls in `finally` without propagating failure into simulator code.

## Validation

- Extend unit tests for coordinate scaling/clamping, minimum size, seven-box cap, undo/clear transitions, and crop ordering.
- Browser test camera permission denial and retry, camera switch with old track stopped, Capture/Retake, Disconnect, and page exit cleanup.
- Draw 1 box and 7 boxes at edges, attempt tiny/eighth boxes, Predict twice, and verify each valid crop runs once per click with unchanged boxes and three ranked results.
- Verify no inference occurs on camera connect/capture and that model/camera errors do not affect editor, Run, robot controls, logs, Three.js resize/render, or embedded guide.
- Run `node --test test_onnx_camera_core.mjs test_onnx_camera_page.mjs test_embed_mode.mjs`, then `npm test`, syntax checks, and `git diff --check`.

## Rollback Boundary

Camera streams, frame canvases, boxes, and results are controller-local and non-persistent. Reverting this phase removes the media/drawing/predict handlers without any data migration or robot-state rollback.
