import type { UserRecord } from "@liveoakv3/shared";

export interface UserRepository {
  getUser(email: string): Promise<UserRecord | null>;
  putUser(record: UserRecord): Promise<void>;
  listUsers(): Promise<UserRecord[]>;
}
