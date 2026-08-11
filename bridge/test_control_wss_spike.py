"""Phase 00 red tests for the localhost WSS compatibility spike.

These tests deliberately describe the probe contract before the disposable
probe exists.  They must not import the FAIRINO SDK or contact the robot.
"""

from __future__ import annotations

import ast
import importlib
import ssl
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROBE_MODULE_NAME = "bridge.spikes.wss_probe_server"


class WssProbeServerContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = importlib.import_module(PROBE_MODULE_NAME)

    def test_probe_has_no_robot_or_sdk_imports(self) -> None:
        source_path = ROOT / "bridge" / "spikes" / "wss_probe_server.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        imported = {
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        }
        imported.update(
            alias.name.split(".")[0]
            for node in ast.walk(tree)
            if isinstance(node, ast.ImportFrom)
            for alias in node.names
        )
        self.assertNotIn("fairino", imported)
        self.assertNotIn("techcamp_api", imported)
        self.assertNotIn("Robot", imported)

    def test_listen_host_is_loopback_only(self) -> None:
        validate_bind_host = self.module.validate_bind_host
        self.assertTrue(validate_bind_host("127.0.0.1"))
        self.assertTrue(validate_bind_host("localhost"))
        for host in ("0.0.0.0", "192.168.58.2", "::"):
            with self.assertRaises(ValueError):
                validate_bind_host(host)

    def test_tls_context_requires_localhost_server_certificate(self) -> None:
        context = self.module.create_server_ssl_context
        with self.assertRaises((FileNotFoundError, ValueError, ssl.SSLError)):
            context("missing-cert.pem", "missing-key.pem", hostname="localhost")

    def test_origin_and_session_authentication_fail_closed(self) -> None:
        validate_origin = self.module.validate_origin
        validate_session = self.module.validate_session
        allowed = {"https://fairino-robot-simulator.vercel.app"}

        self.assertTrue(validate_origin("https://fairino-robot-simulator.vercel.app", allowed))
        for origin in (None, "", "https://evil.example", "http://fairino-robot-simulator.vercel.app"):
            self.assertFalse(validate_origin(origin, allowed))

        self.assertTrue(validate_session("token-123", "token-123", expires_at=10.0, now=9.0))
        self.assertFalse(validate_session("wrong", "token-123", expires_at=10.0, now=9.0))
        self.assertFalse(validate_session("token-123", "token-123", expires_at=10.0, now=10.0))
        self.assertFalse(validate_session(None, "token-123", expires_at=10.0, now=9.0))

    def test_plaintext_fallback_is_not_supported(self) -> None:
        self.assertFalse(self.module.PLAINTEXT_FALLBACK)
        self.assertEqual(self.module.DEFAULT_SCHEME, "wss")
        self.assertEqual(self.module.DEFAULT_PORT, 8766)


class WssProbePageContractTests(unittest.TestCase):
    def test_temporary_probe_page_uses_only_localhost_wss(self) -> None:
        page = ROOT / "wss-probe.html"
        client = ROOT / "wss-probe.mjs"
        self.assertTrue(page.is_file(), "temporary production probe page is missing")
        self.assertTrue(client.is_file(), "temporary production probe client is missing")
        source = client.read_text(encoding="utf-8")
        self.assertIn("wss://localhost:8766", source)
        self.assertNotIn("ws://", source)
        self.assertNotIn("192.168.58.2", source)
        self.assertNotIn("?token=", source)
        self.assertIn('type: "health_probe"', source)


if __name__ == "__main__":
    unittest.main()
