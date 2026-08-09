import {
  createCompetitionState,
  reduceCompetitionEvent,
} from "./competition-engine.mjs";

export function createCompetitionSession() {
  const session = {
    state: createCompetitionState(),
    error: null,
    captureError: null,
    activateOpening() {
      let next = reduceCompetitionEvent(session.state, {
        type: "grip",
        position: "P1",
      });
      next = reduceCompetitionEvent(next, {
        type: "release",
        position: "P7",
      });
      // The orange marker is a visual endpoint only. It no longer moves
      // automatically from P1 to P7 when a student presses Run.
      next = reduceCompetitionEvent(next, { type: "activate", withoutMarker: true });
      session.state = next;
      session.error = next.phase === "invalid" ? next.error : null;
      return next.phase === "scoring";
    },
    applyEvent(event) {
      session.state = reduceCompetitionEvent(session.state, event);
      session.error = session.state.phase === "invalid" ? session.state.error : null;
      return session.state.phase !== "invalid";
    },
    complete() {
      session.state = reduceCompetitionEvent(session.state, { type: "complete" });
      session.error = session.state.phase === "invalid" ? session.state.error : null;
      return session.state.phase === "completed";
    },
    cancel(reason = "Competition run cancelled.") {
      session.state = reduceCompetitionEvent(session.state, { type: "cancel" });
      session.error = reason;
      return session.state;
    },
  };
  return session;
}

export async function runCompetitionSession({
  preflight,
  reset,
  opening,
  replay,
  capture,
}) {
  const validation = await preflight();
  if (!validation?.ok) {
    return { ok: false, stage: "preflight", validation };
  }

  const session = createCompetitionSession();
  try {
    await reset();
    await opening(session);
    if (session.state.phase !== "scoring") {
      return {
        ok: false,
        stage: "opening",
        error: { message: session.error || "Opening marker failed." },
        state: session.state,
      };
    }
    const replayResult = await replay(session, validation.actions || []);
    if (replayResult === false || session.state.phase === "invalid") {
      return {
        ok: false,
        stage: "replay",
        error: { message: session.error || "Student actions diverged from the fixture." },
        state: session.state,
      };
    }
    if (!session.complete()) {
      return {
        ok: false,
        stage: "complete",
        error: { message: session.error || "The gripper did not finish empty." },
        state: session.state,
      };
    }
    let captureError = null;
    let captureResult = null;
    try {
      captureResult = await capture?.({ state: session.state, validation });
    } catch (error) {
      captureError = error;
      session.captureError = error;
    }
    return {
      ok: true,
      state: session.state,
      capture: captureResult,
      captureError,
      validation,
    };
  } catch (error) {
    return {
      ok: false,
      stage: "runtime",
      error: { message: error?.message || String(error) },
      state: session.state,
    };
  }
}
