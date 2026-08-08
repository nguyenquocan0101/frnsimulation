# TechCamp Robot API -- Contestant Guide

The **only** file you need to import is `techcamp_api.py`. It gives you safe,
high-level control of the robot arm, gripper, and camera. You never touch
coordinates, robot SDKs, or hardware details.

---

## 1. Quick Start

The simulator runs student code only through a Python entrypoint: define a
zero-argument function and call it from the `__main__` guard. The function may
be named `main`, `move_cube`, or another descriptive name.

```python
from techcamp_api import TechCamp

def main():
    with TechCamp() as bot:
        bot.move_to("P3")
        bot.move_down()
        bot.grip()
        bot.move_up()
        bot.move_to("P1")
        bot.move_down()
        bot.release()
        bot.move_up()


if __name__ == "__main__":
    main()
```

Or use it as a context manager (recommended):

```python
from techcamp_api import TechCamp

def move_cube():
    with TechCamp() as bot:
        bot.move_to("P3")
        bot.move_down()
        bot.grip()
        bot.move_up()


if __name__ == "__main__":
    move_cube()
```

---

## 2. Function Reference

### `move_to(position: str) -> bool`

Move the gripper to the **safe travel height** above a square.

| Argument | Values |
|---|---|
| `position` | `"P1"` ... `"P7"`, `"HOME"` (`"HOMECHESS"` is a legacy alias) |

- Always travels at the safe UP height (z = 255mm) -- never drags low.
- If the gripper is currently low, the API **automatically raises it first**.
- Returns `True` on success.
- Raises `TechCampError` if the position is invalid or the move fails.

### `move_down() -> bool`

Lower the gripper to **grab/place height** over the current square.

- Only valid after `move_to("P1".."P7")` (not at HOME).
- Safe no-op if already down (idempotent).

### `move_up() -> bool`

Raise the gripper back to **safe travel height** over the current square.

- Safe no-op if already up (idempotent).

### `grip() -> bool`

Close the gripper (grab the block).

- Safe no-op if already gripping (idempotent).

### `release() -> bool`

Open the gripper (drop the block).

- Safe no-op if already released (idempotent).

### `get_image() -> numpy.ndarray`

Return the current camera image (BGR, 1920x1080).

```python
img = bot.get_image()
```

### `get_positions() -> dict`

Return which squares currently have blocks, using AI detection.

```python
blocks = bot.get_positions()
# {'P1': True, 'P2': False, 'P3': True, ...}
```

> Note: detection results depend on camera view. Use it as a hint, and
> verify with your own logic if precision matters.

---

## 3. Safety Rules (cannot be disabled)

| Rule | Why |
|---|---|
| `move_to()` always raises before horizontal travel | Prevents collisions |
| Speed is capped at 40%, acceleration at 20% | Safe motion |
| Coordinates are pre-calibrated and hidden | Students can't break the robot |
| Emergency stop stays active on hardware | Always available |
| Functions are idempotent | Double-calls are safe, never crash |

---

## 4. Errors

All failures raise `TechCampError` with a clear message:

```python
from techcamp_api import TechCamp, TechCampError

try:
    bot.move_to("P9")          # invalid square
except TechCampError as e:
    print(e)                    # "Invalid position 'P9'. Valid: [...]"
```

Common messages:

| Situation | Error |
|---|---|
| Wrong square name | `Invalid position '...'` |
| `move_down()` before any `move_to()` | `move_down() requires move_to('P1'..'P7') first.` |
| Robot not in AUTO mode | `move_to('P3') failed (robot error 14). Check robot is in AUTO mode...` |
| Camera not readable | `get_image() failed: camera not readable.` |

---

## 5. Example: Move a block from P3 to P1

```python
from techcamp_api import TechCamp

with TechCamp() as bot:
    # Pick from P3
    bot.move_to("P3")
    bot.move_down()
    bot.grip()
    bot.move_up()

    # Place at P1
    bot.move_to("P1")
    bot.move_down()
    bot.release()
    bot.move_up()

    print("Done!")
```

## 6. Example: Smart sort (only pick if a block is present)

```python
from techcamp_api import TechCamp

with TechCamp() as bot:
    blocks = bot.get_positions()

    for pos in ["P3", "P4", "P5"]:
        if blocks.get(pos):
            bot.move_to(pos)
            bot.move_down()
            bot.grip()
            bot.move_up()
            bot.move_to("P1")
            bot.move_down()
            bot.release()
            bot.move_up()
            print(f"Moved block from {pos} to P1")
```

---

## 7. Requirements

```
pip install -r requirements.txt
```

- Robot IP: `192.168.58.2` (default, no need to change)
- Camera: USB webcam (index 1, default)
- The robot must be in **AUTO mode** (blue light) before running.

---

## 8. Testing

Run the built-in test (robot must be free):

```sh
python test_techcamp_api.py
```

All steps must show `[PASS]`. Exit code `0` = all passed.
