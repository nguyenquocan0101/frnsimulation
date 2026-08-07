"""Read-only FAIRINO FR5 telemetry bridge over controller TCP/8083.

The bridge never imports the movement API or the FAIRINO SDK. It exposes only
validated telemetry over a local WebSocket and intentionally has no command API.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import math
import struct
import sys
import time
from typing import Any

import websockets


LOG = logging.getLogger("fr3-bridge")
DEFAULT_ROBOT_IP = "192.168.58.2"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
FRAME_MAGIC = 0x5A5A
FRAME_HEADER_SIZE = 5
FRAME_CHECKSUM_SIZE = 2
MIN_PAYLOAD_SIZE = 99
MAX_PAYLOAD_SIZE = 4096
ROBOT_MODEL = "FR5"
READ_TIMEOUT_SECONDS = 2.0


def configure_console() -> None:
    """Prevent non-ASCII telemetry diagnostics from breaking Windows runs."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def parse_status_frame(frame: bytes) -> dict[str, Any]:
    """Parse one captured FAIRINO 8083 frame into the browser contract.

    The payload layout is verified against the reachable FR5 controller
    stream and cross-checked with GetActualJointPosDegree/GetActualTCPPose:
    program_state B @ 0, robot_state B @ 1, status B @ 2, joints 6d @ 3,
    TCP 6d @ 51. Error/safety fields are not exposed by this stream.
    """
    if not isinstance(frame, (bytes, bytearray, memoryview)):
        raise ValueError("8083 frame must be bytes")
    raw = bytes(frame)
    if len(raw) < FRAME_HEADER_SIZE + FRAME_CHECKSUM_SIZE:
        raise ValueError("8083 frame is truncated")
    magic, count, payload_len = struct.unpack_from("<HBH", raw, 0)
    if magic != FRAME_MAGIC:
        raise ValueError("invalid 8083 frame magic")
    if payload_len < MIN_PAYLOAD_SIZE or payload_len > MAX_PAYLOAD_SIZE:
        raise ValueError(f"invalid 8083 payload length: {payload_len}")
    expected_size = FRAME_HEADER_SIZE + payload_len + FRAME_CHECKSUM_SIZE
    if len(raw) != expected_size:
        raise ValueError("8083 frame length does not match payload length")
    payload = raw[FRAME_HEADER_SIZE:FRAME_HEADER_SIZE + payload_len]
    checksum = struct.unpack_from("<H", raw, FRAME_HEADER_SIZE + payload_len)[0]
    if (sum(raw[:FRAME_HEADER_SIZE] + payload) & 0xFFFF) != checksum:
        raise ValueError("8083 checksum mismatch")

    program_state = payload[0]
    robot_state = payload[1]
    robot_mode = payload[2]
    joints = list(struct.unpack_from("<6d", payload, 3))
    tcp = list(struct.unpack_from("<6d", payload, 51))
    values = joints + tcp
    if not all(math.isfinite(value) for value in values):
        raise ValueError("8083 frame contains non-finite telemetry")
    return {
        "type": "robot_state",
        "robot_model": ROBOT_MODEL,
        "timestamp": time.time(),
        "connected": True,
        "transport": "8083",
        "frame_count": count,
        "joints": joints,
        "tcp": tcp,
        "robot_state": robot_state,
        "robot_mode": robot_mode,
        "program_state": program_state,
        "main_code": None,
        "sub_code": None,
        "controller_safety": None,
    }


class Status8083Parser:
    """Bounded stream parser that recovers after garbage or bad frames."""

    def __init__(self, max_buffer: int = MAX_PAYLOAD_SIZE * 4):
        self.buffer = bytearray()
        self.max_buffer = max_buffer

    def feed(self, data: bytes) -> list[dict[str, Any]]:
        if data:
            self.buffer.extend(data)
        if len(self.buffer) > self.max_buffer:
            del self.buffer[:-FRAME_HEADER_SIZE]
        states: list[dict[str, Any]] = []
        while True:
            marker = self.buffer.find(b"\x5a\x5a")
            if marker < 0:
                if self.buffer:
                    del self.buffer[:-1]
                break
            if marker:
                del self.buffer[:marker]
            if len(self.buffer) < FRAME_HEADER_SIZE:
                break
            _, _, payload_len = struct.unpack_from("<HBH", self.buffer, 0)
            if payload_len < MIN_PAYLOAD_SIZE or payload_len > MAX_PAYLOAD_SIZE:
                del self.buffer[0]
                continue
            total = FRAME_HEADER_SIZE + payload_len + FRAME_CHECKSUM_SIZE
            if len(self.buffer) < total:
                break
            frame = bytes(self.buffer[:total])
            del self.buffer[:total]
            try:
                states.append(parse_status_frame(frame))
            except ValueError as error:
                LOG.warning("Bỏ qua frame 8083 không hợp lệ: %s", error)
        return states


