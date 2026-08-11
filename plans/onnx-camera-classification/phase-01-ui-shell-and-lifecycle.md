# Phase 1 — UI shell and lifecycle isolation

**Stories:** P1 local-model entry point; P1 camera connect/switch entry point; P2 status visibility; P3 automatic detection remains excluded.

## Changes

1. In `index.html`, wrap the existing `#viewportWrap` and a new `#onnxCameraCard` in a Simulation-content grid. Keep the card a sibling—not a child or overlay—of the Three.js viewport.
2. Add labelled model input, Connect camera button at the card header's right edge, device selector, Disconnect, Capture/Retake, Undo, Clear boxes, Predict all, provider/timing status, video, frozen-frame canvas, overlay canvas, and an accessible results/status region. Controls start disabled according to prerequisites.
3. In `styles.css`, reuse existing colors, borders, typography, `.button`, focus treatment, and responsive breakpoints. Use a roughly 300–320 px card column when space permits and stack below the viewport without horizontal overflow otherwise.
4. In `app.js`, dynamically import and initialize `onnx-camera.mjs` only after the normal-mode branch is known. Catch/log initialization failure so robot UI and `loadModel()` continue. Do not import or initialize it in `?embed=guide`.
5. In `onnx-camera.mjs`, establish one controller-owned state machine and `destroy()` hook. Register page teardown once and make cleanup idempotent.

## Validation

- Add `test_onnx_camera_page.mjs` assertions that the card is inside `.simulation-column`, outside `#viewportWrap`, has labelled/status controls, and has an embed-mode init guard.
- At wide layout, card is right of the 3D frame; at narrower Simulation width and widths from 768 px upward, it stacks below without page overflow.
- Load normal and `?embed=guide` routes; guide mode has no camera permission/runtime request and its viewport remains full-size.
- Run `node --test test_onnx_camera_page.mjs test_embed_mode.mjs`, `node --check app.js`, and `git diff --check`.

## Rollback Boundary

Remove the card markup/styles and the single guarded initializer; no simulator state or persisted data is changed.
