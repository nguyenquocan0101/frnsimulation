"""Phase 01 RED tests for the versioned control protocol.

These tests intentionally describe the deny-by-default wire contract before
the control bridge exists.  They only validate JSON and pure command data;
they must never import FAIRINO or contact a robot.
"""

from __future__ import annotations

import copy
import json
import unittest

from bridge.control.protocol import (  # type: ignore[import-not-found]
    ALLOWED_COMMANDS,
    MAX_COMMANDS,
    MAX_PAYLOAD_BYTES,
    ProtocolError,
    parse_batch,
    validate_sequence,
)


def canonical_payload() -> dict:
    return {
        "v": 1,
        "runId": "run-01-abcdef",
        "sessionId": "sess-01-abcdef",
        "model": "FR5",
        "profile": "fr5-default",
        "pointsRevision": "sha256:" + "a" * 64,
        "display": {"fileName": "main.py", "title": "Sort blocks"},
        "commands": [
            {"name": "move_to", "args": ["P2"], "line": 8},
            {"name": "move_down", "args": [], "line": 9},
            {"name": "grip", "args": [], "line": 10},
            {"name": "move_up", "args": [], "line": 11},
        ],
    }


class ControlProtocolTests(unittest.TestCase):
    def assert_rejected(self, payload: object, *, code: str | None = None) -> None:
        with self.assertRaises(ProtocolError) as ctx:
            parse_batch(payload)
        if code is not None:
            self.assertEqual(ctx.exception.code, code)

    def test_accepts_canonical_v1_batch_and_normalizes_commands(self) -> None:
        batch = parse_batch(canonical_payload())
        self.assertEqual(batch.version, 1)
        self.assertEqual(batch.run_id, "run-01-abcdef")
        self.assertEqual(batch.session_id, "sess-01-abcdef")
        self.assertEqual(batch.model, "FR5")
        self.assertEqual(batch.profile, "fr5-default")
        self.assertEqual(len(batch.commands), 4)
        self.assertEqual(batch.commands[0].name, "move_to")
        self.assertEqual(batch.commands[0].args, ("P2",))
        self.assertEqual(batch.commands[0].line, 8)

    def test_accepts_at_most_200_commands(self) -> None:
        payload = canonical_payload()
        payload["commands"] = [
            {"name": "move_up", "args": [], "line": index + 1}
            for index in range(MAX_COMMANDS)
        ]
        batch = parse_batch(payload)
        self.assertEqual(len(batch.commands), MAX_COMMANDS)

    def test_rejects_unknown_top_level_or_command_fields(self) -> None:
        payload = canonical_payload()
        payload["source"] = "print('raw python')"
        self.assert_rejected(payload, code="unknown_field")

        payload = canonical_payload()
        payload["commands"][0]["url"] = "https://evil.invalid"
        self.assert_rejected(payload, code="unknown_field")

    def test_rejects_unknown_version_and_payload_over_limit(self) -> None:
        payload = canonical_payload()
        payload["v"] = 2
        self.assert_rejected(payload, code="unsupported_version")

        oversized = json.dumps(canonical_payload()) + (" " * MAX_PAYLOAD_BYTES)
        self.assert_rejected(oversized, code="payload_too_large")

    def test_rejects_malformed_json_and_non_object_payloads(self) -> None:
        self.assert_rejected("{not-json", code="invalid_json")
        self.assert_rejected([], code="invalid_payload")
        self.assert_rejected(None, code="invalid_payload")

    def test_rejects_duplicate_or_replayed_run_id(self) -> None:
        payload = canonical_payload()
        parse_batch(payload, seen_run_ids={"already-used"})
        with self.assertRaises(ProtocolError) as ctx:
            parse_batch(payload, seen_run_ids={payload["runId"]})
        self.assertEqual(ctx.exception.code, "replayed_run")

    def test_rejects_invalid_id_and_revision_formats(self) -> None:
        for field in ("runId", "sessionId"):
            payload = canonical_payload()
            payload[field] = "../../etc/passwd"
            self.assert_rejected(payload, code="invalid_id")

        payload = canonical_payload()
        payload["pointsRevision"] = "not-a-sha"
        self.assert_rejected(payload, code="invalid_revision")

    def test_rejects_bad_lines_and_extra_arguments(self) -> None:
        for line in (0, -1, 1.5, True, "8"):
            payload = canonical_payload()
            payload["commands"][0]["line"] = line
            self.assert_rejected(payload, code="invalid_line")

        payload = canonical_payload()
        payload["commands"][0]["args"] = ["P2", "P3"]
        self.assert_rejected(payload, code="invalid_args")

        payload = canonical_payload()
        payload["commands"][1]["args"] = ["unexpected"]
        self.assert_rejected(payload, code="invalid_args")

    def test_rejects_commands_outside_allowlist(self) -> None:
        self.assertEqual(
            set(ALLOWED_COMMANDS),
            {"move_to", "move_down", "move_up", "grip", "release"},
        )
        for name, args in (
            ("capture", []),
            ("detect", []),
            ("get_positions", []),
            ("MoveJ", [[0, 0, 0, 0, 0, 0]]),
            ("MoveL", [[1, 2, 3, 4, 5, 6]]),
            ("jog", ["j1", 5]),
            ("SetToolDO", [0, 1]),
            ("__getattribute__", ["robot"]),
            ("exec", ["__import__('os').system('whoami')"]),
        ):
            payload = canonical_payload()
            payload["commands"] = [{"name": name, "args": args, "line": 1}]
            self.assert_rejected(payload, code="command_not_allowed")

    def test_rejects_source_python_sdk_shell_urls_and_vectors(self) -> None:
        forbidden_values = (
            "from techcamp_api import TechCamp",
            "Robot.MoveJ",
            "powershell.exe -Command whoami",
            "https://example.invalid/run",
        )
        for field, value in (
            ("python", forbidden_values[0]),
            ("sdkMethod", forbidden_values[1]),
            ("shell", forbidden_values[2]),
            ("url", forbidden_values[3]),
        ):
            payload = canonical_payload()
            payload[field] = value
            # These fields are never part of the v1 schema.  They must fail
            # closed before any bridge execution path is considered.
            self.assert_rejected(payload, code="unknown_field")

        payload = canonical_payload()
        payload["commands"][0]["args"] = [[0, 0, 0, 0, 0, 0]]
        self.assert_rejected(payload, code="invalid_args")

    def test_sequence_requires_down_before_leaving_a_point(self) -> None:
        batch = parse_batch(canonical_payload())
        # A complete source/destination cycle is legal.
        validate_sequence(batch.commands)

        invalid = copy.deepcopy(list(batch.commands))
        invalid[3] = type(invalid[3])(name="move_to", args=("P3",), line=11)
        with self.assertRaises(ProtocolError) as ctx:
            validate_sequence(invalid)
        self.assertEqual(ctx.exception.code, "move_requires_up")

    def test_sequence_rejects_move_down_without_current_point_and_home_down(self) -> None:
        payload = canonical_payload()
        payload["commands"] = [{"name": "move_down", "args": [], "line": 1}]
        batch = parse_batch(payload)
        with self.assertRaises(ProtocolError) as ctx:
            validate_sequence(batch.commands)
        self.assertEqual(ctx.exception.code, "no_current_point")

        payload["commands"] = [
            {"name": "move_to", "args": ["HOME"], "line": 1},
            {"name": "move_down", "args": [], "line": 2},
        ]
        batch = parse_batch(payload)
        with self.assertRaises(ProtocolError) as ctx:
            validate_sequence(batch.commands)
        self.assertEqual(ctx.exception.code, "home_cannot_lower")

        payload["commands"] = [
            {"name": "move_to", "args": ["P8"], "line": 1},
        ]
        batch = parse_batch(payload)
        with self.assertRaises(ProtocolError) as ctx:
            validate_sequence(batch.commands)
        self.assertEqual(ctx.exception.code, "invalid_point")

    def test_validation_is_atomic_and_does_not_return_partial_plan(self) -> None:
        payload = canonical_payload()
        payload["commands"] = [
            {"name": "move_to", "args": ["P2"], "line": 1},
            {"name": "move_down", "args": [], "line": 2},
            {"name": "grip", "args": [], "line": 3},
            {"name": "move_to", "args": ["P3"], "line": 4},
        ]
        batch = parse_batch(payload)
        with self.assertRaises(ProtocolError):
            validate_sequence(batch.commands)

    def test_browser_cannot_override_velocity_acceleration_or_profile(self) -> None:
        for field, value in (("velocity", 100), ("acceleration", 100), ("tool", 3), ("user", 9)):
            payload = canonical_payload()
            payload[field] = value
            self.assert_rejected(payload, code="unknown_field")


if __name__ == "__main__":
    unittest.main()
