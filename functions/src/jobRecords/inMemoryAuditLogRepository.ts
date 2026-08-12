import type { AuditLogEntry } from "@liveoakv3/shared";
import type { AuditLogRepository } from "./auditLogRepository.js";

/** Test double — never used by production code. */
export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  all(): AuditLogEntry[] {
    return [...this.entries];
  }
}
