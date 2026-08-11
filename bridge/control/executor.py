"""Serialized action execution and independent priority Stop coordination."""

from __future__ import annotations

import threading
from dataclasses import dataclass

from .robot_adapter import AdapterFault


@dataclass(frozen=True)
class ExecutionResult:
    completed: bool
    status: str
    error: str | None = None


class RunExecutor:
    def __init__(self, adapter):
        self.adapter = adapter
        self._lock = threading.Lock()
        self._stop_lock = threading.Lock()
        self._cancel = threading.Event()
        self.cancelled = False
        self.disconnected = False
        self._stop_sent = False

    def run(self, actions):
        if self.cancelled or self.disconnected:
            return ExecutionResult(False, "cancelled")
        for action in actions:
            if self.cancelled or self.disconnected:
                return ExecutionResult(False, "stopped")
            try:
                with self._lock:
                    if self.cancelled:
                        return ExecutionResult(False, "stopped")
                    action()
            except AdapterFault as exc:
                return ExecutionResult(False, exc.kind, str(exc))
            except Exception as exc:
                return ExecutionResult(False, "faulted", str(exc))
        return ExecutionResult(True, "completed")

    def stop(self, reason="operator_stop"):
        self.cancelled = True
        self._cancel.set()
        with self._stop_lock:
            if not self._stop_sent:
                self._stop_sent = True
                # Stop must not wait behind a blocking MoveJ.  The production
                # adapter owns an independent client for this call.
                self._stop_thread = threading.Thread(target=self._best_effort_stop,
                                                      name="fairino-stop", daemon=True)
                self._stop_thread.start()

    def _best_effort_stop(self):
        try:
            self.adapter.stop()
        except Exception:
            pass

    def disconnect(self):
        self.disconnected = True
        self.stop("disconnect")

    def shutdown(self):
        self.stop("shutdown")
        stop_thread = getattr(self, "_stop_thread", None)
        if stop_thread is not None:
            stop_thread.join(timeout=0.25)
        close = getattr(self.adapter, "close", None)
        if close:
            close()
