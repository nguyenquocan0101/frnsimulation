import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("python_sim_runner.py")
SPEC = importlib.util.spec_from_file_location("python_sim_runner_under_test", MODULE_PATH)
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


def execute(source, positions=None):
    return runner.execute({"source": source, "positions": positions or {}})


def program(body):
    indented = "\n".join(f"    {line}" if line else "" for line in body.splitlines())
    return (
        "from techcamp_api import TechCamp\n\n"
        "def main():\n"
        f"{indented}\n\n"
        'if __name__ == "__main__":\n'
        "    main()\n"
    )


class PythonSimRunnerContractTests(unittest.TestCase):
    def test_home_and_legacy_alias_emit_canonical_home(self):
        for point in ("HOME", "HOMECHESS"):
            result = execute(
                program(
                    f'with TechCamp() as bot:\n    bot.move_to("{point}")'
                )
            )
            self.assertTrue(result["ok"], result)
            self.assertEqual(result["actions"][0]["position"], "HOME")

    def test_move_down_at_home_is_rejected(self):
        result = execute(
            program(
                'with TechCamp() as bot:\n'
                '    bot.move_to("HOME")\n'
                '    bot.move_down()'
            )
        )
        self.assertFalse(result["ok"])
        self.assertIn("move_down()", result["error"]["message"])

    def test_low_horizontal_travel_records_raise_first(self):
        result = execute(
            program(
                'with TechCamp() as bot:\n'
                '    bot.move_to("P1")\n'
                '    bot.move_down()\n'
                '    bot.move_to("P2")'
            )
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(
            [action["type"] for action in result["actions"]],
            ["move_to", "move_down", "move_up", "move_to"],
        )

    def test_home_and_gripper_calls_are_idempotent(self):
        result = execute(
            program(
                'with TechCamp() as bot:\n'
                '    bot.move_to("HOME")\n'
                '    bot.move_to("HOMECHESS")\n'
                '    bot.move_up()\n'
                '    bot.grip()\n'
                '    bot.grip()\n'
                '    bot.release()\n'
                '    bot.release()'
            )
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual([a["type"] for a in result["actions"]], ["move_to", "grip", "release"])

    def test_response_contract_has_no_steps_telemetry(self):
        result = execute(
            program(
                'with TechCamp() as bot:\n'
                '    bot.move_to("P1")'
            )
        )
        self.assertEqual(set(result), {"ok", "actions", "output"})

    def test_cli_accepts_utf8_student_source_on_windows(self):
        source = (
            "from techcamp_api import TechCamp\n"
            "\n"
            "def main():\n"
            "    with TechCamp() as bot:\n"
            "        print('Đang kiểm tra P1')\n"
            "        bot.move_to('P1')\n"
            "\n"
            'if __name__ == "__main__":\n'
            "    main()\n"
        )
        payload = json.dumps({"source": source, "positions": {}}, ensure_ascii=False)
        completed = subprocess.run(
            [sys.executable, str(MODULE_PATH)],
            input=payload.encode("utf-8"),
            stdout=subprocess.PIPE,
            check=True,
        )
        result = json.loads(completed.stdout.decode("utf-8"))
        self.assertTrue(result["ok"], result)
        self.assertIn("Đang kiểm tra P1", result["output"][0])

    def test_main_entrypoint_is_required(self):
        result = execute(
            'from techcamp_api import TechCamp\n'
            'with TechCamp() as bot:\n'
            '    bot.move_to("P1")\n'
        )
        self.assertFalse(result["ok"])
        self.assertIn("main function", result["error"]["message"])

    def test_main_must_be_called_from_dunder_main_guard(self):
        result = execute(
            'from techcamp_api import TechCamp\n'
            'def main():\n'
            '    with TechCamp() as bot:\n'
            '        bot.move_to("P1")\n'
        )
        self.assertFalse(result["ok"])
        self.assertIn("__main__", result["error"]["message"])

    def test_named_main_function_can_use_the_sample_guard_pattern(self):
        result = execute(
            'from techcamp_api import TechCamp\n'
            'def move_cube():\n'
            '    with TechCamp() as bot:\n'
            '        bot.move_to("P1")\n'
            '\n'
            'if __name__ == "__main__":\n'
            '    move_cube()\n'
        )
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["actions"][0]["position"], "P1")


if __name__ == "__main__":
    unittest.main()
