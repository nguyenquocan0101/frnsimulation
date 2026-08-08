import { initializeApp, getApps } from "firebase/app";
import { getFirestore, collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.mjs";

const REQUIRED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"];
const configured = REQUIRED_CONFIG_KEYS.every((key) => {
  const value = firebaseConfig[key];
  return typeof value === "string" && value && !value.startsWith("REPLACE_WITH_");
});

let db;
function getPublicDb() {
  if (!configured) throw new Error("Firebase is not configured for this deployment");
  if (!db) {
    const app = getApps().find((candidate) => candidate.name === "[DEFAULT]")
      ?? initializeApp(firebaseConfig);
    db = getFirestore(app);
  }
  return db;
}

export async function listSubmissions() {
  const snapshot = await getDocs(query(collection(getPublicDb(), "submissions"), orderBy("submittedAt", "desc"), limit(100)));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function downloadSubmission(source) {
  if (typeof source !== "string") throw new Error("Missing Python source");
  return new Blob([source], { type: "text/x-python;charset=utf-8" });
}
