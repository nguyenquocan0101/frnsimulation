# Plan: Teacher web control for the TechCamp local robot runtime

**Date:** 2026-09-15
**Mode:** Hard
Risk: high-risk - physical robot execution, untrusted submitted Python, a
remote control plane, and two robot profiles.
**Spec:** `E:\fmsimulation\TechCamp-colgnaoh\plans\teacher-web-local-runtime-integration\spec.md`

## Scope challenge

The public simulator, Firebase submission store, existing Teacher page, and
`TechCamp-colgnaoh` physical runtime already exist. The missing boundary is a
secure job path between Teacher page and a Windows process next to FR3/FR5.

The minimum complete change is:

1. An authenticated persistent job API in the existing FastAPI service.
2. A headless Local Agent in `TechCamp-colgnaoh` that claims one job and owns
   the Python/robot process.
3. Additive Teacher-page actions for grade, select FR3/FR5, run, monitor, and
   stop.
4. Tests proving the public simulation path remains unchanged and the physical
   path fails closed on invalid model, concurrent run, timeout, stop, or unsafe
   source.

The public contestant app must not gain a robot-control endpoint or student
credentials. Vercel serves the UI and simulation/grading request. The local
agent makes outbound HTTPS requests to the control plane and talks to the robot
only on the private robot network.

## Architecture decision

Use the existing FastAPI ONNX service as the authenticated control plane rather
than making Firestore job documents publicly writable. Firebase remains the
immutable source of submitted `main.py`; the control plane stores job metadata,
state, logs, and audit records. This refines the brainstorm's Firebase-queue
idea based on the current repository: the FastAPI service already has teacher
sessions, persistent storage, CORS, and the deployed tunnel.

The browser gets only a teacher bearer session. The Local Agent gets a separate
agent token through a Windows environment variable. The agent token is never
returned to the browser, submission code, or Firebase.

## Phase map

| Phase | Outcome | Main files | Verification |
|---|---|---|---|
| [x] 1 | Authenticated job API and state machine | `vps/onnx-submissions/main.py`, API tests | Python API tests |
| [x] 2 | FR3/FR5 Local Agent with source guard and cleanup | `TechCamp-colgnaoh/techcamp_agent.py`, tests | fake control-plane/robot tests |
| [x] 3 | Teacher grade/run/monitor UI | `teacher-access.mjs`, `teacher-submissions.mjs`, `teacher.html` | Node/browser smoke tests |
| [ ] 4 | Packaging, deployment notes, regression gate | service/env/docs and both test suites | full verification |

## Phase 1 - control-plane job API

- Define a versioned job schema containing job ID, immutable submission ID,
  source checksum, action, FR3/FR5 model, site/robot ID, runtime version,
  points-table identity, timestamps, lifecycle status, logs, result, and
  cleanup result.
- Add teacher endpoints to create, inspect, stop, and confirm a real-run job.
  Creation copies the exact source received from Teacher and validates size,
  model, and required fields.
- Add agent endpoints to claim exactly one queued job, retrieve its payload,
  heartbeat, append ordered events, and acknowledge terminal cleanup.
- Persist each job with atomic JSON replacement and a process lock. Reject a
  second active job for the same robot/profile; serialize globally for MVP.
- Add constant-time agent-token verification and preserve the existing teacher
  session mechanism. Do not log either secret.
- Implement legal lifecycle transitions for `queued`, `claimed`, `running`,
  `stopping`, `cleanup`, `succeeded`, `failed`, `timeout`, and `cancelled`.

## Phase 2 - Local Agent and physical boundary

- Add explicit `FR3` and `FR5` profiles. IP, points file, tool/user settings,
  and site ID come from agent-machine configuration. No unverified FR3 IP is
  hardcoded. Both profiles use the confirmed shared gripper contract: close
  `DO0` for `0.4s`, open `DO1` for `0.4s`, then OFF.
- Add a static source guard and compile preflight before robot connection.
  Allow only the student API/runtime imports and reject filesystem/process/
  network escape imports and private-attribute tricks.
- Materialize a job in a temporary directory, set only the selected robot IP,
  selected points file, output directory, and runtime `PYTHONPATH`, then run
  the exact `main.py` with the supported Python interpreter.
- Send bounded timestamped logs and heartbeats. Enforce a timeout and poll STOP
  while the child runs; terminate the child before cleanup.
- On success, failure, timeout, STOP, or startup error, run DO-off and
  HOME/open cleanup and publish each result. Add dry-run/fake-driver mode.

