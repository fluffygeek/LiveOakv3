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
  return new Request("http://localhost/unlinkDuplicate", {
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

function linkedPair(): [JobRecord, JobRecord] {
  const a = baseRecord({
    recordId: "record-a",
    duplicate: { isDuplicate: true, linkedRecordIds: ["record-b"], isPrimary: true },
  });
  const b = baseRecord({
    recordId: "record-b",
    duplicate: { isDuplicate: true, linkedRecordIds: ["record-a"], isPrimary: false },
  });
  return [a, b];
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

Deno.test("unlinkDuplicate - removes the link between two records atomically, clearing isDuplicate when no links remain, and it's audit-logged", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  const [a, b] = linkedPair();
  jobRecordRepo.seed(a);
  jobRecordRepo.seed(b);
  const auditLogRepo = new InMemoryAuditLogRepository();
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    auditLogRepo,
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(request({ recordId: "record-a", otherRecordId: "record-b" }));

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.record.duplicate, noDuplicateLink());
  assertEquals(body.data.other.duplicate, noDuplicateLink());

  const storedA = await jobRecordRepo.getById("record-a");
  const storedB = await jobRecordRepo.getById("record-b");
  assertEquals(storedA?.duplicate, noDuplicateLink());
  assertEquals(storedB?.duplicate, noDuplicateLink());

  assertEquals(auditLogRepo.all().length, 2);
  assertEquals(
    auditLogRepo.all().every((e) => e.action === "duplicate-unlinked"),
    true,
  );
});

Deno.test("unlinkDuplicate - two records that aren't linked are rejected (NotDuplicateError)", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(baseRecord({ recordId: "record-a" }));
  jobRecordRepo.seed(baseRecord({ recordId: "record-b" }));
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(request({ recordId: "record-a", otherRecordId: "record-b" }));

  assertEquals(response.status, 412);
  const body = await response.json();
  assertEquals(body.error.code, "failed-precondition");
});

Deno.test("unlinkDuplicate - a Payroll Administrator is blocked when either record is Closed", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed({
    email: "payroll@example.com",
    roles: ["payrollAdministrator"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const jobRecordRepo = new InMemoryJobRecordRepository();
  const [a, b] = linkedPair();
  jobRecordRepo.seed({ ...a, closed: true });
  jobRecordRepo.seed(b);
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("payroll@example.com"),
  );

  const response = await handler(request({ recordId: "record-a", otherRecordId: "record-b" }));

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("unlinkDuplicate - a Technician caller (not an admin) is rejected", async () => {
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
  const [a, b] = linkedPair();
  jobRecordRepo.seed(a);
  jobRecordRepo.seed(b);
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(request({ recordId: "record-a", otherRecordId: "record-b" }));

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("unlinkDuplicate - an unknown recordId is a 404", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const handler = createHandler(
    userRepo,
    new InMemoryJobRecordRepository(),
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(
    request({ recordId: "does-not-exist", otherRecordId: "record-b" }),
  );

  assertEquals(response.status, 404);
  const body = await response.json();
  assertEquals(body.error.code, "not-found");
});

Deno.test("unlinkDuplicate - an unauthenticated caller gets 401, never reaching the repository", async () => {
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = createHandler(
    new InMemoryUserRepository(),
    new InMemoryJobRecordRepository(),
    new InMemoryAuditLogRepository(),
    rejecting,
  );

  const response = await handler(request({ recordId: "record-a", otherRecordId: "record-b" }));

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
