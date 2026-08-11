from __future__ import annotations

import unittest

from bridge.control.session import SessionError, SessionManager


class SessionTests(unittest.TestCase):
    def test_new_session_has_long_random_token_and_pairs_only_first_message(self):
        manager = SessionManager({"https://fairino-robot-simulator.vercel.app"}, ttl_seconds=60)
        session = manager.create()
        self.assertGreaterEqual(len(session.token), 22)
        self.assertTrue(manager.pair(session, "https://fairino-robot-simulator.vercel.app", {"type": "pair", "token": session.token}))

    def test_exact_origin_expiry_and_query_token_fail_closed(self):
        manager = SessionManager({"https://fairino-robot-simulator.vercel.app"}, ttl_seconds=1, now=lambda: 10)
        session = manager.create()
        with self.assertRaises(SessionError):
            manager.pair(session, "https://evil.invalid", {"type": "pair", "token": session.token})
        session = manager.create()
        token = session.token
        with self.assertRaises(SessionError):
            manager.pair(session, "https://fairino-robot-simulator.vercel.app", {"type": "pair", "token": token}, query="token=" + token)
        session = manager.create()
        manager.now = lambda: 12
        with self.assertRaises(SessionError):
            manager.pair(session, "https://fairino-robot-simulator.vercel.app", {"type": "pair", "token": session.token})

    def test_second_pair_is_rejected_and_must_use_a_fresh_token_after_first_session_drops(self):
        manager = SessionManager({"https://fairino-robot-simulator.vercel.app"})
        first, second = manager.create(), manager.create()
        # The latest session is still not allowed to take over an active lease.
        manager.pair(first, "https://fairino-robot-simulator.vercel.app", {"type": "pair", "token": first.token})
        with self.assertRaises(SessionError):
            manager.pair(second, "https://fairino-robot-simulator.vercel.app", {"type": "pair", "token": second.token})
        manager.drop(first)
        replacement = manager.create()
        manager.pair(replacement, "https://fairino-robot-simulator.vercel.app", {"type": "pair", "token": replacement.token})

    def test_active_session_expiry_is_rechecked_after_pairing(self):
        now = [10]
        manager = SessionManager({"https://fairino-robot-simulator.vercel.app"}, ttl_seconds=60, now=lambda: now[0])
        session = manager.create()
        manager.pair(session, "https://fairino-robot-simulator.vercel.app", {"type": "pair", "token": session.token})
        manager.validate_active(session)
        now[0] = 71
        with self.assertRaises(SessionError):
            manager.validate_active(session)
