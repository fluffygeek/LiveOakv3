import { assertEquals } from "jsr:@std/assert@1";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import { UnauthenticatedError, type VerifyCaller } from "../_shared/callableHandler.ts";
import type { PhotoStorageRepository } from "./photoStorageRepository.ts";
import { createHandler } from "./handler.ts";

/** Test double — never used by production code (mirrors
 * ../createJobRecord/handler.test.ts's InMemoryUserRepository). */
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

/** Test double — never used by production code. Records every upload call so tests can
 * assert on the bytes/contentType the handler decoded and forwarded. */
class FakePhotoStorageRepository implements PhotoStorageRepository {
  readonly uploads: { path: string; bytes: Uint8Array; contentType: string }[] = [];
  private failWith: Error | null = null;

  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (this.failWith) {
      return Promise.reject(this.failWith);
    }
    this.uploads.push({ path, bytes, contentType });
    return Promise.resolve();
  }

  simulateFailure(error: Error): void {
    this.failWith = error;
  }
}

function fakeVerifyCaller(email: string): VerifyCaller {
  return () => Promise.resolve({ email });
}

function technicianRecord(email: string): UserRecord {
  return {
    email,
    roles: ["technician"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  };
}

function request(body: unknown): Request {
  return new Request("http://localhost/uploadJobRecordPhoto", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// "hello" base64-encoded — small, human-checkable fixture rather than a real photo's worth
// of bytes; decodeBase64's correctness doesn't depend on payload size.
const HELLO_BASE64 = "aGVsbG8=";

function helloBytes(): Uint8Array {
  return new TextEncoder().encode("hello");
}

Deno.test("uploadJobRecordPhoto - a Technician can upload a photo, and it's stored under a generated path", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(technicianRecord("tech@example.com"));
  const photoStorageRepo = new FakePhotoStorageRepository();
  const handler = createHandler(
    userRepo,
    photoStorageRepo,
    fakeVerifyCaller("tech@example.com"),
    () => "fixed-id",
  );

  const response = await handler(
    request({ contentType: "image/jpeg", base64Data: HELLO_BASE64 }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.path, "fixed-id.jpg");
  assertEquals(photoStorageRepo.uploads.length, 1);
  assertEquals(photoStorageRepo.uploads[0].path, "fixed-id.jpg");
  assertEquals(photoStorageRepo.uploads[0].contentType, "image/jpeg");
  assertEquals(photoStorageRepo.uploads[0].bytes, helloBytes());
});

Deno.test("uploadJobRecordPhoto - a non-Technician caller is rejected", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed({
    email: "admin@example.com",
    roles: ["applicationAdministrator"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const photoStorageRepo = new FakePhotoStorageRepository();
  const handler = createHandler(
    userRepo,
    photoStorageRepo,
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(
    request({ contentType: "image/jpeg", base64Data: HELLO_BASE64 }),
  );

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
  assertEquals(photoStorageRepo.uploads.length, 0);
});

Deno.test("uploadJobRecordPhoto - an unsupported contentType is a 400, never reaching storage", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(technicianRecord("tech@example.com"));
  const photoStorageRepo = new FakePhotoStorageRepository();
  const handler = createHandler(
    userRepo,
    photoStorageRepo,
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(
    request({ contentType: "application/pdf", base64Data: HELLO_BASE64 }),
  );

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
  assertEquals(photoStorageRepo.uploads.length, 0);
});

Deno.test("uploadJobRecordPhoto - missing base64Data is a 400", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(technicianRecord("tech@example.com"));
  const handler = createHandler(
    userRepo,
    new FakePhotoStorageRepository(),
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(request({ contentType: "image/jpeg" }));

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
});

Deno.test("uploadJobRecordPhoto - invalid base64Data is a 400", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(technicianRecord("tech@example.com"));
  const handler = createHandler(
    userRepo,
    new FakePhotoStorageRepository(),
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(
    request({ contentType: "image/jpeg", base64Data: "not-valid-base64!!!" }),
  );

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
});

Deno.test("uploadJobRecordPhoto - an unauthenticated caller gets 401, never reaching storage", async () => {
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const photoStorageRepo = new FakePhotoStorageRepository();
  const handler = createHandler(new InMemoryUserRepository(), photoStorageRepo, rejecting);

  const response = await handler(
    request({ contentType: "image/jpeg", base64Data: HELLO_BASE64 }),
  );

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
  assertEquals(photoStorageRepo.uploads.length, 0);
});

Deno.test("uploadJobRecordPhoto - a storage failure surfaces as a 500", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(technicianRecord("tech@example.com"));
  const photoStorageRepo = new FakePhotoStorageRepository();
  photoStorageRepo.simulateFailure(new Error("Storage unavailable"));
  const handler = createHandler(
    userRepo,
    photoStorageRepo,
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(
    request({ contentType: "image/jpeg", base64Data: HELLO_BASE64 }),
  );

  assertEquals(response.status, 500);
  const body = await response.json();
  assertEquals(body.error.code, "internal");
});
