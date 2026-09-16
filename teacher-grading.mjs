import { createCompetitionSession } from "./competition-session.mjs";

const pythonRunUrl = "./api/python/run";

function replayForGrade(validation) {
  const session = createCompetitionSession();
  session.activateOpening();
  let position = null;
  for (const action of validation?.actions || []) {
    if (action.type === "move_to") {
      position = action.position;
      continue;
    }
    if (action.type === "grip" || action.type === "release") {
      if (!session.applyEvent({ type: action.type, position, success: action.success !== false })) {
        return { ok: false, error: session.error || "Simulation state became invalid." };
      }
    }
  }
  if (!session.complete()) return { ok: false, error: session.error || "Code did not complete the task." };
  const state = session.state;
  return {
    ok: true,
    score: state.score,
    steps: state.steps,
    distance: state.distance,
    correct: state.correct,
  };
}

export async function gradeStudentSource(source, { fetchImpl = globalThis.fetch, runUrl = pythonRunUrl } = {}) {
  if (typeof source !== "string" || !source.trim()) throw new Error("Submission source is unavailable.");
  const response = await fetchImpl(runUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const message = payload?.error?.message || "Simulation grading failed.";
    return { ok: false, error: message, validation: payload };
  }
  const grade = replayForGrade(payload);
  return { ...grade, validation: payload };
}

export { replayForGrade };
