"""Narrow robot boundary used by the executor.

Only this module may know how a trusted symbolic target becomes a FAIRINO
call.  The fake adapter is deliberately network-free and is used by all CI
tests and dry runs.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any
import socket
import math

from .calibration import Point


@dataclass(frozen=True)
class AdapterLimits:
    travel_velocity: float = 40.0
    lower_velocity: float = 10.0
    max_acceleration: float = 20.0

    def __post_init__(self):
        if not (0 < self.travel_velocity <= 40 and 0 < self.lower_velocity <= 10
                and 0 < self.max_acceleration <= 20):
            raise ValueError("local motion limits exceed the safety caps")


@dataclass(frozen=True)
class SafetySnapshot:
    sdk_state: int
    emergency_stop: int
    safety_stop: tuple[int, int]
    error_code: tuple[int, int]
    motion_queue: int
    active_tool: int
    active_workpiece: int
    motion_done: int
    finite_pose: bool
    sample_age_ms: float = 0.0
    sdk_codes: tuple[int, ...] = ()

    @property
    def safe(self) -> bool:
        return (
            self.sdk_state == 0 and self.emergency_stop == 0
            and tuple(self.safety_stop) == (0, 0)
            and tuple(self.error_code) == (0, 0)
            and self.motion_queue == 0 and self.motion_done == 1
            and self.active_tool == 0 and self.active_workpiece == 0
            and self.finite_pose and self.sample_age_ms <= 500
            and bool(self.sdk_codes) and all(code == 0 for code in self.sdk_codes)
        )


class SafetyState:
    """Compatibility constructor for tests and future status providers."""
    @staticmethod
    def safe() -> SafetySnapshot:
        return SafetySnapshot(0, 0, (0, 0), (0, 0), 0, 0, 0, 1, True, 0, (0,))


class AdapterFault(RuntimeError):
    def __init__(self, message: str, *, kind: str = "faulted"):
        self.kind = kind
        super().__init__(message)


@dataclass(frozen=True)
class AdapterResult:
    ok: bool
    status: str = "completed"
    value: Any = None


class FakeRobotAdapter:
    """Deterministic adapter with no IP/socket configuration whatsoever."""
    def __init__(self, *, safety: SafetySnapshot | None = None, move_error: str | None = None,
                 block_event: threading.Event | None = None):
        self.safety = safety or SafetyState.safe()
        self.move_error = move_error
        self.move_calls: list[dict] = []
        self.do_calls: list[tuple[int, int]] = []
        self.stop_calls = 0
        self.gripper_state = "unknown"
        self.fail_do = False
        self._block_event = block_event
        self._release_event = threading.Event()

    def health(self) -> SafetySnapshot:
        return self.safety

    def _check(self) -> None:
        if not self.safety.safe:
            raise AdapterFault("robot safety predicate failed", kind="faulted")

    def move(self, target: Point, *, speed_class: str = "travel", limits: AdapterLimits | None = None) -> AdapterResult:
        if not isinstance(target, Point) or not _valid_target(target):
            raise AdapterFault("only trusted Point targets are accepted")
        if speed_class not in {"travel", "lower", "home"}:
            raise AdapterFault("unknown speed class")
        self._check()
        limits = limits or AdapterLimits()
        vel = limits.lower_velocity if speed_class == "lower" else limits.travel_velocity
        call = {"target": target.name, "joints": target.joints, "cart": target.cart,
                "tool": target.tool, "user": target.user, "vel": vel, "acc": limits.max_acceleration}
        self.move_calls.append(call)
        if self._block_event is not None:
            self._block_event.set()
            self._release_event.wait(5)
        if self.move_error:
            kind = "unknown" if self.move_error == "timeout" else "faulted"
            raise AdapterFault(self.move_error, kind=kind)
        return AdapterResult(True)

    def release_block(self) -> None:
        self._release_event.set()

    def _do(self, channel: int, value: int) -> None:
        self.do_calls.append((channel, value))
        if self.fail_do and channel != 0:
            raise AdapterFault("fake DO failure")

    def _pulse(self, direction: int, state: str) -> AdapterResult:
        # Do not even attempt cleanup when the precondition itself is unsafe:
        # every write, including DO0, is gated.
        self._check()
        primary = None
        cleanup_error = None
        try:
            self._do(1, direction)
            self._do(0, 1)
            self.gripper_state = state
            result = AdapterResult(True)
        except Exception as exc:
            primary = exc
            result = None
        finally:
            try:
                self._do(0, 0)
            except Exception as exc:
                cleanup_error = exc
        if cleanup_error is not None:
            if primary is not None:
                raise AdapterFault("gripper command failed; DO0 cleanup also failed") from primary
            raise AdapterFault("DO0 cleanup failed") from cleanup_error
        if primary is not None:
            raise primary
        return result

    def grip(self) -> AdapterResult:
        return self._pulse(0, "last_commanded_closed")

    def release(self) -> AdapterResult:
        return self._pulse(1, "last_commanded_open")

    def stop(self) -> AdapterResult:
        self.stop_calls += 1
        return AdapterResult(True, "stopped")

    def close(self) -> None:
        self.release_block()


class FairinoRobotAdapter:
    """Production wrapper; SDK import/connection happens only at factory time."""
    def __init__(self, motion_client, stop_client=None, *, limits: AdapterLimits | None = None,
                 safety_provider=None):
        if stop_client is None or stop_client is motion_client:
            raise ValueError("an independent StopMotion client is required")
        if limits is not None and type(limits) is not AdapterLimits:
            raise TypeError("adapter limits must use the locally capped AdapterLimits type")
        self.motion_client = motion_client
        self.stop_client = stop_client or motion_client
        self.limits = limits or AdapterLimits()
        self.safety_provider = safety_provider
        self.gripper_state = "unknown"

    def health(self):
        if self.safety_provider is None:
            raise AdapterFault("safety provider is required")
        snapshot = self.safety_provider()
        if not snapshot.safe:
            raise AdapterFault("robot safety predicate failed")
        return snapshot

    def move(self, target: Point, *, speed_class: str = "travel") -> AdapterResult:
        if not _valid_target(target) or target.tool != 0 or target.user != 0:
            raise AdapterFault("untrusted target metadata")
        if speed_class not in {"travel", "lower", "home"}:
            raise AdapterFault("unknown speed class")
        self.health()
        velocity = self.limits.lower_velocity if speed_class == "lower" else self.limits.travel_velocity
        try:
            code = self.motion_client.MoveJ(list(target.joints), target.tool, target.user,
                                            desc_pos=list(target.cart), vel=velocity,
                                            acc=self.limits.max_acceleration, blendT=-1)
        except (TimeoutError, socket.timeout, OSError) as exc:
            raise AdapterFault("MoveJ response timeout; motion state unknown", kind="unknown") from exc
        except Exception as exc:
            raise AdapterFault("MoveJ failed", kind="faulted") from exc
        if code not in (None, 0):
            raise AdapterFault(f"MoveJ returned {code}")
        # A fresh post-write sample is required; never infer completion from
        # the return code alone.
        self.health()
        return AdapterResult(True)

    def _set_do(self, channel: int, value: int) -> None:
        code = self.motion_client.SetToolDO(channel, value, 0, 0)
        if code not in (None, 0):
            raise AdapterFault(f"SetToolDO returned {code}")

    def _pulse(self, direction: int, state: str) -> AdapterResult:
        # Health is deliberately outside the try/finally.  An unsafe sample
        # must result in zero SDK writes, including the cleanup write.
        self.health()
        primary = None
        cleanup_error = None
        try:
            self._set_do(1, direction)
            self._set_do(0, 1)
            self.gripper_state = state
            result = AdapterResult(True)
        except Exception as exc:
            primary = exc
            result = None
        finally:
            try:
                self._set_do(0, 0)
            except Exception as exc:
                cleanup_error = exc
        if cleanup_error is not None:
            if primary is not None:
                raise AdapterFault("gripper command failed; DO0 cleanup also failed") from primary
            raise AdapterFault("DO0 cleanup failed") from cleanup_error
        if primary is not None:
            if isinstance(primary, AdapterFault):
                raise primary
            raise AdapterFault("gripper command failed") from primary
        return result

    def grip(self) -> AdapterResult:
        return self._pulse(0, "last_commanded_closed")

    def release(self) -> AdapterResult:
        return self._pulse(1, "last_commanded_open")

    def stop(self) -> AdapterResult:
        try:
            code = self.stop_client.StopMotion()
        except Exception as exc:
            raise AdapterFault("StopMotion failed", kind="faulted") from exc
        if code not in (None, 0):
            raise AdapterFault(f"StopMotion returned {code}")
        return AdapterResult(True, "stopped")

    def close(self):
        for client in {id(self.motion_client): self.motion_client, id(self.stop_client): self.stop_client}.values():
            close = getattr(client, "CloseRPC", None)
            if close:
                close()


def create_fairino_adapter(client_factory, stop_client_factory, *, ip: str,
                           safety_provider=None, limits: AdapterLimits | None = None):
    """Create two independent one-shot clients at the production boundary.

    ``client_factory`` is injected by the Windows launcher.  Keeping it out of
    module import time prevents tests and the simulator from opening a robot
    connection.  The launcher must supply a client whose MoveJ/StopMotion
    calls have bounded socket timeouts and do not internally retry motion.
    """
    if not isinstance(ip, str) or not ip or any(ch in ip for ch in "\\r\n"):
        raise ValueError("invalid robot address")
    motion = client_factory(ip)
    stopper = stop_client_factory(ip)
    if motion is stopper:
        raise ValueError("motion and StopMotion clients must be independent")
    return FairinoRobotAdapter(motion, stopper, limits=limits, safety_provider=safety_provider)


def _valid_target(target: Point) -> bool:
    try:
        return (isinstance(target, Point) and len(target.joints) == 6 and len(target.cart) == 6
                and all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
                        for v in (*target.joints, *target.cart)))
    except (TypeError, AttributeError):
        return False
