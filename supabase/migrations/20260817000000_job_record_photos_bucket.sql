-- Supabase Storage bucket for Job Record photos (ticket #29): where a Technician's uploaded
-- photos live, written exclusively by the uploadJobRecordPhoto Edge Function's service_role
-- client (supabase/functions/uploadJobRecordPhoto) -- no direct client-to-bucket upload, per
-- the ticket's acceptance criteria. Created via migration (not the Studio dashboard, and not
-- supabase/config.toml's local-only `[storage.buckets.*]` declarative section) so bucket
-- creation is part of the same reproducible `supabase db push` deploy path as every other
-- piece of schema here (docs/deploy-runbook.md step 3) -- a dashboard-only bucket wouldn't
-- exist after a fresh `db push` against a new project.
--
-- Genuinely new: a repo-wide search confirmed there is no other Supabase Storage usage
-- anywhere in supabase/, functions/, packages/, or apps/ before this ticket, and photo upload
-- was never implemented against Firebase Storage either (see the ticket).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'job-record-photos',
  'job-record-photos',
  false, -- private: no object is readable via a public URL, only via a service_role client
         -- or a signed URL a service_role client mints (a later ticket's concern -- this one
         -- only needs upload).
  52428800, -- 50MiB, matching supabase/config.toml's [storage] file_size_limit for local dev;
            -- comfortably above a compressed phone-camera photo (see
            -- apps/mobile/src/jobRecords/SubmitJobScreen.tsx's ImagePicker quality: 0.7).
  array['image/jpeg', 'image/png', 'image/heic', 'image/heif']
);

-- storage.objects ships with row level security already enabled by the Storage extension
-- itself (every Supabase project's storage schema is created this way) -- this migration
-- only adds the policy, it does not need its own `alter table ... enable row level security`.
--
-- Mirrors the users/job_records tables' access pattern (20260814210000_users_table.sql,
-- 20260814220000_job_records_table.sql): a single explicit policy scoped to service_role and
-- to this bucket only, and deliberately no policies for anon/authenticated on this bucket --
-- zero matching policies denies all access by default for those roles, which is what makes
-- this "RLS-equivalent" per the ticket's acceptance criteria. Supabase Storage policies are
-- just RLS policies on storage.objects filtered by bucket_id; there is no separate mechanism.
--
-- Scoped to `bucket_id = 'job-record-photos'` (rather than granting service_role blanket
-- access to storage.objects) so this policy can't be read as authorizing service_role access
-- to some other bucket added later by mistake -- each bucket's Edge Function should get its
-- own scoped policy.
create policy "service_role_full_access_job_record_photos"
  on storage.objects
  for all
  to service_role
  using (bucket_id = 'job-record-photos')
  with check (bucket_id = 'job-record-photos');
