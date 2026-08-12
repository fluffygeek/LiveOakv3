import type { AuditLogEntry } from "@liveoakv3/shared";
import type { AuditLogRepository } from "./auditLogRepository.js";

/** Test double — never used by production code. */
export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async listByRecordId(recordId: string): Promise<AuditLogEntry[]> {
    return this.entries.filter((entry) => entry.recordId === recordId);
  }

  all(): AuditLogEntry[] {
    return [...this.entries];
  }
}
