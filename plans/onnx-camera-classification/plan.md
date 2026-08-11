# Plan: ONNX Camera Classification MVP

Mode: --fast
Risk: normal — multi-file browser feature using camera/model APIs, no auth/data/infra or irreversible operation.

**Spec:** `plans/onnx-camera-classification/spec.md`
**Tests:** default (implementation tests are added with each phase; no TDD gate)

## Scope Challenge

- **Exists?** The IDE already has Simulation layout tokens and embed-mode guards, but no local ONNX inference, computer-camera lifecycle, or manual image regions.
- **Minimum?** One isolated card, one local YOLO26-cls session, a frozen frame, 1–7 manual boxes, and button-triggered sequential Top 3 classification.
- **Complexity?** Fast planning is appropriate for the requested workshop MVP; implementation remains a normal-risk, multi-file browser change.

## Spec Quality Check

**Verdict: PASS** — no unresolved clarification marker; P1/P2/P3 stories, measurable acceptance criteria, lifecycle rules, and explicit exclusions are present.

## Implementation Phases

- [x] [Phase 1 — UI shell and lifecycle isolation](phase-01-ui-shell-and-lifecycle.md) — P1 camera/model entry points, P2 status surface, P3 detection exclusion.
- [x] [Phase 2 — ONNX model loading and classification core](phase-02-onnx-model-and-classification-core.md) — P1 local model readiness and P2 provider/load state.
- [x] [Phase 3 — Camera regions, Predict all, and regression](phase-03-camera-regions-predict-and-regression.md) — P1 camera/1–7 boxes/persistence and P2 timing.

## File Map

- Modify `index.html`: accessible card markup outside `#viewportWrap` and inside `.simulation-column`.
- Modify `styles.css`: IDE-token-aligned card, camera canvas, box/result overlay, states, and responsive grid/stack behavior.
- Modify `app.js`: dynamically initialize the controller only in normal IDE mode and isolate startup errors.
- Add `onnx-camera.mjs`: DOM controller, media lifecycle, lazy ONNX Runtime Web adapter, inference orchestration, and teardown.
- Add `onnx-camera-core.mjs`: pure shape/metadata/preprocess/result/box helpers.
- Add `test_onnx_camera_core.mjs`: deterministic unit coverage for the pure helpers.
- Add `test_onnx_camera_page.mjs`: static integration checks for placement, accessibility hooks, responsive/embedded isolation, and guarded initialization.

## Validation

```powershell
node --test test_onnx_camera_core.mjs test_onnx_camera_page.mjs test_embed_mode.mjs
npm test
node --check app.js
node --check onnx-camera.mjs
node --check onnx-camera-core.mjs
git diff --check
```

Browser smoke test on HTTPS or localhost: load renamed representative YOLO26n-cls and one larger YOLO26-cls model; connect/switch/capture; draw exactly 1 and 7 boxes; reject an eighth/tiny box; Predict twice; then clear, retake, disconnect, and confirm no active track or simulator regression.

## Isolation and Rollback

- Keep all new state and browser resources inside the ONNX camera controller; `app.js` only owns guarded startup.
- Do not add inference to the animation loop, Three.js scene, robot state, Firebase, Python runner, or embedded guide path.
- Stop replaced/active media tracks and release the inference session on teardown/page exit.
- Each phase is independently reversible by removing its new module/tests and the matching markup/style/init hook; no migration or persisted data needs rollback.

## Key Risks

- ONNX exports can differ in input/output shape and metadata format; validate one image input, batch-size-one classification output, and parse metadata without `eval`, falling back to stable class indices.
- WebGPU may fail after session creation or during execution; retry once with WASM and expose the active provider/actionable error.
- Camera coordinates differ between displayed and captured pixels; store normalized boxes and convert only at draw/crop boundaries.
- Runtime/model work can stall the UI; set state immediately, yield before expensive loading, and disable duplicate actions while busy.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-08-11 21:16
**Phase in progress:** phase-03-camera-regions-predict-and-regression
**Status:** Implementation and automated/browser verification complete; supervised camera and two-model hardware smoke remain manual.

### Decisions made this session

- Pin ONNX Runtime Web 1.22.0 and lazy-load its WebGPU build only after local model selection.
- Parse ONNX `metadata_props` locally because the browser InferenceSession API exposes tensor metadata but not model custom metadata.
- Preserve existing removal of older guide embed hooks; the AI camera has its own normal-mode guard and embed CSS isolation.
- Reject non-classification ONNX contracts before enabling Predict, and invalidate old sessions whenever a new selection fails.
- Use generation tokens so delayed camera permission cannot revive a stream after disconnect or page teardown.

### Next immediate action

Load a representative small and large YOLO26-cls model on the workshop laptop, then complete a supervised camera Predict-all smoke test.

## Handoff

Run:

`$ck-cook --fast plans/onnx-camera-classification/plan.md`
