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

- `FR3` is the default visual profile.
- `FR5` reloads the official FR5 visual meshes each time it is selected.
- The selector is locked while a program, live telemetry, or gripper animation is running.
- `HOME` is the canonical TechCamp point. `HOMECHESS` remains a deprecated compatibility alias.
- `get_positions()` remains a simulator-only compatibility extension.
- The Python runner response remains `{ok, actions, output}`. No step telemetry, SDK calls, DO pulses, camera capture, `run_status.json`, or `robot_done` feedback is exposed in the browser.

## Orange start/end marker

After reset, the classroom layout is intentionally:

- P1: orange marker
- P2: block labelled P7
- P3–P6: the existing blocks unchanged
- P7: empty marker destination/buffer

The old block at P1 and semantic P2 block are removed from this fixture. Students may sort the five remaining blocks freely. The orange marker is draggable/grippable like a classroom start/end marker; the simulator does not enforce a route or decide whether the lesson is complete. The marker is not included in `get_positions()` or object-class counts. While it occupies a slot, another block cannot be dropped into that occupied slot.

## Live monitor

To mirror read-only robot telemetry, run the local bridge in a separate terminal:

```powershell
python .\bridge\fr3_bridge.py --robot-ip 192.168.58.2 --transport 8083
```

Then open `http://localhost:8080/?live=1` or select **Connect live**. The bridge reads controller telemetry and does not send motion commands.

## API and deployment

See [API_INSTRUCTIONS.md](API_INSTRUCTIONS.md) for the student-facing TechCamp contract. The static web app can be deployed with the existing Vercel configuration and the Python endpoint at `POST /api/python/run`.

The live bridge and physical SDK are intentionally FR3-specific and run only on a machine connected to the robot LAN. They are not used by the browser simulator.
