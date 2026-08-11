from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from bridge.control.audit import AuditLog


class AuditTests(unittest.TestCase):
    def test_redacts_secrets_source_and_camera_and_rotates(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "audit.jsonl"
            log = AuditLog(path, max_bytes=300)
            log.append({"runId": "run-1", "token": "secret", "source": "raw", "camera": "jpg", "state": "received"})
            self.assertNotIn("secret", path.read_text())
            self.assertNotIn("raw", path.read_text())
            self.assertNotIn("jpg", path.read_text())
            for i in range(20):
                log.append({"runId": str(i), "state": "x", "error": "e"})
            self.assertLessEqual(sum(p.stat().st_size for p in Path(folder).glob("audit*.jsonl")), 700)
