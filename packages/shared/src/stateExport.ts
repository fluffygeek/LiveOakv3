import type { JobRecord } from "./jobRecord.js";

/**
 * One state's slice of a nightly state-organized export run — persisted as
 * its own document (one per state per run) rather than one giant
 * whole-export document, so a single run's total record count can't push
 * any one document past Firestore's per-document size limit.
 */
export interface StateExportBatch {
  id: string;
  runId: string;
  generatedAt: string;
  /** A USPS state abbreviation, or "UNKNOWN" when no state could be parsed from the address. */
  state: string;
  records: JobRecord[];
}
