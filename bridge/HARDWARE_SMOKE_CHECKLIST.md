# Real Robot rollout gate

This checklist is intentionally manual and must be signed by the nearby
operator. The current repository status is **NOT CLEARED** until every item is
observed on the target controller.

1. Physical E-stop is reachable; workcell is clear; robot is in AUTO mode only
   after the operator verifies the controller signal.
2. Localhost certificate, exact Vercel Origin, points revision, tool `0`, and
   workpiece `1` match the approval preview.
3. The independent-client StopMotion probe passes at 5–10% speed and the
   measured pickup time is recorded.
4. With an empty table, run exactly `HOME → P1UP → P1 → P1UP → HOME` once.
5. Confirm motion-done, pose tolerance, queue length zero, and no unexpected
   gripper output after every command.
6. Trigger software Stop during a bounded motion; verify no later command is
   dispatched. Keep the physical E-stop ready throughout.
7. Disconnect/reconnect: the old run does not resume and requires a new local
   pairing and approval.

Record controller/firmware/SDK versions, operator, date, calibration hash and
the result in the release report. A failed or missing observation keeps Real
Robot mode disabled; Simulator and read-only telemetry remain available.
