import { assertEquals } from "jsr:@std/assert@1";
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
} from "../../../functions/src/access/errors.ts";
import {
  defineEdgeHandler,
  toErrorResponse,
  UnauthenticatedError,
  type Caller,
  type VerifyCaller,
} from "./callableHandler.ts";

function fakeVerifyCaller(email: string): VerifyCaller {
  return () => Promise.resolve({ email });
}

const rejectingVerifyCaller: VerifyCaller = () => {
  throw new UnauthenticatedError("Sign-in required");
};

function request(body?: unknown): Request {
  return new Request("http://localhost/ping", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

Deno.test("defineEdgeHandler - rejects when the caller can't be verified", async () => {
  const handler = defineEdgeHandler({
    verifyCaller: rejectingVerifyCaller,
    handle: (caller) => Promise.resolve(caller),
  });
  const response = await handler(request({}));
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});

Deno.test("defineEdgeHandler - translates a domain error thrown while parsing the payload", async () => {
  const handler = defineEdgeHandler({
    verifyCaller: fakeVerifyCaller("admin@example.com"),
    parse: (): never => {
      throw new InvalidArgumentError("bad input");
    },
    handle: () => Promise.resolve("unreachable"),
  });
  const response = await handler(request({}));
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
});

Deno.test("defineEdgeHandler - a malformed JSON body is a 400, not a 500, when parse is configured", async () => {
  const handler = defineEdgeHandler({
    verifyCaller: fakeVerifyCaller("admin@example.com"),
    parse: (data) => (data as { n: number }).n,
    handle: () => Promise.resolve("unreachable"),
  });
  const response = await handler(
    new Request("http://localhost/ping", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not valid json",
    }),
  );
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
});

Deno.test("defineEdgeHandler - a missing body doesn't fail when parse is omitted", async () => {
  const handler = defineEdgeHandler({
    verifyCaller: fakeVerifyCaller("admin@example.com"),
    handle: (caller) => Promise.resolve(caller.email),
  });
  const response = await handler(
    new Request("http://localhost/ping", { method: "POST" }),
  );
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data, "admin@example.com");
});

Deno.test("defineEdgeHandler - translates a domain error thrown while handling the request", async () => {
  const handler = defineEdgeHandler({
    verifyCaller: fakeVerifyCaller("admin@example.com"),
    handle: (): Promise<never> => {
      throw new ForbiddenError("nope");
    },
  });
  const response = await handler(request({}));
  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("defineEdgeHandler - passes the resolved caller and parsed input through to handle on the happy path", async () => {
  const handler = defineEdgeHandler({
    verifyCaller: fakeVerifyCaller("admin@example.com"),
    parse: (data) => (data as { n: number }).n * 2,
    handle: (caller, doubled) => Promise.resolve({ email: caller.email, doubled }),
  });
  const response = await handler(request({ n: 21 }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data, { email: "admin@example.com", doubled: 42 });
});

Deno.test("defineEdgeHandler - skips parse entirely when the config omits it", async () => {
  const handler = defineEdgeHandler({
    verifyCaller: fakeVerifyCaller("admin@example.com"),
    handle: (caller) => Promise.resolve(caller.email),
  });
  const response = await handler(request({ ignored: true }));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data, "admin@example.com");
});

Deno.test("toErrorResponse - passes an UnauthenticatedError through as 401", async () => {
  const response = toErrorResponse(new UnauthenticatedError("Sign-in required"));
  assertEquals(response.status, 401);
  assertEquals((await response.json()).error.code, "unauthenticated");
});

const domainErrorCases: [unknown, number, string][] = [
  [new AccessDeniedError("x"), 403, "permission-denied"],
  [new NotAllowlistedError("x"), 403, "permission-denied"],
  [new ForbiddenError("x"), 403, "permission-denied"],
  [new LastAdministratorError("x"), 412, "failed-precondition"],
  [new UserNotFoundError("x"), 404, "not-found"],
  [new JobRecordNotFoundError("x"), 404, "not-found"],
  [new InvalidArgumentError("x"), 400, "invalid-argument"],
  [new DiscrepancyActiveError("x"), 412, "failed-precondition"],
  [new NotDuplicateError("x"), 412, "failed-precondition"],
  [new Error("unrecognized"), 500, "internal"],
];

for (const [error, status, code] of domainErrorCases) {
  Deno.test(`toErrorResponse - maps ${(error as Error).constructor.name} to ${status}/${code}`, async () => {
    const response = toErrorResponse(error);
    assertEquals(response.status, status);
    const body = await response.json();
    assertEquals(body.error.code, code);
  });
}
