-- Postgres-backed state_exports table (ticket #28): where the nightly per-state Job Record
-- export lands, replacing the Firestore `stateExports` collection
-- (functions/src/notifications/firestoreStateExportRepository.ts). Schema drawn from
-- packages/shared/src/stateExport.ts's StateExportBatch interface -- id/runId/generatedAt/
-- state/records, one row per state per run (mirroring one document per state per run today).

create table state_exports (
  id text primary key,
  run_id text not null,
  generated_at timestamptz not null,
  -- A USPS state abbreviation, or "UNKNOWN" when no state could be parsed from the address
  -- (StateExportBatch.state's comment).
  state text not null,
  -- StateExportBatch.records (JobRecord[]) stored as a single jsonb column rather than a
  -- separate table -- always read/written as one unit (stateExportService.ts's
  -- generateStateExport writes a whole batch per state, and nothing queries inside it), same
  -- reasoning as job_records.duplicate (20260814220000_job_records_table.sql).
  records jsonb not null
);

comment on table state_exports is
  'Nightly per-state Job Record export (ticket #28) -- Postgres analog of the Firestore '
  'stateExports collection. A derived, regenerated-nightly artifact (ADR-0003), not a '
  'separately maintained store. Read/written only by Edge Functions via a service_role '
  'client (see supabase/functions/_shared/postgresStateExportRepository.ts); RLS below '
  'denies anon/authenticated entirely, mirroring the users/job_records tables'' access '
  'pattern.';

-- Supports looking up every state's batch for a given run (e.g. re-reading a specific
-- night's export), the same access pattern the Firestore collection supports via runId
-- being embedded in each document's id.
create index state_exports_run_id_idx on state_exports (run_id);

alter table state_exports enable row level security;

-- Deliberately no policies for anon/authenticated: RLS with zero policies denies all
-- access by default for those roles. Only the service_role key -- used exclusively by
-- Edge Functions, never shipped to a client -- bypasses RLS, exactly mirroring the users/
-- job_records tables' access pattern.
--
-- Table-level GRANTs are also required (not just RLS bypass) since this project's Data API
-- doesn't auto-expose new public-schema tables without them (see the users table
-- migration's auto_expose_new_tables note) -- anon/authenticated intentionally get none.
grant select, insert, update, delete on table state_exports to service_role;

-- Second scheduled job on the pg_cron + pg_net harness (ticket #17, see
-- 20260814194632_scheduling_infra.sql for the full explanation of why this runs every
-- minute in UTC rather than natively at 21:00 America/Chicago): the real nightly state
-- export (ticket #28), firing after the 8pm Central Discrepancy email (ticket #27, not yet
-- built on Supabase -- scheduled-ping's TARGET_HOUR = 20 placeholder stands in for it today).
-- Reuses the same Vault secret names (edge_functions_url, edge_functions_service_key)
-- already seeded for scheduled-ping -- no new secrets needed. The nightlyStateExport Edge
-- Function itself gates real work behind isCentralWallClockTime(nowIso, 21, 0), DST-correct.
select
  cron.schedule(
    'nightly-state-export-every-minute',
    '* * * * *',
    $$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_url') || '/nightlyStateExport',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_service_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_service_key')
        )
      ) as request_id;
    $$
  );
