"""Redacted bounded JSONL audit log."""

from __future__ import annotations

import json
from pathlib import Path


_REDACT = ("token", "source", "python", "camera", "cert", "key", "password")


def _redact(value):
    if isinstance(value, dict):
        return {key: "[redacted]" if any(part in key.lower() for part in _REDACT) else _redact(item)
                for key, item in value.items()}
    if isinstance(value, list):
        return [_redact(item) for item in value]
    return value


class AuditLog:
    def __init__(self, path, *, max_bytes=1_048_576, max_files=2):
        self.path = Path(path)
        self.max_bytes = max_bytes
        self.max_files = max_files
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def append(self, event: dict) -> None:
        line = json.dumps(_redact(event), ensure_ascii=False, separators=(",", ":")) + "\n"
        if self.path.exists() and self.path.stat().st_size + len(line.encode()) > self.max_bytes:
            rotated = self.path.with_name(self.path.stem + ".1" + self.path.suffix)
            if rotated.exists(): rotated.unlink()
            self.path.replace(rotated)
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(line)
