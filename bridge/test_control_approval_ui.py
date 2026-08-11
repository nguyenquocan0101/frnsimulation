from __future__ import annotations

import unittest

from bridge.control.approval_ui import build_preview


class ApprovalViewTests(unittest.TestCase):
    def test_preview_contains_lines_and_no_source_or_token(self):
        preview = build_preview({"runId": "run-1", "commands": (type("C", (), {"line": 8})(),), "points_revision": "sha256:" + "a" * 64}, paired=True)
        self.assertEqual(preview["runId"], "run-1")
        self.assertEqual(preview["sourceLines"], [8])
        self.assertNotIn("source", preview)
        self.assertNotIn("token", preview)
