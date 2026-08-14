---
status: research
date: 2026-08-12
---

# Level of effort: Firebase to Supabase migration

This is investigative/reference material, not a decision record — it does not conclude
whether to migrate, only what it would cost. No migration code was written as part of
this research. `docs/research/` did not exist before this document; it was created
because the closest existing conventions (`docs/adr/` for decisions, `docs/agents/` for
agent-facing reference) don't fit an investigative artifact like this one.

## Executive summary

| Area | Verdict | Why |
|---|---|---|
| Auth (sign-in mechanics) | **Trivial→Moderate** | Supabase Auth has a native Google provider; the actual domain-restriction *logic* in this repo is already custom app code, not a Firebase-native feature, so it ports almost as-is. Wiring (SDK calls, session handling) needs a rewrite per client. |
| Data model (Firestore → Postgres) | **Major** | NoSQL→relational is a real redesign, not a driver swap. Repository *interfaces* survive close to verbatim; every implementation, query, and the one transaction get rewritten against Postgres/PostgREST. |
| Storage | **Trivial (greenfield)** | Photo upload was never wired up (`docs/deploy-demo.md` calls this out explicitly) — this is a green-field choice between two comparable services, not a migration of live data. |
| Functions (callables + scheduled jobs) | **Major** | `defineCallable` seam and business logic (services) survive; every handler's transport layer moves from `onCall`/Admin SDK to Edge Functions (Deno) + Postgres client, and the runtime moves from Node 20 to Deno. Scheduling loses native per-function IANA timezone support. |
| Hosting | **Trivial** | Static SPA hosting is commodity; Supabase doesn't host static sites at all, so this piece moves to Vercel/Netlify/Cloudflare Pages regardless — a small, well-trodden swap. |
| Local dev tooling | **Trivial→Moderate** | Supabase CLI is a close analog to the Firebase Emulator Suite, but trades a JVM dependency for a Docker dependency, and the current demo docs' `Authorization: Bearer owner` bootstrap trick has no direct Supabase equivalent. |
| Mobile app changes | **Moderate** | `firebase/auth` + `firebase/functions` client SDK calls are replaced by `@supabase/supabase-js`; the Google sign-in flow (`expo-auth-session`) and offline queue (`storage.ts`) are largely auth-provider-agnostic already. |
| Web app changes | **Moderate** | Same SDK swap as mobile; smaller surface (`firebase.ts`, `useAuth.ts`, two admin screens using `httpsCallable`). |

