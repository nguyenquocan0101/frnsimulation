# Phase 3: Teacher page actions

## Goal

Allow an unlocked teacher to inspect, grade, and explicitly dispatch a
submission to FR3 or FR5 from the existing page.

## Implementation

1. Extend `teacher-access.mjs` for control-plane job calls using the existing
   teacher bearer session.
2. Add Grade/Run real/status/Stop controls to submission rows without changing
   the public simulator.
3. Show submission ID/checksum, model selector, physical-run confirmation,
   status timeline, logs, and cleanup result.
4. Prevent duplicate dispatch and show unavailable/blocked state when the API
   or Local Agent is offline.
5. Align the four-logo shortcut and Teacher form with password `0909`, while
   retaining server-side authentication and never storing agent credentials.

## Tests

- locked page has no usable real-run action;
- correct unlock restores Teacher session and wrong password does not;
- exact submission source and ID are sent;
- FR3/FR5 appears in the request;
- stop and status polling update the row;
- selected FR3/FR5, exact submission source/ID, and model availability are
  sent to the control plane;
- DOM rendering remains text-safe and public simulator tests are unchanged.

## Exit criteria

Teacher completes grade or real-run dispatch without copying a file or changing
folders.
