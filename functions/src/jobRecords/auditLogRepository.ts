import type { AuditLogEntry } from "@liveoakv3/shared";

export interface AuditLogRepository {
  append(entry: AuditLogEntry): Promise<void>;
}
