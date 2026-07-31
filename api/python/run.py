"""Vercel endpoint for executing the isolated FR3 student-code simulator."""

from http.server import BaseHTTPRequestHandler
import json
from pathlib import Path
import sys


# Vercel executes this file as a function. Add the project root so the same
# isolated runner used by local serve.mjs can be imported without duplication.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from python_sim_runner import execute  # noqa: E402


MAX_BODY_BYTES = 48_000


class handler(BaseHTTPRequestHandler):
    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "POST, OPTIONS")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(400, {"ok": False, "error": {"message": "Content-Length không hợp lệ."}})
            return

        if length > MAX_BODY_BYTES:
            self._json(413, {"ok": False, "error": {"message": "Code tối đa 40.000 ký tự."}})
            return

        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._json(400, {"ok": False, "error": {"message": "Yêu cầu Python không hợp lệ."}})
            return

        if not isinstance(payload, dict) or not isinstance(payload.get("source"), str):
            self._json(400, {"ok": False, "error": {"message": "Code phải là chuỗi tối đa 40.000 ký tự."}})
            return
        if len(payload["source"]) > 40_000:
            self._json(400, {"ok": False, "error": {"message": "Code tối đa 40.000 ký tự."}})
            return

        self._json(200, execute(payload))

    def do_GET(self):
        self._json(405, {"ok": False, "error": {"message": "Chỉ hỗ trợ POST."}})
