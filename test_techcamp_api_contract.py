import importlib.util
import sys
import types
import unittest
from pathlib import Path


class FakeRobot:
    instances = []

    def __init__(self, _ip):
        self.moves = []
        self.io = []
        FakeRobot.instances.append(self)

    def move_j(self, joints, desc_pos=None, vel=None, acc=None):
        self.moves.append((list(joints), list(desc_pos), vel, acc))
        return 0

    def set_do(self, channel, value):
        self.io.append((channel, value))
        return 0

    def close(self):
        return None


fake_sdk = types.SimpleNamespace(FairinoFR5=FakeRobot)
sys.modules["fairino_robot"] = fake_sdk
sys.modules["numpy"] = types.SimpleNamespace(ndarray=object)

MODULE_PATH = Path(__file__).with_name("techcamp_api.py")
SPEC = importlib.util.spec_from_file_location("techcamp_api_under_test", MODULE_PATH)
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)


class TechCampCompatibilityTests(unittest.TestCase):
    def setUp(self):
        FakeRobot.instances.clear()

    def test_home_alias_and_home_safety(self):
        with api.TechCamp() as bot:
            self.assertTrue(bot.move_to("HOMECHESS"))
            with self.assertRaises(api.TechCampError):
                bot.move_down()
        self.assertEqual(FakeRobot.instances[0].moves[0][1], api._load_points()["HOME"]["cart"])

    def test_low_travel_auto_raises_and_duplicate_calls_are_safe(self):
        with api.TechCamp() as bot:
            bot.move_to("P1")
            bot.move_down()
            bot.move_down()
            bot.move_to("P2")
            bot.move_up()
            bot.move_up()
            bot.grip()
            bot.grip()
            bot.release()
            bot.release()
        robot = FakeRobot.instances[0]
        self.assertEqual(len(robot.moves), 4)
        self.assertEqual(robot.moves[1][2], 10)
        self.assertEqual(robot.moves[2][2], api.MAX_SPEED)


if __name__ == "__main__":
    unittest.main()
