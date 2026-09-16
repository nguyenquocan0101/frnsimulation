# Brainstorm: Mirror AI Camera Log into the IDE

**Date:** 2026-08-12

## Ideas Explored

- **BroadcastChannel with a fixed IDE block (selected):** the Camera window publishes text-only prediction snapshots on a same-origin channel; the IDE buffers the latest snapshot and refreshes one white block in its existing Output console every 3 seconds.
- **`window.postMessage`:** lightweight, but it depends on a usable opener reference and becomes fragile after IDE reloads or when the named Camera tab is reopened independently.
- **`localStorage` events:** survives tab relationships, but unnecessarily persists workshop prediction output and creates cleanup/staleness concerns.
- **Append a new console line every cycle:** simplest rendering, but a 3-second cadence would spam the Output console and bury simulator logs.

## User's Direction

The current IDE Output console remains the single log surface. AI Camera output appears in a fixed white block within that console, refreshes every 3 seconds, and does not append unlimited history. Camera inference remains on its existing 2-second loop. Closing the Camera tab keeps the last AI result visible in the IDE.

## Open Questions

None. The MVP format is a summary line followed by the latest results for up to seven boxes.

## Risks

- The current simulator logger uses `textContent +=`, which would destroy styled child nodes; implementation must preserve ordinary text nodes and the fixed AI block.
- Cross-window payloads must be validated and rendered with `textContent` only; model bytes, frames, and file handles must never cross the channel.
- Receiver timers and channels must close on non-persisted page teardown without clearing the last visible result.
