import { assertEquals } from "jsr:@std/assert@1";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { createHandler } from "./handler.ts";

/** Test double — never used by production code. */
class InMemoryUserRepository implements UserRepository {
  private readonly usersByEmail = new Map<string, UserRecord>();

  getUser(email: string): Promise<UserRecord | null> {
    return Promise.resolve(this.usersByEmail.get(email) ?? null);
  }

  putUser(record: UserRecord): Promise<void> {
    this.usersByEmail.set(record.email, record);
    return Promise.resolve();
  }

  listUsers(): Promise<UserRecord[]> {
    return Promise.resolve([...this.usersByEmail.values()]);
  }

  seed(record: UserRecord): void {
    this.usersByEmail.set(record.email, record);
  }
}

function fakeVerifyCaller(email: string): VerifyCaller {
  return () => Promise.resolve({ email });
}

function request(): Request {
  return new Request("http://localhost/listUsers", { method: "POST" });
}

function adminRecord(email: string): UserRecord {
  return {
    email,
    roles: ["applicationAdministrator"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  };
}

Deno.test("listUsers - an Application Administrator sees every allowlisted user", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed(adminRecord("admin@example.com"));
  repo.seed({
    email: "tech@example.com",
    roles: ["technician"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const handler = createHandler(repo, fakeVerifyCaller("admin@example.com"));

  const response = await handler(request());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.length, 2);
  assertEquals(
    body.data.map((u: UserRecord) => u.email).sort(),
    ["admin@example.com", "tech@example.com"],
  );
});

Deno.test("listUsers - a non-administrator caller is rejected", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed({
    email: "tech@example.com",
    roles: ["technician"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const handler = createHandler(repo, fakeVerifyCaller("tech@example.com"));

  const response = await handler(request());

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});
