"""Phase 01 RED tests for trusted local point calibration.

The fixture deliberately uses the same named records as TechCamp's
``points.json``.  Browser payloads contain only symbolic point names; all
joint/TCP values must come from the immutable local snapshot.
"""

from __future__ import annotations

import copy
import json
import math
import tempfile
import unittest
from pathlib import Path

from bridge.control.calibration import (  # type: ignore[import-not-found]
    CalibrationError,
    compute_revision,
    load_calibration,
    preflight_points,
    resolve_command_target,
)
from bridge.control.config import DEFAULT_PROFILE  # type: ignore[import-not-found]


def point_record(name: str, offset: float = 0.0, *, toolnum: int = 0, workpiecenum: int = 0) -> dict:
    return {
        "name": name,
        "toolnum": toolnum,
        "workpiecenum": workpiecenum,
        "j1": 1.0 + offset,
        "j2": 2.0 + offset,
        "j3": 3.0 + offset,
        "j4": 4.0 + offset,
        "j5": 5.0 + offset,
        "j6": 6.0 + offset,
        "x": 10.0 + offset,
        "y": 20.0 + offset,
        "z": 30.0 + offset,
        "rx": 40.0 + offset,
        "ry": 50.0 + offset,
        "rz": 60.0 + offset,
    }


def valid_document() -> dict:
    names = ["HOME"] + [item for point in range(1, 8) for item in (f"P{point}", f"P{point}UP")]
    return {"point_count": len(names), "points": [point_record(name, index) for index, name in enumerate(names)]}


class CalibrationContractTests(unittest.TestCase):
    def write_document(self, document: dict) -> Path:
        handle = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
        with handle:
            json.dump(document, handle)
        self.addCleanup(lambda: Path(handle.name).unlink(missing_ok=True))
        return Path(handle.name)

    def load(self, document: dict):
        return load_calibration(self.write_document(document), profile=DEFAULT_PROFILE)

    def test_valid_file_normalizes_exactly_six_joints_and_cart_values(self) -> None:
        snapshot = self.load(valid_document())
        self.assertIn("HOME", snapshot.points)
        self.assertEqual(len(snapshot.points), 15)
        for point in snapshot.points.values():
            self.assertEqual(len(point.joints), 6)
            self.assertEqual(len(point.cart), 6)
            self.assertTrue(all(math.isfinite(value) for value in point.joints))
            self.assertTrue(all(math.isfinite(value) for value in point.cart))
            self.assertEqual(point.tool, 0)
            self.assertEqual(point.user, 0)

    def test_rejects_malformed_json_missing_home_duplicates_or_missing_fields(self) -> None:
        path = self.write_document({"points": "not-a-list"})
        with self.assertRaises(CalibrationError):
            load_calibration(path, profile=DEFAULT_PROFILE)

        document = valid_document()
        document["points"] = [record for record in document["points"] if record["name"] != "HOME"]
        with self.assertRaises(CalibrationError) as ctx:
            self.load(document)
        self.assertEqual(ctx.exception.code, "missing_home")

        document = valid_document()
        document["points"].append(copy.deepcopy(document["points"][0]))
        with self.assertRaises(CalibrationError) as ctx:
            self.load(document)
        self.assertEqual(ctx.exception.code, "duplicate_name")

        document = valid_document()
        del document["points"][1]["j6"]
        with self.assertRaises(CalibrationError) as ctx:
            self.load(document)
        self.assertEqual(ctx.exception.code, "invalid_record")

    def test_rejects_nan_infinity_booleans_and_non_numeric_values(self) -> None:
        for field, value in (("j1", float("nan")), ("z", float("inf")), ("j2", True), ("x", "120")):
            document = valid_document()
            document["points"][1][field] = value
            with self.assertRaises(CalibrationError) as ctx:
                self.load(document)
            self.assertEqual(ctx.exception.code, "invalid_record")

    def test_rejects_tool_or_workpiece_mismatch_against_locked_profile(self) -> None:
        for field, value in (("toolnum", 1), ("workpiecenum", 2)):
            document = valid_document()
            document["points"][1][field] = value
            with self.assertRaises(CalibrationError) as ctx:
                self.load(document)
            self.assertEqual(ctx.exception.code, "profile_mismatch")

    def test_symbolic_resolution_uses_local_points_and_never_browser_coordinates(self) -> None:
        snapshot = self.load(valid_document())
        target = resolve_command_target(snapshot, "move_to", ("P2",), current_point=None)
        self.assertEqual(target.name, "P2UP")
        target = resolve_command_target(snapshot, "move_down", (), current_point="P2")
        self.assertEqual(target.name, "P2")
        target = resolve_command_target(snapshot, "move_up", (), current_point="P2")
        self.assertEqual(target.name, "P2UP")
        target = resolve_command_target(snapshot, "move_to", ("HOME",), current_point="P2")
        self.assertEqual(target.name, "HOME")

        # Any coordinates supplied by the browser are not part of the resolver
        # contract and must not affect the trusted target.
        with self.assertRaises(CalibrationError):
            resolve_command_target(snapshot, "move_to", ("P2", [999, 999, 999]), current_point=None)

        incomplete = valid_document()
        incomplete["points"] = [record for record in incomplete["points"] if record["name"] != "P2UP"]
        incomplete_snapshot = self.load(incomplete)
        with self.assertRaises(CalibrationError):
            resolve_command_target(incomplete_snapshot, "move_to", ("P2",), current_point=None)

    def test_preflight_requires_both_lower_and_upper_records_for_used_points(self) -> None:
        document = valid_document()
        document["points"] = [record for record in document["points"] if record["name"] != "P2UP"]
        snapshot = self.load(document)
        with self.assertRaises(CalibrationError) as ctx:
            preflight_points(snapshot, ("P2",))
        self.assertEqual(ctx.exception.code, "missing_used_point_pair")

        # Unused points may be absent; HOME remains mandatory.
        document = valid_document()
        document["points"] = [
            record for record in document["points"] if not record["name"].startswith("P7")
        ]
        snapshot = self.load(document)
        self.assertIsNone(preflight_points(snapshot, ("P2", "HOME")))

        document = valid_document()
        document["points"].extend([point_record("P8"), point_record("P8UP")])
        snapshot = self.load(document)
        with self.assertRaises(CalibrationError) as ctx:
            preflight_points(snapshot, ("P8",))
        self.assertEqual(ctx.exception.code, "missing_used_point_pair")

    def test_revision_is_stable_sha256_and_changes_when_bytes_change(self) -> None:
        document = valid_document()
        path = self.write_document(document)
        first = compute_revision(path)
        second = compute_revision(path)
        self.assertEqual(first, second)
        self.assertRegex(first, r"^sha256:[0-9a-f]{64}$")

        path.write_text(path.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        self.assertNotEqual(first, compute_revision(path))

    def test_profile_and_revision_are_pinned_for_approval(self) -> None:
        snapshot = self.load(valid_document())
        self.assertEqual(snapshot.profile, DEFAULT_PROFILE)
        self.assertEqual(snapshot.revision, compute_revision(snapshot.path))
        self.assertEqual(snapshot.approval_fingerprint("run-1", "payload-hash"), snapshot.approval_fingerprint("run-1", "payload-hash"))
        self.assertNotEqual(snapshot.approval_fingerprint("run-1", "payload-hash"), snapshot.approval_fingerprint("run-2", "payload-hash"))
        self.assertNotEqual(snapshot.approval_fingerprint("run-1", "payload-hash"), snapshot.approval_fingerprint("run-1", "different"))


if __name__ == "__main__":
    unittest.main()
