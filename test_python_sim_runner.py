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


CANONICAL_OCCUPANCY = {
    "P1": False,
    "P2": True,
    "P3": True,
    "P4": True,
    "P5": True,
    "P6": True,
    "P7": True,
}


def execute(source, positions=None):
    payload = {"source": source}
    if positions is not None:
        payload["positions"] = positions
    return runner.execute(payload)


def program(body, function_name="main", parameters="", guard_call=None):
    indented = "\n".join(f"    {line}" if line else "" for line in body.splitlines())
    called_name = function_name if guard_call is None else guard_call
    return (
        "from techcamp_api import TechCamp\n\n"
        f"def {function_name}({parameters}):\n"
        f"{indented}\n\n"
        'if __name__ == "__main__":\n'
        f"    {called_name}()\n"
    )


def transfer(source="P2", destination="P1"):
    return (
        "with TechCamp() as bot:\n"
        f'    bot.move_to("{source}")\n'
        "    bot.move_down()\n"
        "    bot.grip()\n"
        "    bot.move_up()\n"
        f'    bot.move_to("{destination}")\n'
        "    bot.move_down()\n"
        "    bot.release()\n"
        "    bot.move_up()"
    )


class PythonSimRunnerEntrypointTests(unittest.TestCase):
    def assert_rejected_without_actions(self, result):
        self.assertFalse(result["ok"], result)
        self.assertEqual(result.get("actions", []), [])

    def test_syntax_error_reports_line_and_column_and_no_actions(self):
        result = execute("def main(:\n    pass\n")

        self.assert_rejected_without_actions(result)
        self.assertEqual(result["error"]["line"], 1)
        self.assertIsInstance(result["error"]["column"], int)

    def test_main_function_is_required_by_exact_name(self):
        result = execute(program(transfer(), function_name="move_cube"))

        self.assert_rejected_without_actions(result)
        self.assertIn("main()", result["error"]["message"])

    def test_main_must_not_require_arguments(self):
        result = execute(program("return None", parameters="bot"))

        self.assert_rejected_without_actions(result)
        self.assertIn("main()", result["error"]["message"])
        self.assertIn("arguments", result["error"]["message"])

    def test_main_must_be_called_from_dunder_main_guard(self):
        result = execute(
            "from techcamp_api import TechCamp\n"
            "def main():\n"
            "    return None\n"
        )

        self.assert_rejected_without_actions(result)
        self.assertIn("__main__", result["error"]["message"])

    def test_guard_must_call_main_not_another_function(self):
        result = execute(
            "from techcamp_api import TechCamp\n"
            "def helper():\n"
            "    return None\n"
            "def main():\n"
            "    return None\n"
            'if __name__ == "__main__":\n'
            "    helper()\n"
        )

        self.assert_rejected_without_actions(result)
        self.assertIn("main()", result["error"]["message"])

    def test_helpers_may_take_arguments_when_main_is_zero_argument(self):
        source = (
            "from techcamp_api import TechCamp\n\n"
            "def move_block(bot, source, destination):\n"
            "    bot.move_to(source)\n"
            "    bot.move_down()\n"
            "    bot.grip()\n"
            "    bot.move_up()\n"
            "    bot.move_to(destination)\n"
            "    bot.move_down()\n"
            "    bot.release()\n"
            "    bot.move_up()\n\n"
            "def main():\n"
            "    with TechCamp() as bot:\n"
            '        move_block(bot, "P2", "P1")\n\n'
            'if __name__ == "__main__":\n'
            "    main()\n"
        )

        result = execute(source)

        self.assertTrue(result["ok"], result)


