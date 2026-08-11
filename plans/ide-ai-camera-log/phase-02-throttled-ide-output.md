# Phase 2: Throttled IDE Output Block

**Stories:** P1 — latest AI Camera result in IDE Output; P1 — IDE refreshes less often than 2-second Camera inference.

## Objective

Render the newest valid Camera snapshot as exactly one readable white block inside the existing IDE console at most once per 3 seconds, while keeping every normal simulator log line intact.

## Changes

1. Complete the receiver in `ai-camera-log.mjs` with injected channel, clock, `setTimeout`, and `clearTimeout`. The first valid message may render immediately; during the fixed 3,000 ms cooldown retain only the newest pending payload; at expiry render it once and begin the next cooldown from that render.
2. Do not reset the cooldown timer on every event. Continuous results every 2 seconds must produce bounded renders near 0, 3, 6, and 9 seconds instead of starving forever.
3. Add a console renderer that queries `.ai-camera-log-block` from the supplied `#console` on each render, creates it only if absent, and updates only its `textContent` with one non-empty summary plus 1–7 result lines. Never use `innerHTML`. After every update or recreation, set `console.scrollTop = console.scrollHeight` so the latest block is visible.
4. Add a helper for ordinary console output that creates a text node and inserts it immediately before the AI block when present, otherwise appends it. Keep the current timestamp format and scroll-to-bottom behavior in `app.js`.
5. Initialize the receiver in `app.js` only after `isEmbedMode` is known and only for normal IDE mode. Reuse the existing `#console`; do not add a parallel log panel or permanent `index.html` container.
6. Change Clear log no further than necessary: `#console.textContent = ""` intentionally removes normal text and the AI block. Because the renderer re-queries, the next valid Camera update recreates exactly one block.
7. Add `.ai-camera-log-block` styling in `styles.css`: block flow, bounded padding/margin, wrapping, dark inset background, and explicit white text in light and dark themes. Do not change `.console` foreground colors used by normal simulator lines.
8. Preserve `aria-live="polite"` on the existing console and keep the combined content textual and screen-reader-readable.

## Acceptance Checks

- Ten valid payloads leave exactly one AI block; every update replaces its text rather than appending history.
- Six 2-second messages across 10 seconds cause no more than four renders, and every delayed render uses the newest buffered payload.
- Normal `log(message)` calls remain timestamped, preserve the existing text, and appear before the fixed AI block without deleting or recoloring it.
- Clear log removes all content, and the next valid payload recreates one AI block without errors or duplicates and scrolls the console to its bottom.
- HTML-like labels appear literally; the renderer never creates elements from payload text.
- White AI text is readable in both themes, wraps within the existing console, and does not break scrolling.

## Verification

```powershell
node --test test_ai_camera_log.mjs test_ide_ai_camera_log.mjs test_embed_mode.mjs
node --check ai-camera-log.mjs
node --check app.js
```

Use fake timers for exact 0/2/4/6/8/10-second cadence and a minimal fake DOM for child count, ordering, Clear log, recreation, `scrollTop === scrollHeight`, and `textContent` safety. Receiver tests must reject empty/overlong strings, CR/LF/C0/DEL/NEL/Unicode line separators, invalid line cardinality, and unknown keys. Static integration assertions must lock the normal-mode guard and white class without relying only on regex for behavior.

## Rollback

Remove receiver initialization and AI styling, restore the previous `logElement.textContent +=` line, and delete the IDE log tests. `index.html` requires no rollback because its console markup stays unchanged.
