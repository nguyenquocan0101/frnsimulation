# Spec: Basic gripper animation

**Date:** 2026-08-05
**Status:** Approved

---

## Problem Statement

The simulator currently moves blocks for `bot.grip()` and `bot.release()` but the imported parallel gripper remains static. Students need a direct visual connection between their Python commands and the gripper action.

---

## User Stories

- **[P1]** As a student, I want `bot.grip()` to visibly close the two brown fingers so that I can see the command take effect.
  Accepted when: both fingers move inward from their open pose over a short animation and remain closed.

- **[P1]** As a student, I want a block near the tool to attach after `bot.grip()` so that moving the robot visibly carries the block.
  Accepted when: the nearest eligible block within the existing pickup radius becomes a child of the TCP after the close animation.

- **[P1]** As a student, I want `bot.release()` to visibly open the fingers and leave the block at the current tool position.
  Accepted when: both fingers return to their open pose and the carried block is released using the existing placement logic.

- **[P2]** As a student, I want a small log message when no block is close enough so that I understand why nothing was picked.
  Accepted when: the existing simulator output reports that the gripper closed without a block.

- **[P3]** _(out of scope — noted for future)_ Physical collision/contact, variable-width grasp, motor/gear simulation, and real robot gripper control.

---

## Functional Requirements

1. FR-01: Identify the two brown finger meshes from the imported STEP model and retain references to their open transforms.
2. FR-02: Animate each finger from its open transform to a symmetric closed transform in 180–300 ms when `TechCamp.grip()` runs.
3. FR-03: Preserve the existing nearest-block and TCP parenting behavior after the close animation completes.
4. FR-04: Animate each finger back to its original open transform in 180–300 ms when `TechCamp.release()` runs, before or alongside the existing release behavior.
5. FR-05: Calling `grip()` while closed and `release()` while open remains idempotent.

---

## Non-Functional Requirements

- Performance: finger animation runs in the existing requestAnimationFrame loop without extra render loops and remains smooth at 60 fps on the current scene.
- Security: no new network, robot-control, or browser-permission access.
- Availability: if STEP colors are unavailable, the simulator continues to load and keeps current block behavior.

---

## Success Criteria

- [ ] `bot.grip()` visibly closes both fingers within 300 ms.
- [ ] `bot.release()` visibly restores both fingers to their open pose within 300 ms.
- [ ] A picked block continues to follow the TCP and is released at the current tool position.
- [ ] Existing Python programs that call `grip()` and `release()` finish without JavaScript console errors.

---

## Out of Scope

- Collision physics between fingers and blocks.
- Kinematic simulation of the internal motor, rack, or gears.
- Sending gripper commands to real FR3 hardware.

---

## Assumptions

- The two brown STEP meshes are the gripper fingers and move symmetrically along their local closing axis.
- The existing `TechCamp.grip()` and `TechCamp.release()` block logic is the source of truth for which block is carried.
