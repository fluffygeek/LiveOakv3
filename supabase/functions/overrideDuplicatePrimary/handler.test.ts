import { assertEquals } from "jsr:@std/assert@1";
import { noDuplicateLink, type JobRecord } from "../../../packages/shared/src/jobRecord.ts";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import { InMemoryUserRepository } from "../../../functions/src/access/inMemoryUserRepository.ts";
import { InMemoryJobRecordRepository } from "../../../functions/src/jobRecords/inMemoryJobRecordRepository.ts";
import { InMemoryAuditLogRepository } from "../../../functions/src/jobRecords/inMemoryAuditLogRepository.ts";
import { UnauthenticatedError, type VerifyCaller } from "../_shared/callableHandler.ts";
import { createHandler } from "./handler.ts";

function fakeVerifyCaller(email: string): VerifyCaller {
  return () => Promise.resolve({ email });
}

function request(body: unknown): Request {
  return new Request("http://localhost/overrideDuplicatePrimary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function baseRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    recordId: "record-1",
    jobId: "DISPATCH-123",
    technicianEmail: "tech@example.com",
    address: "123 Main St, Springfield",
    verifiedAddress: null,
    addressVerificationStatus: "unverified",
    workCode: "WC-01",
    footage: 100,
    photoUrls: ["a", "b", "c"],
    notes: "",
    submittedAt: "2026-01-01T12:00:00.000Z",
    createdAt: "2026-01-01T12:00:00.000Z",
    timestampSuspect: false,
    duplicate: noDuplicateLink(),
    discrepancy: false,
    discrepancyReason: null,
    closed: false,
    picturesDownloaded: false,
    ...overrides,
  };
}

function group(): [JobRecord, JobRecord] {
  const primary = baseRecord({
    recordId: "record-primary",
    duplicate: { isDuplicate: true, linkedRecordIds: ["record-1"], isPrimary: true },
  });
  const subordinate = baseRecord({
    recordId: "record-1",
    duplicate: { isDuplicate: true, linkedRecordIds: ["record-primary"], isPrimary: false },
  });
  return [primary, subordinate];
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

Deno.test("overrideDuplicatePrimary - flips primary from the old record to the target and updates both atomically, and it's audit-logged", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  const [primary, subordinate] = group();
  jobRecordRepo.seed(primary);
  jobRecordRepo.seed(subordinate);
  const auditLogRepo = new InMemoryAuditLogRepository();
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    auditLogRepo,
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(request({ recordId: "record-1" }));

  assertEquals(response.status, 200);
  const body = await response.json();
  const newPrimary = (body.data as JobRecord[]).find((r) => r.recordId === "record-1");
  const oldPrimary = (body.data as JobRecord[]).find((r) => r.recordId === "record-primary");
  assertEquals(newPrimary?.duplicate.isPrimary, true);
  assertEquals(oldPrimary?.duplicate.isPrimary, false);

  const storedNewPrimary = await jobRecordRepo.getById("record-1");
  assertEquals(storedNewPrimary?.duplicate.isPrimary, true);
  const storedOldPrimary = await jobRecordRepo.getById("record-primary");
  assertEquals(storedOldPrimary?.duplicate.isPrimary, false);

  assertEquals(auditLogRepo.all().length, 2);
  assertEquals(
    auditLogRepo.all().every((e) => e.action === "duplicate-primary-overridden"),
    true,
  );
});

Deno.test("overrideDuplicatePrimary - a record with no active Duplicate link is rejected (NotDuplicateError)", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(baseRecord());
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(request({ recordId: "record-1" }));

  assertEquals(response.status, 412);
  const body = await response.json();
  assertEquals(body.error.code, "failed-precondition");
});

Deno.test("overrideDuplicatePrimary - a Technician caller (not an admin) is rejected", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed({
    email: "tech@example.com",
    roles: ["technician"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const jobRecordRepo = new InMemoryJobRecordRepository();
  const [primary, subordinate] = group();
  jobRecordRepo.seed(primary);
  jobRecordRepo.seed(subordinate);
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(request({ recordId: "record-1" }));

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("overrideDuplicatePrimary - an unknown recordId is a 404", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const handler = createHandler(
    userRepo,
    new InMemoryJobRecordRepository(),
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(request({ recordId: "does-not-exist" }));

  assertEquals(response.status, 404);
  const body = await response.json();
  assertEquals(body.error.code, "not-found");
});

Deno.test("overrideDuplicatePrimary - an unauthenticated caller gets 401, never reaching the repository", async () => {
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = createHandler(
    new InMemoryUserRepository(),
    new InMemoryJobRecordRepository(),
    new InMemoryAuditLogRepository(),
    rejecting,
  );

  const response = await handler(request({ recordId: "record-1" }));

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
