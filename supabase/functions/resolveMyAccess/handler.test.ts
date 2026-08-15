import { assertEquals } from "jsr:@std/assert@1";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import { UnauthenticatedError, type VerifyCaller } from "../_shared/callableHandler.ts";
import { createHandler } from "./handler.ts";

/** Test double — never used by production code (mirrors
 * functions/src/access/inMemoryUserRepository.ts's role in the Firebase-side tests). */
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
  return new Request("http://localhost/resolveMyAccess", { method: "POST" });
}

Deno.test("resolveMyAccess - a Workspace-domain, allowlisted caller sees their resolved roles", async () => {
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

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data, { email: "tech@example.com", roles: ["technician"] });
});

Deno.test("resolveMyAccess - a non-Workspace-domain caller is rejected, even if allowlisted", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed({
    email: "tech@gmail.com",
    roles: ["technician"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const handler = createHandler(repo, fakeVerifyCaller("tech@gmail.com"));

  const response = await handler(request());

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("resolveMyAccess - a Workspace-domain caller who hasn't been invited is rejected", async () => {
  const repo = new InMemoryUserRepository();
  const handler = createHandler(repo, fakeVerifyCaller("stranger@example.com"));

  const response = await handler(request());

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("resolveMyAccess - a revoked (inactive) Workspace-domain caller is rejected", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed({
    email: "exstaff@example.com",
    roles: ["technician"],
    active: false,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const handler = createHandler(repo, fakeVerifyCaller("exstaff@example.com"));

  const response = await handler(request());

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("resolveMyAccess - an unauthenticated caller gets 401, never reaching the repository", async () => {
  const repo = new InMemoryUserRepository();
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = createHandler(repo, rejecting);

  const response = await handler(request());

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
