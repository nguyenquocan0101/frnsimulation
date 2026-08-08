import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initializeTestEnvironment, assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";

const projectId = "techcamp-workshop-rules";
const submissionId = "submission0123456789abcd";
let testEnv;
const requireEmulator = process.env.FIRESTORE_EMULATOR_HOST ? test : test.skip;

const rules = await readFile(new URL("../firestore.rules", import.meta.url), "utf8");

test.before(async (t) => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    t.skip("Firebase Emulator Suite is not running");
    return;
  }
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules },
  });
});

test.after(async () => {
  await testEnv?.cleanup();
});

const submission = () => ({
  submissionId,
  uid: "student-uid",
  groupKey: "robotx",
  groupName: "RobotX",
  filename: "TechX_RobotX.py",
  byteSize: 12,
  contentType: "text/x-python",
  source: "print('hello')\n",
  submittedAt: serverTimestamp(),
});

requireEmulator("signed-out users can list newest submissions with a 100-record cap", async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const writes = Array.from({ length: 101 }, (_, index) => {
      const number = index + 1;
      const id = `public-submission-${String(number).padStart(3, "0")}`;
      return setDoc(doc(db, "submissions", id), {
        submissionId: id,
        uid: `seed-uid-${number}`,
        groupKey: `group${number}`,
        groupName: `Group${number}`,
        filename: `TechX_Group${number}.py`,
        byteSize: 12,
        contentType: "text/x-python",
        source: "print('hello')\n",
        submittedAt: Timestamp.fromMillis(number),
      });
    });
    await Promise.all(writes);
  });

  const visitor = testEnv.unauthenticatedContext();
  const snapshot = await getDocs(query(
    collection(visitor.firestore(), "submissions"),
    orderBy("submittedAt", "desc"),
    limit(100),
  ));

  assert.equal(snapshot.size, 100);
  assert.equal(snapshot.docs[0].data().groupName, "Group101");
  assert.equal(snapshot.docs.at(-1).data().groupName, "Group2");
});

requireEmulator("anonymous student can create and publicly read metadata but cannot mutate it", async () => {
  const student = testEnv.authenticatedContext("student-uid", {
    firebase: { sign_in_provider: "anonymous" },
  });
  await assertSucceeds(setDoc(doc(student.firestore(), "submissions", submissionId), submission()));
  await assertSucceeds(getDoc(doc(student.firestore(), "submissions", submissionId)));
  await assertFails(updateDoc(doc(student.firestore(), "submissions", submissionId), { source: "mutated" }));
  await assertFails(deleteDoc(doc(student.firestore(), "submissions", submissionId)));
});

requireEmulator("public reads do not depend on a teacher identity", async () => {
  const visitor = testEnv.authenticatedContext("visitor-uid", {
    firebase: { sign_in_provider: "google.com" },
    email: "visitor@example.com",
    email_verified: true,
  });
  await assertSucceeds(getDocs(collection(visitor.firestore(), "submissions")));
});
