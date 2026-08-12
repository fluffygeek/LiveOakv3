import type { JobRecord } from "@liveoakv3/shared";

export interface DuplicateLinkingResult {
  record: JobRecord;
  updatedMatches: JobRecord[];
}

export interface JobRecordRepository {
  update(record: JobRecord): Promise<void>;
  getById(recordId: string): Promise<JobRecord | null>;
  /**
   * Atomically: finds active records whose normalized address matches
   * `normalizedAddress`, submitted on/after `sinceIso`; passes those matches
   * to `buildRecord` to compute the new record and any duplicate-link
   * updates; persists the new record and every updated match together.
   * Implementations must make the read-then-write a single unit of work
   * (e.g. a Firestore transaction) so two concurrent calls for the same
   * address can't each see zero matches and both miss the duplicate link.
   */
  createWithDuplicateLinking(
    normalizedAddress: string,
    sinceIso: string,
    buildRecord: (matches: JobRecord[]) => DuplicateLinkingResult,
  ): Promise<JobRecord>;
}
