import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { getFirestore, collection, doc, setDoc, serverTimestamp, query, orderBy, limit, getDocs } from "firebase/firestore";
import { firebaseConfig } from "./firebase-config.mjs";

const REQUIRED_CONFIG_KEYS = ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"];
const hasRealConfig = REQUIRED_CONFIG_KEYS.every((key) => {
  const value = firebaseConfig[key];
  return typeof value === "string" && value && !value.startsWith("REPLACE_WITH_");
});

let services;

export function firebaseAvailable() {
  return hasRealConfig;
}

export function getFirebaseServices() {
  if (!hasRealConfig) throw new Error("Firebase is not configured for this deployment");
  if (!services) {
    const app = getApps().find((candidate) => candidate.name === "[DEFAULT]")
      ?? initializeApp(firebaseConfig);
    services = {
      app,
      auth: getAuth(app),
      db: getFirestore(app),
    };
  }
  return services;
}

export async function ensureAnonymousUser() {
  const { auth } = getFirebaseServices();
  if (auth.currentUser?.isAnonymous) return auth.currentUser;
  const result = await signInAnonymously(auth);
  return result.user;
}

export async function signInTeacher() {
  const { auth } = getFirebaseServices();
  const provider = new GoogleAuthProvider();
  const redirected = await getRedirectResult(auth);
  if (redirected?.user) return redirected.user;
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (error) {
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(error?.code)) {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw error;
  }
}

export async function resolveTeacherRedirect() {
  const { auth } = getFirebaseServices();
  const result = await getRedirectResult(auth);
  return result?.user ?? null;
}

export async function uploadSubmission({ user, identity, metadata, source, onMetadata }) {
  const { db } = getFirebaseServices();
  try {
    onMetadata?.();
    await setDoc(doc(db, "submissions", metadata.submissionId), {
      ...metadata,
      source,
      submittedAt: serverTimestamp(),
    });
  } catch (error) {
    error.stage = "metadata";
    throw error;
  }
  return metadata;
}

export async function listSubmissions() {
  const { db } = getFirebaseServices();
  const snapshot = await getDocs(query(collection(db, "submissions"), orderBy("submittedAt", "desc"), limit(100)));
  return snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
}

export async function downloadSubmission(source) {
  if (typeof source !== "string") throw new Error("Missing Python source");
  return new Blob([source], { type: "text/x-python" });
}
