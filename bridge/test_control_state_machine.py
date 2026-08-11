"""Phase 01 RED tests for run/command state machines.

No worker, socket, SDK, or robot adapter is involved.  These tests make
terminal states immutable and ensure a reconnect can never resume a run.
"""

from __future__ import annotations

import unittest

from bridge.control.state_machine import (  # type: ignore[import-not-found]
    CommandState,
    InvalidTransition,
    RunFSM,
    RunState,
)


class RunStateMachineTests(unittest.TestCase):
    def make_fsm(self) -> RunFSM:
        return RunFSM(
            run_id="run-01-abcdef",
            session_id="sess-01-abcdef",
            payload_hash="sha256:" + "b" * 64,
            points_revision="sha256:" + "c" * 64,
        )

    def test_legal_happy_path_reaches_completed(self) -> None:
        fsm = self.make_fsm()
        self.assertEqual(fsm.state, RunState.RECEIVED)
        fsm.transition(RunState.VALIDATED)
        fsm.transition(RunState.PENDING_APPROVAL)
        fsm.approve(payload_hash=fsm.payload_hash, points_revision=fsm.points_revision)
        self.assertEqual(fsm.state, RunState.APPROVED)
        fsm.transition(RunState.RUNNING)
        fsm.transition(RunState.COMPLETED)
        self.assertEqual(fsm.state, RunState.COMPLETED)

    def test_approval_is_bound_to_run_payload_and_calibration_revision(self) -> None:
        fsm = self.make_fsm()
        fsm.transition(RunState.VALIDATED)
        fsm.transition(RunState.PENDING_APPROVAL)
        with self.assertRaises(InvalidTransition):
            fsm.approve(payload_hash="sha256:" + "d" * 64, points_revision=fsm.points_revision)
        self.assertEqual(fsm.state, RunState.PENDING_APPROVAL)
        with self.assertRaises(InvalidTransition):
            fsm.approve(payload_hash=fsm.payload_hash, points_revision="sha256:" + "e" * 64)
        self.assertEqual(fsm.state, RunState.PENDING_APPROVAL)
        fsm.approve(payload_hash=fsm.payload_hash, points_revision=fsm.points_revision)

    def test_reject_stop_disconnect_timeout_fault_and_revision_change_are_terminal(self) -> None:
        terminal_actions = (
            "reject",
            "stop",
            "disconnect",
            "timeout",
            "fault",
            "revision_change",
        )
        for action in terminal_actions:
            with self.subTest(action=action):
                fsm = self.make_fsm()
                fsm.transition(RunState.VALIDATED)
                fsm.transition(RunState.PENDING_APPROVAL)
                if action == "reject":
                    fsm.reject("operator_rejected")
                elif action == "stop":
                    fsm.stop("operator_stop")
                elif action == "disconnect":
                    fsm.disconnect()
                elif action == "timeout":
                    fsm.timeout()
                elif action == "fault":
                    fsm.fault("controller_fault")
                else:
                    fsm.invalidate_revision()
                terminal = fsm.state
                self.assertTrue(fsm.is_terminal)
                self.assertNotEqual(terminal, RunState.RUNNING)
                with self.assertRaises(InvalidTransition):
                    fsm.transition(RunState.APPROVED)
                with self.assertRaises(InvalidTransition):
                    fsm.transition(RunState.RUNNING)

    def test_stop_has_priority_even_after_approval_and_cancels_remaining_commands(self) -> None:
        fsm = self.make_fsm()
        fsm.transition(RunState.VALIDATED)
        fsm.transition(RunState.PENDING_APPROVAL)
        fsm.approve(payload_hash=fsm.payload_hash, points_revision=fsm.points_revision)
        fsm.transition(RunState.RUNNING)
        fsm.stop("operator_stop")
        self.assertEqual(fsm.state, RunState.STOPPED)
        self.assertEqual(fsm.remaining_command_indexes([0, 1, 2], completed=(0,)), (1, 2))

    def test_revision_change_after_preview_invalidates_approval(self) -> None:
        fsm = self.make_fsm()
        fsm.transition(RunState.VALIDATED)
        fsm.transition(RunState.PENDING_APPROVAL)
        fsm.approve(payload_hash=fsm.payload_hash, points_revision=fsm.points_revision)
        fsm.invalidate_revision()
        self.assertEqual(fsm.state, RunState.FAULTED)
        self.assertTrue(fsm.is_terminal)

    def test_reconnect_cannot_resume_terminal_run(self) -> None:
        fsm = self.make_fsm()
        fsm.transition(RunState.VALIDATED)
        fsm.transition(RunState.PENDING_APPROVAL)
        fsm.disconnect()
        with self.assertRaises(InvalidTransition):
            fsm.resume(session_id="new-session")
        with self.assertRaises(InvalidTransition):
            fsm.transition(RunState.RUNNING)


class CommandStateMachineTests(unittest.TestCase):
    def test_legal_command_lifecycle(self) -> None:
        fsm = self.make_fsm()
        self.assertEqual(fsm.state, CommandState.PENDING)
        fsm.start()
        self.assertEqual(fsm.state, CommandState.RUNNING)
        fsm.complete()
        self.assertEqual(fsm.state, CommandState.COMPLETED)

    def test_command_terminal_states_cannot_resume_or_complete(self) -> None:
        for action in ("reject", "stop", "fault", "timeout"):
            with self.subTest(action=action):
                fsm = self.make_fsm()
                getattr(fsm, action)("reason")
                self.assertTrue(fsm.is_terminal)
                with self.assertRaises(InvalidTransition):
                    fsm.start()
                with self.assertRaises(InvalidTransition):
                    fsm.complete()

    @staticmethod
    def make_fsm():
        from bridge.control.state_machine import CommandFSM  # type: ignore[import-not-found]

        return CommandFSM(run_id="run-01-abcdef", command_index=0, line=8)


if __name__ == "__main__":
    unittest.main()
