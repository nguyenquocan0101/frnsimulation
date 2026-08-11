from __future__ import annotations

import unittest

from bridge.control.installation import InstallationError, diagnostic_report, validate_config
from bridge.control.config import ALLOWED_ORIGINS


class InstallationTests(unittest.TestCase):
    def test_safe_defaults_are_loopback_disarmed_dry_run(self):
        config = {"host": "127.0.0.1", "port": 8766, "scheme": "wss", "origins": list(ALLOWED_ORIGINS), "dry_run": True, "disarmed": True}
        self.assertTrue(validate_config(config))
        self.assertEqual(diagnostic_report(config)["mode"], "dry-run")

    def test_invalid_host_plaintext_or_armed_boot_fails_closed(self):
        config = {"host": "0.0.0.0", "port": 8766, "scheme": "ws", "origins": [], "dry_run": False, "disarmed": False}
        with self.assertRaises(InstallationError): validate_config(config)

    def test_origin_configuration_must_be_the_exact_two_origin_allowlist(self):
        base = {"host": "127.0.0.1", "port": 8766, "scheme": "wss", "dry_run": True, "disarmed": True}
        for origins in ([ALLOWED_ORIGINS[0]], list(reversed(ALLOWED_ORIGINS)), [*ALLOWED_ORIGINS, "https://evil.invalid"]):
            with self.subTest(origins=origins):
                config = {**base, "origins": list(origins)}
                if tuple(origins) == ALLOWED_ORIGINS:
                    self.assertTrue(validate_config(config))
                else:
                    with self.assertRaises(InstallationError):
                        validate_config(config)
