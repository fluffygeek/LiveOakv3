import type { Firestore } from "firebase-admin/firestore";
import type { AuditLogEntry } from "@liveoakv3/shared";
import type { AuditLogRepository } from "./auditLogRepository.js";

const COLLECTION = "auditLog";

/** Thin Firestore adapter — append-only. */
export class FirestoreAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: Firestore) {}

  async append(entry: AuditLogEntry): Promise<void> {
    await this.db.collection(COLLECTION).doc(entry.id).set(entry);
  }
}
