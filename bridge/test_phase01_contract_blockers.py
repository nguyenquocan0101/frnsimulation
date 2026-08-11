"""Phase 01 RED contracts for the localhost WSS control boundary.

These tests intentionally exercise pure session/config/adapter boundaries.  No
test opens a robot socket or performs a physical robot write.
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from bridge.control.calibration import Point
from bridge.control.config import DEFAULT_PROFILE
from bridge.control.robot_adapter import (
    AdapterFault,
    AdapterLimits,
    FairinoRobotAdapter,
    SafetySnapshot,
)
from bridge.control.session import SessionError, SessionManager
from bridge.control.service import ControlService
from bridge.control.robot_adapter import FakeRobotAdapter


PRODUCTION_ORIGIN = "https://fairino-robot-simulator.vercel.app"
LOCAL_DEV_ORIGIN = "http://127.0.0.1:8080"


class PairingTokenContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = [100.0]
        self.manager = SessionManager({PRODUCTION_ORIGIN, LOCAL_DEV_ORIGIN}, ttl_seconds=60, now=lambda: self.now[0])

    def test_default_origin_matrix_is_exact_and_rejects_all_near_misses(self) -> None:
        self.assertEqual(set(DEFAULT_PROFILE.allowed_origins), {PRODUCTION_ORIGIN, LOCAL_DEV_ORIGIN})
        session = self.manager.create()
        for origin in (
            "*", "null", "", "https://fairino-robot-simulator.vercel.app/",
            "https://fairino-robot-simulator.vercel.app.evil.example",
            "https://user@fairino-robot-simulator.vercel.app",
            "https://fairino-robot-simulator.vercel.app/path",
            "https://fairino-robot-simulator.vercel.app?x=1",
            "https://fairino-robot-simulator.vercel.app#fragment",
            "http://localhost:8080",
        ):
            with self.subTest(origin=origin):
                with self.assertRaisesRegex(SessionError, "origin_not_allowed"):
                    self.manager.pair(session, origin, {"type": "pair", "token": session.token})

    def test_token_is_256_bit_or_stronger_and_compare_digest_is_the_only_matcher(self) -> None:
        session = self.manager.create()
        # URL-safe Base64 expands a 32-byte secret to 43+ characters.
        self.assertGreaterEqual(len(session.token), 43)
        with patch("bridge.control.session.secrets.compare_digest", wraps=__import__("secrets").compare_digest) as compare:
            self.manager.pair(session, PRODUCTION_ORIGIN, {"type": "pair", "token": session.token})
        compare.assert_called_once()

    def test_pairing_token_is_single_use_redacted_after_success_and_new_session_is_required(self) -> None:
        session = self.manager.create()
        token = session.token
        self.manager.pair(session, PRODUCTION_ORIGIN, {"type": "pair", "token": token})
        self.assertIsNone(session.token, "a consumed pairing secret must not remain on the session object")
        self.manager.drop(session)
        with self.assertRaises(SessionError):
            self.manager.pair(session, PRODUCTION_ORIGIN, {"type": "pair", "token": token})

        refreshed = self.manager.create()
        self.assertNotEqual(refreshed.token, token)
        self.assertTrue(self.manager.pair(refreshed, PRODUCTION_ORIGIN, {"type": "pair", "token": refreshed.token}))

    def test_rejected_pair_and_expired_token_are_invalidated_and_cannot_retry(self) -> None:
        rejected = self.manager.create()
        token = rejected.token
        with self.assertRaisesRegex(SessionError, "invalid_token"):
            self.manager.pair(rejected, PRODUCTION_ORIGIN, {"type": "pair", "token": "wrong-token"})
        with self.assertRaises(SessionError):
            self.manager.pair(rejected, PRODUCTION_ORIGIN, {"type": "pair", "token": token})

        expired = self.manager.create()
        self.now[0] += 61
        with self.assertRaisesRegex(SessionError, "session_expired"):
            self.manager.pair(expired, PRODUCTION_ORIGIN, {"type": "pair", "token": expired.token})
        with self.assertRaises(SessionError):
            self.manager.pair(expired, PRODUCTION_ORIGIN, {"type": "pair", "token": expired.token})

    def test_any_rejected_handshake_consumes_the_issued_token(self) -> None:
        for origin, query in (("https://evil.invalid", ""), (PRODUCTION_ORIGIN, "token=leak")):
            with self.subTest(origin=origin, query=query):
                session = self.manager.create()
                token = session.token
                with self.assertRaises(SessionError):
                    self.manager.pair(session, origin, {"type": "pair", "token": token}, query=query)
                self.assertIsNone(session.token)
                with self.assertRaises(SessionError):
                    self.manager.pair(session, PRODUCTION_ORIGIN, {"type": "pair", "token": token})

    def test_consuming_pair_token_does_not_end_its_separate_paired_session_lease(self) -> None:
        session = self.manager.create()
        self.now[0] = 159.0
        self.manager.pair(session, PRODUCTION_ORIGIN, {"type": "pair", "token": session.token})
        self.now[0] = 161.0
        self.manager.validate_active(session)

    def test_shutdown_invalidates_all_existing_pairing_sessions(self) -> None:
        first, second = self.manager.create(), self.manager.create()
        self.manager.shutdown()
        for session in (first, second):
            with self.subTest(session=session.session_id):
                with self.assertRaises(SessionError):
                    self.manager.pair(session, PRODUCTION_ORIGIN, {"type": "pair", "token": session.token})

    def test_preprovisioned_browser_token_claims_the_existing_session_not_a_new_one(self) -> None:
        issued = self.manager.create()
        claimed = self.manager.claim_pairing(
            PRODUCTION_ORIGIN,
            {"type": "pair", "token": issued.token},
        )
        self.assertIs(claimed, issued)
        self.assertIsNone(issued.token)
        self.assertEqual(self.manager.active_session_id, issued.session_id)

    def test_second_controller_rejection_consumes_its_issued_token(self) -> None:
        first = self.manager.create()
        second = self.manager.create()
        self.manager.pair(first, PRODUCTION_ORIGIN, {"type": "pair", "token": first.token})
        second_token = second.token
        with self.assertRaisesRegex(SessionError, "session_already_paired"):
            self.manager.pair(second, PRODUCTION_ORIGIN, {"type": "pair", "token": second_token})
        self.assertIsNone(second.token)
        self.manager.drop(first)
        with self.assertRaises(SessionError):
            self.manager.pair(second, PRODUCTION_ORIGIN, {"type": "pair", "token": second_token})

    def test_runtime_service_rejects_wildcard_or_unapproved_origin_configuration(self) -> None:
        for origins in ({"*"}, {"https://evil.invalid"}, set()):
            with self.subTest(origins=origins):
                with self.assertRaises(ValueError):
                    ControlService(FakeRobotAdapter(), origins=origins)


class _MotionClient:
    def __init__(self) -> None:
        self.movej_calls: list[dict] = []

    def MoveJ(self, joints, tool, user, **kwargs):
        self.movej_calls.append({"joints": joints, "tool": tool, "user": user, **kwargs})
        return 0


class _StopClient:
    def StopMotion(self):
        return 0


def safe_snapshot() -> SafetySnapshot:
    return SafetySnapshot(0, 0, (0, 0), (0, 0), 0, 0, 0, 1, True, 0, (0,))


def fr5_target(name: str = "P2UP") -> Point:
    return Point(name, (1, 2, 3, 4, 5, 6), (10, 20, 30, 40, 50, 60), tool=0, user=0)


class Fr5AdapterSafetyContractTests(unittest.TestCase):
    def test_fr5_uses_tool_zero_and_workpiece_zero_and_rejects_other_target_metadata(self) -> None:
        motion = _MotionClient()
        adapter = FairinoRobotAdapter(motion, _StopClient(), safety_provider=safe_snapshot)
        self.assertTrue(adapter.move(fr5_target()).ok)
        self.assertEqual(motion.movej_calls[-1]["tool"], 0)
        self.assertEqual(motion.movej_calls[-1]["user"], 0)
        for target in (
            Point("bad-tool", fr5_target().joints, fr5_target().cart, tool=1, user=0),
            Point("bad-workpiece", fr5_target().joints, fr5_target().cart, tool=0, user=1),
        ):
            with self.subTest(target=target.name):
                with self.assertRaises(AdapterFault):
                    adapter.move(target)

    def test_motion_limits_are_hard_capped_for_travel_home_and_lowering(self) -> None:
        self.assertEqual(AdapterLimits().travel_velocity, 40.0)
        self.assertEqual(AdapterLimits().lower_velocity, 10.0)
        self.assertEqual(AdapterLimits().max_acceleration, 20.0)
        for kwargs in (
            {"travel_velocity": 40.01},
            {"lower_velocity": 10.01},
            {"max_acceleration": 20.01},
        ):
            with self.subTest(kwargs=kwargs):
                with self.assertRaises(ValueError):
                    AdapterLimits(**kwargs)

        motion = _MotionClient()
        adapter = FairinoRobotAdapter(motion, _StopClient(), safety_provider=safe_snapshot)
        adapter.move(fr5_target("HOME"), speed_class="home")
        adapter.move(fr5_target("P2"), speed_class="lower")
        self.assertEqual(motion.movej_calls[0]["vel"], 40.0)
        self.assertEqual(motion.movej_calls[1]["vel"], 10.0)
        self.assertTrue(all(call["acc"] == 20.0 for call in motion.movej_calls))

    def test_adapter_rejects_non_adapter_limits_that_try_to_bypass_hard_caps(self) -> None:
        motion = _MotionClient()
        with self.assertRaises((TypeError, ValueError)):
            FairinoRobotAdapter(
                motion,
                _StopClient(),
                safety_provider=safe_snapshot,
                limits=SimpleNamespace(travel_velocity=999, lower_velocity=888, max_acceleration=777),
            )
        self.assertEqual(motion.movej_calls, [])

    def test_adapter_rejects_adapter_limits_subclass_that_mutates_safety_caps(self) -> None:
        class UnsafeLimits(AdapterLimits):
            def __init__(self):
                object.__setattr__(self, "travel_velocity", 999.0)
                object.__setattr__(self, "lower_velocity", 888.0)
                object.__setattr__(self, "max_acceleration", 777.0)

        with self.assertRaises(TypeError):
            FairinoRobotAdapter(_MotionClient(), _StopClient(), safety_provider=safe_snapshot, limits=UnsafeLimits())


if __name__ == "__main__":
    unittest.main()
