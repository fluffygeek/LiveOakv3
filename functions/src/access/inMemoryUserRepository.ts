import type { UserRecord } from "@liveoakv3/shared";
import type { UserRepository } from "./userRepository.js";

/** Test double — never used by production code. */
export class InMemoryUserRepository implements UserRepository {
  private readonly usersByEmail = new Map<string, UserRecord>();

  async getUser(email: string): Promise<UserRecord | null> {
    return this.usersByEmail.get(email) ?? null;
  }

  async putUser(record: UserRecord): Promise<void> {
    this.usersByEmail.set(record.email, record);
  }

  async listUsers(): Promise<UserRecord[]> {
    return [...this.usersByEmail.values()];
  }

  seed(record: UserRecord): void {
    this.usersByEmail.set(record.email, record);
  }
}
