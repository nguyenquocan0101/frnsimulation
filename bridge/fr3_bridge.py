"""Read-only FAIRINO FR3 state bridge.

The bridge connects to the robot with the FAIRINO Python SDK and exposes only
telemetry over a local WebSocket. It intentionally has no motion command API.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import json
import logging
import math
import struct
import sys
import time
from pathlib import Path
from typing import Any

import websockets


LOG = logging.getLogger("fr3-bridge")
DEFAULT_ROBOT_IP = "192.168.58.2"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def configure_console() -> None:
    """Prevent SDK's non-ASCII diagnostic prints from breaking Windows runs."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure:
            reconfigure(encoding="utf-8", errors="replace")


def _sdk_paths() -> tuple[Path, Path]:
    vendor = Path(__file__).resolve().parent / "vendor" / "fairino-python-sdk-main" / "windows"
    package_root = vendor / "fairino"
    binary_root = package_root / "build" / "lib.win-amd64-cpython-311"
    return package_root, binary_root


def load_sdk(sdk_root: Path | None = None):
    package_root, binary_root = _sdk_paths()
    if sdk_root:
        package_root = sdk_root / "windows" / "fairino"
        binary_root = package_root / "build" / "lib.win-amd64-cpython-311"

    for path in (package_root.parent, binary_root):
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))

    try:
        return importlib.import_module("fairino.Robot")
    except ImportError as exc:
        raise RuntimeError(
            "Không nạp được FAIRINO Python SDK. "
            f"Đã tìm package tại {package_root} và binary tại {binary_root}."
        ) from exc


def scalar(value: Any, default: float = 0.0) -> float:
    """Convert ctypes/numeric values to finite JSON numbers."""
    raw = getattr(value, "value", value)
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def vector(value: Any, size: int = 6) -> list[float]:
    if value is None:
        return [0.0] * size
    return [scalar(value[index]) for index in range(min(size, len(value)))] + [0.0] * max(0, size - len(value))


def integer(value: Any) -> int | None:
    if value is None:
        return None
    raw = getattr(value, "value", value)
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def read_state(robot: Any) -> dict[str, Any]:
    """Read only the SDK's continuously updated state package."""
    package = getattr(robot, "robot_state_pkg", None)
    if package is None:
        raise RuntimeError("SDK chưa có robot_state_pkg")

    return {
        "type": "robot_state",
        "timestamp": time.time(),
        "connected": True,
        "joints": vector(getattr(package, "jt_cur_pos", None)),
        "tcp": vector(getattr(package, "tl_cur_pos", None)),
        "robot_state": integer(getattr(package, "robot_state", None)),
        "robot_mode": integer(getattr(package, "robot_mode", None)),
        "program_state": integer(getattr(package, "program_state", None)),
        "main_code": integer(getattr(package, "main_code", None)),
        "sub_code": integer(getattr(package, "sub_code", None)),
        "controller_safety": {
            "safety_plane_alarm": integer(getattr(package, "safetyPlaneAlarm", None)),
            "interference_alarm": integer(getattr(package, "interfaceAlarm", None)),
            "collision_state": integer(getattr(package, "collisionState", None)),
            "emergency_stop": integer(getattr(package, "EmergencyStop", None)),
            "safety_stop0": integer(getattr(package, "safety_stop0_state", None)),
            "safety_stop1": integer(getattr(package, "safety_stop1_state", None)),
        },
    }


class Status8083:
    """FAIRINO controller TCP/8083 status feedback parser.

    The documented frame is: uint16 header, uint8 count, uint16 payload
    length, payload, uint16 sum. The first payload fields are three uint8
    values followed by six joint and six TCP doubles.
    """

    def __init__(self, host: str):
        self.host = host
        self.reader: asyncio.StreamReader | None = None
        self.writer: asyncio.StreamWriter | None = None

    async def connect(self) -> None:
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

    async def read_state(self) -> dict[str, Any]:
        if self.reader is None:
            raise RuntimeError("8083 telemetry chưa kết nối")

        while True:
            first = await self.reader.readexactly(1)
            if first != b"\x5a":
                continue
            rest = await self.reader.readexactly(4)
            header = first + rest
            magic, count, length = struct.unpack("<HBH", header)
            if magic != 0x5A5A or length < 99 or length > 4096:
                continue
            payload = await self.reader.readexactly(length)
            checksum = struct.unpack("<H", await self.reader.readexactly(2))[0]
            if (sum(header + payload) & 0xFFFF) != checksum:
                LOG.warning("Bỏ qua frame 8083 sai checksum (count=%d)", count)
                continue
            program_state, error_code, robot_mode, *values = struct.unpack_from("<BBB12d", payload)
            return {
                "type": "robot_state",
                "timestamp": time.time(),
                "connected": True,
                "transport": "8083",
                "joints": values[:6],
                "tcp": values[6:12],
                "robot_state": error_code,
                "robot_mode": robot_mode,
                "program_state": program_state,
                "main_code": None,
                "sub_code": None,
                "controller_safety": None,
            }


