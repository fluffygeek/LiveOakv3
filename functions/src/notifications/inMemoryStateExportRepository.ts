import type { StateExportBatch } from "@liveoakv3/shared";
import type { StateExportRepository } from "./stateExportRepository.ts";

/** Test double — never used by production code. */
export class InMemoryStateExportRepository implements StateExportRepository {
  private readonly batches: StateExportBatch[] = [];

  async saveBatches(batches: StateExportBatch[]): Promise<void> {
    this.batches.push(...batches);
  }

  all(): StateExportBatch[] {
    return [...this.batches];
  }
}
