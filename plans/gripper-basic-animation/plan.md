# Implementation Plan: Basic gripper animation

**Spec:** `plans/gripper-basic-animation/spec.md`
**Mode:** fast
**Risk:** normal — changes visible simulator behavior and block sequencing, but is local, reversible, and has no real-robot connection.

## Scope

Implement the basic visual gripper simulation only: animate the two brown CAD finger meshes, then use the existing block carry state to make the nearest eligible block follow TCP.

## Phase 1 — Capture and animate the STEP fingers

**Spec coverage:** P1 visual close; FR-01, FR-02, FR-05.

1. In `loadGripper`, identify the two brown finger meshes from the STEP material color and retain their original transforms.
2. Add a small gripper visual state (`open`, `closed`, active animation) and a single requestAnimationFrame interpolation helper.
3. Move each finger symmetrically along the local closing axis over 180–300 ms; prevent duplicate animations when the requested state is already active.

**Verification:**

- Browser: load the simulator with no console errors.
- Browser: invoke the gripper close/open actions and verify both brown fingers move symmetrically, then stop at their expected poses.

## Phase 2 — Synchronize Python commands and block carry

**Spec coverage:** P1 pickup/release; P2 feedback; FR-03, FR-04, FR-05.

1. Change `techcampSim.grip()` to await the close animation before applying the existing nearest-block carry state.
2. Keep the current block data model and `updateBlockVisuals()` TCP-follow behavior; do not add collision physics or alter point placement.
3. Change `techcampSim.release()` to open the fingers and preserve the existing release-at-current-position behavior.
4. Keep useful existing output when `grip()` closes without a block nearby.

**Verification:**

- Browser: run a `move_to → move_down → grip → move_up` program; the selected block follows the TCP only after fingers close.
- Browser: run `release`; the fingers reopen and the block remains at the current position.
- Browser: repeat `grip()` and `release()` while already closed/open; no duplicate animation, block state, or console error occurs.

## Phase 3 — Regression check and handoff

**Spec coverage:** all success criteria.

1. Run syntax and diff checks for `app.js` and the local server.
2. Run the standard sample Python program in the browser and inspect the simulator console for errors.
3. Check normal robot motion, safe-zone behavior, and block-board updates still work with the gripper in open and closed poses.

**Verification:**

- `node --check app.js`
- `node --check serve.mjs`
- `git diff --check`
- Local browser test: close, carry, release, and a no-block `grip()` all finish without JavaScript errors.

## Risks and constraints

- STEP color metadata is the temporary identifier for the two brown fingers; if the CAD export changes colors, use their mesh bounds/name rather than a broad material match.
- Finger animation is visual only. No collision width, force, gear, motor, or real robot I/O is introduced.
- Block attachment remains driven by the existing lesson-position rule (`move_down` at a valid block), which avoids unexpected pickups while travelling.

## Completion

- [x] Phase 1: Capture and animate the STEP fingers
- [x] Phase 2: Synchronize Python commands and block carry
- [x] Phase 3: Regression check and handoff

## Session Notes

<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-08-05 11:16
**Phase in progress:** phase-03-regression-check
**Status:** Complete in fast mode; browser smoke checks executed manually.

### Decisions made this session

- Brown STEP meshes (`#694d3b`) identify the two movable fingers.
- Fingers move symmetrically 16 mm along their local X axis over 220 ms.
- Existing block state remains the TCP-follow mechanism; no physics or real I/O was added.

### Next immediate action

Review the visual close distance with the user and tune it only if needed.
