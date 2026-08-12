import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { UserRecord } from "@liveoakv3/shared";
import {
  AccessDeniedError,
  DiscrepancyActiveError,
  ForbiddenError,
  InvalidArgumentError,
  JobRecordNotFoundError,
  LastAdministratorError,
  NotAllowlistedError,
  NotDuplicateError,
  UserNotFoundError,
} from "./access/errors.js";
import { defineCallable, toHttpsError } from "./callableHandler.js";

const { getUserMock } = vi.hoisted(() => ({ getUserMock: vi.fn() }));

vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({}),
}));

vi.mock("./access/firestoreUserRepository.js", () => ({
  FirestoreUserRepository: class {
    getUser = getUserMock;
    async putUser() {}
    async listUsers() {
      return [];
    }
  },
}));

function authFor(email: string): CallableRequest["auth"] {
  return { uid: email, token: { email } } as CallableRequest["auth"];
}

const adminUser: UserRecord = {
  email: "admin@example.com",
  roles: ["applicationAdministrator"],
  active: true,
  invitedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  onDistributionList: false,
};

beforeEach(() => {
  getUserMock.mockReset();
});

describe("defineCallable", () => {
  it("throws unauthenticated when the request has no auth token", async () => {
    const callable = defineCallable({ handle: async (caller) => caller });
    await expect(
      callable.run({ auth: undefined, data: {} } as CallableRequest<unknown>),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("translates a domain error thrown while parsing the payload", async () => {
    getUserMock.mockResolvedValue(adminUser);
    const callable = defineCallable({
      parse: (): never => {
        throw new InvalidArgumentError("bad input");
      },
      handle: async () => "unreachable",
    });
    await expect(
      callable.run({
        auth: authFor("admin@example.com"),
        data: {},
      } as CallableRequest<unknown>),
    ).rejects.toMatchObject({ code: "invalid-argument" });
  });

  it("translates a domain error thrown while handling the request", async () => {
    getUserMock.mockResolvedValue(adminUser);
    const callable = defineCallable({
      handle: async (): Promise<never> => {
        throw new ForbiddenError("nope");
      },
    });
    await expect(
      callable.run({
        auth: authFor("admin@example.com"),
        data: {},
      } as CallableRequest<unknown>),
    ).rejects.toMatchObject({ code: "permission-denied" });
  });

  it("passes the resolved caller and parsed input through to handle on the happy path", async () => {
    getUserMock.mockResolvedValue(adminUser);
    const callable = defineCallable({
      parse: (data) => (data as { n: number }).n * 2,
      handle: async (caller, doubled) => ({ email: caller.email, doubled }),
    });
    const result = await callable.run({
      auth: authFor("admin@example.com"),
      data: { n: 21 },
    } as CallableRequest<unknown>);
    expect(result).toEqual({ email: "admin@example.com", doubled: 42 });
  });

  it("skips parse entirely when the config omits it", async () => {
    getUserMock.mockResolvedValue(adminUser);
    const callable = defineCallable({ handle: async (caller) => caller.email });
    const result = await callable.run({
      auth: authFor("admin@example.com"),
      data: { ignored: true },
    } as CallableRequest<unknown>);
    expect(result).toBe("admin@example.com");
  });
});

describe("toHttpsError", () => {
  it("passes an existing HttpsError through unchanged", () => {
    const original = new HttpsError("unauthenticated", "Sign-in required");
    expect(toHttpsError(original)).toBe(original);
  });

  it.each([
    [new AccessDeniedError("x"), "permission-denied"],
    [new NotAllowlistedError("x"), "permission-denied"],
    [new ForbiddenError("x"), "permission-denied"],
    [new LastAdministratorError("x"), "failed-precondition"],
    [new UserNotFoundError("x"), "not-found"],
    [new JobRecordNotFoundError("x"), "not-found"],
    [new InvalidArgumentError("x"), "invalid-argument"],
    [new DiscrepancyActiveError("x"), "failed-precondition"],
    [new NotDuplicateError("x"), "failed-precondition"],
    [new Error("unrecognized"), "internal"],
  ] as const)("maps %j to %s", (error, code) => {
    expect(toHttpsError(error).code).toBe(code);
  });
});
