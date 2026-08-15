import { assertEquals, assertObjectMatch } from "jsr:@std/assert@1";
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

function request(body: unknown): Request {
  return new Request("http://localhost/updateUserRoles", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

Deno.test("updateUserRoles - an Application Administrator can change another user's roles", async () => {
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

  const response = await handler(
    request({ email: "tech@example.com", roles: ["payrollAdministrator"] }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertObjectMatch(body.data, { email: "tech@example.com", roles: ["payrollAdministrator"] });
});

Deno.test("updateUserRoles - a non-administrator caller is rejected", async () => {
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

  const response = await handler(
    request({ email: "tech@example.com", roles: ["payrollAdministrator"] }),
  );

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("updateUserRoles - demoting the sole active administrator trips LastAdministratorError", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed(adminRecord("admin@example.com"));
  const handler = createHandler(repo, fakeVerifyCaller("admin@example.com"));

  const response = await handler(
    request({ email: "admin@example.com", roles: ["technician"] }),
  );

  assertEquals(response.status, 412);
  const body = await response.json();
  assertEquals(body.error.code, "failed-precondition");
});

Deno.test("updateUserRoles - an unknown email is a 404", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed(adminRecord("admin@example.com"));
  const handler = createHandler(repo, fakeVerifyCaller("admin@example.com"));

  const response = await handler(
    request({ email: "ghost@example.com", roles: ["technician"] }),
  );

  assertEquals(response.status, 404);
  const body = await response.json();
  assertEquals(body.error.code, "not-found");
});