**Overall gut-check:** this is a **major, full-stack effort**, correctly characterized by
ADR-0001 as a "full-stack commitment" to unwind — but not for the reason the ADR states.
The auth domain-restriction requirement (the ADR's stated reason for choosing Firebase)
turns out to be the *cheapest* part of a migration, because it's already implemented as
portable application code, not a Firebase-native capability. The real cost driver is the
Firestore→Postgres data-model change and the Node→Deno runtime change for the scheduled
jobs and callables, both of which touch effectively every file under `functions/src/`.

**Biggest uncertainty/risk:** whether `cron.timezone` — the one Postgres GUC that would
let a Supabase Cron job run natively in `America/Chicago` the way `onSchedule({ schedule,
timeZone })` does today — is actually settable on Supabase's managed platform. It's a
postmaster-context setting requiring a Postgres restart, which is normally not exposed to
tenants on managed Postgres. If it isn't settable, the nightly discrepancy email
(currently scheduled for 8pm Central specifically so it runs "before the state export...
rather than racing it," per `functions/src/index.ts:33-36`) and the state export job need
either a UTC-computed schedule with manual DST handling, or in-function time-window logic
— exactly the kind of DST arithmetic the codebase currently avoids by delegating to Cloud
Scheduler (see the comment at `functions/src/index.ts:33-36` contrasting this with
`easternWeekWindow`, which *does* do that arithmetic itself for a different job). This
needs a spike against a real Supabase project before any migration estimate can be
trusted.

---

## 1. Firebase touchpoint inventory (as implemented today)

### 1.1 Auth

- **Client init**: `apps/web/src/firebase.ts:1-27`, `apps/mobile/src/firebase.ts:1-33`.
  Both call `initializeApp`/`getAuth`/`getFunctions` from the `firebase` npm package
  (v12.17.1, per `apps/web/package.json:14` and `apps/mobile/package.json:22`), and
  connect to the Auth + Functions emulators in dev.
- **Sign-in flow**:
  - Web: `signInWithPopup` with a `GoogleAuthProvider`
    (`apps/web/src/auth/useAuth.ts:45-47`). The provider gets
    `setCustomParameters({ hd: workspaceDomain })`
    (`apps/web/src/firebase.ts:18-22`) — explicitly commented as a **UX hint only**.
  - Mobile: `expo-auth-session`'s `Google.useIdTokenAuthRequest`, passing
    `hd` via `extraParams` (`apps/mobile/src/auth/useAuth.ts:31-40`), then
    `signInWithCredential` into Firebase Auth. Same "UX hint only" comment.
- **The actual domain enforcement** is **not** a Firebase-native feature. It's
  application code: `isAllowedWorkspaceDomain` (`packages/shared/src/workspaceDomain.ts`)
  is called from `resolveAccess` (`functions/src/access/accessService.ts:73-87`), which
  runs inside the `resolveMyAccess` callable
  (`functions/src/access/handlers.ts:12-14`) via `requireCaller`
  (`functions/src/callableHandler.ts:50-56`). It's a plain string-suffix check against
  `process.env.ALLOWED_WORKSPACE_DOMAIN` (`functions/src/callableHandler.ts:18`, default
  `"example.com"`), run *after* Google sign-in succeeds, on the ID token's verified email
  claim (`auth.token.email`, `functions/src/callableHandler.ts:51`). **This directly
  contradicts the framing in ADR-0001** ("which Firebase Auth supports natively") — Google
  OAuth's `hd` param is a UI hint on *Google's* consent screen regardless of which auth
  backend requests it, and the actual restriction is custom code that would run
  identically against any provider that gives you a verified email post-OAuth.
- **Roles/allowlist**: a Firestore `users` collection doc per email
  (`functions/src/access/firestoreUserRepository.ts:5,11-23`), shape defined in
  `packages/shared/src/user.ts:3-13` (`email`, `roles: Role[]`, `active`, `invitedAt`,
  `updatedAt`, `onDistributionList`). Nothing here is Firestore-specific — plain JSON.

### 1.2 Firestore (data model and access patterns)

Four collections, inferred from the four Firestore-backed repositories:

| Collection | Repository | Notable query patterns |
|---|---|---|
| `users` | `functions/src/access/firestoreUserRepository.ts` | doc-by-email get/set, full collection scan (`listUsers`) |
| `jobRecords` | `functions/src/jobRecords/firestoreJobRecordRepository.ts` | equality filter on `discrepancy`; range filter on `submittedAt` within `technicianEmail`; a derived/denormalized `normalizedAddressKey` field (`toDocument`, lines 7-14) used in a composite query; **one Firestore transaction** (`createWithDuplicateLinking`, lines 66-90) |
| `auditLog` | `functions/src/jobRecords/firestoreAuditLogRepository.ts` | append-only, filter+order by `recordId`/`timestamp` |
| `stateExports` | `functions/src/notifications/firestoreStateExportRepository.ts` | one doc per US state per nightly run, written as a single `WriteBatch` (lines 17-23) |

- **Composite indexes** (`firestore.indexes.json:1-27`) — three, mapping directly to
  Postgres composite/covering indexes: `(normalizedAddressKey, submittedAt)`,
  `(recordId, timestamp)`, `(technicianEmail, submittedAt)`.
- **No realtime listeners anywhere** (`grep -rn onSnapshot apps functions` returns
  nothing) — every client read goes through a callable, not a live subscription. This
  removes an entire category of Supabase Realtime migration work that a
  listener-heavy Firestore app would otherwise face.
- **No Firestore-specific value types** (`Timestamp`, `GeoPoint`, `DocumentReference`) in
  the domain model — every timestamp in `packages/shared/src/jobRecord.ts` and
  `user.ts` is a plain ISO-8601 string. This is a genuinely favorable finding: the domain
  types are already storage-agnostic JSON, which is most of what makes the
  interface-survives-the-implementation-doesn't pattern viable.
- **Transactions/batches**: one `runTransaction` (duplicate-linking,
  `firestoreJobRecordRepository.ts:71-89`) and two `WriteBatch`s
  (`updateMany` in the same file, and `saveBatches` in
  `firestoreStateExportRepository.ts:17-23`). All three map cleanly to a single Postgres
  transaction (`BEGIN`/`COMMIT`) — arguably *simpler* in Postgres, since Firestore
  transactions require the read-set to be re-validated (optimistic concurrency across the
  whole transaction), whereas Postgres offers real row locking.
- **Domain model source**: `packages/shared/src/jobRecord.ts` (`JobRecord`,
  `DuplicateLink`) and `user.ts` (`UserRecord`) — these define the schema that a Postgres
  table design would need to normalize (e.g. `DuplicateLink.linkedRecordIds: string[]`
  is either a join table or a Postgres array column; `roles: Role[]` similarly).

### 1.3 Cloud Storage

**Not actually in use.** `firebase.json` has no `storage` key, and there is no
`storage.rules` file in the repo. `docs/deploy-demo.md:57-59` states this explicitly:
*"There's no Cloud Storage bucket or `storage.rules` configured at all... Photos never
leave the phone"* — confirmed at `apps/mobile/src/jobRecords/storage.ts:25-27`, where
`photoUrls` holds local `file://` device URIs with a `NOTE` that real upload wiring is a
follow-up. This means Storage is a **greenfield decision**, not a migration of live data
or working code.

### 1.4 Cloud Functions (`functions/src/index.ts`)

- **Two `onSchedule` (Cloud Scheduler-triggered) functions**, both using a per-function
  IANA `timeZone`:
  - `nightlyDiscrepancyEmail` — `{ schedule: "0 20 * * *", timeZone: "America/Chicago" }`
    (`functions/src/index.ts:37-42`)
  - `nightlyStateExport` — `{ schedule: "0 21 * * *", timeZone: "America/Chicago" }`
    (`functions/src/index.ts:44-48`)
  - The comment at lines 33-36 is explicit that this ordering (8pm before 9pm) and the
    DST correctness are *delegated to Cloud Scheduler* resolving `America/Chicago`
    against its own DST table — nothing in this codebase computes that offset.
- **Fourteen `onCall` callables**, all built on the `defineCallable` seam
  (`functions/src/callableHandler.ts:64-77`), which is itself a thin `onCall` wrapper
  handling auth resolution (`requireCaller`), input parsing, and domain-error→`HttpsError`
  translation (`toHttpsError`, lines 24-48):
  - Access domain (`functions/src/access/handlers.ts`): `resolveMyAccess`, `inviteUser`,
    `updateUserRoles`, `revokeUser`, `listUsers`, `setDistributionListMembership`.
  - Job Records domain (`functions/src/jobRecords/handlers.ts`): `createJobRecord`,
    `listJobRecords`, `getJobRecord`, `listJobRecordAuditLog`, `editJobRecord`,
    `setDiscrepancy`, `setPicturesDownloaded`, `setClosed`, `overrideDuplicatePrimary`,
    `unlinkDuplicate`, `listMyWeeklyJobRecords`.
- **No Firestore-trigger functions** (`onDocumentCreated`/`onDocumentWritten` etc.) exist
  at all — every write happens synchronously inside a callable's own request. This is
  favorable: there's no event-driven trigger topology to redesign.
- **Runtime**: Node 20, TypeScript, `firebase-admin` ^12.6.0 +
  `firebase-functions` ^6.0.1 (`functions/package.json:6-17`). Single "default" codebase
  (`firebase.json:6-12`). Consumes `@liveoakv3/shared` built to `dist`/`lib` via a
  workspace dependency (`functions/package.json:15`, and the build-order note in
  `docs/deploy-demo.md:117-118`, `168-169`).

### 1.5 Hosting

`firebase.json:14-18` serves `apps/web/dist` (a Vite build) with an SPA rewrite. Nothing
Firebase-specific in the built artifact itself — it's a static site.

### 1.6 Local dev / emulator suite

`firebase.json:19-27` configures `auth`(9099), `functions`(5001), `firestore`(8080),
`hosting`(5000), plus the Emulator UI. `docs/deploy-demo.md` documents two demo paths
(local emulator vs. live project) and a **first-admin bootstrap trick specific to the
emulator**: `Authorization: Bearer owner` against the emulator's Firestore REST API to
write the first `users` doc, bypassing `firestore.rules` deny-all
(`docs/deploy-demo.md:81-97`). The doc also notes the Firestore/Auth emulators are
Java-based (JVM required) and that Cloud Functions 2nd-gen (both `onSchedule` jobs) won't
deploy on Firebase's free Spark plan — Blaze (pay-as-you-go) is required even for a demo
(`docs/deploy-demo.md:32-34`).

---

## 2. Supabase equivalents (primary sources)

### 2.1 Auth: Google Workspace domain restriction

- Supabase Auth's Google provider guide
  ([supabase.com/docs/guides/auth/social-login/auth-google](https://supabase.com/docs/guides/auth/social-login/auth-google))
  documents standard Google OAuth setup but does **not** document the `hd` parameter or
  native Workspace-domain restriction.
- `signInWithOAuth` accepts an `options.queryParams` map that is passed through to the
  provider's authorization URL
  ([supabase.com/docs/reference/javascript/auth-signinwithoauth](https://supabase.com/docs/reference/javascript/auth-signinwithoauth)),
  so `queryParams: { hd: 'yourdomain.com' }` reproduces the exact same **UX-hint-only**
  behavior the current code already relies on (`GoogleAuthProvider.setCustomParameters`
  and `expo-auth-session`'s `extraParams` do the same thing today).
- For the *authoritative* check (equivalent to today's `resolveAccess` string-suffix
  check), Supabase's **Before User Created Hook**
  ([supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook))
  can inspect the incoming user's email domain and reject the signup at the Auth layer
  (implementable as a Postgres function or an HTTP/Edge Function receiving a webhook with
  the pending user record) — but the current architecture doesn't need this, since
  `resolveAccess` already does the equivalent check downstream of sign-in, inside the
  `resolveMyAccess` callable. **Net effect: this is the lowest-risk piece of the whole
  migration** — the enforcement logic (`isAllowedWorkspaceDomain`, a pure function in
  `packages/shared`) is storage- and auth-provider-agnostic already and needs no rewrite,
  only a new call site.
- Supabase JWTs expose the verified email the same way Firebase ID tokens do (`auth.uid()`
  / the decoded JWT's `email` claim), per the JWT Claims reference
  ([supabase.com/docs/guides/auth/jwt-fields](https://supabase.com/docs/guides/auth/jwt-fields)).

### 2.2 Data model: Postgres vs. Firestore

- RLS is Postgres-native row security, documented at
  [supabase.com/docs/guides/database/postgres/row-level-security](https://supabase.com/docs/guides/database/postgres/row-level-security):
  policies act as an implicit `WHERE` clause per role (`anon`, `authenticated`,
  `service_role`).
- **Critical finding, corroborated across two independent primary-source lookups**: the
  `service_role` key **bypasses RLS entirely** (confirmed via
  [supabase.com/features/row-level-security](https://supabase.com/features/row-level-security)
  and cross-referenced against Supabase's own guidance that the service key "bypasses
  row level security for administrative tasks" and "must only ever be used in
  server-side code"). This is the direct Postgres analog of the Firebase Admin SDK
  bypassing `firestore.rules` — meaning the current architecture (`firestore.rules`
  denies all direct client access; every read/write goes through a callable using the
  Admin SDK) **translates cleanly**: keep RLS denying `anon`/`authenticated` entirely (or
  don't expose those keys to clients at all) and have Edge Functions use `service_role`,
  exactly mirroring today's Admin-SDK-only pattern. This is a straightforward
  architectural port, not a redesign — the interesting decision (stay callable-only vs.
  open up direct RLS-gated client access) is optional, not forced.
- **The real cost is schema and query rewriting, not the security model.** Every
  Firestore-backed repository implementation
  (`firestoreUserRepository.ts`, `firestoreJobRecordRepository.ts`,
  `firestoreAuditLogRepository.ts`, `firestoreStateExportRepository.ts` — 4 files) gets
  replaced by a Postgres-backed implementation of the *same interface*
  (`userRepository.ts`, `jobRecordRepository.ts`, `auditLogRepository.ts`,
  `stateExportRepository.ts`), using either PostgREST via `@supabase/supabase-js`'s
  query builder or raw SQL. The 4 matching `inMemory*` test doubles need no changes at
  all — they already satisfy the same interfaces and are what the service-layer tests
  (`accessService.test.ts`, `jobRecordService.test.ts`, etc.) exercise. Concretely:
  - `DuplicateLink.linkedRecordIds: string[]` and `roles: Role[]` need a schema decision
    (Postgres native array column vs. join table) that Firestore's document model let the
    team avoid entirely.
  - The one Firestore `runTransaction` (`createWithDuplicateLinking`) becomes a Postgres
    transaction with an explicit row lock (`SELECT ... FOR UPDATE`) to get the same
    concurrent-duplicate-detection guarantee the code's own comment calls out
    (`jobRecordRepository.ts:34-36`).
  - The three composite Firestore indexes become three Postgres indexes — mechanical,
    but every query in the four Firestore repos needs re-expression in
    PostgREST/SQL syntax.

### 2.3 Storage

Supabase Storage ([supabase.com/docs/guides/storage](https://supabase.com/docs/guides/storage))
uses the same RLS model as the database — bucket/object access policies live in Postgres
against the `storage.objects` table, and (per §2.2's finding) `service_role` uploads
bypass those policies the same way Admin-SDK Storage writes bypass `storage.rules` today.
Since photo upload was never implemented in this codebase, this is a **like-for-like
green-field pick**, not a migration — whichever platform is chosen, the mobile app's
`SubmitJobScreen.tsx`/`storage.ts` upload wiring is *new* code either way.

### 2.4 Functions: onCall/onSchedule vs. Edge Functions + pg_cron

- Supabase Edge Functions run on a **Deno-compatible runtime**, TypeScript-first, per
  [supabase.com/docs/guides/functions](https://supabase.com/docs/guides/functions).
  They are invoked over HTTP (not a `httpsCallable`-style client-SDK RPC — though
  `@supabase/supabase-js`'s `functions.invoke()` wraps that HTTP call similarly).
- Deno's npm/Node compatibility layer supports `npm:` specifiers and `node:` built-ins
  directly in Edge Functions
  ([supabase.com/docs/guides/functions/dependencies](https://supabase.com/docs/guides/functions/dependencies),
  corroborated by
  [supabase.com/blog/edge-functions-node-npm](https://supabase.com/blog/edge-functions-node-npm)),
  meaning `@liveoakv3/shared` likely ports with an import-path change
  (`npm:@liveoakv3/shared` or a JSR-style import) rather than a full rewrite — but this
  needs verification against the package's actual dependency graph (does it pull in
  anything Node-native that Deno's compat layer doesn't cover?).
- **Scheduling**: Supabase's answer is `pg_cron` + `pg_net` — a Postgres extension that
  calls `cron.schedule()` with a cron expression, then uses `net.http_post()` inside the
  scheduled job to invoke the Edge Function over HTTP, authenticating via a Vault-stored
  token
  ([supabase.com/docs/guides/functions/schedule-functions](https://supabase.com/docs/guides/functions/schedule-functions),
  [supabase.com/docs/guides/database/extensions/pg_cron](https://supabase.com/docs/guides/database/extensions/pg_cron)).
  This is structurally different from `onSchedule`: the trigger lives in Postgres, not
  next to the function code, and the HTTP hop adds a layer `onSchedule` doesn't have.
- **Timezone gap (see risk section)**: `cron.timezone` is a `postgresql.conf` setting
  with **postmaster context** (requires a full Postgres restart to change), default GMT,
  only configurable on Postgres 16+, per pg_cron's own documentation surfaced in search
  results. Whether this GUC is exposed/settable on Supabase's *managed* platform (as
  opposed to self-hosted Postgres) was **not confirmed against a primary source** in this
  research — Supabase's own docs pages fetched for this report did not state it either
  way. This directly affects whether `nightlyDiscrepancyEmail`/`nightlyStateExport`'s
  `America/Chicago` scheduling can be reproduced natively.

### 2.5 Hosting

Supabase doesn't offer static hosting — this piece leaves the Firebase/Supabase question
entirely regardless of the Auth/DB/Functions decision and moves to something like Vercel,
Netlify, or Cloudflare Pages. Not researched further here since it's orthogonal to the
Supabase-specific question, but worth noting as a piece with zero relationship to
whichever backend platform is chosen.

### 2.6 Local dev / CLI

The Supabase CLI's local dev workflow
([supabase.com/docs/guides/local-development](https://supabase.com/docs/guides/local-development))
runs local Postgres, Auth, and Storage (Edge Functions/Studio not confirmed in the fetched
excerpt, but are part of `supabase start` in practice) via Docker, started with
`supabase init` + `supabase start`. This is a reasonably close structural analog to
`firebase emulators:start`, but swaps the Firebase Emulator Suite's **JVM** dependency
(noted as a prerequisite in `docs/deploy-demo.md:31`) for a **Docker** dependency — a
different, not obviously smaller, local-environment burden. The emulator-specific
`Authorization: Bearer owner` first-admin bootstrap trick documented in
`docs/deploy-demo.md:81-97` has no confirmed Supabase equivalent found in this research —
the CLI likely offers a `service_role` key locally that can write directly via
`supabase-js`/`psql`, which would actually be simpler, but this wasn't verified against a
primary source and should be spiked.

---

## 3. Effort by area, in file/scope terms

| Area | Files/scope touched | Effort |
|---|---|---|
| Auth wiring | `apps/web/src/firebase.ts`, `apps/web/src/auth/useAuth.ts`, `apps/mobile/src/firebase.ts`, `apps/mobile/src/auth/useAuth.ts`, `functions/src/callableHandler.ts` (auth resolution only — `resolveAccess`/`isAllowedWorkspaceDomain` themselves don't change) | Moderate — SDK swap (`firebase/auth` → `@supabase/supabase-js`), sign-in flow rewrite (popup/credential exchange differs), but zero business-logic change |
| Data model | 4 Firestore repos + schema design + 3 indexes + 1 transaction, across `functions/src/access/`, `functions/src/jobRecords/`, `functions/src/notifications/` | Major — genuine relational schema design, every query rewritten; repository *interfaces* and all 4 `inMemory*` test doubles are unaffected |
| Storage | None today (unimplemented) | Trivial — greenfield choice, no migration |
| Functions transport | `functions/src/callableHandler.ts` (the `defineCallable`/`onCall` seam itself), all 16 exports in `functions/src/index.ts` + `access/handlers.ts` + `jobRecords/handlers.ts`, Node→Deno runtime, `@liveoakv3/shared` import path | Major — every callable's transport layer changes; service-layer functions they call (`accessService.ts`, `jobRecordService.ts`, `jobRecordReviewService.ts`, `weeklyListService.ts`, `discrepancyEmailService.ts`, `stateExportService.ts`) are Firestore-agnostic already and don't change |
| Scheduling | `functions/src/index.ts:37-49` (2 jobs) | Moderate, pending the `cron.timezone` spike — mechanically small (2 jobs) but the DST-correctness guarantee the code currently gets for free may need to be re-implemented |
| Hosting | `firebase.json` hosting config | Trivial — moves off-platform regardless (Supabase has no hosting product) |
| Local dev | `firebase.json` emulators config, `docs/deploy-demo.md` | Moderate — comparable shape, different dependency (Docker vs JVM), bootstrap-trick equivalent unconfirmed |
| Mobile app | `apps/mobile/src/firebase.ts`, `apps/mobile/src/auth/*`, `apps/mobile/src/jobRecords/api.ts` (httpsCallable call sites) | Moderate |
| Web app | `apps/web/src/firebase.ts`, `apps/web/src/auth/*`, `apps/web/src/admin/JobRecordReviewScreen.tsx`, `apps/web/src/admin/ManageUsersScreen.tsx` (httpsCallable call sites) | Moderate |

## 4. What needs a spike before estimating further

1. **`cron.timezone` on managed Supabase** — settable or not; if not, whether an
   in-function time-window check or a UTC-computed fixed offset is acceptable given the
   existing DST-correctness bar (`functions/src/index.ts:33-36`).
2. **`@liveoakv3/shared`'s actual Deno compatibility** — audit its dependency graph
   (currently just TypeScript + presumably `crypto.randomUUID`, per
   `stateExportService.ts:21`) against Deno's Node-compat layer rather than assuming it
   from Supabase's general npm-support claim.
3. **Local-dev first-admin bootstrap equivalent** — whether the Supabase CLI's local
   `service_role` key can replicate the emulator's `Authorization: Bearer owner` trick
   documented in `docs/deploy-demo.md:81-97`.
