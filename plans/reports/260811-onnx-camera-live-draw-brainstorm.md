# Brainstorm: Live drawing with automatic ONNX classification

**Date:** 2026-08-11

## Ideas Explored

- Keep the existing `Capture frame` flow as the stable manual mode. Selected as the default so the current workshop behavior does not change.
- Add an opt-in `Draw live` mode where the video keeps playing and the overlay canvas accepts pointer boxes. Selected for the requested faster demo flow.
- Snapshot the newest video frame when a valid box is finished, then run the existing sequential classifier over every box. Selected because it gives live drawing without continuous inference or object tracking.
- Run inference continuously while the camera plays. Rejected because results can race and jump, CPU/GPU use is unnecessary for a click-driven workshop demo, and the user only requested auto Predict after drawing.
- Track objects between frames so boxes follow motion. Rejected as detection/tracking scope and incompatible with the YOLO26-cls classification MVP.
- Keep boxes/results when switching between capture and live modes. Rejected because the saved crop source would no longer be obvious; switching modes will clear them.

## User's Direction

Keep `Capture frame` and its manual `Predict all` behavior. Add a `Draw live` toggle. In live mode, the camera continues running; after each valid box is drawn, the newest frame is snapshotted internally and Predict reruns on all boxes currently present. Changing modes clears boxes and results. The live mode is opt-in and does not start continuous inference.

## Open Questions

- `$ck-plan` should choose the exact toggle placement and copy while preserving the dedicated camera-window layout.
- `$ck-plan` should define the inference busy/race guard and what status appears when a box is drawn before a compatible model is ready.

## Risks

- A moving object can leave a live box semantically attached to a different object by the time the user draws the next box; results are explicitly tied to the snapshot taken on each pointer release, not tracked across frames.
- Auto-running all boxes after every new box can take up to seven sequential inferences; drawing is locked while Predict runs to prevent stale result races.
- Switching source modes or cameras invalidates prior crops; clearing regions/results is required to avoid misleading classifications.
