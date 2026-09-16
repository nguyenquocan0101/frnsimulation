# Spec: Full-page maintenance mode

**Date:** 2026-08-12
**Status:** Ready

---

## Problem Statement

Before the workshop and competition, the public FR5 Simulation needs to be temporarily unavailable while clearly explaining why. The current IDE should be hidden completely, with a simple configuration switch to restore it later.

---

## User Stories

- **[P1]** As a workshop visitor, I want to see a full-page maintenance notice so that I understand the simulator is intentionally offline.
  Accepted when: with `MAINTENANCE_MODE = true`, the initial page displays the supplied Vietnamese message and no IDE, simulator, camera launcher, or robot controls are visible.

- **[P1]** As the project team, I want to restore the IDE by changing one configuration boolean so that maintenance can be ended without reverting UI code.
  Accepted when: changing the same config value to `false` restores the existing IDE bootstrap and layout without source edits elsewhere.

- **[P1]** As a visitor on a phone or zoomed desktop, I want the notice to remain readable so that maintenance information is accessible on common workshop devices.
  Accepted when: the notice has no horizontal overflow from 360px viewport width through desktop widths and remains usable at 200% zoom.

- **[P2]** As the project team, I want a reload/retry affordance so that a visitor can check whether maintenance has ended without navigating away.
  Accepted when: the control only reloads the page and does not bypass the maintenance gate.

- **[P3]** _(out of scope — authenticated admin bypass or remote maintenance dashboard)_

---

## Functional Requirements

1. **FR-01:** Add a dedicated configuration module/file exporting `MAINTENANCE_MODE` as a boolean; the maintenance deployment defaults to `true`.
2. **FR-02:** Gate normal app bootstrap before Three.js, Firebase, camera, robot, or simulator initialization when maintenance mode is enabled.
3. **FR-03:** Render the exact approved Vietnamese maintenance copy, including the emoji and line breaks, in a full-page accessible maintenance root.
4. **FR-04:** Hide the complete IDE while maintenance mode is enabled; do not leave the viewport, header, sidebar, dialogs, or camera launcher interactive or visually exposed.
5. **FR-05:** Reuse existing IDE design tokens, font stack, spacing, borders, radii, and light/dark surface language for the maintenance screen.
6. **FR-06:** Include a reload/retry control only if it remains a normal page reload and cannot bypass `MAINTENANCE_MODE`.
7. **FR-07:** When the flag is changed to `false`, restore the current IDE bootstrap without requiring markup removal or a second app implementation.

---

## Non-Functional Requirements

- **Performance:** Maintenance mode must avoid importing or initializing simulator-only runtime modules before the maintenance screen is shown.
- **Security:** No client-side URL/query parameter, hidden shortcut, or local storage value may bypass the configured maintenance gate.
- **Availability:** The notice must render even if Firebase, Three.js, camera permissions, or ONNX runtime are unavailable.
- **Accessibility:** The maintenance root has a meaningful heading, readable contrast, keyboard-focusable reload control, and no focusable elements inside the hidden IDE.

---

## Success Criteria

- [ ] Enabled gate: `MAINTENANCE_MODE = true` renders only the maintenance screen on a fresh load; no IDE controls are visible or initialized.
- [ ] Exact copy: the supplied Vietnamese notice appears with the required wording and punctuation.
- [ ] Reversible toggle: changing only the config boolean to `false` restores the existing IDE in a fresh load.
- [ ] Responsive layout: no horizontal overflow at 360px, 768px, and 1440px viewport widths.
- [ ] Zoom/accessibility: content remains readable and keyboard navigation reaches the reload control at 200% zoom.
- [ ] Isolation: static/runtime checks show no Three.js/Firebase/ONNX bootstrap occurs while the gate is enabled.

---

## Out of Scope

- Remote/admin maintenance controls or authentication.
- A server-side deployment shutdown or Vercel project deletion.
- Persisting visitor state or synchronizing maintenance status across browser contexts.
- Changing the simulator's normal IDE layout or ONNX camera behavior.

---

## Assumptions

- The deployment serves a static/browser app where a checked-in config module can gate the client bootstrap.
- The supplied Vietnamese copy is final and should be rendered verbatim.
- Re-enabling the IDE means changing the boolean to `false` and deploying/reloading the app.

## [NEEDS CLARIFICATION]

<!-- No blocking questions remain. The reload/retry control remains optional during planning. -->
