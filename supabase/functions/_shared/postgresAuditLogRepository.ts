import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLogEntry } from "../../../packages/shared/src/auditLog.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";

const TABLE = "audit_log";

/** Shape of a row in the `audit_log` table (supabase/migrations/*_audit_log_table.sql) --
 * snake_case columns, `before`/`after` stored as jsonb. */
interface AuditLogRow {
  id: string;
  record_id: string;
  actor_email: string;
  action: string;
  timestamp: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

function fromRow(row: AuditLogRow): AuditLogEntry {
  return {
    id: row.id,
    recordId: row.record_id,
    actorEmail: row.actor_email,
    action: row.action,
    timestamp: row.timestamp,
    before: row.before,
    after: row.after,
  };
}

function toRow(entry: AuditLogEntry): AuditLogRow {
  return {
    id: entry.id,
    record_id: entry.recordId,
    actor_email: entry.actorEmail,
    action: entry.action,
    timestamp: entry.timestamp,
    before: entry.before,
    after: entry.after,
  };
}

/**
 * Postgres adapter for the `audit_log` table -- the Edge Function analog of
 * functions/src/jobRecords/firestoreAuditLogRepository.ts. Thin by design, same division of
 * labor as PostgresJobRecordRepository: this class only translates between `AuditLogEntry`
 * and `audit_log` table rows, never deciding *when* to write an entry -- that's
 * jobRecordReviewService.ts's `writeAuditEntry`.
 *
 * Append-only, matching the interface's contract (functions/src/jobRecords/
 * auditLogRepository.ts): only `append` (a plain insert) and `listByRecordId` (ordered
 * oldest-first, per that interface's doc comment) are implemented -- no update/delete, same
 * as the table's GRANTs (see the migration).
 *
 * Takes an injected `SupabaseClient` (mirrors `PostgresJobRecordRepository`/
 * `PostgresUserRepository`) rather than constructing its own -- production wiring uses
 * `serviceRoleClient()` (postgresUserRepository.ts); tests inject a fake.
 */
export class PostgresAuditLogRepository implements AuditLogRepository {
  constructor(private readonly client: SupabaseClient) {}

  async append(entry: AuditLogEntry): Promise<void> {
    const { error } = await this.client.from(TABLE).insert(toRow(entry));
    if (error) {
      throw new Error(`Failed to append audit log entry ${entry.id}: ${error.message}`);
    }
  }

  async listByRecordId(recordId: string): Promise<AuditLogEntry[]> {
    const { data, error } = await this.client
      .from(TABLE)
      .select("*")
      .eq("record_id", recordId)
      .order("timestamp", { ascending: true });
    if (error) {
      throw new Error(`Failed to list audit log entries for ${recordId}: ${error.message}`);
    }
    if (!data) {
      return [];
    }
    return (data as AuditLogRow[]).map(fromRow);
  }
}
