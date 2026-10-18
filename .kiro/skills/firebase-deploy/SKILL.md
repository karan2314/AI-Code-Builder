---
name: firebase-deploy
description: Set up and deploy the frontend on Firebase Hosting or App Hosting with rewrites to Cloud Run, Firebase Authentication (Google + anonymous guest mode), Firestore/Storage security rules, App Check, and preview channels. Use when working on the web frontend hosting, auth, or Firebase rules.
---

# Firebase Deploy

## 1. Init

```bash
firebase use "$PROJECT_ID"
firebase init hosting firestore storage   # public: frontend/dist, SPA rewrite: yes
```

Edit `firebase.json` with the `/api/**` → Cloud Run rewrite from `gcp-deployment.md`.

## 2. Frontend Firebase client

```ts
// frontend/src/lib/firebase.ts
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});
export const auth = getAuth(app);
export const guestLogin = () => signInAnonymously(auth); // one-click judge access
```

Send `Authorization: Bearer ${await auth.currentUser.getIdToken()}` on API calls; the backend
verifies with `firebase_admin.auth.verify_id_token`.

## 3. Rules (deny by default)

```
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /{document=**} { allow read, write: if false; }
  }
}
```

Test with the emulator: `firebase emulators:start --only firestore,auth`.

## 4. Deploy

```bash
(cd frontend && npm ci && npm run build)
firebase hosting:channel:deploy preview --expires 7d   # test first
firebase deploy --only hosting,firestore:rules,storage
```

App Hosting (Next.js/Angular SSR): `firebase init apphosting`, configure `apphosting.yaml`
(env, secrets via Secret Manager), deploy via GitHub integration or `firebase deploy --only apphosting`.

## 5. Verify

- Open the Hosting URL in incognito on mobile width; complete the hero flow as a guest.
- `/api/healthz` via the Hosting domain returns ok (rewrite works).
- Rules: unauthorized read is denied in the emulator.
- Run the `accessibility-audit` skill on the live URL.

The Firebase MCP server (`firebase` in mcp.json) can manage projects, rules, auth users, and
Firestore data during development.
