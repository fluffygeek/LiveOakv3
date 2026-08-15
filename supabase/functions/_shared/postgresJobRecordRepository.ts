import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
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

/**
 * The `postgres` (postgres.js) tagged-template client type, inferred from its factory
 * function rather than imported by name -- the npm package's runtime API (what this file
 * actually depends on) is stable across versions in a way its exported type names aren't
 * guaranteed to be.
 */
type DirectSql = ReturnType<typeof postgres>;

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

// Columns that get overwritten by createWithDuplicateLinking's `updatedMatches` UPDATE --
// every JobRecordRow column except the primary key, which appears only in the WHERE clause.
const UPDATABLE_COLUMNS = [
  "job_id",
  "technician_email",
  "address",
  "verified_address",
  "address_verification_status",
  "work_code",
  "footage",
  "photo_urls",
  "notes",
  "submitted_at",
  "created_at",
  "timestamp_suspect",
  "duplicate",
  "discrepancy",
  "discrepancy_reason",
  "closed",
  "pictures_downloaded",
  "normalized_address_key",
] as const satisfies readonly (keyof JobRecordRow)[];

/**
 * Lazily created and cached across requests handled by the same warm Deno isolate --
 * mirrors postgresUserRepository.ts's `serviceRoleClient()` caching, but for a *direct*
 * Postgres connection (`SUPABASE_DB_URL`) rather than the PostgREST-backed `SupabaseClient`
 * (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Only `createWithDuplicateLinking` needs this:
 * see the class doc comment for why PostgREST can't do the job.
 */
let cachedDirectSql: DirectSql | undefined;

function directSql(): DirectSql {
  if (!cachedDirectSql) {
    const dbUrl = Deno.env.get("SUPABASE_DB_URL");
    if (!dbUrl) {
      throw new Error("SUPABASE_DB_URL must be set");
    }
    cachedDirectSql = postgres(dbUrl);
  }
  return cachedDirectSql;
}

/**
 * Postgres adapter for the `job_records` table -- the Edge Function analog of
 * functions/src/jobRecords/firestoreJobRecordRepository.ts. Thin by design: business rules
 * (photo minimums, Duplicate-link computation, Discrepancy/Closed guards, etc.) live in
 * jobRecordService.ts / jobRecordReviewService.ts, not here -- this class only translates
 * between `JobRecord` and `job_records` table rows.
 *
 * Every method except `createWithDuplicateLinking` goes through `client`, the
 * PostgREST-backed `SupabaseClient` injected by the constructor (mirrors
 * `PostgresUserRepository`). `createWithDuplicateLinking` is different: PostgREST's REST
 * interface has no way to express `SELECT ... FOR UPDATE` row locking or a multi-statement
 * transaction (each `.from(table)...` call is one stateless HTTP request), and this
 * interface method's shape -- `buildRecord` is a TypeScript callback that must run
 * *mid-transaction*, after the candidate matches are locked but before the new record is
 * inserted -- can't be expressed as a `.rpc()` call to a stored procedure either, since a
 * stored procedure can't call back into TS code partway through. So this method alone uses
 * `sql`/`directSql()`, a real Postgres connection (via the `postgres` / postgres.js package,
 * imported as `npm:postgres` -- see deno.json) with genuine `BEGIN`/`FOR UPDATE`/`COMMIT`
 * semantics, connected via the direct Postgres connection string rather than the PostgREST
 * URL. See that method's doc comment for the locking strategy itself.
 */
export class PostgresJobRecordRepository implements JobRecordRepository {
  /**
   * `directSqlOverride` lets tests point `createWithDuplicateLinking` at a specific Postgres
   * connection (e.g. a local `supabase start` instance) without mutating `SUPABASE_DB_URL`.
   * Production wiring (createJobRecord/index.ts) omits it, so the method falls back to the
   * lazily-cached `directSql()` above.
   */
  constructor(
    private readonly client: SupabaseClient,
    private readonly directSqlOverride?: DirectSql,
  ) {}

  private sql(): DirectSql {
    return this.directSqlOverride ?? directSql();
  }

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

  /**
   * Mirrors FirestoreJobRecordRepository.createWithDuplicateLinking's shape via a real
   * Postgres transaction instead of `db.runTransaction`:
   *
   * 1. `pg_advisory_xact_lock(hashtext(normalizedAddress))` -- an advisory lock keyed on the
   *    normalized address, held for the rest of the transaction (Postgres releases it
   *    automatically on COMMIT/ROLLBACK). This is what makes the genuinely-new-address race
   *    safe: when zero rows exist yet for this address, step 2's `FOR UPDATE` has nothing to
   *    lock, so without a lock taken *before* the read, two concurrent transactions could
   *    both SELECT zero matches and both decide they're the sole/primary record -- the exact
   *    lost-update bug this method exists to prevent. Taking this lock first serializes
   *    every createWithDuplicateLinking call for the same address: whichever transaction
   *    loses the race blocks here until the winner commits (making its insert visible), so
   *    its own SELECT below is then guaranteed to see it. `hashtext(...)::bigint` folds the
   *    address into the single bigint key `pg_advisory_xact_lock` takes; a hash collision
   *    between two different addresses would only cause unnecessary serialization between
   *    them, not an incorrect result.
   * 2. `SELECT ... FOR UPDATE` -- fetches candidate matches (same address, submitted on/after
   *    `sinceIso`) and row-locks them, satisfying #22's acceptance criterion directly and
   *    guarding against any other writer of these specific rows mid-transaction.
   * 3. `buildRecord(matches)` runs the business logic (jobRecordService.ts's
   *    computeDuplicateLinks) against the locked matches, entirely in TypeScript.
   * 4. INSERT the new record and UPDATE every updated match, all inside the same transaction.
   * 5. Returning from the `sql.begin` callback commits; throwing rolls back.
   */
  async createWithDuplicateLinking(
    normalizedAddress: string,
    sinceIso: string,
    buildRecord: (matches: JobRecord[]) => DuplicateLinkingResult,
  ): Promise<JobRecord> {
    const sql = this.sql();

    return await sql.begin(async (tx) => {
      // See the call sites below: postgres.js's column-helper (`tx(row, ...columns)`) wants
      // every value typed as plain JSON-compatible data; `DuplicateLink` is a named
      // interface rather than an index-signature object, so TS rejects it unless it's
      // re-wrapped with `tx.json(...)` first. The runtime write is the same jsonb value
      // either way.
      const insertableRow = (row: JobRecordRow): Record<string, unknown> => ({
        ...row,
        // deno-lint-ignore no-explicit-any
        duplicate: tx.json(row.duplicate as any),
      });

      await tx`select pg_advisory_xact_lock(hashtext(${normalizedAddress})::bigint)`;

      const rows = await tx<JobRecordRow[]>`
        select * from job_records
        where normalized_address_key = ${normalizedAddress} and submitted_at >= ${sinceIso}
        for update
      `;
      const matches = rows.map(fromRow);
      const { record, updatedMatches } = buildRecord(matches);

      await tx`insert into job_records ${tx(insertableRow(toRow(record)))}`;

      for (const updatedMatch of updatedMatches) {
        const row = toRow(updatedMatch);
        await tx`
          update job_records set ${tx(insertableRow(row), ...UPDATABLE_COLUMNS)}
          where record_id = ${row.record_id}
        `;
      }

      return record;
    });
  }
}
