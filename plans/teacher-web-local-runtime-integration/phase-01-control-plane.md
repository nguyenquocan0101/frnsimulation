# Phase 1: Authenticated control-plane jobs

## Goal

Make Teacher-to-agent dispatch persistent, authenticated, auditable, and
serializable without exposing robot ports.

## Implementation

1. Add a job repository under the existing service `data_root/jobs` with atomic
   JSON writes and an in-process lock.
2. Validate source, submission ID, model (`FR3`/`FR5`), site, and action
   (`real_run`); compute SHA-256 server-side.
3. Add teacher routes for create/status/stop/confirm.
4. Add agent routes for heartbeat, next-job claim, status snapshot, and events.
   Expose teacher-only agent status and verify the separate token with
   constant-time comparison.
5. Implement legal lifecycle transitions and reject illegal transitions.
6. Bound log size/event count and redact configured secret values.

## Tests

- teacher session required for create/status/stop;
- wrong/absent agent token rejected;
- source checksum and submission ID retained;
- FR3/FR5 accepted, unknown model rejected;
- only one claim succeeds under concurrent requests;
- stop and terminal events reach expected states;
- robot IP, agent token, and backend secrets do not appear in responses;
- physical confirmation is rejected while the agent heartbeat is stale.

## Exit criteria

The API is exercisable entirely with a fake agent and no robot connection.
