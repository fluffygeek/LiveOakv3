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
  return new Request("http://localhost/setDiscrepancy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sampleRecord(overrides: Partial<JobRecord> = {}): JobRecord {
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

function payrollRecord(email: string): UserRecord {
  return {
    email,
    roles: ["payrollAdministrator"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  };
}

Deno.test("setDiscrepancy - a Payroll/Application Administrator can set an active Discrepancy with a reason, and it's audit-logged", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(sampleRecord());
  const auditLogRepo = new InMemoryAuditLogRepository();
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    auditLogRepo,
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(
    request({ recordId: "record-1", active: true, reason: "ADDRESS" }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.discrepancy, true);
  assertEquals(body.data.discrepancyReason, "ADDRESS");

  const stored = await jobRecordRepo.getById("record-1");
  assertEquals(stored?.discrepancy, true);
  assertEquals(stored?.discrepancyReason, "ADDRESS");

  assertEquals(auditLogRepo.all().length, 1);
  assertEquals(auditLogRepo.all()[0].action, "discrepancy-set");
  assertEquals(auditLogRepo.all()[0].actorEmail, "admin@example.com");
});

Deno.test("setDiscrepancy - clears an active Discrepancy, dropping the reason", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(sampleRecord({ discrepancy: true, discrepancyReason: "ADDRESS" }));
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(
    request({ recordId: "record-1", active: false, reason: null }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.discrepancy, false);
  assertEquals(body.data.discrepancyReason, null);
});

Deno.test("setDiscrepancy - an unknown reason is a 400", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(sampleRecord());
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(
    request({ recordId: "record-1", active: true, reason: "NOT-A-REAL-REASON" }),
  );

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
});

Deno.test("setDiscrepancy - a Payroll Administrator is blocked from setting Discrepancy on a Closed record", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(payrollRecord("payroll@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(sampleRecord({ closed: true }));
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("payroll@example.com"),
  );

  const response = await handler(
    request({ recordId: "record-1", active: true, reason: "ADDRESS" }),
  );

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("setDiscrepancy - an Application Administrator can still set Discrepancy on a Closed record", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(sampleRecord({ closed: true }));
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(
    request({ recordId: "record-1", active: true, reason: "ADDRESS" }),
  );

  assertEquals(response.status, 200);
});

Deno.test("setDiscrepancy - a Technician caller (not an admin) is rejected", async () => {
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
  jobRecordRepo.seed(sampleRecord());
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(
    request({ recordId: "record-1", active: true, reason: "ADDRESS" }),
  );

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("setDiscrepancy - an unknown recordId is a 404", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const handler = createHandler(
    userRepo,
    new InMemoryJobRecordRepository(),
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(
    request({ recordId: "does-not-exist", active: true, reason: "ADDRESS" }),
  );

  assertEquals(response.status, 404);
  const body = await response.json();
  assertEquals(body.error.code, "not-found");
});

Deno.test("setDiscrepancy - an unauthenticated caller gets 401, never reaching the repository", async () => {
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = createHandler(
    new InMemoryUserRepository(),
    new InMemoryJobRecordRepository(),
    new InMemoryAuditLogRepository(),
    rejecting,
  );

  const response = await handler(
    request({ recordId: "record-1", active: true, reason: "ADDRESS" }),
  );

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
