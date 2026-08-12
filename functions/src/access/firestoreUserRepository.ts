import type { Firestore } from "firebase-admin/firestore";
import type { UserRecord } from "@liveoakv3/shared";
import type { UserRepository } from "./userRepository.js";

const COLLECTION = "users";

/** Thin Firestore adapter — business rules live in accessService.ts, not here. */
export class FirestoreUserRepository implements UserRepository {
  constructor(private readonly db: Firestore) {}

  async getUser(email: string): Promise<UserRecord | null> {
    const snapshot = await this.db.collection(COLLECTION).doc(email).get();
    return snapshot.exists ? (snapshot.data() as UserRecord) : null;
  }

  async putUser(record: UserRecord): Promise<void> {
    await this.db.collection(COLLECTION).doc(record.email).set(record);
  }

  async listUsers(): Promise<UserRecord[]> {
    const snapshot = await this.db.collection(COLLECTION).get();
    return snapshot.docs.map((doc) => doc.data() as UserRecord);
  }
}
