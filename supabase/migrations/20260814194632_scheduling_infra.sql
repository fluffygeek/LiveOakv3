-- Scheduling harness (ticket #17): pg_cron + pg_net calling Edge Functions, authenticated
-- via a Vault-stored service token. Reused as-is by the real nightly jobs (tickets #27/#28).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Spike finding: cron.timezone -- the pg_cron GUC that would let a job run natively in
-- America/Chicago -- is a postmaster-context Postgres setting. Supabase's managed platform
-- only lets tenants configure a specific allowlisted set of restart-capable parameters (via
-- `supabase postgres-config`, see
-- https://supabase.com/docs/guides/database/custom-postgres-config), and cron.timezone is
-- not on that list -- only cron.log_statement is, among cron.* settings. Two GitHub
-- discussions asking for cron.timezone support (2023, 2025) remain open/unanswered as of
-- this research. Conclusion: cron.timezone is NOT settable on managed Supabase.
--
-- So every schedule below runs in UTC (the default, unconfigurable on managed Supabase),
-- firing every minute; the Edge Function being called does its own DST-aware wall-clock
-- check (packages/shared/src/centralTime.ts, mirroring easternWeekWindow's technique) to
-- decide whether "now" is actually the target Central time and do real work, or no-op.
--
-- `scheduled-ping` is a placeholder proving this harness end-to-end -- not a real job.
--
-- The URL and service key are read from Vault at *invocation* time (the subquery runs each
-- time the job fires, not when it's scheduled), so seeding those secrets can happen after
-- this migration runs -- see supabase/seed.sql for local dev, and the deploy runbook for
-- production, where an operator seeds the real project URL and service_role key the same
-- way once, after `supabase db push`.
select
  cron.schedule(
    'scheduled-ping-every-minute',
    '* * * * *',
    $$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_url') || '/scheduled-ping',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_service_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_service_key')
        )
      ) as request_id;
    $$
  );
