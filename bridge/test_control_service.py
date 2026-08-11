from __future__ import annotations

import threading
import asyncio
import unittest

from bridge.control.service import ControlService, ServiceError, serve_websocket
from bridge.control.robot_adapter import FakeRobotAdapter, SafetyState


class ServiceTests(unittest.TestCase):
    def payload(self, revision):
        return {"v": 1, "runId": "run-01-abcdef", "sessionId": "sess-01-abcdef", "model": "FR5", "profile": "fr5-default", "pointsRevision": revision,
                "commands": [{"name": "move_to", "args": ["P2"], "line": 1}, {"name": "move_down", "args": [], "line": 2}, {"name": "move_up", "args": [], "line": 3}]}

    def test_submit_is_pending_and_does_not_write_before_local_approval(self):
        robot = FakeRobotAdapter(safety=SafetyState.safe())
        service = ControlService(robot, origins={"https://fairino-robot-simulator.vercel.app"})
        session = service.create_session()
        service.pair_session(session, origin="https://fairino-robot-simulator.vercel.app", token=session.token)
        revision = service.revision
        payload = self.payload(revision)
        payload["sessionId"] = session.session_id
        run = service.submit(payload, origin="https://fairino-robot-simulator.vercel.app")
        self.assertEqual(run.state, "pending_approval")
        self.assertEqual(robot.move_calls, [])
        service.approve(run.run_id)
        self.assertEqual(len(robot.move_calls), 3)
        self.assertTrue(all(call["tool"] == 0 and call["user"] == 0 for call in robot.move_calls))

    def test_replayed_and_second_active_batch_are_rejected(self):
        robot = FakeRobotAdapter(safety=SafetyState.safe())
        service = ControlService(robot, origins={"https://fairino-robot-simulator.vercel.app"})
        session = service.create_session()
        service.pair_session(session, origin="https://fairino-robot-simulator.vercel.app", token=session.token)
        p = self.payload(service.revision)
        p["sessionId"] = session.session_id
        service.submit(p, origin="https://fairino-robot-simulator.vercel.app")
        with self.assertRaises(ServiceError): service.submit(p, origin="https://fairino-robot-simulator.vercel.app")
        p["runId"] = "run-02-abcdef"
        with self.assertRaises(ServiceError): service.submit(p, origin="https://fairino-robot-simulator.vercel.app")

    def test_unpaired_or_wrong_session_cannot_submit_and_pending_stop_cancels(self):
        robot = FakeRobotAdapter(safety=SafetyState.safe())
        service = ControlService(robot, origins={"https://fairino-robot-simulator.vercel.app"})
        session = service.create_session()
        p = self.payload(service.revision)
        p["sessionId"] = session.session_id
        with self.assertRaises(ServiceError):
            service.submit(p, origin="https://fairino-robot-simulator.vercel.app")
        service.pair_session(session, origin="https://fairino-robot-simulator.vercel.app", token=session.token)
        run = service.submit(p, origin="https://fairino-robot-simulator.vercel.app")
        service.stop()
        self.assertEqual(run.state, "stopped")
        self.assertEqual(robot.move_calls, [])

    def test_stop_wins_over_a_blocked_approved_action(self):
        block_event = threading.Event()
        robot = FakeRobotAdapter(safety=SafetyState.safe(), block_event=block_event)
        service = ControlService(robot, origins={"https://fairino-robot-simulator.vercel.app"})
        session = service.create_session()
        service.pair_session(session, origin="https://fairino-robot-simulator.vercel.app", token=session.token)
        payload = self.payload(service.revision)
        payload["sessionId"] = session.session_id
        run = service.submit(payload, origin="https://fairino-robot-simulator.vercel.app")
        worker = threading.Thread(target=lambda: service.approve(run.run_id))
        worker.start()
        self.assertTrue(block_event.wait(1))
        service.stop()
        robot.release_block()
        worker.join(2)
        self.assertEqual(run.state, "stopped")
        self.assertEqual(run.fsm.state.value, "stopped")

    def test_reject_is_terminal_and_emits_versioned_event(self):
        robot = FakeRobotAdapter(safety=SafetyState.safe())
        service = ControlService(robot, origins={"https://fairino-robot-simulator.vercel.app"})
        session = service.create_session()
        service.pair_session(session, origin="https://fairino-robot-simulator.vercel.app", token=session.token)
        payload = self.payload(service.revision)
        payload["sessionId"] = session.session_id
        run = service.submit(payload, origin="https://fairino-robot-simulator.vercel.app")
        service.reject(run.run_id)
        self.assertEqual(run.state, "rejected")
        self.assertEqual(robot.move_calls, [])
        self.assertIn("rejected", [event["type"] for event in service.events])
        self.assertTrue(all(event["v"] == 1 for event in service.events))

    def test_plaintext_transport_is_rejected(self):
        robot = FakeRobotAdapter(safety=SafetyState.safe())
        service = ControlService(robot, origins={"https://fairino-robot-simulator.vercel.app"})
        with self.assertRaises(ValueError):
            asyncio.run(serve_websocket(service, None))
