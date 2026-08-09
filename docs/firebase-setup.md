# Firebase workshop setup

This is a lightweight one-workshop collection flow. It is not designed to prove authorship or
defend against adversarial uploads.

## Create the project

1. Create a Firebase project and Web App.
2. Enable Anonymous sign-in for student uploads. Google sign-in is not needed for the public
   teacher page.
3. Create Firestore in production mode. Cloud Storage is not required.
4. Copy only the public Web App fields into `firebase-config.mjs`.
5. Deploy `firestore.rules` and `firestore.indexes.json`; the workshop rules intentionally allow
   public `get/list` reads while keeping anonymous creates schema-validated and immutable.

## Local check

```powershell
cd W:\farino_fr3\07_web_simulator
npm install
npm test
npm run test:rules:emulator
node .\serve.mjs
```

Open `http://localhost:8080/` for the student IDE,
`http://localhost:8080/competition` for rules/leaderboard, and
`http://localhost:8080/teacher.html` for the public teacher page. The page auto-refreshes every
three seconds and has a manual refresh button. Python source is stored directly in Firestore, so
no Storage bucket or Storage emulator is needed.

## Deploy Rules and site

```powershell
firebase use YOUR_WORKSHOP_PROJECT
firebase deploy --only firestore:rules,firestore:indexes
```

Deploy the static site to Vercel after the Rules deploy. Test one student upload, a competition
run, a leaderboard result, and a second version
from the same group, public list/preview, group filter, and exact `.py` download before the
workshop. Anyone with the page URL can read/download source; this is intentional for the workshop.

## Cleanup after the workshop

There is no delete button in the browser. An administrator can archive or remove old
`submissions/{submissionId}` documents from the Firebase console after confirming the workshop
data is no longer needed. Do not delete the Firestore database during deployment; if the legacy
collection must be removed, export it and run a separately confirmed, project-checked deletion.
