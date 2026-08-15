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
  return new Request("http://localhost/setDistributionListMembership", {
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

Deno.test("setDistributionListMembership - an Application Administrator can add an eligible user to the Distribution List", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed(adminRecord("admin@example.com"));
  repo.seed({
    email: "payroll@example.com",
    roles: ["payrollAdministrator"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const handler = createHandler(repo, fakeVerifyCaller("admin@example.com"));

  const response = await handler(
    request({ email: "payroll@example.com", onDistributionList: true }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertObjectMatch(body.data, { email: "payroll@example.com", onDistributionList: true });
});

Deno.test("setDistributionListMembership - a non-administrator caller is rejected", async () => {
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
    request({ email: "tech@example.com", onDistributionList: true }),
  );

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("setDistributionListMembership - an ineligible role (e.g. technician) can't join the Distribution List", async () => {
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
    request({ email: "tech@example.com", onDistributionList: true }),
  );

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
});

Deno.test("setDistributionListMembership - an unknown email is a 404", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed(adminRecord("admin@example.com"));
  const handler = createHandler(repo, fakeVerifyCaller("admin@example.com"));

  const response = await handler(
    request({ email: "ghost@example.com", onDistributionList: true }),
  );

  assertEquals(response.status, 404);
  const body = await response.json();
  assertEquals(body.error.code, "not-found");
});
