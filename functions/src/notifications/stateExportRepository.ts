import type { StateExportBatch } from "@liveoakv3/shared";

export interface StateExportRepository {
  /** Persists every state's batch for one run as a single atomic write — a partial-run failure must never leave some states on the new run and others on the prior one. */
  saveBatches(batches: StateExportBatch[]): Promise<void>;
}
