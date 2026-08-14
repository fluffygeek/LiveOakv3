-- Local-dev-only: seeds the Vault secrets supabase/migrations/20260814194632_scheduling_infra.sql
-- reads at cron-invocation time. Not run against production -- these are the well-known,
-- publicly documented local Supabase CLI demo keys (identical across every default local
-- project), not real secrets. In production, an operator seeds the equivalent secrets once
-- after `supabase db push`, with the real project URL and service_role key:
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1', 'edge_functions_url');
--   select vault.create_secret('<real service_role key>', 'edge_functions_service_key');
--
-- `http://kong:8000` is the local stack's internal Docker network address for the API
-- gateway that fronts Edge Functions -- not reachable as `localhost` from inside the
-- Postgres container, which is why this differs from the FUNCTIONS_URL `supabase start`
-- prints for use from the host machine.
select vault.create_secret('http://kong:8000/functions/v1', 'edge_functions_url');
select vault.create_secret(
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  'edge_functions_service_key'
);
