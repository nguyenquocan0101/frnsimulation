# Phase 2: Simulation Launcher and Open-or-Focus Lifecycle

## Objective

Replace the narrow inline panel with a compact top-right Simulation camera action that synchronously opens or focuses one named browser context and clearly handles popup blocking.

## Changes

1. Add `onnx-camera-launcher.mjs` as a dependency-injectable launcher controller. It owns the button click listener, child reference, `new URL('./onnx-camera-window.html', document.baseURI).href`, fixed window name, status rendering, and an idempotent `destroy()`.
2. On click, if the stored reference exists and is not closed, call `focus()` and announce that the camera window was focused. Otherwise call `window.open()` immediately in the click handler, store/focus a non-null result, or announce that the browser blocked the window and the user should allow popups and retry.
3. Wrap `.closed` and `.focus()` access defensively so a stale/navigated reference cannot break the IDE. The stable name remains the browser-level duplicate-prevention mechanism after the in-memory reference is lost.
4. Request a centered popup around 1100 × 800 CSS pixels with `resizable=yes` and `scrollbars=yes`, clamped to available screen dimensions. Treat a browser-opened tab as a valid policy fallback. After parent reload, a stable-name relaunch is allowed to navigate/reset the child; announce/document that local state can reset rather than adding IPC.
5. In `index.html`, remove the inline `#onnxCameraCard` markup and unwrap the 3D `#viewportWrap` from the camera-specific grid. Add a token-aligned camera icon/button in the right side of the Simulation heading with visible tooltip/title, accessible name, `type="button"`, and a nearby compact polite status node.
6. In `app.js`, replace `initOnnxCamera()` and `onnxCameraController` with guarded launcher initialization only in normal IDE mode. Register main-page `pagehide` cleanup that removes launcher listeners and forgets the reference only when `event.persisted !== true`, without closing the child; a bfcache restore keeps the original listener active.
7. In `styles.css`, restore the 3D viewport to the full Simulation width, style launcher hover/active/focus/blocked states with existing tokens, and hide the launcher/status in guide embed. Retain `.onnx-*` control styling used by the standalone document, but remove `.simulation-workspace` two-column and fixed sidebar assumptions.
8. Do not use `postMessage`, `BroadcastChannel`, storage events, query payloads, or a backend to coordinate contexts. Theme is a snapshot at child launch/reload, not live-synced.

## Acceptance Checks

- A direct click resolves and opens `./onnx-camera-window.html` under one stable name with clamped popup features; subsequent clicks focus the same open context and do not create another tab/window.
- Closing the child and clicking again opens a fresh one. A blocked popup returns control immediately, produces an actionable screen-reader-visible status, and does not affect simulator controls.
- The launcher is keyboard reachable and its icon has a meaningful accessible name; focus remains visible in both themes.
- Normal Simulation regains the full-width 3D viewport. The camera UI is no longer a child, sibling sidebar, or overlay inside the Simulation workspace.
- `?embed=guide` does not bind or display the launcher.
- Reloading the IDE then relaunching may reset the existing child; that behavior is explicit, status-visible, and covered rather than silently promising state preservation.
- Returning to a bfcached IDE leaves exactly one active launcher listener, and the next click still opens or focuses the camera context.

## Verification

```powershell
node --check app.js
node --check onnx-camera-launcher.mjs
node --test test_onnx_camera_launcher.mjs test_onnx_camera_page.mjs test_embed_mode.mjs
```

Manual: click/focus/close/reopen, repeat with popup blocking enabled, activate by keyboard, and confirm simulator resizing and embed mode remain unchanged.

## Rollback

Restore the inline host markup/init and remove the launcher module/hook. The standalone page from Phase 1 is independently removable.
