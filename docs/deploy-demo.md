# Deploying for a demo

One way to run a demo today: **local, via the Supabase CLI's Docker-based stack** — no
billing, no real Supabase project, no live URL. `supabase/config.toml` and
`supabase/seed.sql` are already committed (tickets #16/#17), so there's no `supabase
init` step for a fresh clone — just `supabase start`.

A second path — **a live, deployed Supabase project** reachable by anyone with a URL —
doesn't exist yet. Provisioning one is tracked separately in #37 ("Provision production
Supabase project"); once that lands, this doc will grow a second path the same way the
old Firebase-era version had one. Until then, this doc only covers local dev.

**Read [Known gaps](#known-gaps-worth-disclosing-before-the-demo) before you start** —
the migration from Firebase to Supabase is in progress and lands incrementally. As of
this writing, `supabase start` fails outright on an unmodified checkout (tracked as
#42), and a couple of other pieces (Google sign-in, the weekly-list screen) aren't wired
up locally yet either. None of that is specific to this doc; it reflects where `main`
actually is right now.

```mermaid
flowchart TD
    Start["Need to run a demo"] --> Stack["supabase start\n(Docker: Postgres, Auth, REST, Studio, Edge Functions)"]
    Stack --> Bootstrap["Bootstrap the first admin\nservice_role REST insert into public.users"]
    Bootstrap --> Web["npm run dev --workspace=apps/web"]
    Bootstrap --> Mobile["npx expo start (apps/mobile)"]
    Web -.- Gap["Edge Functions don't serve yet — #42\nresolveMyAccess/createJobRecord/etc blocked until fixed"]
    Mobile -.- Gap
```

## Prerequisites

- Node 20 (`functions/package.json` still pins `engines.node: "20"` for the
  not-yet-fully-retired Firebase Functions codebase; nothing in `apps/web` or
  `apps/mobile` pins a version, but the workspace is built and tested on Node 20).
- **Docker** on `PATH` and its daemon running — the local Supabase stack runs entirely as
  Docker containers (Postgres, GoTrue/Auth, PostgREST, Studio, Realtime, Storage, the
  Edge Functions runtime, etc.), replacing the old JVM-based Firestore/Auth emulators.
  Verified in this environment: `docker --version` → 29.7.2, `docker info` reachable.
- The `supabase` CLI — already a root `devDependencies` entry (`package.json`), so
  `npx supabase <command>` works with no separate install. Verified:
  `npx supabase --version` → 2.114.0.
- For the mobile app: the **Expo Go** app on a physical phone, or an iOS/Android
  simulator. Same as before — `apps/mobile` only has `expo start`/`--android`/`--ios`
  scripts, no standalone build config.

## Known gaps, worth disclosing before the demo

These are real, current states of `main` as of this writing (2026-08-14) — not something
this guide works around:

- **`supabase start` fails outright on an unmodified checkout — tracked as #42.**
  Several `supabase/functions/**` files (`_shared/postgresUserRepository.ts`,
  `resolvedAccessHandler.ts`, `callableHandler.ts`, every function's `handler.ts`)
  transitively import `functions/src/access/accessService.ts`, which imports
  `./userRepository.js` — a `.js`-extension import pointing at a sibling `.ts` file (the
  same Node/NodeNext-style pattern used throughout `functions/src/**`, unrelated to this
  ticket). `deno check`/`deno test` resolve this fine via `sloppy-imports`
  (`supabase/functions/deno.json`), but `supabase start`'s own Edge Function bundler does
  not, and fails before starting *any* container — not just the Edge Runtime one — with:
  ```
  {"_tag":"Error","error":{"code":"UnknownError","message":"failed to read file: open functions/src/access/userRepository.js: no such file or directory"}}
  ```
  Confirmed live in this environment, with and without `-x edge-runtime`, with
  `[edge_runtime] enabled = false`, and on a fresh Docker volume. **Verified workaround**
  for exercising everything below `supabase/functions/`: temporarily move the directory
  out of the way, start the stack, do your testing, move it back —
  ```bash
  mv supabase/functions /tmp/supabase-functions-aside
  npx supabase start
  # ...do your testing (see "Bootstrapping the first admin" below)...
  npx supabase stop
  mv /tmp/supabase-functions-aside supabase/functions
  ```
  This is a stopgap, not a workflow — until #42 is fixed, none of the Edge
  Functions (`resolveMyAccess`, `inviteUser`, `updateUserRoles`, `revokeUser`,
  `listUsers`, `setDistributionListMembership`, `createJobRecord`, `getJobRecord`,
  `listJobRecords`) can be exercised through Docker, which in turn means **the web and
  mobile apps' sign-in flow can't complete locally** (`useAuth.ts` calls
  `resolveMyAccess` right after auth) — so today, the fastest way to see a real local
  demo end-to-end is to watch #42 land.
- **Google sign-in isn't wired for local dev.** `supabase/config.toml`'s
  `[auth.external.google]` block is `enabled = false`, with a comment noting no real
  Google OAuth client is provisioned (out of scope for tickets #18/#19). Unlike the old
  Firebase Auth emulator — which used Firebase's own built-in OAuth client, so the web
  app's "Sign in with Google" button worked with zero extra setup — Supabase's Google
  provider always requires you to register your own Google Cloud OAuth client, even
  locally. That hasn't been done in this repo yet. Both `apps/web/src/auth/SignIn.tsx`
  and the mobile equivalent only expose a Google button, so there's currently no
  UI-driven way to sign in locally at all (email/password auth is enabled server-side —
  `supabase/config.toml`'s `[auth.email]` — but no UI is wired to it).
- **The mobile weekly-list screen still calls the old Firebase callable.**
  `apps/mobile/src/jobRecords/api.ts`'s `listMyWeeklyJobRecordsFn` still uses
  `httpsCallable` from `firebase/functions` — only `createJobRecord` (ticket #21) has
  been ported onto `supabase.functions.invoke()` so far. Submitting a job record from
  the mobile app is otherwise ported and, per #21, calls the real `createJobRecord` Edge
  Function — once #42 is fixed, that part of the demo should work.
- **Photos never leave the phone.** Unchanged from before —
  `apps/mobile/src/jobRecords/storage.ts` still stores the camera roll's local `file://`
  URI directly; there's no Storage upload wired up yet (tracked as #29, open).
- **Address verification, the nightly discrepancy email, and the nightly state export
  are still Firebase/Firestore-only** — `functions/src/jobRecords`'s
  `NotConfiguredAddressVerifier`, and `functions/src/notifications`'s
  `NotConfiguredEmailSender` / `firestoreStateExportRepository.ts`, haven't been ported
  onto the Supabase stack at all (tracked as #27 and #28, both open). This local-Supabase
  demo path doesn't exercise them either way.

## Bootstrapping the first admin

Every admin-only Edge Function (`inviteUser`, `updateUserRoles`, etc., once #42 is fixed)
calls `resolveAccess`/`requireApplicationAdministrator`
(`functions/src/access/accessService.ts`, unchanged) — there's no self-serve first-admin
flow. The `users` table
(`supabase/migrations/20260814210000_users_table.sql`) has row-level security enabled
with **zero policies for `anon`/`authenticated`**, which denies those roles all access by
default — the Postgres/PostgREST analog of the old Firestore-rules deny-all. Only a
`service_role`-authenticated request bypasses RLS, exactly the way
`supabase/functions/_shared/postgresUserRepository.ts`'s `serviceRoleClient()` does it
from inside an Edge Function — this is the direct replacement for the old
`Authorization: Bearer owner` emulator trick.

`supabase start` prints (and `supabase status` re-prints) the local `API_URL` and
`SERVICE_ROLE_KEY` — for an unmodified `supabase/config.toml`, these are the well-known,
publicly documented local Supabase CLI demo values (identical across every default local
project, not a secret — see the comment at the top of `supabase/seed.sql`):

```
API_URL=http://127.0.0.1:54321
SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU
```

Insert the first admin directly via PostgREST, using the `users` table's actual
snake_case columns (`supabase/migrations/20260814210000_users_table.sql` — not the
camelCase `UserRecord` TS shape those columns get mapped to/from by
`postgresUserRepository.ts`):

```bash
curl -X POST "$API_URL/rest/v1/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d '{
    "email": "you@yourdomain.com",
    "roles": ["applicationAdministrator"],
    "active": true,
    "on_distribution_list": false
  }'
```

**Verified live** in this environment (Docker + `supabase@2.114.0`, stack started per the
#42 workaround above): this returns the inserted row with `invited_at`/`updated_at`
defaulted by the table, and a follow-up `GET
$API_URL/rest/v1/users?email=eq.you%40yourdomain.com` with the same headers returns it
back. The same request with the `anon` key instead of `service_role` gets a 401 —
```json
{"code":"42501","message":"permission denied for table users", ...}
```
— confirming the RLS-deny-all + no-anon-grants setup actually holds.

If you'd rather go straight through Postgres: `supabase status` also prints `DB_URL`
(`postgresql://postgres:postgres@127.0.0.1:54322/postgres` by default), so
`psql "$DB_URL" -c "insert into users (email, roles, active, on_distribution_list) values ('you@yourdomain.com', '{applicationAdministrator}', true, false);"`
is an equally valid alternative — not separately verified here, but it's the same table,
same columns, and bypasses PostgREST/RLS entirely by using the Postgres superuser role
the local stack seeds.

Once that row exists, once #42 is fixed and Google sign-in is configured (see
[Known gaps](#known-gaps-worth-disclosing-before-the-demo)), signing in as that email
resolves as an Application Administrator via `resolveMyAccess` — invite everyone else
from the Manage Users screen from there, same as the Firebase-era flow.

## Web app

```bash
# from the repo root, after the workaround in "Known gaps" above:
npx supabase start

npm run dev --workspace=apps/web   # vite dev server, defaults to localhost:5173
```

`apps/web/src/supabase.ts` defaults `VITE_SUPABASE_URL` to `http://127.0.0.1:54321`,
matching `supabase/config.toml`'s `[api] port`, so no `.env` is needed for the URL.
**`VITE_SUPABASE_ANON_KEY` has no safe default, though** — unlike the Firebase emulator
(which accepted any placeholder API key), Supabase validates the anon key against the
project's real JWT signing key even locally, so `apps/web/src/supabase.ts` defaults it to
`""` and auth calls will fail without a real one. Set it from `supabase status`'s
`ANON_KEY` (the local demo value is the well-known one from `supabase/seed.sql`'s
comment, `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0`)
in `apps/web/.env`:

```
VITE_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
```

```mermaid
sequenceDiagram
    participant You
    participant Docker as Docker (supabase start)
    participant Web as apps/web (vite dev)

    You->>Docker: npx supabase start
    You->>Web: npm run dev --workspace=apps/web
    Web->>Docker: REST/Auth calls via VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
    You->>Docker: bootstrap first admin (service_role curl or psql)
    You->>Web: sign in — blocked locally today by #42 + missing Google OAuth client
```

## Mobile app

Same idea, `EXPO_PUBLIC_*` names this time (`apps/mobile/src/supabase.ts`):

```bash
npx expo start --clear
```

`EXPO_PUBLIC_SUPABASE_URL` also defaults to `http://127.0.0.1:54321`
(`supabase/config.toml`'s `[api] port`), and `127.0.0.1` **will not work from a physical
phone** — same caveat as the old Firebase emulator setup, a loopback address always means
"this device," so a phone resolves it to itself, not your laptop. Set it explicitly,
e.g. in `apps/mobile/.env`:

```
# find your machine's LAN IP first (ipconfig / ifconfig)
EXPO_PUBLIC_SUPABASE_URL=http://192.168.1.23:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
```

`EXPO_PUBLIC_SUPABASE_ANON_KEY` has the same no-safe-default caveat as the web app's
`VITE_SUPABASE_ANON_KEY` above. A simulator running on the same machine can keep the
`127.0.0.1` default for the URL.

Scan the QR code with Expo Go (physical phone) or press `i`/`a` in the Expo CLI for a
simulator. As with the web app, signing in is blocked locally today by #42 and the
missing Google OAuth client (see [Known gaps](#known-gaps-worth-disclosing-before-the-demo)).
