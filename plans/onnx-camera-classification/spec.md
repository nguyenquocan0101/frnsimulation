# Spec: ONNX Camera Classification

**Date:** 2026-08-11
**Status:** Approved

---

## Problem Statement

Workshop participants need a small, visual AI demo inside the existing robot IDE. They should be able to load a local YOLO26-cls ONNX model, select regions from a camera frame, and see classifications without adding a backend or modifying the 3D simulation.

---

## User Stories

- **[P1]** As a workshop participant, I want to load a local YOLO26-cls `.onnx` file so that I can demo my classification model without uploading it to a server.
  Accepted when: a valid model with any `.onnx` filename reaches a ready state, while an incompatible file shows an actionable error and does not enable prediction.

- **[P1]** As a workshop participant, I want to connect and switch between available computer cameras so that I can use the correct camera during the demo.
  Accepted when: the panel can request permission, display available video inputs, switch to another input, and disconnect the active stream.

- **[P1]** As a workshop participant, I want to capture a frame, draw 1–7 boxes, and classify every selected crop on demand so that I can demonstrate classification of several objects.
  Accepted when: Predict runs only after a button press, processes every valid box, and displays Top 3 class names and confidence values on or beside each box.

- **[P1]** As a workshop participant, I want boxes and results to remain after prediction so that I can repeat the same test quickly.
  Accepted when: repeated Predict actions reuse the current captured frame and regions until the user clears them, retakes the frame, or disconnects the camera.

- **[P2]** As a workshop facilitator, I want inference timing and execution provider status so that I can explain performance differences.
  Accepted when: the panel displays model load state, WebGPU or WASM provider, and elapsed prediction time.

- **[P3]** Automatic object detection and generated bounding boxes are out of scope for this classification MVP.

---

## Functional Requirements

1. FR-01: Add an ONNX Camera card to the right of the 3D viewport, inside the Simulation column but outside the Three.js viewport; stack it below the viewport when the available width is insufficient.
2. FR-02: Match existing IDE tokens and components for surfaces, borders, typography, buttons, selects, status indicators, focus states, and responsive behavior.
3. FR-03: Accept a user-selected local file only when its filename ends in `.onnx`; never upload the file to a server.
4. FR-04: Load compatible Ultralytics YOLO26-cls ONNX exports regardless of the original filename or model scale, inspect model input dimensions, and validate the classification output before enabling Predict.
5. FR-05: Read class names from ONNX metadata when present; fall back to stable class indices when names are unavailable.
6. FR-06: Prefer ONNX Runtime Web with WebGPU and automatically fall back to WASM when WebGPU initialization or execution is unavailable.
7. FR-07: Provide Connect camera, camera selector, Disconnect, Capture/Retake, Undo box, Clear boxes, and Predict all controls with explicit disabled, loading, ready, and error states.
8. FR-08: Stop prior media tracks before switching cameras and stop all media tracks when disconnecting or leaving the page.
9. FR-09: Freeze the visible image after Capture and allow pointer drawing of at least one and at most seven rectangular regions constrained to the captured image bounds.
10. FR-10: Ignore accidental regions smaller than 12 by 12 displayed pixels and number accepted regions from 1 through 7.
11. FR-11: On Predict all, crop each region from the captured frame at source resolution, apply preprocessing derived from the model input shape, and execute the crops sequentially to support fixed batch-size-one exports.
12. FR-12: Show Top 3 class results with percentages for every region and preserve the frame, boxes, and latest results after prediction.
13. FR-13: Run inference only in response to Predict all; camera connection and frame capture must never start continuous inference.
14. FR-14: Starting a retake clears the previous captured frame, regions, and results; Clear boxes clears regions/results without disconnecting the camera.
15. FR-15: Do not initialize the camera/model feature in embedded guide mode, and keep failures isolated from robot controls and the 3D renderer.

---

## Non-Functional Requirements

- Performance: for a compatible model of at most 100 MB on a modern workshop laptop, model loading must expose progress/state within 100 ms, and each crop should complete within 3 seconds after warm-up; processing seven boxes may be sequential.
- Security: model bytes, captured frames, crops, and predictions remain in the browser process and are not sent to an application server.
- Availability: camera/model failure must not block the IDE, robot connection controls, editor, or 3D simulation; the feature remains retryable without a page reload.
- Accessibility: all controls must be keyboard reachable, show visible focus, and expose labels/status messages to assistive technology.

---

## Success Criteria

- [ ] Model compatibility: representative YOLO26n-cls and one larger YOLO26-cls ONNX export both load under their original and renamed `.onnx` filenames.
- [ ] Camera flow: connect, enumerate, switch, capture, retake, and disconnect work without leaving an active track behind.
- [ ] Region workflow: users can create exactly 1–7 bounded regions, undo/clear them, and cannot create an eighth region.
- [ ] Prediction behavior: one click classifies every selected region exactly once and shows three ranked results per region without starting a loop.
- [ ] Persistence: regions and results remain unchanged through a second Predict action and clear only through an explicit clear, retake, or disconnect action.
- [ ] Layout isolation: the camera card never becomes a child or overlay of the Three.js viewport and stacks without horizontal page overflow at widths from 768 px upward.
- [ ] Regression isolation: existing editor, robot connection, simulator controls, and embedded guide behavior continue to work when no ONNX model or camera is used.

---

## Out of Scope

- Automatic bounding-box generation, object detection, segmentation, tracking, or continuous inference.
- Training, converting, optimizing, or uploading models inside the application.
- Models other than compatible Ultralytics YOLO26-cls ONNX exports.
- Persisting models, camera frames, boxes, or predictions across page reloads.
- Mobile rear/front camera UX beyond normal browser video-input enumeration.

---

## Assumptions

- Models are exported from Ultralytics YOLO26-cls using its supported ONNX exporter and expose a standard classification tensor.
- Workshop browsers support `getUserMedia`; camera use occurs in a secure context such as HTTPS or localhost.
- A maximum of seven sequential classifications is acceptable for the workshop interaction.
- When metadata lacks class names, showing class indices is sufficient for the MVP.
