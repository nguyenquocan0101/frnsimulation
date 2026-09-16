# Phase 4: Verification and handoff

## Goal

Prove the additive integration is safe to deploy and document the operator
workflow.

## Checks

- Python API and Local Agent fake-driver tests, including STOP, timeout,
  non-zero exit, and startup failure cleanup;
- Node/browser tests and existing simulation/grading regression suite;
- `py_compile` for runtime and API files;
- dry-run from a Teacher-created submission through the control plane to the
  Local Agent terminal result;
- teacher confirmation blocked when the Local Agent heartbeat is stale;
- secret and public-port scan;
- deployment config/env documentation review.

## Operator acceptance

1. Start the control plane and Cloudflare HTTPS tunnel.
2. Start the Local Agent on the judge PC with `TECHCAMP_AGENT_TOKEN` and
   explicit FR3/FR5 IP/points profiles.
3. Unlock Teacher page, choose submitted code, grade it, then select FR3 or
   FR5 and confirm the physical warning.
4. Observe queued -> claimed -> running -> cleanup -> terminal status.
5. Test STOP before running a second job.
6. Only after dry-run passes, perform one controlled physical run with an
   operator at the emergency stop.

Physical acceptance remains an operator responsibility and is not inferred from
automated tests.
