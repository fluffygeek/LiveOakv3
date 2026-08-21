-- Third scheduled job on the pg_cron + pg_net harness (ticket #17, see
-- 20260814194632_scheduling_infra.sql for the full explanation of why this runs every minute
-- in UTC rather than natively at 20:00 America/Chicago): the real nightly Discrepancy email
-- (ticket #27), replacing scheduled-ping's TARGET_HOUR = 20 placeholder now that the real job
-- exists, and firing before the 9pm Central state export (ticket #28,
-- 20260814230000_state_exports_table.sql) so the export reflects a settled day rather than
-- racing it. Reuses the same Vault secret names (edge_functions_url,
-- edge_functions_service_key) already seeded for scheduled-ping/nightlyStateExport -- no new
-- secrets needed. The nightlyDiscrepancyEmail Edge Function itself gates real work behind
-- isCentralWallClockTime(nowIso, 20, 0), DST-correct across the fall-back/spring-forward
-- transitions.
select
  cron.schedule(
    'nightly-discrepancy-email-every-minute',
    '* * * * *',
    $$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_url') || '/nightlyDiscrepancyEmail',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_service_key'),
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_functions_service_key')
        )
      ) as request_id;
    $$
  );