class PythonSimRunnerRawTraceTests(unittest.TestCase):
    def assert_protocol_error(self, result, line=None):
        self.assertFalse(result["ok"], result)
        self.assertEqual(result.get("actions", []), [])
        self.assertIn("rawTrace", result)
        if line is not None:
            self.assertEqual(result["error"]["line"], line)

    def test_valid_transfer_returns_line_numbered_actions_and_raw_trace(self):
        result = execute(program(transfer()))

        self.assertTrue(result["ok"], result)
        self.assertEqual(
            [entry["method"] for entry in result["rawTrace"]],
            ["move_to", "move_down", "grip", "move_up", "move_to", "move_down", "release", "move_up"],
        )
        self.assertEqual(
            [entry["order"] for entry in result["rawTrace"]],
            list(range(1, 9)),
        )
        self.assertEqual(result["rawTrace"][0]["args"], ["P2"])
        self.assertEqual(result["rawTrace"][4]["args"], ["P1"])
        self.assertTrue(all(isinstance(entry["line"], int) for entry in result["rawTrace"]))
        self.assertTrue(all(isinstance(action["line"], int) for action in result["actions"]))

    def test_second_move_to_without_move_down_is_rejected_at_second_call(self):
        source = program(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P2")\n'
            '    bot.move_to("P1")'
        )

        result = execute(source)

        self.assert_protocol_error(result, line=6)
        self.assertEqual(
            [entry["method"] for entry in result["rawTrace"]],
            ["move_to", "move_to"],
        )
        self.assertEqual(result["rawTrace"][1]["args"], ["P1"])

    def test_duplicate_same_move_to_is_not_suppressed(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                '    bot.move_to("P2")\n'
                '    bot.move_to("P2")'
            )
        )

        self.assert_protocol_error(result, line=6)
        self.assertEqual(len(result["rawTrace"]), 2)
        self.assertEqual(result["rawTrace"][0]["args"], ["P2"])
        self.assertEqual(result["rawTrace"][1]["args"], ["P2"])

    def test_returning_to_the_same_point_without_travel_is_rejected(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                '    bot.move_to("P2")\n'
                "    bot.move_down()\n"
                "    bot.move_up()\n"
                '    bot.move_to("P2")'
            )
        )
        self.assert_protocol_error(result, line=8)
        self.assertIn("same", result["error"]["message"].lower())

    def test_duplicate_home_move_is_rejected(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                '    bot.move_to("HOME")\n'
                '    bot.move_to("HOMECHESS")'
            )
        )
        self.assert_protocol_error(result, line=6)

    def test_move_to_does_not_hide_missing_move_down_with_implicit_move_up(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                '    bot.move_to("P2")\n'
                "    bot.move_down()\n"
                '    bot.move_to("P1")'
            )
        )

        self.assert_protocol_error(result, line=7)
        self.assertEqual(
            [entry["method"] for entry in result["rawTrace"]],
            ["move_to", "move_down", "move_to"],
        )
        self.assertNotIn("move_up", [entry["method"] for entry in result["rawTrace"]])

    def test_repeated_grip_is_visible_and_ignored(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                '    bot.move_to("P2")\n'
                "    bot.move_down()\n"
                "    bot.grip()\n"
                "    bot.grip()"
            )
        )

        self.assertTrue(result["ok"], result)
        self.assertFalse(result["rawTrace"][-1]["success"])
        self.assertEqual(
            [entry["method"] for entry in result["rawTrace"]][-2:],
            ["grip", "grip"],
        )

    def test_repeated_release_is_visible_and_ignored(self):
        result = execute(
            program(transfer() + "\n    bot.release()")
        )

        self.assertTrue(result["ok"], result)
        self.assertFalse(result["rawTrace"][-1]["success"])
        self.assertEqual(
            [entry["method"] for entry in result["rawTrace"]][-2:],
            ["move_up", "release"],
        )

    def test_noop_move_up_is_visible_and_rejected(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                '    bot.move_to("P2")\n'
                "    bot.move_down()\n"
                "    bot.move_up()\n"
                "    bot.move_up()"
            )
        )

        self.assert_protocol_error(result, line=8)
        self.assertEqual(
            [entry["method"] for entry in result["rawTrace"]][-2:],
            ["move_up", "move_up"],
        )

    def test_repeated_move_down_is_visible_and_rejected(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                '    bot.move_to("P2")\n'
                "    bot.move_down()\n"
                "    bot.move_down()"
            )
        )

        self.assert_protocol_error(result, line=7)
        self.assertEqual(
            [entry["method"] for entry in result["rawTrace"]][-2:],
            ["move_down", "move_down"],
        )


