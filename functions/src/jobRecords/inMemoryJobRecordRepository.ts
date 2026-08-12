import { normalizeAddress, type JobRecord } from "@liveoakv3/shared";
import type { DuplicateLinkingResult, JobRecordRepository } from "./jobRecordRepository.js";

/** Test double — never used by production code. */
export class InMemoryJobRecordRepository implements JobRecordRepository {
  private readonly recordsById = new Map<string, JobRecord>();

  async update(record: JobRecord): Promise<void> {
    this.recordsById.set(record.recordId, record);
  }

  async getById(recordId: string): Promise<JobRecord | null> {
    return this.recordsById.get(recordId) ?? null;
  }

  async createWithDuplicateLinking(
    normalizedAddress: string,
    sinceIso: string,
    buildRecord: (matches: JobRecord[]) => DuplicateLinkingResult,
  ): Promise<JobRecord> {
    const matches = [...this.recordsById.values()].filter((record) => {
      const key = normalizeAddress(record.verifiedAddress ?? record.address);
      return key === normalizedAddress && record.submittedAt >= sinceIso;
    });
    const { record, updatedMatches } = buildRecord(matches);
    this.recordsById.set(record.recordId, record);
    for (const updatedMatch of updatedMatches) {
      this.recordsById.set(updatedMatch.recordId, updatedMatch);
    }
    return record;
  }

  seed(record: JobRecord): void {
    this.recordsById.set(record.recordId, record);
  }

  all(): JobRecord[] {
    return [...this.recordsById.values()];
  }
}
