"""Versioned, deny-by-default command batch protocol."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Iterable, Mapping

MAX_COMMANDS = 200
MAX_PAYLOAD_BYTES = 256 * 1024
ALLOWED_COMMANDS = ("move_to", "move_down", "move_up", "grip", "release")
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{5,95}$")
_REVISION = re.compile(r"^sha256:[0-9a-f]{64}$")
_POINT = re.compile(r"^(?:P[1-7]|HOME)$")


class ProtocolError(ValueError):
    def __init__(self, code: str, message: str | None = None):
        self.code = code
        super().__init__(message or code)


@dataclass(frozen=True)
class Command:
    name: str
    args: tuple
    line: int


@dataclass(frozen=True)
class CommandBatch:
    version: int
    run_id: str
    session_id: str
    model: str
    profile: str
    points_revision: str
    display: dict
    commands: tuple[Command, ...]


_TOP_FIELDS = {"v", "runId", "sessionId", "model", "profile", "pointsRevision", "display", "commands"}
_COMMAND_FIELDS = {"name", "args", "line"}


def _object(value, code="invalid_payload"):
    if not isinstance(value, Mapping):
        raise ProtocolError(code)
    return value


def _string(value, code):
    if not isinstance(value, str):
        raise ProtocolError(code)
    return value


def parse_batch(raw, seen_run_ids: set[str] | None = None) -> CommandBatch:
    if isinstance(raw, (str, bytes, bytearray)):
        try:
            data = raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw
        except UnicodeDecodeError as exc:
            raise ProtocolError("invalid_json") from exc
        if len(data.encode("utf-8")) > MAX_PAYLOAD_BYTES:
            raise ProtocolError("payload_too_large")
        try:
            payload = json.loads(data)
        except (TypeError, ValueError) as exc:
            raise ProtocolError("invalid_json") from exc
    else:
        payload = raw
        try:
            encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            if len(encoded) > MAX_PAYLOAD_BYTES:
                raise ProtocolError("payload_too_large")
        except AttributeError:
            # The normal path below provides the useful invalid-payload error.
            pass
    payload = _object(payload)
    if set(payload) - _TOP_FIELDS:
        raise ProtocolError("unknown_field")
    if payload.get("v") != 1:
        raise ProtocolError("unsupported_version")
    run_id = _string(payload.get("runId"), "invalid_id")
    session_id = _string(payload.get("sessionId"), "invalid_id")
    if not _ID.fullmatch(run_id) or not _ID.fullmatch(session_id):
        raise ProtocolError("invalid_id")
    if seen_run_ids and run_id in seen_run_ids:
        raise ProtocolError("replayed_run")
    model = _string(payload.get("model"), "invalid_model")
    profile = _string(payload.get("profile"), "invalid_profile")
    revision = _string(payload.get("pointsRevision"), "invalid_revision")
    if not _REVISION.fullmatch(revision):
        raise ProtocolError("invalid_revision")
    display = payload.get("display", {})
    if not isinstance(display, Mapping):
        raise ProtocolError("invalid_display")
    if set(display) - {"fileName", "title"}:
        raise ProtocolError("unknown_field")
    commands_raw = payload.get("commands")
    if not isinstance(commands_raw, list) or len(commands_raw) > MAX_COMMANDS:
        raise ProtocolError("invalid_commands")
    commands = []
    for item in commands_raw:
        item = _object(item)
        if set(item) - _COMMAND_FIELDS:
            raise ProtocolError("unknown_field")
        name = _string(item.get("name"), "command_not_allowed")
        if name not in ALLOWED_COMMANDS:
            raise ProtocolError("command_not_allowed")
        line = item.get("line")
        if isinstance(line, bool) or not isinstance(line, int) or line < 1:
            raise ProtocolError("invalid_line")
        args = item.get("args")
        if not isinstance(args, list):
            raise ProtocolError("invalid_args")
        expected = 1 if name == "move_to" else 0
        if len(args) != expected:
            raise ProtocolError("invalid_args")
        if name == "move_to" and not isinstance(args[0], str):
            raise ProtocolError("invalid_args")
        if any(isinstance(arg, (dict, list, tuple)) for arg in args):
            raise ProtocolError("invalid_args")
        commands.append(Command(name, tuple(args), line))
    return CommandBatch(1, run_id, session_id, model, profile, revision, dict(display), tuple(commands))


def validate_sequence(commands: Iterable[Command]) -> None:
    current = None
    lowered = False
    ready_to_travel = True
    holding = False
    for command in commands:
        name = command.name
        if name == "move_to":
            target = command.args[0]
            if not _POINT.fullmatch(target):
                raise ProtocolError("invalid_point")
            if lowered or holding:
                raise ProtocolError("move_requires_up")
            if current is not None and not ready_to_travel:
                raise ProtocolError("move_requires_down")
            if current == target:
                raise ProtocolError("duplicate_point")
            current = target
            ready_to_travel = False
        elif name == "move_down":
            if current is None:
                raise ProtocolError("no_current_point")
            if current == "HOME":
                raise ProtocolError("home_cannot_lower")
            if lowered:
                raise ProtocolError("already_lowered")
            lowered = True
        elif name == "move_up":
            if not lowered:
                raise ProtocolError("not_lowered")
            lowered = False
            ready_to_travel = True
        elif name == "grip":
            if not lowered:
                raise ProtocolError("grip_requires_down")
            if holding:
                raise ProtocolError("already_holding")
            holding = True
        elif name == "release":
            if not lowered:
                raise ProtocolError("release_requires_down")
            if not holding:
                raise ProtocolError("not_holding")
            holding = False
        else:
            raise ProtocolError("command_not_allowed")
