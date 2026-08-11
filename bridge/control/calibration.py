"""Trusted local points.json loading and symbolic target resolution."""

from __future__ import annotations

import hashlib
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType

from .config import DEFAULT_PROFILE, Profile


class CalibrationError(ValueError):
    def __init__(self, code: str, message: str | None = None):
        self.code = code
        super().__init__(message or code)


@dataclass(frozen=True)
class Point:
    name: str
    joints: tuple[float, ...]
    cart: tuple[float, ...]
    tool: int
    user: int


@dataclass(frozen=True)
class CalibrationSnapshot:
    path: Path
    profile: Profile
    revision: str
    points: object

    def approval_fingerprint(self, run_id: str, payload_hash: str) -> str:
        value = "|".join((run_id, payload_hash, self.revision, self.profile.name))
        return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def compute_revision(path: str | Path) -> str:
    return "sha256:" + hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _number(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError
    return float(value)


def load_calibration(path: str | Path, profile: Profile = DEFAULT_PROFILE) -> CalibrationSnapshot:
    path = Path(path)
    if not path.is_absolute():
        raise CalibrationError("path_must_be_absolute")
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CalibrationError("invalid_json") from exc
    if not isinstance(document, dict) or not isinstance(document.get("points"), list):
        raise CalibrationError("invalid_document")
    points = {}
    for record in document["points"]:
        if not isinstance(record, dict) or not isinstance(record.get("name"), str):
            raise CalibrationError("invalid_record")
        name = record["name"]
        if name in points:
            raise CalibrationError("duplicate_name")
        try:
            joints = tuple(_number(record[f"j{i}"]) for i in range(1, 7))
            cart = tuple(_number(record[key]) for key in ("x", "y", "z", "rx", "ry", "rz"))
            tool = record["toolnum"]
            user = record["workpiecenum"]
            if isinstance(tool, bool) or not isinstance(tool, int) or isinstance(user, bool) or not isinstance(user, int):
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise CalibrationError("invalid_record")
        if tool != profile.tool or user != profile.workpiece:
            raise CalibrationError("profile_mismatch")
        points[name] = Point(name, joints, cart, tool, user)
    if "HOME" not in points:
        raise CalibrationError("missing_home")
    return CalibrationSnapshot(path, profile, compute_revision(path), MappingProxyType(points))


def preflight_points(snapshot: CalibrationSnapshot, used_points) -> None:
    for name in used_points:
        if name == "HOME":
            if name not in snapshot.points:
                raise CalibrationError("missing_home")
            continue
        if not isinstance(name, str) or not re.fullmatch(r"P[1-7]", name) or name not in snapshot.points or f"{name}UP" not in snapshot.points:
            raise CalibrationError("missing_used_point_pair")


def resolve_command_target(snapshot: CalibrationSnapshot, command_name: str, args: tuple, current_point: str | None = None) -> Point:
    if command_name == "move_to":
        if len(args) != 1 or args[0] not in snapshot.points:
            raise CalibrationError("unknown_point")
        name = args[0]
        target_name = name + "UP" if name != "HOME" else name
        try:
            return snapshot.points[target_name]
        except KeyError as exc:
            raise CalibrationError("missing_used_point_pair") from exc
    if command_name == "move_down":
        if current_point is None or current_point == "HOME":
            raise CalibrationError("invalid_lower_target")
        name = current_point
    elif command_name == "move_up":
        if current_point is None or current_point == "HOME":
            raise CalibrationError("invalid_raise_target")
        name = current_point + "UP"
    elif command_name in {"grip", "release"}:
        if current_point is None:
            raise CalibrationError("no_current_point")
        name = current_point
    else:
        raise CalibrationError("command_not_allowed")
    if name not in snapshot.points:
        raise CalibrationError("unknown_point")
    return snapshot.points[name]
