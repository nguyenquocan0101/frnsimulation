import importlib.util
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("python_sim_runner.py")
SPEC = importlib.util.spec_from_file_location("python_sim_runner_under_test", MODULE_PATH)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def execute(source, positions=None):
    return runner.execute({"source": source, "positions": positions or {}})


class PythonSimRunnerContractTests(unittest.TestCase):
    def test_home_and_legacy_alias_emit_canonical_home(self):
        for point in ("HOME", "HOMECHESS"):
            result = execute(
                f'from techcamp_api import TechCamp\nwith TechCamp() as bot:\n    bot.move_to("{point}")\n'
            )
            self.assertTrue(result["ok"], result)
            self.assertEqual(result["actions"][0]["position"], "HOME")

    def test_move_down_at_home_is_rejected(self):
        result = execute(
            'from techcamp_api import TechCamp\n'
            'with TechCamp() as bot:\n'
            '    bot.move_to("HOME")\n'
            '    bot.move_down()\n'
        )
        self.assertFalse(result["ok"])
        self.assertIn("move_down()", result["error"]["message"])

    def test_low_horizontal_travel_records_raise_first(self):
        result = execute(
            'from techcamp_api import TechCamp\n'
            'with TechCamp() as bot:\n'
            '    bot.move_to("P1")\n'
            '    bot.move_down()\n'
            '    bot.move_to("P2")\n'
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(
            [action["type"] for action in result["actions"]],
            ["move_to", "move_down", "move_up", "move_to"],
        )

    def test_home_and_gripper_calls_are_idempotent(self):
        result = execute(
            'from techcamp_api import TechCamp\n'
            'with TechCamp() as bot:\n'
            '    bot.move_to("HOME")\n'
            '    bot.move_to("HOMECHESS")\n'
            '    bot.move_up()\n'
            '    bot.grip()\n'
            '    bot.grip()\n'
            '    bot.release()\n'
            '    bot.release()\n'
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual([a["type"] for a in result["actions"]], ["move_to", "grip", "release"])

    def test_response_contract_has_no_steps_telemetry(self):
        result = execute(
            'from techcamp_api import TechCamp\n'
            'with TechCamp() as bot:\n'
            '    bot.move_to("P1")\n'
        )
        self.assertEqual(set(result), {"ok", "actions", "output"})


if __name__ == "__main__":
    unittest.main()
