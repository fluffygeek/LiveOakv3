import type { AuditLogEntry } from "@liveoakv3/shared";

export interface AuditLogRepository {
  append(entry: AuditLogEntry): Promise<void>;
  /** All entries for a Job Record, for the admin-facing audit history view. */
  listByRecordId(recordId: string): Promise<AuditLogEntry[]>;
}
