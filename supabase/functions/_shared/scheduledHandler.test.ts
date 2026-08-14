import { assertEquals } from "jsr:@std/assert@1";
import { UnauthenticatedError } from "./callableHandler.ts";
import {
  defineScheduledHandler,
  verifyScheduledSecret,
  type VerifyScheduledSecret,
} from "./scheduledHandler.ts";

function request(authHeader?: string): Request {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("Authorization", authHeader);
  return new Request("http://localhost/scheduled-ping", { method: "POST", headers });
}

const acceptAll: VerifyScheduledSecret = () => {};
const rejectAll: VerifyScheduledSecret = () => {
  throw new UnauthenticatedError("Invalid scheduler credentials");
};

Deno.test("defineScheduledHandler - runs the handler and returns its result when the secret verifies", async () => {
  const handler = defineScheduledHandler({
    verifySecret: acceptAll,
    handle: () => Promise.resolve({ fired: true }),
  });
  const response = await handler(request("Bearer whatever"));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data, { fired: true });
});

Deno.test("defineScheduledHandler - translates a rejection from verifySecret to 401", async () => {
  const handler = defineScheduledHandler({
    verifySecret: rejectAll,
    handle: () => Promise.resolve("unreachable"),
  });
  const response = await handler(request());
  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});

Deno.test("defineScheduledHandler - translates an unrecognized thrown error to 500", async () => {
  const handler = defineScheduledHandler({
    verifySecret: () => {
      throw new Error("boom");
    },
    handle: () => Promise.resolve("unreachable"),
  });
  const response = await handler(request());
  assertEquals(response.status, 500);
});

Deno.test("defineScheduledHandler - never calls handle when the secret is invalid", async () => {
  let handleCalled = false;
  const handler = defineScheduledHandler({
    verifySecret: rejectAll,
    handle: () => {
      handleCalled = true;
      return Promise.resolve("should not run");
    },
  });
  await handler(request());
  assertEquals(handleCalled, false);
});

Deno.test("verifyScheduledSecret - rejects when the Authorization header doesn't match SUPABASE_SERVICE_ROLE_KEY", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  try {
    let threw = false;
    try {
      verifyScheduledSecret(request("Bearer wrong-key"));
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("verifyScheduledSecret - rejects a missing Authorization header", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  try {
    let threw = false;
    try {
      verifyScheduledSecret(request());
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("verifyScheduledSecret - accepts a matching Authorization header", () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "the-real-key");
  try {
    verifyScheduledSecret(request("Bearer the-real-key"));
  } finally {
    Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});
