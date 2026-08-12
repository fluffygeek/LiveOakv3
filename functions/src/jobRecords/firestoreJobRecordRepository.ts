import type { Firestore } from "firebase-admin/firestore";
import { normalizeAddress, type JobRecord } from "@liveoakv3/shared";
import type { DuplicateLinkingResult, JobRecordRepository } from "./jobRecordRepository.js";

const COLLECTION = "jobRecords";

function toDocument(record: JobRecord): Record<string, unknown> {
  return {
    ...record,
    // Query-only index field — Firestore can't compute normalizeAddress()
    // on the fly, so it's derived and stored alongside the record.
    normalizedAddressKey: normalizeAddress(record.verifiedAddress ?? record.address),
  };
}

function fromDocument(data: Record<string, unknown>): JobRecord {
  const { normalizedAddressKey: _normalizedAddressKey, ...record } = data;
  return record as unknown as JobRecord;
}

/** Thin Firestore adapter — business rules live in jobRecordService.ts, not here. */
export class FirestoreJobRecordRepository implements JobRecordRepository {
  constructor(private readonly db: Firestore) {}

  async update(record: JobRecord): Promise<void> {
    await this.db.collection(COLLECTION).doc(record.recordId).set(toDocument(record));
  }

  async getById(recordId: string): Promise<JobRecord | null> {
    const snapshot = await this.db.collection(COLLECTION).doc(recordId).get();
    return snapshot.exists ? fromDocument(snapshot.data() as Record<string, unknown>) : null;
  }

  async createWithDuplicateLinking(
    normalizedAddress: string,
    sinceIso: string,
    buildRecord: (matches: JobRecord[]) => DuplicateLinkingResult,
  ): Promise<JobRecord> {
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(
        this.db
          .collection(COLLECTION)
          .where("normalizedAddressKey", "==", normalizedAddress)
          .where("submittedAt", ">=", sinceIso),
      );
      const matches = snapshot.docs.map((doc) => fromDocument(doc.data()));
      const { record, updatedMatches } = buildRecord(matches);

      transaction.set(this.db.collection(COLLECTION).doc(record.recordId), toDocument(record));
      for (const updatedMatch of updatedMatches) {
        transaction.set(
          this.db.collection(COLLECTION).doc(updatedMatch.recordId),
          toDocument(updatedMatch),
        );
      }
      return record;
    });
  }
}
