# Plan: Dedicated ONNX Camera Window

Mode: Hard
Risk: normal — multi-file frontend change with popup and camera lifecycle, no auth/data/infra or irreversible operation.

**Tests:** default (focused unit/static integration tests plus manual browser smoke)
**Supersedes:** `plans/onnx-camera-classification/spec.md` FR-01 and its inline-card layout success criterion only; the approved workflow and model/camera requirements remain useful context, but the camera UI now belongs in a dedicated browser context rather than beside the 3D viewport.

## Scope Challenge

- **Exists?** Local ONNX model loading, camera selection, capture, 1–7 manual regions, button-triggered Predict all, result persistence, and `pagehide` teardown already exist in `onnx-camera.mjs` / `onnx-camera-core.mjs`. Only the host surface and launch lifecycle need to change.
- **Minimum?** Replace the inline card with one accessible camera launcher in the Simulation header, open or focus a named same-origin browser context, and bootstrap the existing controller against equivalent markup in a dedicated page.
- **Complexity?** Hard: the behavior is conceptually small but spans the IDE shell, a second document, popup handling, responsive styling, lifecycle cleanup, and regression boundaries.

## Architectural Decision

Use a dedicated `onnx-camera-window.html` and `onnx-camera-window.mjs` bootstrap. Keep inference and camera ownership entirely in the child page by reusing `createOnnxCameraController()` from `onnx-camera.mjs`; do not copy inference logic into the launcher or main IDE. Add a small `onnx-camera-launcher.mjs` that synchronously handles the click, reuses a stable window name, focuses a live reference when possible, and exposes popup-blocked feedback. Request a resizable, scrollable popup around 1100 × 800 CSS pixels, clamped to the available screen; accept that browser policy may instead open it as a normal tab.

No `postMessage`, `BroadcastChannel`, service worker, backend, shared model object, or prediction-state synchronization is introduced. Browser file inputs are not persisted: opening/reloading the camera page always requires the participant to select the local `.onnx` model again.

## Implementation Phases

- [x] [Phase 1 — Dedicated page shell and bootstrap](phase-01-dedicated-page-shell.md) — move the camera DOM contract into a full browser page, inherit IDE tokens, and initialize/tear down the existing controller locally.
- [x] [Phase 2 — Simulation launcher and open-or-focus lifecycle](phase-02-launcher-open-or-focus.md) — replace the inline panel with an accessible camera icon/button and named-window launcher with blocked-popup feedback.
- [x] [Phase 3 — Regression, lifecycle, and workshop smoke](phase-03-regression-and-smoke.md) — update focused tests, protect guide/embed behavior, and verify model/camera/box flows in the larger surface.

## File Map

- Add `onnx-camera-window.html`: standalone semantic document containing the existing ONNX camera control IDs, status regions, canvas/video stage, and local module entry point.
- Add `onnx-camera-window.mjs`: apply a launch-time snapshot of the saved `fr3-theme` value (with a safe default), create the camera controller exactly once, surface bootstrap errors, rely on the controller as the sole `pagehide` teardown owner, and recreate it on a persisted `pageshow` bfcache restore.
- Add `onnx-camera-window.css`: page-only responsive shell and size overrides; consume tokens/components from `styles.css` rather than redefining a second visual system.
- Add `onnx-camera-launcher.mjs`: testable named-window open-or-focus controller, relative URL resolution, popup feature constants/clamping, popup-blocked status, focus behavior, and launcher listener cleanup.
- Modify `index.html`: remove `#onnxCameraCard` and the now-unneeded two-column camera workspace wrapper; add the top-right Simulation camera launcher and an adjacent polite live status hook marked as normal-IDE-only.
- Modify `app.js`: remove inline `initOnnxCamera()` ownership; initialize the launcher only in normal mode and dispose its listeners/reference on main-page `pagehide` only when `event.persisted !== true`, without closing an already-open child page.
- Modify `styles.css`: remove inline-card layout constraints from the Simulation area; add token-aligned launcher/icon, focus, compact status, responsive, dark-theme, and guide/embed hiding rules. Retain shared `.onnx-*` component rules needed by the dedicated page, moving only page-specific sizing to `onnx-camera-window.css`.
- Modify `test_onnx_camera_page.mjs`: replace inline-placement assertions with standalone-page DOM/bootstrap/controller-reuse assertions and confirm there is no ONNX card inside the 3D viewport or Simulation workspace.
- Add `test_onnx_camera_launcher.mjs`: mock window opening/focus/closed states and assert reuse, recovery, blocked-popup messaging, URL/name stability, and cleanup.
- Modify `feature_list.json`: preserve all existing entries and update only the three window-plan entries through selective staging; it is a plan artifact, not application runtime state.
- Keep `onnx-camera.mjs` and `onnx-camera-core.mjs` behavior unchanged unless a minimal host-agnostic teardown hook is proven necessary by tests; do not duplicate or fork inference code.

## Cross-Phase Invariants

