import type { AuditLogEntry } from "@liveoakv3/shared";
import type { AuditLogRepository } from "./auditLogRepository.ts";

/** Test double — never used by production code. */
export class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  /** Oldest-first, matching the interface's contract (auditLogRepository.ts's doc comment)
   * and PostgresAuditLogRepository's real `.order("timestamp", { ascending: true })`. */
  async listByRecordId(recordId: string): Promise<AuditLogEntry[]> {
    return this.entries
      .filter((entry) => entry.recordId === recordId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  all(): AuditLogEntry[] {
    return [...this.entries];
  }

  seed(entry: AuditLogEntry): void {
    this.entries.push(entry);
  }
}
