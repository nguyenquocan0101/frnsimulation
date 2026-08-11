# Phase 2 — ONNX model loading and classification core

**Stories:** P1 load a local YOLO26-cls model; P2 show load state/provider; supports the later P1 Top 3 flow.

## Changes

1. Add pure helpers in `onnx-camera-core.mjs` to validate `.onnx`, inspect a single image tensor/input size and batch-one classification output, parse Ultralytics `names` metadata safely, and fall back to `class_<index>` labels.
2. Add pure image preprocessing/result helpers: map a source crop to the model's NCHW float tensor using the Ultralytics classification resize/center-crop and normalization contract; normalize logits only when needed; return a stable Top 3 ranking and percentages.
3. In `onnx-camera.mjs`, read model bytes with `File.arrayBuffer()` and lazily load a pinned ONNX Runtime Web browser build only when a model is selected. Keep bytes/session in browser memory and never call an application endpoint.
4. Attempt session creation with WebGPU first, then WASM. If WebGPU later fails during the first run, rebuild once with WASM and update status; release a replaced session.
5. Move UI through idle/loading/ready/error states immediately, expose provider, and keep Predict disabled until structural compatibility is established. Errors identify filename/extension, input shape, output shape, or runtime/provider failure and remain retryable.

## Validation

- Add `test_onnx_camera_core.mjs` cases for case-insensitive `.onnx` acceptance, invalid extension, fixed/dynamic input dimensions, unsafe/missing metadata, NCHW values, logits/probabilities, deterministic Top 3, and malformed classification outputs.
- Browser-load representative YOLO26n-cls and one larger YOLO26-cls export under original and renamed filenames; verify class names or stable indices and provider state.
- Force WebGPU unavailable and verify WASM readiness; try an incompatible ONNX file and verify Predict stays disabled while the rest of the IDE works.
- Run `node --test test_onnx_camera_core.mjs`, `node --check onnx-camera.mjs`, and `node --check onnx-camera-core.mjs`.

## Rollback Boundary

The runtime adapter and pure core are new modules. Removing them leaves the Phase 1 shell inert and does not affect Three.js, robot controls, or server dependencies.
