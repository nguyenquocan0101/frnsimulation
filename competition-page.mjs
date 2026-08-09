import { listCompetitionResults } from "./firebase-competition-client.mjs";
import { compareCompetitionResults } from "./competition-results.mjs";

const rowsNode = document.querySelector("#competitionRows");
const statusNode = document.querySelector("#competitionStatus");
const refreshButton = document.querySelector("#refreshCompetitionBtn");

function render(rows) {
  rowsNode.replaceChildren();
  [...rows].sort(compareCompetitionResults).forEach((row, index) => {
    const tr = document.createElement("tr");
    [index + 1, row.solutionName, Number(row.score).toFixed(2), row.steps, row.distance].forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.append(td);
    });
    rowsNode.append(tr);
  });
}

async function load() {
  refreshButton.disabled = true;
  statusNode.textContent = "Loading results…";
  try {
    const rows = await listCompetitionResults();
    render(rows);
    statusNode.textContent = rows.length ? `${rows.length} submissions · latest update` : "No submissions yet. Be the first team!";
  } catch (error) {
    statusNode.textContent = "The leaderboard is unavailable — the rules above are still available.";
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", load);
load();
