import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeAddress } from "../../../packages/shared/src/address.ts";
import type {
  AddressVerificationStatus,
  DuplicateLink,
  JobRecord,
} from "../../../packages/shared/src/jobRecord.ts";
import type {
  DuplicateLinkingResult,
  JobRecordRepository,
} from "../../../functions/src/jobRecords/jobRecordRepository.ts";

const TABLE = "job_records";

/** Shape of a row in the `job_records` table (supabase/migrations/*_job_records_table.sql) --
 * snake_case columns, `duplicate` stored as jsonb, `photo_urls` as a native Postgres array. */
interface JobRecordRow {
  record_id: string;
  job_id: string;
  technician_email: string;
  address: string;
  verified_address: string | null;
  address_verification_status: AddressVerificationStatus;
  work_code: string;
  footage: number;
  photo_urls: string[];
  notes: string;
  submitted_at: string;
  created_at: string;
  timestamp_suspect: boolean;
  duplicate: DuplicateLink;
  discrepancy: boolean;
  discrepancy_reason: string | null;
  closed: boolean;
  pictures_downloaded: boolean;
  normalized_address_key: string;
}

function fromRow(row: JobRecordRow): JobRecord {
  return {
    recordId: row.record_id,
    jobId: row.job_id,
    technicianEmail: row.technician_email,
    address: row.address,
    verifiedAddress: row.verified_address,
    addressVerificationStatus: row.address_verification_status,
    workCode: row.work_code,
    footage: row.footage,
    photoUrls: row.photo_urls,
    notes: row.notes,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    timestampSuspect: row.timestamp_suspect,
    duplicate: row.duplicate,
    discrepancy: row.discrepancy,
    discrepancyReason: row.discrepancy_reason,
    closed: row.closed,
    picturesDownloaded: row.pictures_downloaded,
  };
}

function toRow(record: JobRecord): JobRecordRow {
  return {
    record_id: record.recordId,
    job_id: record.jobId,
    technician_email: record.technicianEmail,
    address: record.address,
    verified_address: record.verifiedAddress,
    address_verification_status: record.addressVerificationStatus,
    work_code: record.workCode,
    footage: record.footage,
    photo_urls: record.photoUrls,
    notes: record.notes,
    submitted_at: record.submittedAt,
    created_at: record.createdAt,
    timestamp_suspect: record.timestampSuspect,
    duplicate: record.duplicate,
    discrepancy: record.discrepancy,
    discrepancy_reason: record.discrepancyReason,
    closed: record.closed,
    pictures_downloaded: record.picturesDownloaded,
    // Query-only index field -- Postgres can't compute normalizeAddress() on the fly, so
    // it's derived here and stored alongside the record, same division of labor as
    // FirestoreJobRecordRepository.toDocument.
    normalized_address_key: normalizeAddress(record.verifiedAddress ?? record.address),
  };
}

/**
 * Postgres adapter for the `job_records` table -- the Edge Function analog of
 * functions/src/jobRecords/firestoreJobRecordRepository.ts. Thin by design: business rules
 * (photo minimums, Duplicate-link computation, Discrepancy/Closed guards, etc.) live in
 * jobRecordService.ts / jobRecordReviewService.ts, not here -- this class only translates
 * between `JobRecord` and `job_records` table rows.
 *
 * `createWithDuplicateLinking` is the one method that deliberately does NOT mirror
 * FirestoreJobRecordRepository's real behavior yet (ticket #21's scope explicitly excludes
 * duplicate detection -- that's #22's job): rather than running the "find candidate matches
 * within the window, row-lock, link" query, it always calls `buildRecord` with an empty
 * `matches` array (so every new record comes back with `noDuplicateLink()`, per
 * jobRecordService.ts's computeDuplicateLinks) and then does a plain INSERT of the
 * resulting record. This is NOT a no-op: it's the ONLY way createJobRecord persists a new
 * record (see jobRecordService.ts), so real persistence has to happen here for a Technician's
 * submission to actually show up in listJobRecords/getJobRecord. #22 replaces the empty-array
 * shortcut with a real "select matching rows within the 6-month window, `for update` to lock
 * them, then write everything in one transaction" implementation -- Postgres, unlike
 * Firestore, doesn't need a separate transaction API for that; it'll use a single
 * `client.rpc(...)` or a direct `pg` transaction.
 */
export class PostgresJobRecordRepository implements JobRecordRepository {
  constructor(private readonly client: SupabaseClient) {}

  async update(record: JobRecord): Promise<void> {
    const { error } = await this.client.from(TABLE).upsert(toRow(record));
    if (error) {
      throw new Error(`Failed to save job record ${record.recordId}: ${error.message}`);
    }
  }

  async updateMany(records: JobRecord[]): Promise<void> {
    if (records.length === 0) return;
    // A single multi-row upsert is one Postgres statement, so it commits (or fails) as one
    // atomic unit -- satisfying the "written atomically" requirement callers like
    // overrideDuplicatePrimary/unlinkDuplicate (jobRecordReviewService.ts) rely on, without
    // needing an explicit transaction API the way FirestoreJobRecordRepository needs
    // db.batch().
    const { error } = await this.client.from(TABLE).upsert(records.map(toRow));
    if (error) {
      throw new Error(`Failed to save ${records.length} job records: ${error.message}`);
    }
  }

  async getById(recordId: string): Promise<JobRecord | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select("*")
      .eq("record_id", recordId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load job record ${recordId}: ${error.message}`);
    }
    return data ? fromRow(data as JobRecordRow) : null;
  }

  async list(): Promise<JobRecord[]> {
    const { data, error } = await this.client.from(TABLE).select("*");
    if (error) {
      throw new Error(`Failed to list job records: ${error.message}`);
    }
    return (data as JobRecordRow[]).map(fromRow);
  }

  async listByTechnicianAndWindow(
    technicianEmail: string,
    startIso: string,
    endIso: string,
  ): Promise<JobRecord[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select("*")
      .eq("technician_email", technicianEmail)
      .gte("submitted_at", startIso)
      .lt("submitted_at", endIso);
    if (error) {
      throw new Error(
        `Failed to list job records for ${technicianEmail} in [${startIso}, ${endIso}): ${error.message}`,
      );
    }
    return (data as JobRecordRow[]).map(fromRow);
  }

  async listWithActiveDiscrepancy(): Promise<JobRecord[]> {
    const { data, error } = await this.client.from(TABLE).select("*").eq("discrepancy", true);
    if (error) {
      throw new Error(`Failed to list job records with an active discrepancy: ${error.message}`);
    }
    return (data as JobRecordRow[]).map(fromRow);
  }

  async createWithDuplicateLinking(
    _normalizedAddress: string,
    _sinceIso: string,
    buildRecord: (matches: JobRecord[]) => DuplicateLinkingResult,
  ): Promise<JobRecord> {
    // See the class doc comment: #21 intentionally skips the real candidate-matching query
    // (#22's scope), always passing zero matches so `buildRecord` returns a record with
    // `noDuplicateLink()` and an empty `updatedMatches`.
    const { record, updatedMatches } = buildRecord([]);

    const { error } = await this.client.from(TABLE).insert(toRow(record));
    if (error) {
      throw new Error(`Failed to create job record ${record.recordId}: ${error.message}`);
    }

    // Always empty today (see above), but honored generically in case a future caller of
    // this interface method ever passes non-empty matches through some other path.
    if (updatedMatches.length > 0) {
      await this.updateMany(updatedMatches);
    }

    return record;
  }
}
