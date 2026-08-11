# Control protocol v1

## Batch envelope

```json
{
  "v": 1, "runId": "run-01-abcdef", "sessionId": "sess-01-abcdef",
  "model": "FR5", "profile": "fr5-default",
  "pointsRevision": "sha256:<64 lowercase hex characters>",
  "display": {"fileName": "main.py", "title": "Sort blocks"},
  "commands": [{"name": "move_to", "args": ["P2"], "line": 8}]
}
```

The envelope has only the fields shown above. `commands` contains at most 200
entries and the UTF-8 JSON payload is at most 256 KiB. IDs are 6–96 characters
(`A–Z`, `a–z`, digits, `.`, `_`, `-`). A run ID is accepted once per bridge
session. `pointsRevision` is the SHA-256 of the operator-selected local
calibration file.

## Commands and sequence

The only names are `move_to`, `move_down`, `move_up`, `grip`, and `release`.
`move_to` has one symbolic argument (`P1`…`P7` or `HOME`); all other commands
have no arguments. A point must be lowered before the program can leave it:
the normal cycle is `move_to(Pn) → move_down() → grip/release → move_up() →
move_to(next)`. HOME cannot be lowered. Coordinates, joints, velocity,
acceleration, SDK names, URLs, raw Python, camera/detect commands, and unknown
fields are rejected before execution. Validation is atomic; no partial batch
is sent to the robot.

## State and approval

`received → validated → pending_approval → approved → running → completed`.
Reject, stop, disconnect, timeout, fault, or a calibration revision change
enter a terminal cancelled state. Approval is bound to `runId`, payload hash,
and `pointsRevision`; a changed batch or file must be approved again. Stop is
an out-of-band local operator message with priority over the student batch;
the bridge never auto-resumes after a disconnect.

## Point resolution and events

The bridge resolves symbolic names only from the immutable local snapshot:
`move_to(Pn) → PnUP`, `move_down() → Pn`, `move_up() → PnUP`, and
`move_to(HOME) → HOME`. Status events are versioned with `v: 1` and use the
names `connected`, `pending_approval`, `approved`, `command_started`,
`command_completed`, `run_completed`, `rejected`, `stopped`, and `faulted`.
Command events include `runId`, `commandIndex`, `line`, command name, and
status; faults also include an error code. The bridge fans these events to the
paired WebSocket and keeps only a bounded in-memory history. The browser never
supplies TCP or joint values.

## Gripper and safety

The bridge reports the gripper state as **last commanded** (`grip` or
`release`); this is not physical confirmation. Real safety/error state is
queried from the robot adapter before approval and before each motion. A
software Stop is not a physical emergency stop; an operator must keep the
physical E-stop available.

Representative errors are `unknown_field`, `payload_too_large`,
`command_not_allowed`, `invalid_args`, `invalid_point`, `move_requires_down`,
`move_requires_up`, `home_cannot_lower`, `replayed_run`, and
`profile_mismatch`.
