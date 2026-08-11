"""Pure state model for the nearby operator approval window."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class UIModel:
    state: str = "DISARMED"
    calibration_valid: bool = False
    revision: str | None = None
    calibrated_points: tuple[str, ...] = ()
    paired: bool = False
    healthy: bool = False
    pending: dict | None = None
    robot_calls: int = 0
    stop_requests: int = 0
    closed: bool = False
    message: str = "Ready. Robot is disarmed."

    @property
    def can_approve(self):
        return (self.state == "PENDING_APPROVAL" and self.calibration_valid
                and self.paired and self.healthy and self.pending is not None
                and self.pending.get("revision") == self.revision)

    @property
    def can_stop(self): return not self.closed

    def set_calibration(self, valid, revision, points=()):
        self.calibration_valid, self.revision = bool(valid), revision
        self.calibrated_points = tuple(points)
        if not valid: self.message = "Calibration is invalid; approval is disabled."

    def set_pairing(self, paired): self.paired = bool(paired)
    def set_health(self, healthy): self.healthy = bool(healthy)

    def set_pending(self, pending):
        self.pending = dict(pending)
        self.state = "PENDING_APPROVAL"
        self.message = "Review the batch before approving."

    def approve(self):
        if not self.can_approve: raise RuntimeError("approval prerequisites are not met")
        self.state = "RUNNING"
        self.message = "Approved locally; running."
        self.robot_calls += 1

    def reject(self):
        self.pending = None
        self.state = "DISARMED"
        self.message = "Batch rejected."

    def stop(self):
        self.stop_requests += 1
        self.state = "STOPPED"
        self.message = "Software stop requested. Physical E-stop remains available."

    def close(self):
        self.closed = True
        self.state = "STOPPED" if self.state == "RUNNING" else self.state
