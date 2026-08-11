from __future__ import annotations

import unittest

import bridge.control_bridge as cli


class CliTests(unittest.TestCase):
    def test_loopback_wss_defaults(self):
        self.assertEqual(cli.DEFAULT_HOST, "127.0.0.1")
        self.assertEqual(cli.DEFAULT_PORT, 8766)
        self.assertEqual(cli.DEFAULT_SCHEME, "wss")
        self.assertFalse(cli.PLAINTEXT_FALLBACK)
