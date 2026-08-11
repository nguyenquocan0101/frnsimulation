"""Application-level pairing for the loopback control service."""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass


class SessionError(ValueError):
    pass


@dataclass
class Session:
    session_id: str
    token: str | None
    # `token_expires_at` only protects the one-time pre-pairing secret.
    # `expires_at` becomes the separate active-session lease after pairing.
    token_expires_at: float
    expires_at: float
    paired: bool = False


class SessionManager:
    def __init__(self, origins, *, ttl_seconds=600, now=None):
        self.origins = frozenset(origins)
        self.ttl_seconds = ttl_seconds
        self.now = now or time.time
        self.session: Session | None = None
        self.sessions: dict[str, Session] = {}
        self.active_session_id: str | None = None

    def create(self) -> Session:
        now = self.now()
        self.session = Session(
            "sess-" + secrets.token_urlsafe(24),
            secrets.token_urlsafe(32),
            now + self.ttl_seconds,
            now + self.ttl_seconds,
        )
        self.sessions[self.session.session_id] = self.session
        return self.session

    def validate_origin(self, origin: str) -> None:
        if origin not in self.origins:
            raise SessionError("origin_not_allowed")

    def validate_active(self, session: Session) -> None:
        """Require a currently paired, unexpired lease for each message."""
        if self.active_session_id != session.session_id or not session.paired:
            raise SessionError("session_not_paired")
        if self.now() >= session.expires_at:
            session.paired = False
            if self.active_session_id == session.session_id:
                self.active_session_id = None
            raise SessionError("session_expired")

    def _invalidate(self, session: Session) -> None:
        """Remove the pairing secret and any active lease without logging it."""
        session.token = None
        session.paired = False
        session.token_expires_at = self.now()
        session.expires_at = self.now()
        if self.active_session_id == session.session_id:
            self.active_session_id = None

    def pair(self, session: Session, origin: str, message: dict, *, query: str = "") -> bool:
        # A malformed or unapproved handshake is a failed pairing attempt, not
        # an opportunity to replay the same secret from another tab/origin.
        if origin not in self.origins:
            self._invalidate(session)
            raise SessionError("origin_not_allowed")
        if query or not isinstance(message, dict) or message.get("type") != "pair":
            self._invalidate(session)
            raise SessionError("invalid_pair_message")
        if session.token is None:
            raise SessionError("pairing_token_consumed")
        if session.paired:
            raise SessionError("session_already_paired")
        if self.active_session_id is not None and self.active_session_id != session.session_id:
            self._invalidate(session)
            raise SessionError("session_already_paired")
        if self.now() >= session.token_expires_at:
            self._invalidate(session)
            raise SessionError("session_expired")
        if not secrets.compare_digest(str(message.get("token", "")), session.token):
            self._invalidate(session)
            raise SessionError("invalid_token")
        # Consume the secret before marking the browser session active.  A
        # leaked/old token can never pair a second tab after this point.
        session.token = None
        session.paired = True
        session.expires_at = self.now() + self.ttl_seconds
        self.active_session_id = session.session_id
        return True

    def claim_pairing(self, origin: str, message: dict, *, query: str = "") -> Session:
        """Bind a browser's first frame to one already-issued local token.

        The launcher issues and displays the token *before* a browser opens
        WSS.  The transport must therefore claim that existing session rather
        than inventing a new secret after the connection arrives.
        """
        if not isinstance(message, dict) or message.get("type") != "pair":
            raise SessionError("invalid_pair_message")
        supplied = message.get("token")
        if not isinstance(supplied, str):
            raise SessionError("invalid_token")
        match = None
        for candidate in tuple(self.sessions.values()):
            if candidate.token is not None and secrets.compare_digest(supplied, candidate.token):
                match = candidate
        if match is None:
            raise SessionError("invalid_token")
        self.pair(match, origin, message, query=query)
        return match

    def drop(self, session: Session) -> None:
        self._invalidate(session)

    def shutdown(self) -> None:
        """Invalidate every issued secret and active lease during bridge exit."""
        for session in tuple(self.sessions.values()):
            self._invalidate(session)
        self.active_session_id = None
