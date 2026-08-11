# Plan: IDE AI Camera Log Mirror

Mode: Hard
Risk: normal — multi-file frontend change spanning a same-origin channel, timers, controller lifecycle, and the existing Output DOM, with no auth, persistence, backend, or irreversible operation.

**Tests:** default (focused protocol/controller/DOM/lifecycle tests plus a two-tab browser smoke)
**Spec:** `plans/ide-ai-camera-log/spec.md`
**Status:** Complete — all three implementation phases and final verification are finished.

## Scope Challenge

- **Exists?** The Camera window already produces one successful prediction summary and 1–7 result rows, live mode already predicts every 2 seconds, and the IDE already owns `#console`, `log(message)`, Clear log, normal/embed branching, and page lifecycle hooks. Cross-window result delivery and stable styled console ownership do not yet exist.
- **Minimum?** Publish only the latest successful text snapshot through one same-origin `BroadcastChannel`, throttle IDE rendering to a latest-wins 3-second cadence, and lazily maintain exactly one white AI block inside the existing console.
- **Complexity?** Hard: the visible change is small, but a naive debounce starves under 2-second traffic, `textContent +=` destroys styled children, and bfcache can duplicate listeners unless receiver ownership is explicit.

## Spec Quality Check

- **[NEEDS CLARIFICATION] remaining?** No.
- **Success criteria measurable?** Yes: cadence, block count, payload shape, compatibility, and lifecycle are quantified.
- **P1/P2/P3 stories present?** Yes; P3 is explicitly out of scope.
- **Acceptance criteria testable?** Yes.

**Verdict:** PASS

## Architectural Decision

Add one lightweight shared module, `ai-camera-log.mjs`, that owns a strict versioned text-only protocol, safe publisher construction, exact payload validation, latest-value throttling, receiver cleanup, and small console text helpers. Use a fixed same-origin channel name such as `fairino-ai-camera-log:v1` and this exact payload shape:

```js
{
  type: "ai-camera:prediction",
  version: 1,
  summary: string,
  lines: string[]
}
```

Only those four own keys are accepted. `summary` and every result line are non-empty single-line strings of 1–500 characters; successful payloads contain 1–7 result lines. Receiver-side validation rejects CR, LF, every C0 control (`U+0000`–`U+001F`), DEL (`U+007F`), NEL (`U+0085`), Unicode line/paragraph separators (`U+2028`/`U+2029`), wrong/extra keys, and invalid values rather than normalizing untrusted messages. The publisher normalizes controller-owned text and catches channel creation/posting failures. The receiver treats every message as untrusted and renders only with `textContent`.

Use a leading-plus-trailing latest-wins throttle, not debounce: render the first valid payload immediately, open a 3,000 ms cooldown, retain only the newest payload received during that cooldown, and render it when the cooldown ends. Continuous 2-second Camera results therefore render around 0, 3, 6, and 9 seconds, never becoming permanently deferred.

The Camera controller publishes only after a current `predictAll()` run has successfully committed `state.results` and measured elapsed time. Both manual and live runs use that path. It publishes no loading, failure, clear, disconnect, frame, model, file, stream, blob, or teardown event. The IDE owns one receiver only in normal mode and lazily upserts one `.ai-camera-log-block` inside `#console`. Normal `log(message)` inserts a timestamped text node before that block instead of using `textContent +=`; Clear log may remove everything, and a later payload recreates the block. Camera closure itself sends nothing: the last rendered result remains, except that one newer successful payload already received and buffered by the IDE before closure is allowed to render once at its scheduled throttle boundary, then remains.

## Implementation Phases

- [x] [Phase 1 — Protocol and successful Camera publication](phase-01-protocol-and-camera-publication.md) — **P1 latest result**: implement the strict text-only channel and publish completed manual/live snapshots without affecting inference.
- [x] [Phase 2 — Throttled IDE Output block](phase-02-throttled-ide-output.md) — **P1 latest result + P1 readable cadence**: add one white latest-result block to `#console`, preserve normal logs, and render at most once per 3 seconds.
- [x] [Phase 3 — Lifecycle, isolation, and regression](phase-03-lifecycle-and-regression.md) — **P2 retain last result + P1 regression; P3 persistence remains excluded**: close/recreate resources safely around teardown/bfcache and verify the two-tab workshop flow.

## File Map

