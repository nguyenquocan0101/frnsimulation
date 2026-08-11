"""Small immutable-terminal FSMs for approved runs and commands."""

from __future__ import annotations

from enum import Enum


class InvalidTransition(RuntimeError):
    pass


class RunState(Enum):
    RECEIVED = "received"
    VALIDATED = "validated"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    RUNNING = "running"
    COMPLETED = "completed"
    REJECTED = "rejected"
    STOPPED = "stopped"
    DISCONNECTED = "disconnected"
    TIMED_OUT = "timed_out"
    FAULTED = "faulted"


class CommandState(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    REJECTED = "rejected"
    STOPPED = "stopped"
    FAULTED = "faulted"
    TIMED_OUT = "timed_out"


class RunFSM:
    _edges = {
        RunState.RECEIVED: {RunState.VALIDATED, RunState.REJECTED, RunState.FAULTED},
        RunState.VALIDATED: {RunState.PENDING_APPROVAL, RunState.REJECTED, RunState.FAULTED},
        RunState.PENDING_APPROVAL: {RunState.APPROVED, RunState.REJECTED, RunState.STOPPED, RunState.DISCONNECTED, RunState.TIMED_OUT, RunState.FAULTED},
        RunState.APPROVED: {RunState.RUNNING, RunState.STOPPED, RunState.DISCONNECTED, RunState.TIMED_OUT, RunState.FAULTED},
        RunState.RUNNING: {RunState.COMPLETED, RunState.STOPPED, RunState.DISCONNECTED, RunState.TIMED_OUT, RunState.FAULTED},
    }
    def __init__(self, run_id, session_id, payload_hash, points_revision):
        self.run_id, self.session_id = run_id, session_id
        self.payload_hash, self.points_revision = payload_hash, points_revision
        self.state = RunState.RECEIVED
        self.reason = None
    @property
    def is_terminal(self):
        return self.state in {RunState.COMPLETED, RunState.REJECTED, RunState.STOPPED, RunState.DISCONNECTED, RunState.TIMED_OUT, RunState.FAULTED}
    def transition(self, state):
        if self.is_terminal or state not in self._edges.get(self.state, set()):
            raise InvalidTransition(f"{self.state.value} -> {state.value}")
        self.state = state
    def approve(self, *, payload_hash, points_revision):
        if self.state is not RunState.PENDING_APPROVAL or payload_hash != self.payload_hash or points_revision != self.points_revision:
            raise InvalidTransition("approval_binding_mismatch")
        self.state = RunState.APPROVED
    def _terminal(self, state, reason=None):
        if self.is_terminal:
            raise InvalidTransition("terminal_run")
        if state not in self._edges.get(self.state, set()):
            raise InvalidTransition("illegal_terminal_transition")
        self.state, self.reason = state, reason
    def reject(self, reason): self._terminal(RunState.REJECTED, reason)
    def stop(self, reason): self._terminal(RunState.STOPPED, reason)
    def disconnect(self): self._terminal(RunState.DISCONNECTED, "disconnect")
    def timeout(self): self._terminal(RunState.TIMED_OUT, "timeout")
    def fault(self, reason): self._terminal(RunState.FAULTED, reason)
    def invalidate_revision(self): self._terminal(RunState.FAULTED, "revision_change")
    def resume(self, session_id): raise InvalidTransition("terminal_runs_cannot_resume")
    def remaining_command_indexes(self, indexes, completed=()):
        done = set(completed)
        return tuple(index for index in indexes if index not in done)


class CommandFSM:
    def __init__(self, run_id, command_index, line):
        self.run_id, self.command_index, self.line = run_id, command_index, line
        self.state, self.reason = CommandState.PENDING, None
    @property
    def is_terminal(self): return self.state in {CommandState.COMPLETED, CommandState.REJECTED, CommandState.STOPPED, CommandState.FAULTED, CommandState.TIMED_OUT}
    def start(self):
        if self.state is not CommandState.PENDING: raise InvalidTransition("command_not_pending")
        self.state = CommandState.RUNNING
    def complete(self):
        if self.state is not CommandState.RUNNING: raise InvalidTransition("command_not_running")
        self.state = CommandState.COMPLETED
    def _terminal(self, state, reason):
        if self.is_terminal: raise InvalidTransition("terminal_command")
        self.state, self.reason = state, reason
    def reject(self, reason): self._terminal(CommandState.REJECTED, reason)
    def stop(self, reason): self._terminal(CommandState.STOPPED, reason)
    def fault(self, reason): self._terminal(CommandState.FAULTED, reason)
    def timeout(self, reason): self._terminal(CommandState.TIMED_OUT, reason)
