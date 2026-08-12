# Deploying for a demo

Two ways to run a demo, pick one:

- **A. Local (Firebase Emulator Suite)** — no billing, no real Google Workspace, no
  live Firebase project. Fastest to stand up, and this exact path was verified
  end-to-end (web + emulators) while building spec #6. **Recommended** unless you
  need a URL to hand someone who isn't in the room.
- **B. Live Firebase project** — a real deployed backend + hosted web app, reachable
  by anyone with the URL. More setup, and the mobile app has a real limitation here
  (see [Mobile app → against a live project](#against-a-live-project)).

Both paths share the [prerequisites](#prerequisites) and the
[first-admin bootstrap](#bootstrapping-the-first-admin) step below.

## Prerequisites

- Node 20 (`functions/package.json` pins `engines.node: "20"`, matching
  `firebase.json`'s `functions.runtime: "nodejs20"`)
- `npx firebase-tools` (no need to install globally — every command below uses `npx`)
- For path A: a JVM on `PATH` — the Firestore/Auth emulators are Java-based. Nothing
  else.
- For path B: a real Firebase project on the **Blaze** (pay-as-you-go) plan — Cloud
  Functions 2nd gen (everything in `functions/`, including the two nightly
  `onSchedule` jobs) will not deploy on the free Spark plan.
- For the mobile app either way: the **Expo Go** app on a physical phone, or an
  iOS/Android simulator. There's no `eas.json` in this repo — `apps/mobile` only has
  `expo start`/`--android`/`--ios` scripts, no standalone build config. A demo means
  running through Expo Go or a simulator, not installing a built app.

## Known gaps, worth disclosing before the demo

These are real, intentional stubs already in the code — not something this guide
works around:

- **Photos never leave the phone.** `SubmitJobScreen.tsx` stores the camera roll's
  local `file://` URI directly into `photoUrls` — there's no Cloud Storage upload
  wired up yet (see the comment in `apps/mobile/src/jobRecords/storage.ts`). A photo
  taken on the demo phone won't be viewable from the web Admin/Payroll review screen.
- **Address verification always reports "unverified."**
  `NotConfiguredAddressVerifier` (`functions/src/jobRecords/notConfiguredAddressVerifier.ts`)
  unconditionally returns `{ matched: false, normalizedAddress: null }` — this is
  treated as non-blocking, not an error, so record submission still works.
- **The nightly discrepancy email never actually sends.**
  `NotConfiguredEmailSender` (`functions/src/notifications/notConfiguredEmailSender.ts`)
  no-ops. The scheduled job still runs and queries Firestore correctly; nothing goes
  out.
- **There's no Cloud Storage bucket or `storage.rules` configured at all** —
  `firebase.json` has no `storage` key. Only relevant if you plan to wire up the
  photo upload above.

## Bootstrapping the first admin

`inviteUser` (and every other admin-only callable) requires the caller to already be
an Application Administrator (`requireApplicationAdministrator` in
`functions/src/access/accessService.ts`) — there's no self-serve first-admin flow.
The first user has to be written directly into Firestore's `users` collection.

Document shape (`users/<normalized-email>`):

```json
{
  "email": "you@yourdomain.com",
  "roles": ["applicationAdministrator"],
  "active": true,
  "invitedAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "onDistributionList": false
}
```

**Path A (emulator):** the emulator's REST API accepts an `Authorization: Bearer owner`
header to bypass `firestore.rules` (which deny all direct client access — see
[firestore.rules](../firestore.rules)):

```bash
curl -X PATCH \
  "http://127.0.0.1:8080/v1/projects/liveoakv3-dev/databases/(default)/documents/users/you%40yourdomain.com" \
  -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  -d '{"fields": {
    "email": {"stringValue": "you@yourdomain.com"},
    "roles": {"arrayValue": {"values": [{"stringValue": "applicationAdministrator"}]}},
    "active": {"booleanValue": true},
    "invitedAt": {"stringValue": "2026-01-01T00:00:00.000Z"},
    "updatedAt": {"stringValue": "2026-01-01T00:00:00.000Z"},
    "onDistributionList": {"booleanValue": false}
  }}'
```

Or use the Emulator UI's Firestore tab (`http://127.0.0.1:4000`) to add the document
by hand — same shape, no curl needed.

**Path B (live project):** `Authorization: Bearer owner` is emulator-only and won't
work against a real project — `firestore.rules` denies it. Use the Firebase Console
(Firestore Database → Start collection `users` → document ID = the normalized email)
instead; Console writes go through your Google account's IAM role on the project, not
the client security rules.

Once that document exists, sign in as that email and you're an Application
Administrator — invite everyone else from the Manage Users screen from there.

## Web app

### Path A — against the emulator suite

```bash
# from the repo root, in separate terminals:
npm run build --workspace=packages/shared   # functions/lib needs a compiled shared package to load at runtime
npm run build --workspace=functions         # firebase.json has no predeploy hook — lib/ has to exist already
npx firebase-tools emulators:start --only auth,firestore,functions

npm run dev --workspace=apps/web            # vite dev server, defaults to localhost:5173
```

`apps/web/src/firebase.ts` only calls `connectAuthEmulator`/`connectFunctionsEmulator`
when `import.meta.env.DEV` is true (i.e. `vite dev`, not `vite build`) — no extra flag
needed. It also defaults `VITE_FIREBASE_PROJECT_ID` to `liveoakv3-dev` (the project ID
in `.firebaserc`) when no `.env` is present, so this works with zero configuration.

### Path B — against a live project

1. `firebase use --add` to point `.firebaserc` at the real project (or add a second
   alias alongside `default`).
2. In the Firebase Console, add a Web app to the project and copy its config values.
3. Create `apps/web/.env.production` (there's no `.env.example` in the repo to copy —
   these are the exact 4 vars `apps/web/src/firebase.ts` reads):
   ```
   VITE_FIREBASE_API_KEY=<from console>
   VITE_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
   VITE_FIREBASE_PROJECT_ID=<project-id>
   VITE_WORKSPACE_DOMAIN=yourdomain.com
   ```
4. In Firebase Console → Authentication → Sign-in method, enable Google, and add your
   demo domain under Authorized domains if it isn't the default Hosting domain.
5. Set the matching server-side value so `resolveAccess` actually enforces the same
   domain (`VITE_WORKSPACE_DOMAIN` above is a UX hint only): create
   `functions/.env.<project-id>` with `ALLOWED_WORKSPACE_DOMAIN=yourdomain.com` —
   Firebase Functions v2 loads `.env`/`.env.<project-id>` files from the `functions/`
   directory automatically on deploy.
6. Deploy:
   ```bash
   npm run build --workspace=packages/shared
   npm run build --workspace=functions
   npm run build --workspace=apps/web
   npx firebase-tools deploy --only firestore,functions,hosting
   ```
7. Bootstrap the first admin (see above), then visit the Hosting URL Firebase prints.

## Mobile app

### Path A — against the emulator suite

`apps/mobile/src/firebase.ts` connects to the emulators whenever `__DEV__` is true,
which is always the case when running through `expo start` (there's no release build
configured in this repo — see prerequisites). The emulator host defaults to
`localhost`, which **will not work from a physical phone** — a phone can't resolve
your laptop's `localhost`. Set it explicitly:

```bash
# find your machine's LAN IP first (ipconfig / ifconfig)
EXPO_PUBLIC_FIREBASE_EMULATOR_HOST=192.168.1.23 npx expo start --clear
```

Or put it in `apps/mobile/.env`. Same rule as the web app: no other Firebase env vars
are required against the emulator (`apps/mobile/src/firebase.ts` defaults
`EXPO_PUBLIC_FIREBASE_PROJECT_ID` to `liveoakv3-dev` too). Google Sign-In still needs
real OAuth client IDs even against the emulator (Auth emulator federated sign-in still
goes through Google's real consent screen for Expo's `expo-auth-session` flow) — see
the client-ID setup below.

Scan the QR code with Expo Go (physical phone) or press `i`/`a` in the Expo CLI for a
simulator.

### Against a live project

Same `.env` values as the web app's `VITE_*` set, under the `EXPO_PUBLIC_*` names
`apps/mobile/src/firebase.ts` and `apps/mobile/src/auth/useAuth.ts` actually read:

```
EXPO_PUBLIC_FIREBASE_API_KEY=<from console>
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=<project-id>.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=<project-id>
EXPO_PUBLIC_WORKSPACE_DOMAIN=yourdomain.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<see below>
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<see below, optional for Expo Go>
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=<see below, optional for Expo Go>
```

**The real limitation:** `apps/mobile/src/firebase.ts` connects to the emulators
whenever `__DEV__` is true, and `__DEV__` is true for the entire lifetime of an Expo
Go / `expo start` session — there is no code path today that runs the Metro dev
bundler against a live Firebase project. To point the mobile app at a live backend
you currently have to either:

- temporarily comment out the `if (__DEV__) { connectAuthEmulator(...); ... }` block
  in `apps/mobile/src/firebase.ts` for the demo, or
- set up an EAS build (not configured in this repo — would need a new `eas.json` and
  an Expo account) to produce a real release binary, where `__DEV__` is `false`.

For a one-off demo, commenting out that block locally (don't commit it) is the
faster path.

**Google OAuth client IDs**: `expo-auth-session`'s `Google.useIdTokenAuthRequest`
needs a Web OAuth client registered in Google Cloud Console under the same project
(Firebase projects are GCP projects) — APIs & Services → Credentials → Create OAuth
client ID → Web application, with the redirect URI `expo start` prints in its console
output added to the client's authorized redirect URIs. That client's ID is
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. iOS/Android-specific client IDs are only needed
for a standalone EAS build, not for Expo Go — leave them unset for a Path A/B demo
through Expo Go. Expo's own
[Google authentication guide](https://docs.expo.dev/guides/authentication/#google)
covers the exact console click-path, which changes often enough that it's not worth
freezing into this doc.
