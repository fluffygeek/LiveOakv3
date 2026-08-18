-- Postgres-backed audit_log table (ticket #23): field-level audit trail for Job Record
-- edits, replacing the Firestore `auditLog` collection. Schema drawn from packages/shared/
-- src/auditLog.ts's AuditLogEntry interface -- every field there gets a column.
--
-- Append-only: jobRecordReviewService.ts's writeAuditEntry only ever calls
-- AuditLogRepository.append (functions/src/jobRecords/auditLogRepository.ts) -- there is no
-- update/delete path, mirroring firestoreAuditLogRepository.ts, which never mutates or
-- removes an existing entry either.
--
-- Ticket #21 stood up job_records without this table (supabase/migrations/
-- 20260814220000_job_records_table.sql's header comment says so explicitly), wiring
-- createJobRecord's audit writes through a NoopAuditLogRepository placeholder
-- (supabase/functions/_shared/noopAuditLogRepository.ts) in the meantime. This migration is
-- what that placeholder's own doc comment says #23 replaces it with.

create table audit_log (
  id text primary key,
  -- No foreign key to job_records(record_id): entries must remain readable even if a Job
  -- Record were ever deleted (it currently never is, but the audit trail's job is to
  -- outlive the record it describes, not depend on it).
  record_id text not null,
  actor_email text not null,
  action text not null,
  timestamp timestamptz not null,
  -- Null for fields that don't have a "before" state to report (e.g. picturesDownloaded's
  -- comment in FirestoreAuditLogRepository's shape reference is symmetric: both before/after
  -- are always populated by writeAuditEntry today, but AuditLogEntry types them nullable, so
  -- the column follows suit rather than adding a not-null constraint the type doesn't have).
  before jsonb,
  "after" jsonb
);

comment on table audit_log is
  'Field-level audit trail for Job Record edits (ticket #23) -- Postgres analog of the '
  'Firestore auditLog collection. Append-only, written by jobRecordReviewService.ts''s '
  'writeAuditEntry via PostgresAuditLogRepository (supabase/functions/_shared/'
  'postgresAuditLogRepository.ts). Read/written only by Edge Functions via a service_role '
  'client; RLS below denies anon/authenticated entirely, mirroring job_records'' (ticket #21) '
  'and users'' (ticket #18) deny-all + Admin-SDK-only access pattern.';

-- Supports listByRecordId (functions/src/jobRecords/auditLogRepository.ts), the admin-facing
-- audit history view's only read query: every entry for one Job Record, ordered oldest-first
-- -- the exact composite the acceptance criteria calls out.
create index audit_log_record_id_timestamp_idx on audit_log (record_id, timestamp);

alter table audit_log enable row level security;

-- Deliberately no policies for anon/authenticated: RLS with zero policies denies all access
-- by default for those roles. Only the service_role key -- used exclusively by Edge
-- Functions, never shipped to a client -- bypasses RLS, exactly mirroring job_records' and
-- users' access pattern.
--
-- Table-level GRANTs are also required (not just RLS bypass) since this project's Data API
-- doesn't auto-expose new public-schema tables without them (see the users table migration's
-- auto_expose_new_tables note). No update/delete grant: the repository only ever inserts and
-- selects (append-only, see file header), and withholding the privilege at the database level
-- keeps that invariant enforced even if application code regresses.
grant select, insert on table audit_log to service_role;
