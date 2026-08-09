# FAIRINO FR3/FR5 · 3D Web Simulator

Local classroom simulator for the official FAIRINO FR3 V6 and FR5 V6 visual models. The selector in the Simulation header reloads the selected arm model while preserving the scene, editor, camera, worktable, and gripper state.

FR5 is display-only in this delivery. Its visual link geometry is official, but TCP, IK, safe-zone, worktable, and calibrated points remain FR3-based and provisional until the engineering team supplies FR5 calibration.

## Run locally

Do not open `index.html` with `file://`; use the static server:

```powershell
cd W:\farino_fr3\07_web_simulator
node .\serve.mjs
```

Open `http://localhost:8080/`.

The page loads Three.js from a CDN, so the first visit needs Internet access. FR3 assets live in `assets/fr3_v6/`; FR5 assets live in `assets/fr5_v6/`.

## Simulator boundaries

- `FR5` is the default visual profile and opens at its calibrated `HOME` pose
  with the FR3-style Home camera.
- `FR3` remains available from the model selector.
- The selector is locked while a program, live telemetry, or gripper animation is running.
- `HOME` is the canonical TechCamp point. `HOMECHESS` remains a deprecated compatibility alias.
- `get_positions()` remains a simulator-only compatibility extension.
- The Python runner response remains `{ok, actions, output}`. No step telemetry, SDK calls, DO pulses, camera capture, `run_status.json`, or `robot_done` feedback is exposed in the browser.
- Programs must define a zero-argument `main()` and call it from
  `if __name__ == "__main__":`. The IDE only blocks syntax, unsafe/private
  commands, and clearly invalid robot order; this is a workshop, not an
  anti-cheat judge.
- `Home camera` uses the third reference view (`Back`) as the workshop preset
  and sets the camera to `View 200%`. `Change view` still cycles
  `Front → Right → Back → Left` from the table/robot frame for both FR3 and FR5;
  it does not rotate the robot or alter calibrated points.
- The adjustable camera range is 100–200%. A legacy scalar zoom of exactly
  `118` is migrated to 100 once because the old value did not record whether it
  was user-selected; new slider values are stored with explicit provenance.

The five classroom blocks use the workshop sticker set in
`assets/sticker-objects/` (copied from the supplied `Sticker (2)` folder).

## Orange start/end marker

The regular classroom reset layout is:

- P1: orange marker
- P2: car (block labelled P7)
- P3: chicken
- P4: dog
- P5: chair
- P6: house
- P7: empty marker destination/buffer

The competition Run button uses its own deterministic input (P1 marker, P2 dog, P3 chicken, P4 chair, P5 house, P6 car, P7 empty) before the marker opening. Students may sort the five blocks freely. The orange marker is draggable/grippable like a classroom start/end marker; the regular simulator does not enforce a route or decide whether the lesson is complete. The marker is not included in `get_positions()` or object-class counts. While it occupies a slot, another block cannot be dropped into that occupied slot.

## Live monitor

To mirror read-only robot telemetry, run the local bridge in a separate terminal:

```powershell
python .\bridge\fr3_bridge.py --robot-ip 192.168.58.2 --transport 8083
```

Then open `http://localhost:8080/?live=1` or select **Connect live**. The bridge reads controller telemetry and does not send motion commands.

## API and deployment

See [API_INSTRUCTIONS.md](API_INSTRUCTIONS.md) for the student-facing TechCamp contract. The static web app can be deployed with the existing Vercel configuration and the Python endpoint at `POST /api/python/run`.

The live bridge and physical SDK are intentionally FR3-specific and run only on a machine connected to the robot LAN. They are not used by the browser simulator.

## Workshop submissions

The editor toolbar has **Upload bài** instead of a local `.py` download. Students enter a
non-accented, contiguous group name using only ASCII letters/digits (2–30 characters), for
example `Nhom1` or `RobotXanh`. The app generates `TechX_Nhom1.py` or
`TechX_RobotXanh.py`. Each upload is kept as a separate version with its Firebase timestamp;
the editor and local autosave are not changed.

Teachers open [`teacher.html`](teacher.html) directly; no login, account, or expiring token is
required. The page lists the newest 100 submissions, refreshes every three seconds, supports a
group filter, exact code preview, and `.py` download. Source code is stored directly in Firestore,
so this flow does not require Firebase Storage or the Blaze billing plan. Firebase Web
configuration is public project configuration and is stored in
[`firebase-config.mjs`](firebase-config.mjs). Firestore read access is intentionally public for
this workshop: anyone with the page URL can view and download submitted source code.
The workshop flow intentionally does not implement anti-cheating, App Check, rate limiting,
pagination beyond 100 rows, or automatic cleanup. See
[`docs/firebase-setup.md`](docs/firebase-setup.md) for setup and manual cleanup.

## Robot sorting competition

Open [`/competition`](competition.html) for the public rules and leaderboard. On **Run
program**, the IDE resets the competition fixture and moves the orange marker P1 → P7 as
the start signal; that movement is not counted. Students then sort the five blocks. Every
successful release is one step and its distance is the number of slot gaps (for example,
P7 → P2 is 5). The result card shows correctness, score, steps, distance, and a local
snapshot; only the four result fields are written to the optional `competition_results`
collection. No timer or centimetres are used.
Competition result saving is intentionally public for this low-stakes workshop, so it does
not require a Firebase login; the leaderboard is not a trusted anti-cheat judge.

The existing `submissions` collection is not deleted by deployment. If an organizer wants
to retire it, export/check the project `frteachxcamp`, deploy the replacement, and run an
explicit Firebase console/CLI deletion as a separate, manually confirmed operation.
