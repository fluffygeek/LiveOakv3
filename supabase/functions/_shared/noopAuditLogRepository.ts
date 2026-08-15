import type { AuditLogEntry } from "../../../packages/shared/src/auditLog.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";

/**
 * Placeholder pending a real Postgres `audit_log` table (ticket #23 -- "Postgres audit_log
 * table exists" is explicitly #23's acceptance criterion, not #21's). #21 needs *some*
 * `AuditLogRepository` to satisfy `CreateJobRecordDeps` (createJobRecord calls
 * `deps.auditLogRepo.append(...)` right after creating a record --
 * functions/src/jobRecords/jobRecordService.ts), but #21's acceptance criteria don't list
 * audit logging at all, and functions/src/jobRecords/inMemoryAuditLogRepository.ts is
 * explicitly commented "Test double -- never used by production code," so wiring that into
 * a real Edge Function would be wrong.
 *
 * Analogous to NotConfiguredAddressVerifier
 * (functions/src/jobRecords/notConfiguredAddressVerifier.ts): an intentional, clearly-labeled
 * no-op standing in for a vendor/table that doesn't exist yet on this transport, never
 * silently pretending to have persisted something it hasn't. `append` drops the entry;
 * `listByRecordId` always returns empty -- #23 replaces this with a real
 * PostgresAuditLogRepository once its migration lands.
 */
export class NoopAuditLogRepository implements AuditLogRepository {
  async append(_entry: AuditLogEntry): Promise<void> {
    // Intentionally discarded -- see class doc comment.
  }

  async listByRecordId(_recordId: string): Promise<AuditLogEntry[]> {
    return [];
  }
}