- Add `ai-camera-log.mjs`: protocol constants; single-line text normalization; exact schema validation; no-op-safe publisher; latest-wins receiver with injected channel/clock/timers; an IDE receiver lifecycle coordinator; idempotent `destroy()`; and testable helpers that append normal text before or lazily upsert the one AI console block and scroll it into view.
- Add `test_ai_camera_log.mjs`: protocol, sanitization, unsupported-browser fallback, throttle timing, latest-wins buffering, DOM block ownership, clear/recreate, and idempotent teardown unit tests.
- Modify `onnx-camera.mjs`: create or accept an injected prediction publisher using the controller's explicit `windowRef`, format one summary plus 1–7 one-line box results from the committed `state.results`, publish after successful current manual/live prediction, and synchronously destroy the publisher before the controller's first teardown `await`.
- Modify `test_onnx_camera_live_draw.mjs`: inject a publisher spy and cover successful manual/live publication, exact snapshot scope, stale/cancelled/failed runs, and teardown.
- Modify `app.js`: use the extracted lifecycle coordinator to initialize the receiver only in normal IDE mode; render into `#console`; replace `logElement.textContent +=` with text-node insertion before the AI block; destroy/null on every `pagehide`; recreate exactly once on persisted `pageshow`; never clear the rendered DOM block during receiver teardown.
- Modify `styles.css`: style `.ai-camera-log-block` as white text on a dark inset surface in both themes while preserving inherited normal simulator log colors and console scrolling.
- Add `test_ide_ai_camera_log.mjs`: execute the lifecycle coordinator against a fake window and assert normal-mode receiver wiring, exactly-one block, normal-log ordering, Clear log recreation, scroll-to-bottom, text-only rendering, white styling, three bfcache cycles, final teardown, and embed zero-construction/listener ownership.
- Modify `test_embed_mode.mjs`: lock out receiver/channel initialization in `?embed=guide` while leaving the existing hidden console behavior unchanged.
- Modify both `onnx-camera-window.html` and `onnx-camera-window.mjs`: bump the HTML bootstrap query and the window module's `onnx-camera.mjs` import to the same new cache-version token so the deployed import graph cannot mix old/new controller code. Do not alter layout or inference behavior.
- Modify `feature_list.json`: merge the two P1 stories and one P2 story and record their final `passing` evidence, preserving every unrelated entry/status/evidence.

No `index.html` markup change is required: the AI block is deliberately created lazily inside the existing `<pre id="console">`.

## Protocol and Rendering Contract

- The channel is delivery-only and same-origin; it is not sender authentication. Strict validation and text-only rendering are still mandatory.
- Publisher output has exactly `type`, `version`, `summary`, and `lines`. A valid success has one non-empty 1–500-character summary and 1–7 non-empty 1–500-character result strings. Receiver validation rejects unknown keys, wrong cardinality/type, empty or overlong strings, CR/LF, C0 controls, DEL, NEL, and Unicode line/paragraph separators before rendering.
- A box line uses one stable line, for example `Box 1 · 3_dog — 3_dog 33.8% · 8_airplane 27.1% · 5_chair 18.4%`; no result becomes nested HTML.
- Publisher construction reads only an explicitly supplied `windowRef.BroadcastChannel` (or an explicitly injected constructor for unit tests), never `globalThis.BroadcastChannel` or a Node global fallback. Failures are swallowed by the publisher boundary so a missing/throwing browser API cannot turn a successful prediction into a Camera error.
- The receiver never appends AI history. During cooldown it replaces one pending reference with the newest valid payload.
- `renderAiCameraLog()` queries the current console each time, recreates the block if Clear log removed it, updates through `textContent`, and sets `console.scrollTop = console.scrollHeight` after every render/recreation; it must not retain a stale element reference.
- `log(message)` continues producing timestamped normal text and inserts that text immediately before the AI block, keeping the fixed AI result at the visual bottom.
- Closing Camera, disconnecting it, clearing boxes, prediction failure, and controller destruction publish nothing. The last successful IDE result therefore remains until Clear log or IDE navigation/reload removes the DOM, subject only to one newer success that the IDE had already received and buffered before Camera closure.

## Lifecycle

