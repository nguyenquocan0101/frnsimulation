# Brainstorm: Full-page maintenance mode

**Date:** 2026-08-12

## Ideas Explored

- Full-page maintenance gate: replace the entire IDE with the notice while a single config flag is enabled. This is the clearest workshop experience and avoids users entering a partially disabled simulator.
- Simulation-only notice: keep the IDE shell visible and replace only the 3D area. Rejected because the user wants the whole IDE hidden.
- Build/deploy environment variable: useful for a mature deployment pipeline, but slower to toggle for a workshop.
- URL override: convenient for private testing, but not suitable as the primary switch because anyone who knows the URL could bypass maintenance.

## User's Direction

Use a full-screen maintenance page with the exact Vietnamese notice, styled with the existing IDE tokens, typography, spacing, and responsive behavior. The primary switch is a boolean `MAINTENANCE_MODE = true/false` in a dedicated configuration file. Set it to `true` for the maintenance deployment; set it to `false` to restore the IDE.

## Open Questions

- The exact config file/module and the bootstrap point that gates the normal IDE need to be selected during planning.
- The plan should decide whether a small reload/retry control is shown; it must not expose a bypass while maintenance is active.

## Risks

- The maintenance gate must run before normal simulator/Firebase/Three.js initialization so the hidden IDE does not still load or produce side effects.
- The message must remain readable at narrow widths and high zoom while preserving the current light/dark design language.
- A future toggle must be a one-line change and must not require deleting or restoring the IDE markup.