- The launcher calls `window.open()` directly within the user click stack; no awaited work may precede it.
- Use one constant name such as `techcamp-onnx-camera` and resolve `./onnx-camera-window.html` from `document.baseURI`. A live child reference is focused; a closed/stale reference is replaced; `null` means popup blocked and produces an actionable `aria-live` message.
- Use testable popup features (`width`, `height`, `left`, `top`, `resizable=yes`, `scrollbars=yes`) clamped to available screen dimensions; browser fallback to a tab is valid.
- The dedicated page owns all media tracks and the ONNX session. `onnx-camera.mjs` remains the only `pagehide` teardown owner; a persisted `pageshow` creates a fresh controller after bfcache restore.
- Main-page non-bfcache cleanup removes launcher listeners and forgets the reference but does not forcibly close the child. A persisted main-page `pagehide` retains the launcher so Back/Forward restores a working button. After a real IDE reload, launching the stable name may navigate/reload that child and reset its local model/frame/boxes; this deterministic reset is accepted and documented.
- Guide/embed mode never binds the launcher, never opens a child, and retains the current viewport-only behavior.
- No model bytes, frames, boxes, results, or camera selection cross browser contexts or survive a child-page reload.
- Existing element IDs consumed by `onnx-camera.mjs` stay stable in the dedicated page to minimize controller changes.

## Validation

```powershell
node --test test_onnx_camera_core.mjs test_onnx_camera_page.mjs test_onnx_camera_launcher.mjs test_embed_mode.mjs
node --check app.js
node --check onnx-camera.mjs
node --check onnx-camera-window.mjs
node --check onnx-camera-launcher.mjs
npm test
git diff --check
```

Manual smoke on localhost/HTTPS:

1. Load the normal IDE and confirm the Simulation header shows a keyboard-focusable camera launcher at the right without shrinking or covering the 3D viewport.
2. Click once and confirm `onnx-camera-window.html` opens at a useful desktop size; click again and confirm the same named context is focused rather than duplicated.
3. Enable popup blocking and confirm the IDE reports a concise, actionable message while all simulator/editor controls remain usable; allow popups and retry successfully.
4. In the child page, select a renamed YOLO26-cls `.onnx`, connect/switch a camera, capture, draw 1 and 7 boxes, Predict all twice, and confirm regions/results persist between predictions.
5. Reload the child and confirm model/camera/boxes/results reset and the model must be selected again. Close/reload/navigate away from the child while camera is live and confirm its media track indicator stops.
6. Open `?embed=guide`; confirm no camera launcher or camera initialization appears and existing guide controls/messages still work.
7. Test light/dark saved theme, keyboard focus, 200% zoom, and widths around 768/1024/1440 px; confirm no horizontal overflow and status/results remain readable.
8. Navigate back/forward to exercise bfcache and reload the IDE while the child exists; confirm the controller can restart after bfcache and the documented parent-reload relaunch reset is predictable.

## Risks and Mitigations

- **Popup policies:** browsers can return `null` or suppress a window opened outside direct user activation. Keep opening synchronous, do no preflight async work, and announce recovery instructions next to the launcher.
- **Duplicate/stale contexts:** references can become closed or inaccessible after navigation. Guard `.closed`/`.focus()` access, use a fixed window name as the browser-level fallback, and reacquire on the next click.
- **Parent reload reset:** losing the in-memory reference may cause a stable-name relaunch to navigate the child and clear local state. Treat that reset as explicit MVP behavior and test it; do not add cross-window state recovery.
- **Camera leak on child exit or bfcache:** a second document changes lifecycle ownership. Keep `pagehide` ownership in the existing controller, recreate once on persisted `pageshow`, and preserve its generation-token protection against delayed permission results.
- **CSS coupling:** loading the large shared stylesheet may expose unrelated selectors. Scope all new page layout under a dedicated root/class, keep shared ONNX component selectors stable, and verify both themes and narrow sizes.
- **Accidental IDE/embed regression:** removing `.simulation-workspace` and inline initialization can disturb layout or embed guards. Cover the DOM boundary and normal/embed initialization paths with static tests plus a browser smoke.
- **Dirty worktree:** implementation must stage only files/hunks listed in this plan and must not include unrelated robot-mode, competition, assets, certificates, or temporary files.
- **Theme drift:** the child reads `fr3-theme` only at launch/reload; changing the IDE theme while it is already open does not live-sync in this MVP.

Before implementation and before commit, capture `git diff -- app.js index.html styles.css feature_list.json`, then use partial staging and verify `git diff --cached --name-only`, `git diff --cached --check`, and the cached diff itself. Never stage `bridge/certs/` or any private key.

## Explicit Non-Goals

- No automatic detection, continuous inference, backend upload, model conversion, model persistence, or camera-state persistence.
- No communication or coordinated state between IDE and camera page after launch.
- No multi-window orchestration beyond one stable named camera context.
- No redesign of the editor, simulator, guide embed, or existing classification pipeline.

## Handoff

After validation approval, run:

`$ck-cook --hard plans/onnx-camera-window/plan.md`

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-08-11 22:57
**Phase in progress:** phase-03-regression-and-smoke (final verification complete)
**Status:** Complete — focused camera/window suite 21/21 and syntax checks pass; full baseline retains three unrelated pre-existing embed/guide failures with no camera/window failures.

### Decisions made this session
- Kept `onnx-camera.mjs` as the single inference/controller implementation.
- Used a launch-time theme snapshot and let the controller own `pagehide` teardown; bootstrap handles persisted `pageshow` restore.
- Kept popup opening synchronous in the click handler and accepted browser tab fallback when popup features are ignored.
- Replaced inline placement assertions with standalone-page and open/focus/lifecycle tests; no camera/window test failure remains.

### Next immediate action
Proceed to the selective staging/git audit; keep unrelated dirty files, assets, temporary output, and `bridge/certs/` excluded.
