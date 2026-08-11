"""Supervised capability probe for an independent FAIRINO StopMotion client.

This file intentionally has no default robot address and never runs on import.
An operator must inject two already-configured clients and perform the probe in
a clear workcell at low speed.  CI must not execute it.
"""

from __future__ import annotations

import threading
import time


def probe(motion_client, stop_client, *, timeout: float = 2.0) -> dict:
    if motion_client is stop_client:
        raise ValueError("motion and stop clients must be independent")
    started = threading.Event()
    finished = threading.Event()
    result = {"stop_called": False, "motion_returned": False, "elapsed_ms": None}

    def motion():
        started.set()
        try:
            motion_client.MoveJ()
        finally:
            result["motion_returned"] = True
            finished.set()

    worker = threading.Thread(target=motion, daemon=True)
    worker.start()
    if not started.wait(timeout):
        return {**result, "ok": False, "reason": "motion did not start"}
    begin = time.monotonic()
    stop_error = []
    def stop():
        try:
            stop_client.StopMotion()
            result["stop_called"] = True
        except Exception as exc:
            stop_error.append(exc)
    stop_thread = threading.Thread(target=stop, daemon=True)
    stop_thread.start()
    stop_thread.join(timeout)
    result["elapsed_ms"] = round((time.monotonic() - begin) * 1000, 1)
    if stop_thread.is_alive() or stop_error:
        return {**result, "ok": False, "reason": "StopMotion did not return"}
    return {**result, "ok": result["stop_called"] and finished.wait(timeout)}
