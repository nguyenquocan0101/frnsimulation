# Brainstorm: ONNX camera classification with manual regions

**Date:** 2026-08-11

## Ideas Explored

- Use a YOLO26 detection model to generate real boxes automatically. Rejected for this workshop because the available model is YOLO26-cls and the goal is a fast classification demo.
- Use YOLO26-cls on the whole camera frame and draw one full-frame box. Rejected because it does not let students classify several selected objects independently.
- Draw regions over a live camera stream and classify their current contents. Possible, but movement between drawing and prediction makes the demo unreliable.
- Capture a still frame, draw 1–7 regions, then classify every crop. Selected because it is deterministic, visually understandable, and matches a classification model.
- Run all crops as one batch. Deferred because exported models may be fixed to batch size 1; sequential inference supports more YOLO26-cls ONNX exports with little cost at a maximum of seven regions.
- Put the camera inside the Three.js viewport. Rejected because it mixes two independent canvases and conflicts with the requested boundary.
- Add a separate ONNX Camera card beside the 3D viewport inside the Simulation column. Selected because it preserves the existing simulator hierarchy and can stack responsively.

## User's Direction

Build a reversible workshop MVP. The user uploads a locally stored YOLO26-cls `.onnx` file with any filename, connects or changes a computer camera, captures a still frame, draws between one and seven boxes, and presses Predict to classify all selected regions. Predictions do not run continuously. Boxes remain after prediction so the same selections can be tested again quickly.

## Open Questions

- Exact ONNX Runtime Web delivery method and bundle strategy should be chosen during planning.
- The implementation should validate real exported input/output shapes against representative YOLO26-cls models before fixing preprocessing details.

## Risks

- Very large models can load or infer slowly on workshop laptops, especially when WebGPU is unavailable and execution falls back to WASM.
- A renamed `.onnx` file is not necessarily a compatible YOLO26-cls export; the UI needs clear validation errors.
- Camera permission and device labels vary by browser and are only fully available after permission is granted.
