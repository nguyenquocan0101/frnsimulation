from __future__ import annotations

import json
import unittest
from pathlib import Path


class PackagingTests(unittest.TestCase):
    def test_example_has_no_secret_and_scripts_are_scoped(self):
        example = json.loads(Path("bridge/control.example.json").read_text(encoding="utf-8"))
        self.assertTrue(example["dry_run"])
        self.assertNotIn("token", example)
        for name in ("install-control-bridge.ps1", "uninstall-control-bridge.ps1", "package-control-bridge.ps1"):
            self.assertTrue(Path("bridge/scripts", name).exists())
