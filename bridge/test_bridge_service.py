import asyncio
import inspect
import json
import unittest

from fr3_bridge import Bridge, DEFAULT_HOST, ROBOT_MODEL


class FakeWebSocket:
    def __init__(self, incoming=("{\"MoveJ\": [1, 2, 3]}",)):
        self.incoming = iter(incoming)
        self.sent = []

    async def send(self, message):
        self.sent.append(message)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self.incoming)
        except StopIteration:
            raise StopAsyncIteration


class BridgeServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_client_messages_are_ignored_and_only_state_is_sent(self):
        bridge = Bridge("192.168.58.2", 20, mock=True)
        bridge.last_state = bridge.mock_state()
        websocket = FakeWebSocket()
        await bridge.client_handler(websocket)
        self.assertEqual(len(websocket.sent), 1)
        payload = json.loads(websocket.sent[0])
        self.assertEqual(payload["type"], "robot_state")
        self.assertNotIn("MoveJ", payload)

    async def test_mock_state_is_fr5_read_only_schema(self):
        bridge = Bridge("192.168.58.2", 20, mock=True)
        state = bridge.mock_state()
        self.assertEqual(state["robot_model"], ROBOT_MODEL)
        self.assertEqual(len(state["joints"]), 6)
        self.assertEqual(len(state["tcp"]), 6)
        self.assertIsNone(state["controller_safety"])

    async def test_transport_is_strictly_8083(self):
        with self.assertRaises(ValueError):
            Bridge("192.168.58.2", 20, transport="sdk")
        with self.assertRaises(ValueError):
            Bridge("192.168.58.2", 20, transport="auto")

    def test_bridge_defaults_to_localhost_and_has_no_write_api(self):
        self.assertEqual(DEFAULT_HOST, "127.0.0.1")
        source = inspect.getsource(__import__("fr3_bridge"))
        for forbidden in ("MoveJ", "MoveCart", "SetToolDO", "SetDO", "CloseRPC"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