class Bridge:
    def __init__(self, robot_ip: str, poll_hz: float, sdk_root: Path | None = None, mock: bool = False, transport: str = "8083"):
        self.robot_ip = robot_ip
        self.poll_interval = 1.0 / max(1.0, poll_hz)
        self.sdk_root = sdk_root
        self.mock = mock
        self.transport = transport
        self.clients: set[Any] = set()
        self.robot: Any = None
        self.sdk: Any = None
        self.status8083: Status8083 | None = None
        self.last_state: dict[str, Any] | None = None
        self.stop_event = asyncio.Event()

    async def connect_robot(self) -> None:
        if self.mock:
            LOG.info("Mock mode: không kết nối robot thật")
            return
        if self.transport in {"8083", "auto"}:
            try:
                self.status8083 = Status8083(self.robot_ip)
                await self.status8083.connect()
                return
            except Exception:
                await self.close_connections()
                if self.transport == "8083":
                    raise
                LOG.info("8083 không khả dụng; thử FAIRINO SDK/CNDE")
        sdk = load_sdk(self.sdk_root)
        self.sdk = sdk
        LOG.info("Đang mở FAIRINO RPC read-only tới %s", self.robot_ip)
        self.robot = await asyncio.to_thread(sdk.RPC, self.robot_ip)
        if not getattr(sdk.RPC, "is_connect", True):
            await self.close_robot()
            raise RuntimeError(
                "FAIRINO SDK chưa kết nối hoàn chỉnh: kênh realtime CNDE không hoạt động "
                "(thường là controller không mở/cùng phiên bản không hỗ trợ TCP 20005). "
                "HTTP Web App mở được không đồng nghĩa SDK telemetry đã sẵn sàng."
            )
        LOG.info("Đã mở SDK connection; chỉ đọc telemetry")

    async def close_robot(self) -> None:
        robot, self.robot = self.robot, None
        if robot is not None and hasattr(robot, "CloseRPC"):
            try:
                await asyncio.to_thread(robot.CloseRPC)
            except Exception:
                LOG.exception("Lỗi khi đóng SDK connection")

    async def close_connections(self) -> None:
        if self.status8083 is not None:
            await self.status8083.close()
            self.status8083 = None
        await self.close_robot()

    def mock_state(self) -> dict[str, Any]:
        phase = time.monotonic()
        joints = [0.0, -35.0 + math.sin(phase) * 5.0, 65.0 + math.cos(phase) * 5.0, 0.0, 25.0, 0.0]
        return {
            "type": "robot_state",
            "timestamp": time.time(),
            "connected": True,
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
                if self.robot is None and self.status8083 is None and not self.mock:
                    await self.connect_robot()
                if self.mock:
                    state = self.mock_state()
                elif self.status8083 is not None:
                    state = await self.status8083.read_state()
                else:
                    state = read_state(self.robot)
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
    parser = argparse.ArgumentParser(description="FAIRINO FR3 read-only telemetry bridge")
    parser.add_argument("--robot-ip", default=DEFAULT_ROBOT_IP, help="FAIRINO controller IP")
    parser.add_argument("--host", default=DEFAULT_HOST, help="WebSocket listen address")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="WebSocket listen port")
    parser.add_argument("--poll-hz", type=float, default=20.0, help="Telemetry broadcast frequency")
    parser.add_argument("--sdk-root", type=Path, help="SDK root containing windows/fairino")
    parser.add_argument("--transport", choices=("8083", "sdk", "auto"), default="8083", help="Telemetry transport")
    parser.add_argument("--mock", action="store_true", help="Generate fake telemetry without a robot")
    return parser.parse_args()


async def main() -> None:
    configure_console()
    args = parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    bridge = Bridge(args.robot_ip, args.poll_hz, args.sdk_root, args.mock, args.transport)
    try:
        await bridge.run(args.host, args.port)
    except KeyboardInterrupt:
        bridge.stop_event.set()


if __name__ == "__main__":
    asyncio.run(main())
