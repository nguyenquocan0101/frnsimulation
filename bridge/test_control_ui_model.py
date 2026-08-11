from __future__ import annotations

import unittest

from bridge.control.ui_model import UIModel


class UIModelTests(unittest.TestCase):
    def test_starts_disarmed_and_cannot_approve(self):
        model = UIModel()
        self.assertEqual(model.state, "DISARMED")
        self.assertFalse(model.can_approve)
        self.assertTrue(model.can_stop)
        self.assertEqual(model.robot_calls, 0)

    def test_approval_requires_valid_calibration_pair_health_and_pending(self):
        model = UIModel()
        model.set_calibration(True, "sha256:" + "a" * 64, ("P2",))
        model.set_pairing(True)
        model.set_health(True)
        model.set_pending({"runId": "run-1", "commands": 2, "revision": "sha256:" + "a" * 64, "lines": (1, 2)})
        self.assertTrue(model.can_approve)
        model.approve()
        self.assertEqual(model.state, "RUNNING")
        self.assertFalse(model.can_approve)

    def test_reject_stop_and_close_are_safe(self):
        model = UIModel()
        model.set_pending({"runId": "run-1", "commands": 1, "revision": "x", "lines": (1,)})
        model.reject()
        self.assertEqual(model.state, "DISARMED")
        model.stop()
        self.assertEqual(model.stop_requests, 1)
        model.close()
        self.assertTrue(model.closed)
