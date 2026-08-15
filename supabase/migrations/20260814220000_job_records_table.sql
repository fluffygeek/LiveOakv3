-- Postgres-backed job_records table (ticket #21): where a Technician's submitted Job
-- Records live, replacing the Firestore `jobRecords` collection for the mobile-submit path.
-- Schema drawn from packages/shared/src/jobRecord.ts's JobRecord interface -- every field
-- there gets a column, plus one derived column not on the interface itself:
-- normalized_address_key, the Duplicate-matching key FirestoreJobRecordRepository.toDocument
-- computes and stores alongside the record today (functions/src/jobRecords/
-- firestoreJobRecordRepository.ts) since neither Firestore nor Postgres can run the shared
-- normalizeAddress() TS function inside a query -- the repository computes it in application
-- code before every insert/update (see supabase/functions/_shared/
-- postgresJobRecordRepository.ts).
--
-- Ticket #21 intentionally does not implement real duplicate detection (#22's scope) or a
-- Postgres audit_log table (#23's scope) -- this migration covers job_records only.

-- Mirrors packages/shared/src/jobRecord.ts's AddressVerificationStatus union.
create type job_record_address_verification_status as enum ('verified', 'unverified', 'newBuild');

create table job_records (
  record_id text primary key,
  job_id text not null,
  -- References the allowlist row (ticket #18/#20) for the Technician who submitted this
  -- record -- every caller reaching createJobRecord has already been resolved against
  -- `users` by resolveAccess, so this is always a real, active user at write time.
  technician_email text not null references users (email),
  address text not null,
  -- Null except when address_verification_status = 'verified' (packages/shared/src/
  -- jobRecord.ts's JobRecord.verifiedAddress comment).
  verified_address text,
  address_verification_status job_record_address_verification_status not null,
  work_code text not null,
  -- Whole number, linear feet -- JobRecord.footage's comment.
  footage integer not null check (footage >= 0),
  photo_urls text[] not null default '{}',
  notes text not null default '',
  -- Device-local time at the moment the Technician tapped Submit.
  submitted_at timestamptz not null,
  -- Server-received time -- may lag submitted_at when drafted offline.
  created_at timestamptz not null,
  timestamp_suspect boolean not null default false,
  -- JobRecord.duplicate (DuplicateLink: isDuplicate/linkedRecordIds/isPrimary) stored as a
  -- single jsonb column rather than split across three columns -- it's always read/written
  -- as one unit (see jobRecordService.ts's computeDuplicateLinks), so there's no query
  -- that needs to filter on its sub-fields independently. Defaults to the "no link" shape
  -- (packages/shared/src/jobRecord.ts's noDuplicateLink()).
  duplicate jsonb not null default '{"isDuplicate": false, "linkedRecordIds": [], "isPrimary": false}',
  discrepancy boolean not null default false,
  -- Non-null only while discrepancy is true (JobRecord.discrepancyReason's comment) --
  -- left unenforced by a check constraint since that invariant is a jobRecordReviewService.ts
  -- business rule, not a storage-layer one (mirrors how firestoreJobRecordRepository.ts
  -- doesn't enforce it either).
  discrepancy_reason text,
  closed boolean not null default false,
  pictures_downloaded boolean not null default false,
  -- Derived, query-only index field -- see file header. Never part of the JobRecord type
  -- itself; PostgresJobRecordRepository strips it back out when mapping a row to a
  -- JobRecord, the same way FirestoreJobRecordRepository.fromDocument does.
  normalized_address_key text not null
);

comment on table job_records is
  'Job Records a Technician submits from the mobile app (ticket #21) -- Postgres analog of '
  'the Firestore jobRecords collection. Read/written only by Edge Functions via a '
  'service_role client (see supabase/functions/_shared/postgresJobRecordRepository.ts); RLS '
  'below denies anon/authenticated entirely, mirroring the users table''s (ticket #18) and '
  'firestore.rules'' deny-all + Admin-SDK-only access pattern.';

-- Supports the Payroll/Application Administrator weekly list (listByTechnicianAndWindow)
-- and the future #22 duplicate-candidate lookup (createWithDuplicateLinking's normalized
-- address + since-timestamp query), same access patterns FirestoreJobRecordRepository
-- indexes via its where() clauses today.
create index job_records_technician_email_submitted_at_idx
  on job_records (technician_email, submitted_at);
create index job_records_normalized_address_key_submitted_at_idx
  on job_records (normalized_address_key, submitted_at);
-- Supports listWithActiveDiscrepancy's nightly Discrepancy-email query -- partial since
-- discrepancy = true is expected to be a small minority of rows.
create index job_records_active_discrepancy_idx
  on job_records (record_id) where discrepancy;

alter table job_records enable row level security;

-- Deliberately no policies for anon/authenticated: RLS with zero policies denies all
-- access by default for those roles. Only the service_role key -- used exclusively by
-- Edge Functions, never shipped to a client -- bypasses RLS, exactly mirroring the users
-- table's (20260814210000_users_table.sql) access pattern.
--
-- Table-level GRANTs are also required (not just RLS bypass) since this project's Data API
-- doesn't auto-expose new public-schema tables without them (see the users table migration's
-- auto_expose_new_tables note) -- anon/authenticated intentionally get none.
grant select, insert, update, delete on table job_records to service_role;
