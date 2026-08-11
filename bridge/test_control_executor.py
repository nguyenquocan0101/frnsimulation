from __future__ import annotations

import threading
import time
import unittest

from bridge.control.calibration import Point
from bridge.control.executor import RunExecutor
from bridge.control.robot_adapter import FakeRobotAdapter, SafetySnapshot


class ExecutorTests(unittest.TestCase):
    def target(self, name="P2UP"):
        return Point(name, (1, 2, 3, 4, 5, 6), (10, 20, 30, 40, 50, 60), 0, 1)

    def adapter(self, **kwargs):
        return FakeRobotAdapter(safety=SafetySnapshot(0, 0, (0, 0), (0, 0), 0, 0, 0, 1, True, 0, (0,)), **kwargs)

    def test_serializes_actions_in_order(self):
        robot = self.adapter()
        executor = RunExecutor(robot)
        result = executor.run([lambda: robot.move(self.target("P2UP")), lambda: robot.move(self.target("P2"))])
        self.assertTrue(result.completed)
        self.assertEqual([call["target"] for call in robot.move_calls], ["P2UP", "P2"])

    def test_stop_cancels_blocked_run_and_calls_stop_once(self):
        entered = threading.Event()
        robot = self.adapter(block_event=entered)
        executor = RunExecutor(robot)
        worker = threading.Thread(target=lambda: executor.run([lambda: robot.move(self.target())]))
        worker.start()
        self.assertTrue(entered.wait(1))
        executor.stop("operator_stop")
        robot.release_block()
        worker.join(2)
        self.assertEqual(robot.stop_calls, 1)
        self.assertTrue(executor.cancelled)
        self.assertEqual(len(robot.move_calls), 1)

    def test_disconnect_does_not_resume(self):
        robot = self.adapter()
        executor = RunExecutor(robot)
        executor.disconnect()
        result = executor.run([lambda: robot.move(self.target())])
        self.assertFalse(result.completed)
        self.assertEqual(robot.move_calls, [])


if __name__ == "__main__":
    unittest.main()