class PythonSimRunnerFixturePreflightTests(unittest.TestCase):
    def assert_fixture_error(self, body, message_fragment, line=None):
        result = execute(program(body))
        self.assertFalse(result["ok"], result)
        self.assertEqual(result.get("actions", []), [])
        self.assertIn("rawTrace", result)
        self.assertIn(message_fragment.lower(), result["error"]["message"].lower())
        if line is not None:
            self.assertEqual(result["error"]["line"], line)
        return result

    def test_grip_without_lowering_is_a_noop(self):
        result = execute(program(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P2")\n'
            "    bot.grip()"))
        self.assertTrue(result["ok"], result)
        self.assertFalse(result["rawTrace"][-1]["success"])

    def test_grip_at_empty_p1_is_a_noop(self):
        result = execute(program(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P1")\n'
            "    bot.move_down()\n"
            "    bot.grip()"))
        self.assertTrue(result["ok"], result)
        self.assertFalse(result["rawTrace"][-1]["success"])

    def test_marker_at_p7_is_a_noop_for_students(self):
        result = execute(program(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P7")\n'
            "    bot.move_down()\n"
            "    bot.grip()"))
        self.assertTrue(result["ok"], result)
        self.assertFalse(result["rawTrace"][-1]["success"])

    def test_release_without_carrying_is_a_noop(self):
        result = execute(program(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P1")\n'
            "    bot.move_down()\n"
            "    bot.release()"))
        self.assertTrue(result["ok"], result)
        self.assertFalse(result["rawTrace"][-1]["success"])

    def test_release_into_occupied_destination_is_a_noop(self):
        result = execute(program(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P2")\n'
            "    bot.move_down()\n"
            "    bot.grip()\n"
            "    bot.move_up()\n"
            '    bot.move_to("P3")\n'
            "    bot.move_down()\n"
            "    bot.release()"))
        self.assertTrue(result["ok"], result)
        self.assertFalse(result["rawTrace"][-1]["success"])

    def test_release_into_reserved_marker_slot_is_a_noop(self):
        result = execute(program(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P2")\n'
            "    bot.move_down()\n"
            "    bot.grip()\n"
            "    bot.move_up()\n"
            '    bot.move_to("P7")\n'
            "    bot.move_down()\n"
            "    bot.release()"))
        self.assertTrue(result["ok"], result)
        self.assertFalse(result["rawTrace"][-1]["success"])

    def test_finish_while_carrying_is_allowed_for_workshop(self):
        result = execute(program(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P2")\n'
            "    bot.move_down()\n"
            "    bot.grip()\n"
            "    bot.move_up()"))
        self.assertTrue(result["ok"], result)

    def test_invalid_point_reports_attempt_line_and_no_actions(self):
        result = self.assert_fixture_error(
            "with TechCamp() as bot:\n"
            '    bot.move_to("P8")',
            "invalid position",
            line=5,
        )
        self.assertEqual(result["rawTrace"][0]["method"], "move_to")
        self.assertEqual(result["rawTrace"][0]["args"], ["P8"])

    def test_get_positions_uses_canonical_scored_fixture_not_payload(self):
        branch_program = program(
            "with TechCamp() as bot:\n"
            "    blocks = bot.get_positions()\n"
            '    if blocks == {"P1": False, "P2": True, "P3": True, "P4": True, "P5": True, "P6": True, "P7": True}:\n'
            '        source, destination = "P2", "P1"\n'
            "    else:\n"
            '        source, destination = "P6", "P7"\n'
            "    bot.move_to(source)\n"
            "    bot.move_down()\n"
            "    bot.grip()\n"
            "    bot.move_up()\n"
            "    bot.move_to(destination)\n"
            "    bot.move_down()\n"
            "    bot.release()\n"
            "    bot.move_up()"
        )
        dirty_inputs = (
            None,
            {},
            {point: False for point in CANONICAL_OCCUPANCY},
            {point: True for point in CANONICAL_OCCUPANCY},
            {"P1": True, "P2": False, "P7": False},
        )

        results = [execute(branch_program, positions) for positions in dirty_inputs]

        self.assertTrue(all(result["ok"] for result in results), results)
        expected_actions = results[0]["actions"]
        expected_trace = results[0]["rawTrace"]
        for result in results[1:]:
            self.assertEqual(result["actions"], expected_actions)
            self.assertEqual(result["rawTrace"], expected_trace)
        self.assertEqual(expected_actions[0]["position"], "P2")
        self.assertEqual(expected_actions[4]["position"], "P1")