class Status8083:
    """FAIRINO controller TCP/8083 read-only status transport."""

    def __init__(self, host: str):
        self.host = host
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None
        self.parser = Status8083Parser()
        self.pending_states: list[dict[str, Any]] = []

    async def connect(self) -> None:
        self.parser = Status8083Parser()
        self.pending_states.clear()
        self.reader, self.writer = await asyncio.open_connection(self.host, 8083)
        LOG.info("Đã mở cổng telemetry FAIRINO 8083 read-only tới %s", self.host)

    async def close(self) -> None:
        if self.writer is not None:
            self.writer.close()
            try:
                await self.writer.wait_closed()
            except Exception:
                pass
        self.reader = None
        self.writer = None
        self.parser = Status8083Parser()
        self.pending_states.clear()

    async def read_state(self) -> dict[str, Any]:
        if self.reader is None:
            raise RuntimeError("8083 telemetry chưa kết nối")
        if self.pending_states:
            return self.pending_states.pop(0)
        while True:
            chunk = await asyncio.wait_for(
                self.reader.read(4096), timeout=READ_TIMEOUT_SECONDS
            )
            if not chunk:
                raise ConnectionError("8083 telemetry connection closed")
            states = self.parser.feed(chunk)
            if states:
                self.pending_states.extend(states[1:])
                return states[0]


class Bridge:
    def __init__(self, robot_ip: str, poll_hz: float, mock: bool = False, transport: str = "8083"):
        if transport != "8083":
            raise ValueError("Strict live bridge supports only read-only TCP/8083")
        self.robot_ip = robot_ip
        self.poll_interval = 1.0 / max(1.0, poll_hz)
        self.mock = mock
        self.clients: set[Any] = set()
        self.status8083: Status8083 | None = None
        self.last_state: dict[str, Any] | None = None
        self.stop_event = asyncio.Event()

    async def connect_robot(self) -> None:
        if self.mock:
            LOG.info("Mock mode: không kết nối robot thật")
            return
        self.status8083 = Status8083(self.robot_ip)
        await self.status8083.connect()

    async def close_connections(self) -> None:
        if self.status8083 is not None:
            await self.status8083.close()
            self.status8083 = None

    def mock_state(self) -> dict[str, Any]:
        phase = time.monotonic()
        joints = [0.0, -35.0 + math.sin(phase) * 5.0, 65.0 + math.cos(phase) * 5.0, 0.0, 25.0, 0.0]
        self.mock_count = getattr(self, "mock_count", 0) + 1
        return {
            "type": "robot_state",
            "robot_model": ROBOT_MODEL,
            "timestamp": time.time(),
            "connected": True,
            "transport": "mock",
            "frame_count": self.mock_count,
            "joints": joints,
            "tcp": [0.0] * 6,
            "robot_state": 0,
            "robot_mode": 0,
            "program_state": 0,
            "main_code": 0,
            "sub_code": 0,
            "controller_safety": None,
        }

    async def broadcast(self, payload: dict[str, Any]) -> None:
        message = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        if not self.clients:
            return
        results = await asyncio.gather(*(client.send(message) for client in self.clients), return_exceptions=True)
        stale = {client for client, result in zip(self.clients, results) if isinstance(result, Exception)}
        for client in stale:
            self.clients.discard(client)

    async def telemetry_loop(self) -> None:
        backoff = 1.0
        while not self.stop_event.is_set():
            try:
                if self.status8083 is None and not self.mock:
                    await self.connect_robot()
                if self.mock:
                    state = self.mock_state()
                elif self.status8083 is not None:
                    state = await self.status8083.read_state()
                else:
                    raise RuntimeError("8083 telemetry is not connected")
                self.last_state = state
                await self.broadcast(state)
                backoff = 1.0
                if self.status8083 is None:
                    await asyncio.sleep(self.poll_interval)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                LOG.warning("Mất telemetry: %s", exc)
                self.last_state = None
                await self.broadcast({"type": "error", "connected": False, "message": str(exc)})
                await self.close_connections()
                try:
                    await asyncio.wait_for(self.stop_event.wait(), timeout=backoff)
                except asyncio.TimeoutError:
                    backoff = min(backoff * 2.0, 10.0)

    async def client_handler(self, websocket: Any) -> None:
        self.clients.add(websocket)
        LOG.info("Web client connected (%d clients)", len(self.clients))
        try:
            await websocket.send(json.dumps(self.last_state or {"type": "status", "connected": False}))
            async for message in websocket:
                # Deliberately ignore all client messages. This bridge is telemetry-only.
                LOG.debug("Ignoring client message (%d bytes); bridge is read-only", len(message))
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            LOG.info("Web client disconnected (%d clients)", len(self.clients))

    async def run(self, host: str, port: int) -> None:
        telemetry = asyncio.create_task(self.telemetry_loop())
        try:
            async with websockets.serve(self.client_handler, host, port):
                LOG.info("WebSocket telemetry listening on ws://%s:%d", host, port)
                await self.stop_event.wait()
        finally:
            telemetry.cancel()
            await asyncio.gather(telemetry, return_exceptions=True)
            await self.close_connections()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="FAIRINO FR5 read-only telemetry bridge")
    parser.add_argument("--robot-ip", default=DEFAULT_ROBOT_IP, help="FAIRINO controller IP")
    parser.add_argument("--host", default=DEFAULT_HOST, help="WebSocket listen address")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="WebSocket listen port")
    parser.add_argument("--poll-hz", type=float, default=20.0, help="Telemetry broadcast frequency")
    parser.add_argument("--transport", choices=("8083",), default="8083", help="Read-only telemetry transport")
    parser.add_argument("--mock", action="store_true", help="Generate fake telemetry without a robot")
    return parser.parse_args()


async def main() -> None:
    configure_console()
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    bridge = Bridge(args.robot_ip, args.poll_hz, args.mock, args.transport)
    try:
        await bridge.run(args.host, args.port)
    except KeyboardInterrupt:
        bridge.stop_event.set()


if __name__ == "__main__":
    asyncio.run(main())
