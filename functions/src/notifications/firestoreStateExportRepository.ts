import type { Firestore } from "firebase-admin/firestore";
import type { StateExportBatch } from "@liveoakv3/shared";
import type { StateExportRepository } from "./stateExportRepository.js";

const COLLECTION = "stateExports";

/**
 * Thin Firestore adapter — one document per state per run (see
 * StateExportBatch), but every state in a run commits together via a single
 * WriteBatch (well under Firestore's 500-write batch limit even at 51 US
 * states/DC) so a mid-run failure can't leave some states on the new run
 * and others stranded on the prior night's.
 */
export class FirestoreStateExportRepository implements StateExportRepository {
  constructor(private readonly db: Firestore) {}

  async saveBatches(batches: StateExportBatch[]): Promise<void> {
    const writeBatch = this.db.batch();
    for (const batch of batches) {
      writeBatch.set(this.db.collection(COLLECTION).doc(batch.id), batch);
    }
    await writeBatch.commit();
  }
}