class PythonSimRunnerCompatibilityAndSandboxTests(unittest.TestCase):
    def test_home_and_legacy_alias_emit_canonical_home(self):
        for point in ("HOME", "HOMECHESS"):
            result = execute(
                program(f'with TechCamp() as bot:\n    bot.move_to("{point}")')
            )
            self.assertTrue(result["ok"], result)
            self.assertEqual(result["actions"][0]["position"], "HOME")

    def test_loops_produce_deterministic_normalized_actions(self):
        source = program(
            "with TechCamp() as bot:\n"
            '    for source, destination in [("P2", "P1")]:\n'
            "        bot.move_to(source)\n"
            "        bot.move_down()\n"
            "        bot.grip()\n"
            "        bot.move_up()\n"
            "        bot.move_to(destination)\n"
            "        bot.move_down()\n"
            "        bot.release()\n"
            "        bot.move_up()"
        )

        first = execute(source)
        second = execute(source)

        self.assertTrue(first["ok"], first)
        self.assertEqual(first, second)

    def test_forbidden_import_is_blocked_without_actions(self):
        source = (
            "import os\n"
            "def main():\n"
            "    return None\n"
            'if __name__ == "__main__":\n'
            "    main()\n"
        )

        result = execute(source)

        self.assertFalse(result["ok"], result)
        self.assertEqual(result.get("actions", []), [])
        self.assertIn("Only use", result["error"]["message"])
        self.assertEqual(result["error"]["line"], 1)

    def test_forbidden_builtin_is_blocked_without_actions(self):
        result = execute(program('open("answer.py", "w")'))

        self.assertFalse(result["ok"], result)
        self.assertEqual(result.get("actions", []), [])
        self.assertIn("not allowed", result["error"]["message"])
        self.assertEqual(result["error"]["line"], 4)

    def test_student_cannot_access_or_clear_private_runner_state(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                '    bot.move_to("P2")\n'
                "    bot._raw_trace.clear()"
            )
        )
        self.assertFalse(result["ok"], result)
        self.assertEqual(result.get("actions", []), [])
        self.assertEqual(result["error"]["line"], 6)
        self.assertIn("private", result["error"]["message"].lower())

    def test_huge_range_is_blocked_before_allocating_memory(self):
        result = execute(program("values = list(range(1000000000))"))
        self.assertFalse(result["ok"], result)
        self.assertEqual(result.get("actions", []), [])
        self.assertIn("range", result["error"]["message"].lower())

    def test_cli_accepts_utf8_student_source_on_windows(self):
        source = program(
            "print('Đang kiểm tra P2')\n" + transfer()
        )
        payload = json.dumps({"source": source}, ensure_ascii=False)

        completed = subprocess.run(
            [sys.executable, str(MODULE_PATH)],
            input=payload.encode("utf-8"),
            stdout=subprocess.PIPE,
            check=True,
        )
        result = json.loads(completed.stdout.decode("utf-8"))

        self.assertTrue(result["ok"], result)
        self.assertIn("Đang kiểm tra P2", result["output"][0])

    def test_capture_and_detect_are_available_to_simulator_programs(self):
        result = execute(
            program(
                "with TechCamp() as bot:\n"
                "    image = bot.capture()\n"
                "    objects = bot.detect()\n"
                "    print(objects)"
            )
        )

        self.assertTrue(result["ok"], result)
        self.assertEqual(
            [entry["method"] for entry in result["rawTrace"]],
            ["capture", "detect"],
        )
        self.assertEqual(
            [action["type"] for action in result["actions"]],
            ["capture", "detect"],
        )
        self.assertIn("'P2': 'cho'", result["output"][0])


if __name__ == "__main__":
    unittest.main()
