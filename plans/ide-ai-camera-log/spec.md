# Spec: IDE AI Camera Log

**Date:** 2026-08-12
**Status:** Ready

---

## Problem Statement

Workshop users must watch the separate Camera tab to see classification output. Mirror the latest AI Camera prediction into the IDE's existing Output console so simulator activity and AI results can be monitored together.

---

## User Stories

- **[P1]** As a workshop user, I want the latest AI Camera result inside the IDE Output console so that I can monitor the demo from one screen.
  Accepted when: the IDE shows one fixed AI Camera block containing the latest prediction summary and results for 1–7 boxes.

- **[P1]** As a workshop user, I want the IDE copy to refresh less often than camera inference so that the console stays readable.
  Accepted when: Camera inference remains every 2 seconds while the IDE renders at most one buffered update every 3 seconds.

- **[P2]** As a workshop user, I want the last AI result to remain after closing the Camera tab so that I can still reference it.
  Accepted when: closing the Camera tab emits no disconnect, blank, or clear update; one successful payload already accepted into the IDE throttle buffer may render once after closure, then becomes the retained final AI block.

- **[P3]** _(out of scope — storing prediction history across IDE reloads or browser restarts)_

---

## Functional Requirements

1. FR-01: The Camera window must publish a versioned, text-only prediction payload after each completed prediction, containing one summary and at most seven box result lines.
2. FR-02: Cross-window delivery must use a same-origin `BroadcastChannel`; it must not transfer ONNX bytes, frames, canvases, streams, blobs, or file handles.
3. FR-03: The IDE must buffer the newest valid payload and update its visible AI block no more than once per 3,000 milliseconds.
4. FR-04: The AI block must live inside the existing `#console`, use white text in both themes, and be visually distinguishable from normal simulator output without changing existing log colors.
5. FR-05: The IDE must maintain exactly one AI block; new payloads replace that block rather than append history.
6. FR-06: Normal `log(message)` calls must preserve the AI block and continue appending timestamped simulator text.
7. FR-07: The Clear log action may clear the current AI block, but a still-running Camera window may repopulate it on the next 3-second IDE refresh.
8. FR-08: Closing the Camera tab must emit no disconnect, blank, or clear update. One successful payload already accepted into the IDE throttle buffer may render once after closure; that result then remains as the final AI block.
9. FR-09: Guide/embed mode must not initialize the Camera log receiver.
10. FR-10: The Camera publisher and IDE receiver must close their channel/timer resources on final page teardown and avoid duplicate listeners after bfcache restoration.

---

## Non-Functional Requirements

- Performance: IDE rendering occurs at most once per 3,000 milliseconds and handles no more than 8 text lines per update.
- Security: accept only same-channel payloads matching the versioned schema; cap each line at 500 characters, reject CR/LF, C0/DEL, NEL (`U+0085`), and Unicode line/paragraph separators (`U+2028`/`U+2029`), and render via `textContent`, never HTML.
- Availability: if `BroadcastChannel` is unavailable, Camera prediction continues normally and the IDE Output console remains functional without AI mirroring.

---

## Success Criteria

- [ ] Cadence: 10 seconds of Camera predictions produces no more than 4 IDE AI block renders.
- [ ] Bounded output: the IDE contains exactly one AI block after at least 10 Camera payloads.
- [ ] Payload scope: automated tests confirm no model/frame/file/stream fields are published.
- [ ] Compatibility: existing simulator log lines remain present and keep their current color after AI block updates.
- [ ] Lifecycle: closing the Camera tab emits no disconnect, blank, or clear update; at most one already-buffered success may render afterward and then remains, while IDE teardown clears receiver timers/channels without errors.

---

## Out of Scope

- Persisting AI logs across an IDE reload, browser restart, or another device.
- Sending commands, camera controls, model data, or image frames between windows.
- A full log-history viewer, export, filtering, or timestamps for every 2-second Camera inference.

---

## Assumptions

- The IDE and Camera page remain on the same origin.
- The browser used for the workshop supports `BroadcastChannel`; unsupported browsers degrade without breaking either page.
- A prediction payload includes the latest summary plus results for no more than seven boxes.