1. Camera controller construction passes its explicit dependency-injected `windowRef` to the default publisher or uses a test-injected publisher. An unsupported fake/browser window returns a functional no-op publisher even if the test runtime exposes a Node/global `BroadcastChannel`.
2. Each successful current prediction commits local Camera state/status, then publishes one sanitized snapshot. Stale token results and thrown inference do not publish.
3. Normal IDE startup creates one receiver after `isEmbedMode` is known; guide/embed startup creates none.
4. `app.js` delegates receiver ownership to a testable lifecycle coordinator. In normal mode it owns the `pagehide`/`pageshow` listeners and exactly one receiver; in embed mode it registers zero listeners and constructs zero receivers.
5. IDE `pagehide` always destroys and nulls the receiver, including persisted bfcache transitions, but does not touch the AI DOM block. Persisted `pageshow` recreates one receiver; final pagehide removes coordinator listeners. The existing launcher remains governed by its current non-persisted teardown rule.
6. Camera/controller `destroy()` invalidates work, stops live timers/stream, and calls `predictionPublisher.destroy()` synchronously before the first `await releaseSession()`. A deferred-release test must observe the channel already closed while session release is still pending.
7. Closing Camera does not cancel the IDE receiver's timer. If the IDE already accepted a successful payload into its latest-wins buffer, that payload may render once at the scheduled boundary after Camera closes; after that, the block remains. No disconnect/blank payload is generated.

## Exact Automated Verification

```powershell
node --test test_ai_camera_log.mjs test_ide_ai_camera_log.mjs test_onnx_camera_live_draw.mjs test_embed_mode.mjs test_onnx_camera_window.mjs
node --check ai-camera-log.mjs
node --check onnx-camera.mjs
node --check onnx-camera-window.mjs
node --check app.js
npm test
git diff --check
```

Required focused assertions:

1. Valid publisher output has exactly four allowed keys; no payload contains model/frame/file/blob/stream/canvas fields.
2. Wrong type/version, non-plain objects, unknown keys, zero or more than seven lines, non-string lines, empty/over-500 strings, CR/LF, C0 controls, and DEL are rejected receiver-side; publisher-normalized class text cannot inject visual lines.
3. With valid inputs at 0, 2, 4, 6, 8, and 10 seconds, the IDE renders no more than four times in the first 10 seconds; each trailing render is the newest value seen during its cooldown.
4. Ten payloads leave exactly one `.ai-camera-log-block`; normal timestamped log nodes remain before it and preserve their inherited color.
5. Clear log removes the block; the next valid payload recreates exactly one block without a stale-reference exception and scrolls `#console` to its bottom.
6. DOM rendering uses `textContent`; HTML-like model labels remain literal text.
7. A fake `windowRef` with missing or throwing `BroadcastChannel` leaves Camera prediction and normal IDE logging operational even if the Node/global environment defines a channel implementation.
8. A successful manual run and a successful live run each publish once after results commit; stale, cancelled, failed, no-model, and busy paths publish zero times.
9. Publisher and receiver `destroy()` are idempotent, close their channels, clear pending timers, and prevent later renders/posts; controller destroy closes the publisher before a deferred `releaseSession()` settles.
10. A fake-window execution of three persisted pagehide/pageshow cycles keeps exactly one receiver, final pagehide removes listeners, and embed mode constructs zero receivers and registers zero lifecycle listeners.
11. Camera teardown emits no disconnected/blank payload. The last rendered IDE block remains, while one successful payload already buffered by the IDE before close may render once and become the retained final block.
12. Static/import tests assert `onnx-camera-window.html` and `onnx-camera-window.mjs` use the exact same new cache token for the bootstrap and controller edges.

## Manual Workshop Smoke

1. Open the normal IDE and Camera window on the same local or HTTPS origin; load a model, connect a camera, draw 1–7 boxes, and confirm Camera live inference continues every 2 seconds.
2. Confirm the IDE Output adds one white AI Camera block with the latest summary and box lines, while ordinary simulator logs remain their original color above it.
3. Observe at least 10 seconds of continuous prediction and confirm the IDE updates no faster than every 3 seconds without stopping indefinitely.
4. Click Clear log while Camera remains active; confirm the console clears and the next buffered Camera result recreates one AI block.
5. Close Camera and wait beyond 3 seconds; confirm no `disconnected`/blank line appears. Accept at most one final change only when a successful payload had already reached the IDE buffer before close; that result then remains.
6. Navigate the IDE away/back to exercise bfcache; confirm one receiver resumes and each Camera update causes only one block update.
7. Open `?embed=guide`; confirm no AI channel/listener initializes and Guide behavior remains unchanged.
8. Repeat in light and dark themes and at narrow desktop width; confirm white AI text remains readable, wrapping stays inside the existing console, and normal console scrolling works.

## Risks and Mitigations

