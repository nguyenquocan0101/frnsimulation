"""Small localhost-only WSS contract helpers for Phase 00.

This module intentionally contains no FAIRINO or TechCamp imports. The
production control service will use a separate implementation after this
compatibility spike is accepted.
"""

from __future__ import annotations

import ipaddress
import asyncio
import json
import ssl
from pathlib import Path
from typing import Iterable

DEFAULT_SCHEME = "wss"
DEFAULT_PORT = 8766
PLAINTEXT_FALLBACK = False


def validate_bind_host(host: str) -> bool:
    value = str(host).strip().lower()
    if value == "localhost":
        return True
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValueError("probe must bind to loopback only") from exc
    if not address.is_loopback:
        raise ValueError("probe must bind to loopback only")
    return True


def create_server_ssl_context(cert_file: str, key_file: str, *, hostname: str = "localhost") -> ssl.SSLContext:
    if hostname != "localhost":
        raise ValueError("probe certificate hostname must be localhost")
    cert = Path(cert_file)
    key = Path(key_file)
    if not cert.is_file() or not key.is_file():
        raise FileNotFoundError("localhost certificate and private key are required")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(certfile=str(cert), keyfile=str(key))
    return context


def validate_origin(origin: str | None, allowed_origins: set[str]) -> bool:
    return bool(origin and origin in allowed_origins)


def validate_session(received: str | None, expected: str, *, expires_at: float, now: float) -> bool:
    return bool(received and received == expected and now < expires_at)


def health_message() -> dict[str, str]:
    return {"type": "health_probe", "version": "wss-probe-v1", "status": "ok"}


async def serve_probe(
    cert_file: str,
    key_file: str,
    expected_token: str,
    *,
    host: str = "127.0.0.1",
    port: int = DEFAULT_PORT,
    allowed_origins: Iterable[str] = ("https://fairino-robot-simulator.vercel.app",),
):
    """Run the disposable WSS health probe until the caller closes the server."""
    validate_bind_host(host)
    if port != DEFAULT_PORT:
        raise ValueError("probe port must remain 8766")
    context = create_server_ssl_context(cert_file, key_file)
    allowed = set(allowed_origins)

    async def handler(websocket):
        origin = websocket.request.headers.get("Origin")
        if not validate_origin(origin, allowed):
            await websocket.close(code=1008, reason="origin denied")
            return
        try:
            raw = await asyncio.wait_for(websocket.recv(), timeout=5)
            message = json.loads(raw)
        except Exception:
            await websocket.close(code=1008, reason="invalid pairing")
            return
        if not isinstance(message, dict) or message.get("type") != "pair":
            await websocket.close(code=1008, reason="pairing required")
            return
        if not validate_session(message.get("token"), expected_token, expires_at=float("inf"), now=0.0):
            await websocket.close(code=1008, reason="token denied")
            return
        await websocket.send(json.dumps(health_message()))

    # websockets is a probe-only dependency, intentionally not imported at
    # module load so contract tests stay stdlib-only.
    import websockets

    return await websockets.serve(
        handler,
        host,
        port,
        ssl=context,
        origins=None,
        max_size=64 * 1024,
    )
