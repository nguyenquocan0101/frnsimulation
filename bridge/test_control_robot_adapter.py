from __future__ import annotations

import unittest

from bridge.control.calibration import Point
from bridge.control.robot_adapter import AdapterFault, AdapterLimits, FakeRobotAdapter, SafetySnapshot


def target(name="P2UP"):
    return Point(name, (1, 2, 3, 4, 5, 6), (10, 20, 30, 40, 50, 60), 0, 1)


class AdapterTests(unittest.TestCase):
    def healthy(self):
        return SafetySnapshot(0, 0, (0, 0), (0, 0), 0, 0, 0, 1, True, 0, (0,))

    def test_move_is_one_shot_and_caps_speed(self):
        robot = FakeRobotAdapter(safety=self.healthy())
        result = robot.move(target(), speed_class="travel")
        self.assertTrue(result.ok)
        self.assertEqual(len(robot.move_calls), 1)
        self.assertEqual(robot.move_calls[0]["vel"], AdapterLimits().travel_velocity)
        self.assertEqual(robot.move_calls[0]["acc"], AdapterLimits().max_acceleration)

    def test_unhealthy_state_blocks_write(self):
        robot = FakeRobotAdapter(safety=SafetySnapshot(0, 1, (0, 0), (0, 0), 0, 0, 0, 1, True, 0, (0,)))
        with self.assertRaises(AdapterFault):
            robot.move(target())
        self.assertEqual(robot.move_calls, [])

    def test_timeout_is_not_retried(self):
        robot = FakeRobotAdapter(safety=self.healthy(), move_error="timeout")
        with self.assertRaises(AdapterFault) as ctx:
            robot.move(target())
        self.assertEqual(ctx.exception.kind, "unknown")
        self.assertEqual(len(robot.move_calls), 1)

    def test_gripper_always_cleans_do0_and_tracks_last_command(self):
        robot = FakeRobotAdapter(safety=self.healthy())
        robot.grip()
        self.assertEqual(robot.gripper_state, "last_commanded_closed")
        self.assertEqual(robot.do_calls[-1], (0, 0))
        robot.fail_do = True
        with self.assertRaises(AdapterFault):
            robot.release()
        self.assertEqual(robot.do_calls[-1], (0, 0))


if __name__ == "__main__":
    unittest.main()
