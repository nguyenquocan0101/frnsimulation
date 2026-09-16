# Phase 2: FR3/FR5 Local Agent

## Goal

Run the exact submitted `main.py` from the complete `TechCamp-colgnaoh`
runtime on the judge PC, with safe profile selection and cleanup.

## Implementation

1. Load explicit FR3 and FR5 profiles. Require local IP/points configuration;
   share the existing HCM gripper constants and 0.4-second pulse contract.
2. Add source guard and compile preflight before robot connection.
3. Claim one job, materialize a temporary directory, and launch a child Python
   process with runtime `PYTHONPATH` and selected environment only.
4. Acquire the shared robot boundary before the child connects, hold it while
   the submitted process runs, poll STOP, then keep it through DO-off and
   HOME/open cleanup.
5. Publish final status on every exit path; never let a control-plane logging
   failure skip local safety cleanup.
6. Add dry-run/fake-driver mode and an operator startup check.

## Tests

- profile and points resolution;
- source guard allow/deny cases;
- selected model/IP/points forwarded to child;
- timeout and STOP kill child;
- cleanup called once on every exit path and the physical lock spans process
  creation through cleanup;
- no physical driver is imported in dry-run tests.

## Exit criteria

An offline fake-agent test claims a job, runs a student-compatible script,
records logs, and reaches a terminal state with cleanup evidence.
