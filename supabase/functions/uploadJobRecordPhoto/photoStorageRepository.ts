import type { SupabaseClient } from "@supabase/supabase-js";

/** Matches the bucket `id`/`name` created by
 * supabase/migrations/20260817000000_job_record_photos_bucket.sql. */
export const JOB_RECORD_PHOTOS_BUCKET = "job-record-photos";

export interface PhotoStorageRepository {
  /** Uploads photo bytes to the given object path. Throws on failure. */
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/**
 * Supabase Storage adapter for the job-record-photos bucket -- the Storage analog of
 * PostgresUserRepository/PostgresJobRecordRepository (../_shared/postgresUserRepository.ts,
 * ../_shared/postgresJobRecordRepository.ts): takes an injected SupabaseClient rather than
 * constructing its own. Production wiring (index.ts) uses serviceRoleClient(), so the upload
 * bypasses storage.objects' RLS -- which denies anon/authenticated entirely for this bucket,
 * see the migration above -- the same server-side-only trust boundary every other repository
 * in this codebase relies on. Tests inject a fake.
 */
export class SupabasePhotoStorageRepository implements PhotoStorageRepository {
  constructor(private readonly client: SupabaseClient) {}

  async upload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.client.storage
      .from(JOB_RECORD_PHOTOS_BUCKET)
      .upload(path, bytes, { contentType, upsert: false });
    if (error) {
      throw new Error(`Failed to upload photo ${path}: ${error.message}`);
    }
  }
}
