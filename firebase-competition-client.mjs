import { collection, doc, getDocs, limit, orderBy, query, runTransaction } from "firebase/firestore";
import { getFirebaseServices } from "./firebase-client.mjs";
import {
  buildCompetitionResult,
  competitionResultDocId,
  compareCompetitionResults,
} from "./competition-results.mjs";

const COLLECTION = "competition_results";

export async function saveCompetitionResult(input) {
  const result = buildCompetitionResult(input);
  const { db } = getFirebaseServices();
  const reference = doc(db, COLLECTION, competitionResultDocId(result.solutionName));
  return runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(reference);
    const current = currentSnapshot.exists() ? currentSnapshot.data() : null;
    if (!current || compareCompetitionResults(result, current) < 0) {
      transaction.set(reference, result);
      return { saved: true, result };
    }
    return { saved: false, result: current };
  });
}

export async function listCompetitionResults() {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(query(
    collection(db, COLLECTION),
    orderBy("score", "desc"),
    orderBy("steps", "asc"),
    orderBy("distance", "asc"),
    limit(100),
  ));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}
