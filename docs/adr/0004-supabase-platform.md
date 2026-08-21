---
status: accepted
supersedes: ADR-0001
---

# Supabase as the platform, superseding ADR-0001

LiveOakv3 has moved off Google Cloud/Firebase onto Supabase: Postgres (replacing Firestore) as the data store, Supabase Auth (replacing Firebase Auth) for sign-in, Edge Functions (replacing Cloud Functions' `onCall`) for the callable/transport layer, and `pg_cron`/`pg_net` (replacing Cloud Scheduler's `onSchedule`) for the nightly discrepancy-email and per-state-export jobs. This corrects ADR-0001's stated rationale rather than reversing a still-valid one: ADR-0001 chose Firebase because it "supports [Google Workspace domain-restricted sign-in] natively," but the enforcement was never a platform feature — it is, and always was, plain application code, `isAllowedWorkspaceDomain` (`packages/shared/src/workspaceDomain.ts`), called from `resolveAccess` (`functions/src/access/accessService.ts`) after sign-in, checking the verified email on the caller's token. The `hd` OAuth parameter set on both the Firebase and Supabase sign-in flows is a UI hint to Google's consent screen only, not the actual restriction, on either platform. Because that check is a provider-agnostic string comparison against a verified post-OAuth email, it ported to Supabase unchanged and runs identically today from Edge Functions (e.g. `supabase/functions/resolveMyAccess/handler.ts`) — meaning it was never a reason to prefer Firebase, and isn't a reason to prefer any particular platform going forward. See `docs/research/supabase-migration-effort.md` for the full effort/rationale breakdown that grounded this move.
