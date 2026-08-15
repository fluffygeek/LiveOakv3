import { assertEquals } from "jsr:@std/assert@1";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import { UnauthenticatedError, type VerifyCaller } from "./callableHandler.ts";
import { defineResolvedAccessHandler } from "./resolvedAccessHandler.ts";

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
  return new Request("http://localhost/test", { method: "POST" });
}

Deno.test("defineResolvedAccessHandler - hands the handler the caller's resolved roles, not just their email", async () => {
  const repo = new InMemoryUserRepository();
  repo.seed({
    email: "admin@example.com",
    roles: ["applicationAdministrator"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const handler = defineResolvedAccessHandler(repo, {
    verifyCaller: fakeVerifyCaller("admin@example.com"),
    handle: (caller) => Promise.resolve(caller),
  });

  const response = await handler(request());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data, { email: "admin@example.com", roles: ["applicationAdministrator"] });
});

Deno.test("defineResolvedAccessHandler - a non-allowlisted Workspace-domain caller is rejected before handle runs", async () => {
  const repo = new InMemoryUserRepository();
  const handler = defineResolvedAccessHandler(repo, {
    verifyCaller: fakeVerifyCaller("stranger@example.com"),
    handle: (): Promise<never> => {
      throw new Error("handle should not have been called");
    },
  });

  const response = await handler(request());

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("defineResolvedAccessHandler - an unauthenticated caller gets 401, never reaching resolveAccess or handle", async () => {
  const repo = new InMemoryUserRepository();
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = defineResolvedAccessHandler(repo, {
    verifyCaller: rejecting,
    handle: (): Promise<never> => {
      throw new Error("handle should not have been called");
    },
  });

  const response = await handler(request());

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