- **Throttle starvation:** a reset-on-message debounce never fires under 2-second traffic. Use a non-resetting 3-second cooldown with one latest pending payload and deterministic fake-timer tests.
- **Styled child destruction:** current `textContent +=` replaces all `#console` children. Insert timestamped text nodes before the AI block and test block identity/count after normal logs.
- **Channel spoofing or malformed content:** same-origin scoping does not authenticate the sender and cannot prevent another same-origin script from spoofing a valid payload. Require exact plain-object schema, non-empty bounded single-line strings, receiver-side CR/LF/C0/DEL/NEL/Unicode-separator rejection, and `textContent` only; do not claim spoofing prevention.
- **Unsupported/throwing browser API:** construct/post/close through guarded adapters using only the passed browser `windowRef`, never ambient Node/global fallbacks, and use a no-op publisher/receiver boundary so core Camera and IDE behavior cannot fail.
- **Duplicate bfcache listeners:** destroy/null on every `pagehide`, recreate only when missing on persisted `pageshow`, and test repeated cycles.
- **Stale DOM after Clear log:** never cache the block node across renders; query then create on demand.
- **Timer/channel leaks:** `destroy()` cancels the pending timer, clears buffered state, removes message ownership, and closes once.
- **Dirty worktree:** implementation must stage only the files/hunks listed here. Existing PDFs, object images, snapshots, temporary browser output, maintenance plans, reports, and `bridge/certs/` are unrelated; private keys must never be staged.

Before each commit, inspect `git status --short`, then use selective/partial staging. For `feature_list.json`, first parse it, confirm exactly the three planned IDs are `passing` with final evidence, review `git diff -- feature_list.json` for preservation of all unrelated status/evidence, and after staging re-run the same checks against `git diff --cached -- feature_list.json`. Verify `git diff --cached --name-only`, `git diff --cached --check`, and the full cached diff. Do not use `git add .` or broad globs.

## Rollback

Rollback is additive and reversible: remove `ai-camera-log.mjs` and its tests/styles, remove Camera publication and IDE receiver/log insertion changes, restore `logElement.textContent +=`, and restore the prior page lifecycle hooks. No stored data, schema, backend, or external resource requires migration. Rolling back only Phase 2/3 may leave the publisher harmlessly broadcasting to no receivers, but the preferred rollback removes all three phases together.

## Explicit Non-Goals

- No AI history, persistence across IDE reload/browser restart, export, filtering, or cross-device delivery.
- No model/frame/canvas/blob/file/stream transfer and no Camera command/control channel.
- No `window.opener.postMessage`, `localStorage` events, polling, service worker, SharedWorker, backend, Firebase, or authentication.
- No Camera layout, inference cadence, box logic, ONNX format, normal simulator log color, Guide UI, or competition log redesign.
- No disconnect replacement message; retaining the last result is intentional.

## Completion Evidence

- Focused feature suite: **51/51 passed**, 0 failed.
- PowerShell-expanded full suite: **230 total**, **226 passed**, **0 failed**, **4 expected Firebase emulator skips**.
- Browser smoke: normal IDE/Camera cross-window log flow completed with **no browser errors**.
- Syntax gates passed for `ai-camera-log.mjs`, `app.js`, `onnx-camera.mjs`, and `onnx-camera-window.mjs`; `git diff --check` passed.
- Spec success criteria are covered: bounded text-only schema, manual/live publication, 0/3/6/9 latest-wins cadence, one lazy white Output block, normal log preservation, Clear/recreate/scroll, retained buffered close result, bfcache lifecycle, embed isolation, unsupported-channel fallback, and synchronized cache tokens.

## Handoff

Implementation and verification are complete. The remaining repository action is selective staging, review of the cached diff, commit, and push by the owning agent.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-08-12
**Phase in progress:** None — final verification complete.
**Status:** Complete — focused 51/51, expanded full suite 226 passed / 0 failed / 4 expected skips, and browser smoke completed without errors.

### Decisions made this session
- Publisher validation accepts only the four-key versioned text schema and never falls back to an ambient Node `BroadcastChannel`.
- Controller publishes only after committed manual/live results and closes its publisher synchronously before awaiting ONNX session release.
- The IDE renders the first valid payload immediately, then uses a fixed 3-second latest-wins cooldown and one lazy white block inside the existing Output console.
- Receiver ownership survives repeated bfcache cycles without duplicates, embed mode creates no channel, and Camera import edges share the new deploy cache token.
- Final browser smoke confirmed the IDE receives and retains Camera results without console or lifecycle errors.

### Next immediate action
Selectively stage only the planned feature, test, registry, and plan files; inspect the cached diff, then commit and push. Keep all unrelated dirty-worktree files excluded.
