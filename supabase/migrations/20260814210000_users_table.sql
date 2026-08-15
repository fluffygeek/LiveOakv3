-- Postgres-backed users table (ticket #18): the allowlist + role source resolveAccess
-- (functions/src/access/accessService.ts, unchanged) reads from, replacing the Firebase
-- Auth + Firestore `users` collection flow. Schema drawn from packages/shared/src/user.ts's
-- UserRecord -- email, roles: Role[], active, invitedAt, updatedAt, onDistributionList.

-- Mirrors packages/shared/src/roles.ts's ROLES tuple. `roles` is stored as a native
-- Postgres array of this enum (rather than a join table) per ticket #18's acceptance
-- criteria -- see docs/research/supabase-migration-effort.md §2.2 for the array-vs-join-table
-- tradeoff this resolves.
create type app_role as enum ('technician', 'payrollAdministrator', 'applicationAdministrator');

create table users (
  email text primary key,
  roles app_role[] not null default '{}',
  active boolean not null default true,
  invited_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  on_distribution_list boolean not null default false
);

comment on table users is
  'Allowlist + role source for resolveAccess (ticket #18) -- Postgres analog of the '
  'Firestore users collection. Read/written only by Edge Functions via a service_role '
  'client (see supabase/functions/_shared/postgresUserRepository.ts); RLS below denies '
  'anon/authenticated entirely, mirroring firestore.rules deny-all + Admin-SDK-only access.';

alter table users enable row level security;

-- Deliberately no policies for anon/authenticated: RLS with zero policies denies all
-- access by default for those roles. Only the service_role key -- used exclusively by
-- Edge Functions, never shipped to a client -- bypasses RLS, exactly mirroring today's
-- Admin-SDK-only Firestore access pattern (see docs/research/supabase-migration-effort.md
-- §2.2's "service_role key bypasses RLS entirely" finding).
--
-- RLS bypass alone isn't sufficient, though: this project's Data API doesn't
-- auto-expose new public-schema tables to any role without explicit GRANTs (the current
-- Supabase default -- see the `auto_expose_new_tables` note in supabase/config.toml), so
-- service_role also needs the table-level privileges below. anon/authenticated
-- intentionally get none -- confirmed locally that omitting them yields a
-- "permission denied for table users" error via PostgREST, independent of and in
-- addition to the RLS deny-all above.
grant select, insert, update, delete on table users to service_role;
