# Phase 2 — Live video overlay and snapshot-on-release

## Goal

Make Draw live usable on the running camera: show the video beneath the overlay, accept bounded normalized pointer boxes, and snapshot the newest frame exactly once for each valid release before inference is requested.

## Stories covered

- P1: draw a box directly on a running camera and snapshot the current frame.
- P1: live mode keeps the manual Capture frame path available.
- P3: no tracking, continuous inference, or detection-generated boxes.

## Implementation tasks

1. Update stage markup/CSS so video and overlay share a stable aspect-ratio box, with overlay pointer events and keyboard focus enabled in live and captured states. Keep the video visibly playing only in Draw live; keep frame canvas as the inference source.
2. Add a dependency-injected/pure `displayRect` helper in `onnx-camera.mjs` or `onnx-camera-core.mjs` that derives the visible media rectangle from stage bounds and intrinsic video aspect ratio. Use it for client→normalized mapping, overlay drawing, edge clamping, and the displayed 12 px minimum; do not use raw stage bounds when `object-fit: contain` creates bars.
3. Permit pointerdown/move/up only when `mode === 'live'`, a stream/video frame is ready (`readyState >= 2`), not busy, and fewer than seven boxes exist. Use pointer capture; pointercancel/lostpointercapture discard the draft. Reject boxes below 12 displayed pixels without snapshot or box mutation. Route keyboard creation through the same guarded path or keep preset keyboard creation capture-only.
4. On valid pointerup, require `video.readyState >= 2`, size the existing frame canvas to `video.videoWidth/video.videoHeight`, and call `drawImage(video, 0, 0, width, height)` once inside a guarded try/catch. If the video is not ready or drawing fails, report an actionable status and mutate neither `frameReady` nor the boxes/results. Only after a successful snapshot set `frameReady`, append the normalized box, clear old result rows/results for the new source, and render all box outlines over the live video.
5. Leave auto inference invocation to Phase 3, but expose a single accepted-release hook that receives the source token and current box list. Keep a no-session path that preserves the accepted box and displays an actionable model status.
6. Ensure Capture frame still hides/pauses live presentation as before and uses the same normalized box rendering/tensor crop path.

## Tests to write/update first

- Static test rejects `setInterval`, prediction `requestAnimationFrame`, `requestVideoFrameCallback`, tracking, and parent-window messaging in the controller.
- Fake video/canvas test proves live video remains visible, overlay is positioned over it, and one valid pointerup snapshots exactly once.
- Geometry tests cover stage sizes, non-16:9 aspect ratios, edge clamping, reversed drag direction, sub-12px rejection, and the seventh/eighth box boundary.
- Geometry tests cover non-16:9 aspect ratios with letterbox bars and prove the same displayRect is used for mapping and rendering.
- Live Capture/Retake test covers an unready video: it stays in live mode, does not freeze or clear the current selection, and announces that a camera frame is not ready yet.
- Mode regression test proves the same pointer gesture in Capture mode adds a manual box only after capture and never snapshots a live frame.

## Done when

- A valid live release produces exactly one normalized box and one current-frame snapshot.
- The displayRect keeps 4:3 and 16:9 video aligned even when the stage has forced minimum height or contain bars.
- Invalid drafts do not mutate frame/box/result state.
- Video/overlay layout is readable at 360–1440 px and remains keyboard/focus accessible.
- No continuous inference or tracking mechanism exists.

## Rollback

Disable the Draw live control and remove the live pointer/snapshot branch; retain Phase 1 capture mode and its manual workflow.