## Phase 3 - Teacher page

- Extend `teacher-access.mjs` for control-plane job calls using the existing
  teacher bearer session. Keep the public Firebase client read-only.
- Add per-submission `Grade`, `Run real`, status/log, and `Stop` actions.
  Grading calls the existing simulation endpoint/rules; the UI does not
  duplicate scoring.
- Add an FR3/FR5 selector and explicit confirmation showing submission ID,
  source checksum, model, and the physical-run warning.
- Render lifecycle status, ordered logs, cleanup result, and unavailable/blocked
  state. Disable duplicate Run actions while a job is active.
- Align the four-logo shortcut and Teacher form with password `0909`, while
  retaining server-side authentication and never storing agent credentials in
  browser storage.

## Phase 4 - integration, deployment, and regression

- Add Windows Local Agent setup, environment examples for FR3/FR5 IPs/points,
  control-plane URL, and agent token. Require the agent before Run real is
  enabled.
- Update systemd/Cloudflare deployment notes. Expose only HTTPS control-plane
  traffic; never proxy XML-RPC/UDP robot calls.
- Run API tests, agent fake-driver tests, Node tests, Python syntax checks,
  public simulation regressions, and a no-robot end-to-end dry run.
- Perform physical acceptance only after dry-run: one FR3/FR5 run, STOP,
  timeout, and cleanup observation. Do not claim physical acceptance from
  mocks.

## Red-team review

| Threat | Mitigation | Test |
|---|---|---|
| Public user submits robot command | teacher session + agent token; no robot route | unauthenticated API tests |
| Browser exposes token/IP | profile and token stay local | response/log secret scan |
| Two runs overlap | atomic claim + active-job lock | concurrent claim test |
| Code hangs/stops mid-motion | timeout/STOP kills child, then DO-off/HOME/open | lifecycle test |
| Invalid profile | allow-list and fail-closed validation | profile test |
| Unsafe Python | AST preflight, temp cwd, no secrets | guard test |
| Wrong submission | immutable ID and server checksum in job | checksum test |
| API/tunnel outage | agent heartbeat and Teacher blocked state | outage test |

## Definition of done

- All phase feature entries pass with evidence.
- Existing contestant simulation tests pass unchanged.
- Teacher grades and queues the exact Firebase submission without folder
  copying and can select FR3 or FR5.
- Fake-agent end-to-end proves job/state/log/STOP behavior.
- Agent fails closed without valid profile, token, source, or cleanup.
- Physical acceptance is explicitly pending until an operator performs it.

## Session Notes
<!-- Updated by cook automatically - do not edit manually -->

**Last active:** 2026-09-16
**Phase in progress:** phase-04-verification
**Status:** Local implementation and offline verification are complete; deployment and physical FR3/FR5 acceptance remain pending.

### Decisions made this session

- Reused the existing FastAPI service as the authenticated job control plane;
  Firebase remains the immutable submission source.
- Added one Local Agent process with explicit FR3/FR5 IP/points profiles and a
  separate agent token.
- Added a recent-agent heartbeat check before physical confirmation and held
  the shared robot lock across submitted-process execution plus cleanup.
- Preserved the public simulator and added Teacher-only Grade/Run real/STOP
  controls after the four-click + `0909` gate.
- Kept the confirmed shared gripper mapping: CLOSE=DO0 for 0.4 seconds and
  OPEN=DO1 for 0.4 seconds, followed by OFF.
- Vercel CLI inspection on 2026-09-16 found no linked project and a logged-out
  session; no external deployment was attempted.
- The live Vercel `teacher.html` is still the pre-runtime build and the
  configured Quick Tunnel hostname no longer resolves; republish the API URL
  and frontend before workshop use.
- Added `scripts/deploy-production.ps1` to health-check the tunnel, require a
  logged-in Vercel CLI, run frontend tests, update the API URL, and deploy.
- Resolved the local npm/Vercel CLI failure by adding valid project version
  metadata and pinning the CLI workaround to `vercel@59.17.0`.
- Vercel login is now valid as `giakhangdoan`, but that team does not own the
  existing `fairino-robot-simulator.vercel.app` alias; deployment must use the
  owner account or an invited team member before linking.
- Added and passed a local three-process smoke test covering the real HTTP
  control plane and Local Agent dry-run lifecycle without hardware.

### Next immediate action

Deploy the updated FastAPI service and Vercel frontend, configure the agent
token and actual FR3 IP locally, then run the no-robot dry-run before any
physical test.
