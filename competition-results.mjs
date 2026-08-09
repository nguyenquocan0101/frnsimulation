const SOLUTION_NAME_RE = /^TechX_[A-Za-z0-9_-]{2,32}\.py$/;

export function normalizeSolutionName(value) {
  const raw = String(value ?? "").trim();
  const withoutExtension = raw.replace(/\.py$/i, "");
  const safe = withoutExtension.replace(/[^A-Za-z0-9_-]/g, "");
  return safe.startsWith("TechX_") ? `${safe}.py` : `TechX_${safe}.py`;
}

export function competitionResultDocId(solutionName) {
  return normalizeSolutionName(solutionName).toLowerCase();
}

export function isValidCompetitionResult(value) {
  if (!value || typeof value !== "object") return false;
  if (Object.keys(value).sort().join(",") !== "distance,score,solutionName,steps") return false;
  if (typeof value.solutionName !== "string" || !SOLUTION_NAME_RE.test(value.solutionName)) return false;
  if (typeof value.score !== "number" || !Number.isFinite(value.score) || value.score < 0 || value.score > 100) return false;
  if (Math.round(value.score * 100) !== value.score * 100) return false;
  if (!Number.isInteger(value.steps) || value.steps < 0 || value.steps > 500) return false;
  if (!Number.isInteger(value.distance) || value.distance < 0 || value.distance > 5000) return false;
  return true;
}

export function buildCompetitionResult({ solutionName, score, steps, distance }) {
  const result = {
    solutionName: normalizeSolutionName(solutionName),
    score: Number(score),
    steps: Number(steps),
    distance: Number(distance),
  };
  if (!isValidCompetitionResult(result)) throw new TypeError("Invalid competition result.");
  return result;
}

export function compareCompetitionResults(left, right) {
  if (left.score !== right.score) return right.score - left.score;
  if (left.steps !== right.steps) return left.steps - right.steps;
  if (left.distance !== right.distance) return left.distance - right.distance;
  return String(left.solutionName).localeCompare(String(right.solutionName), "en");
}

export function isBetterCompetitionResult(candidate, current) {
  return !current || compareCompetitionResults(candidate, current) < 0;
}
