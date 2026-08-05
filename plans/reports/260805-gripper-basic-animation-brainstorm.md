# Brainstorm: Basic gripper animation

**Date:** 2026-08-05

## Ideas Explored

- Full physical grasp: detect both finger contacts and only grip when the block fits. Rejected for this lesson simulator because it adds collision logic without learning value.
- Basic visual grasp: animate the brown fingers closed, then attach the nearest eligible block to the TCP. Selected for the first version.
- Gripper-specific controller model: simulate motor, gear and finger kinematics. Deferred because the request is only for a simple visual simulation.

## User's Direction

Use a basic simulation: the gripper closes/opens, and a block automatically attaches to the TCP when `bot.grip()` runs.

## Open Questions

- None blocking. The initial close distance and animation timing can be tuned visually during implementation.

## Risks

- A block might be selected when it is near but not visibly between the fingers; use the existing nearest-block pickup rule and a small grasp radius.
- Animated finger motion must not disturb the existing block carry/release logic.
