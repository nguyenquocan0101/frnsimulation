"""In-process control service; the WSS transport is a thin future wrapper."""

from __future__ import annotations

import hashlib
import time
import json
import threading
from collections import deque
from dataclasses import dataclass

from .audit import AuditLog
from .executor import RunExecutor
from .protocol import parse_batch, validate_sequence
from .robot_adapter import AdapterFault
from .calibration import Point, preflight_points, resolve_command_target
from .session import SessionManager
from .state_machine import RunFSM, RunState
from .config import validate_runtime_origins


class ServiceError(RuntimeError):
    pass


@dataclass
class ServiceRun:
    run_id: str
    payload_hash: str
    points_revision: str
    commands: tuple
    state: str = "pending_approval"
    executor: RunExecutor | None = None
    error: str | None = None
    fsm: RunFSM | None = None
    approval_claimed: bool = False


class ControlService:
    def __init__(self, adapter, *, origins, calibration=None, audit=None, clock=None):
        self.adapter = adapter
        self.origins = validate_runtime_origins(origins)
        self.calibration = calibration
        self.audit = audit
        self.clock = clock or time.time
        self.revision = calibration.revision if calibration else "sha256:" + "0" * 64
        self._seen = set()
        self._active: ServiceRun | None = None
        self.sessions = SessionManager(self.origins)
        self._paired_session = None
        self.events = deque(maxlen=1000)
        self._subscribers = set()
        self._lifecycle_lock = threading.RLock()

    def _check_origin(self, origin):
        if origin not in self.origins:
            raise ServiceError("origin_not_allowed")

    def create_session(self):
        return self.sessions.create()

    def pair_session(self, session, *, origin, token):
        try:
            self.sessions.pair(session, origin, {"type": "pair", "token": token})
        except Exception as exc:
            raise ServiceError(str(exc)) from exc
        self._paired_session = session
        self._emit("connected", sessionId=session.session_id)

    def subscribe(self, callback):
        """Register a bounded transport callback for versioned status events."""
        self._subscribers.add(callback)
        return lambda: self._subscribers.discard(callback)

    def submit(self, raw, *, origin, session=None):
        self._check_origin(origin)
        try:
            batch = parse_batch(raw, seen_run_ids=self._seen)
            validate_sequence(batch.commands)
        except Exception as exc:
            raise ServiceError(str(exc)) from exc
        paired = session or self._paired_session
        if paired is None or batch.session_id != paired.session_id or not paired.paired:
            raise ServiceError("session_not_paired")
        try:
            self.sessions.validate_active(paired)
        except Exception as exc:
            raise ServiceError(str(exc)) from exc
        expected_model = self.calibration.profile.model if self.calibration else "FR5"
        expected_profile = self.calibration.profile.name if self.calibration else "fr5-default"
        if batch.model != expected_model or batch.profile != expected_profile:
            raise ServiceError("profile_mismatch")
        if batch.points_revision != self.revision:
            raise ServiceError("stale_points_revision")
        if self.calibration is not None:
            try:
                used_points = [command.args[0] for command in batch.commands if command.name == "move_to"]
                preflight_points(self.calibration, used_points)
            except Exception as exc:
                raise ServiceError("calibration_invalid") from exc
        digest = hashlib.sha256(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        payload_hash = "sha256:" + digest
        fsm = RunFSM(batch.run_id, batch.session_id, payload_hash, batch.points_revision)
        fsm.transition(RunState.VALIDATED)
        fsm.transition(RunState.PENDING_APPROVAL)
        run = ServiceRun(batch.run_id, payload_hash, batch.points_revision, batch.commands, fsm=fsm)
        with self._lifecycle_lock:
            if batch.run_id in self._seen:
                raise ServiceError("replayed_run")
            if self._active is not None and self._active.state in {"pending_approval", "running", "approving"}:
                raise ServiceError("active_run_exists")
            self._seen.add(batch.run_id)
            self._active = run
        self._record({"state": "pending_approval", "runId": run.run_id, "pointsRevision": run.points_revision})
        self._emit("pending_approval", runId=run.run_id)
        return run

    def approve(self, run_id: str) -> ServiceRun:
        with self._lifecycle_lock:
            run = self._active
            if run is None or run.run_id != run_id or run.state != "pending_approval" or run.approval_claimed:
                raise ServiceError("run_not_pending")
            run.approval_claimed = True
        try:
            health = self.adapter.health()
            if not health.safe:
                raise ServiceError("robot_not_safe")
        except ServiceError:
            with self._lifecycle_lock:
                run.approval_claimed = False
            raise
        except Exception as exc:
            with self._lifecycle_lock:
                run.approval_claimed = False
            raise ServiceError("robot_health_unavailable") from exc
        with self._lifecycle_lock:
            if run.fsm.is_terminal:
                run.state = run.fsm.state.value
                return run
            run.fsm.approve(payload_hash=run.payload_hash, points_revision=run.points_revision)
            run.fsm.transition(RunState.RUNNING)
            run.state = "running"
            run.executor = RunExecutor(self.adapter)
        self._emit("approved", runId=run.run_id)
        actions = []
        current = None
        for command in run.commands:
            if command.name == "move_to":
                current = command.args[0]
            if self.calibration is not None:
                target = resolve_command_target(self.calibration, command.name, command.args, current)
            else:
                if command.name == "move_to":
                    name = "HOME" if current == "HOME" else current + "UP"
                    target = Point(name, (0, 0, 0, 0, 0, 0), (0, 0, 0, 0, 0, 0), 0, 0)
                elif command.name == "move_down":
                    name = current
                    target = Point(name, (0, 0, 0, 0, 0, 0), (0, 0, 0, 0, 0, 0), 0, 0)
                elif command.name == "move_up":
                    name = current + "UP"
                    target = Point(name, (0, 0, 0, 0, 0, 0), (0, 0, 0, 0, 0, 0), 0, 0)
                else:
                    target = None
            action_index = len(actions)
            if command.name == "move_to": actions.append(lambda t=target, c=command, i=action_index: self._run_action(run, i, c, lambda: self.adapter.move(t, speed_class="travel")))
            elif command.name == "move_down": actions.append(lambda t=target, c=command, i=action_index: self._run_action(run, i, c, lambda: self.adapter.move(t, speed_class="lower")))
            elif command.name == "move_up": actions.append(lambda t=target, c=command, i=action_index: self._run_action(run, i, c, lambda: self.adapter.move(t, speed_class="travel")))
            elif command.name == "grip": actions.append(lambda c=command, i=action_index: self._run_action(run, i, c, self.adapter.grip))
            elif command.name == "release": actions.append(lambda c=command, i=action_index: self._run_action(run, i, c, self.adapter.release))
        result = run.executor.run(actions)
        # Stop/disconnect may win while an adapter action is blocked.  Never
        # overwrite that terminal decision when the action eventually returns.
        event = None
        with self._lifecycle_lock:
            if run.fsm and run.fsm.is_terminal:
                run.state = run.fsm.state.value
                run.error = run.fsm.reason
            elif result.completed:
                run.fsm.transition(RunState.COMPLETED)
                run.state = "completed"
                event = ("run_completed", {"runId": run.run_id})
            else:
                run.fsm.fault(result.error or result.status)
                run.state, run.error = run.fsm.state.value, result.error
                event = ("faulted", {"runId": run.run_id, "error": run.error, "status": result.status})
        if event:
            self._emit(event[0], **event[1])
        self._record({"state": run.state, "runId": run.run_id, "error": run.error})
        return run

    def stop(self, reason="operator_stop"):
        with self._lifecycle_lock:
            run = self._active
            should_stop = bool(run and run.state in {"pending_approval", "approving", "running"})
            executor = run.executor if should_stop else None
            if should_stop:
                if run.fsm and not run.fsm.is_terminal:
                    run.fsm.stop(reason)
                run.state = "stopped"
                self._emit("stopped", runId=run.run_id)
        if executor:
            executor.stop(reason)

    def reject(self, run_id, reason="operator_reject"):
        with self._lifecycle_lock:
            run = self._active
            if run is None or run.run_id != run_id or run.state != "pending_approval":
                raise ServiceError("run_not_pending")
            run.fsm.reject(reason)
            run.state = "rejected"
            run.error = reason
            self._emit("rejected", runId=run.run_id, reason=reason)
            self._record({"state": run.state, "runId": run.run_id, "error": reason})
            return run

    def disconnect(self, session=None):
        target = session or self._paired_session
        # A rejected/secondary WebSocket must not stop the active run owned by
        # the paired session.  A controller-level disconnect (no session) is
        # intentionally global and cancels the active run.
        if session is None or target is self._paired_session:
            self.stop("disconnect")
        if target:
            self.sessions.drop(target)
        if target is self._paired_session or session is None:
            self._paired_session = None

    def _record(self, event):
        if self.audit:
            self.audit.append({"timestamp": self.clock(), **event})

    def _emit(self, event_type, **payload):
        event = {"v": 1, "type": event_type, **payload}
        self.events.append(event)
        self._record(event)
        for callback in tuple(self._subscribers):
            try:
                callback(event)
            except Exception:
                # A status observer must never affect robot execution.
                continue

    def _run_action(self, run, index, command, action):
        self._emit("command_started", runId=run.run_id, commandIndex=index,
                   index=index, line=command.line, command=command.name, status="running")
        try:
            result = action()
        except Exception as exc:
            self._emit("faulted", runId=run.run_id, commandIndex=index,
                       index=index, line=command.line, command=command.name,
                       status="faulted", error=str(exc))
            raise
        self._emit("command_completed", runId=run.run_id, commandIndex=index,
                   index=index, line=command.line, command=command.name, status="completed")
        return result


async def serve_websocket(service: ControlService, ssl_context, *, host="127.0.0.1", port=8766):
    """Serve the narrow WSS transport when the optional websockets package exists.

    The first frame is always the application-level pairing message. Approval
    is intentionally not a WebSocket command; it belongs to the local UI.
    """
    try:
        import websockets
    except ImportError as exc:
        raise RuntimeError("websockets package is required for the control service") from exc
    if ssl_context is None:
        raise ValueError("TLS is required; plaintext control transport is disabled")
    if host not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("control service is loopback-only")
    async def handler(websocket):
        import asyncio
        session = None
        loop = asyncio.get_running_loop()
        event_queue = asyncio.Queue()
        unsubscribe = lambda: None
        sender = None
        try:
            origin = websocket.request.headers.get("Origin", "")
            first = await websocket.recv()
            if isinstance(first, bytes):
                await websocket.close(code=1003, reason="binary messages are not supported")
                return
            try:
                message = json.loads(first)
                session = service.sessions.claim_pairing(
                    origin,
                    message,
                    query=websocket.request.path.split("?", 1)[1] if "?" in websocket.request.path else "",
                )
                service._paired_session = session
                service._emit("connected", sessionId=session.session_id)
            except Exception:
                await websocket.close(code=1008, reason="pairing failed")
                return
            unsubscribe = service.subscribe(lambda event: loop.call_soon_threadsafe(event_queue.put_nowait, event))
            sender = asyncio.create_task(_send_events(websocket, event_queue))
            await websocket.send(json.dumps({"type": "paired", "sessionId": session.session_id}))
            async for raw in websocket:
                if isinstance(raw, bytes):
                    await websocket.close(code=1003, reason="binary messages are not supported")
                    return
                try:
                    message = json.loads(raw)
                    if message.get("type") == "submit":
                        run = service.submit(message.get("batch"), origin=origin, session=session)
                        await websocket.send(json.dumps({"type": "pending_approval", "runId": run.run_id}))
                    elif message.get("type") == "stop":
                        service.stop("browser_stop_request")
                        await websocket.send(json.dumps({"type": "stopped"}))
                    else:
                        raise ServiceError("web_approval_not_allowed")
                except Exception as exc:
                    await websocket.send(json.dumps({"type": "error", "error": str(exc)}))
        finally:
            unsubscribe()
            if sender is not None:
                sender.cancel()
            if session is not None:
                service.disconnect(session)

    return await websockets.serve(handler, host, port, ssl=ssl_context, origins=list(service.origins), max_size=256 * 1024)


async def _send_events(websocket, event_queue):
    while True:
        await websocket.send(json.dumps(await event_queue.get()))
