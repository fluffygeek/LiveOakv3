import { assertEquals } from "jsr:@std/assert@1";
import { noDuplicateLink, type JobRecord } from "../../../packages/shared/src/jobRecord.ts";
import type { AuditLogEntry } from "../../../packages/shared/src/auditLog.ts";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type {
  DuplicateLinkingResult,
  JobRecordRepository,
} from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";
import { UnauthenticatedError, type VerifyCaller } from "../_shared/callableHandler.ts";
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

/** Test double — never used by production code. Kept minimal: this file only exercises
 * editJobRecord's transport/auth wiring, not Duplicate matching. */
class InMemoryJobRecordRepository implements JobRecordRepository {
  private readonly recordsById = new Map<string, JobRecord>();

  update(record: JobRecord): Promise<void> {
    this.recordsById.set(record.recordId, record);
    return Promise.resolve();
  }

  updateMany(records: JobRecord[]): Promise<void> {
    for (const record of records) this.recordsById.set(record.recordId, record);
    return Promise.resolve();
  }

  getById(recordId: string): Promise<JobRecord | null> {
    return Promise.resolve(this.recordsById.get(recordId) ?? null);
  }

  list(): Promise<JobRecord[]> {
    return Promise.resolve([...this.recordsById.values()]);
  }

  listByTechnicianAndWindow(): Promise<JobRecord[]> {
    return Promise.resolve([...this.recordsById.values()]);
  }

  listWithActiveDiscrepancy(): Promise<JobRecord[]> {
    return Promise.resolve([...this.recordsById.values()].filter((r) => r.discrepancy));
  }

  createWithDuplicateLinking(
    _normalizedAddress: string,
    _sinceIso: string,
    buildRecord: (matches: JobRecord[]) => DuplicateLinkingResult,
  ): Promise<JobRecord> {
    const { record } = buildRecord([]);
    this.recordsById.set(record.recordId, record);
    return Promise.resolve(record);
  }

  seed(record: JobRecord): void {
    this.recordsById.set(record.recordId, record);
  }
}

/** Test double — never used by production code. */
class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly entries: AuditLogEntry[] = [];

  append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }

  listByRecordId(recordId: string): Promise<AuditLogEntry[]> {
    return Promise.resolve(this.entries.filter((entry) => entry.recordId === recordId));
  }

  get all(): AuditLogEntry[] {
    return this.entries;
  }
}

function fakeVerifyCaller(email: string): VerifyCaller {
  return () => Promise.resolve({ email });
}

function request(body: unknown): Request {
  return new Request("http://localhost/editJobRecord", {
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

Deno.test("editJobRecord - a Payroll/Application Administrator can edit fields, and it's audit-logged", async () => {
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
    request({ recordId: "record-1", jobId: "DISPATCH-999", notes: "Updated notes" }),
  );

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.jobId, "DISPATCH-999");
  assertEquals(body.data.notes, "Updated notes");

  const stored = await jobRecordRepo.getById("record-1");
  assertEquals(stored?.jobId, "DISPATCH-999");

  assertEquals(auditLogRepo.all.length, 1);
  assertEquals(auditLogRepo.all[0].action, "edited");
  assertEquals(auditLogRepo.all[0].actorEmail, "admin@example.com");
  assertEquals(auditLogRepo.all[0].before, { jobId: "DISPATCH-123", notes: "" });
  assertEquals(auditLogRepo.all[0].after, { jobId: "DISPATCH-999", notes: "Updated notes" });
});

Deno.test("editJobRecord - a Technician caller (not an admin) is rejected", async () => {
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

  const response = await handler(request({ recordId: "record-1", notes: "nope" }));

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("editJobRecord - a Payroll Administrator editing a Closed record is rejected", async () => {
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
  jobRecordRepo.seed(sampleRecord({ closed: true }));
  const handler = createHandler(
    userRepo,
    jobRecordRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("payroll@example.com"),
  );

  const response = await handler(request({ recordId: "record-1", notes: "nope" }));

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("editJobRecord - an unknown recordId is a 404", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const handler = createHandler(
    userRepo,
    new InMemoryJobRecordRepository(),
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(request({ recordId: "does-not-exist", notes: "x" }));

  assertEquals(response.status, 404);
  const body = await response.json();
  assertEquals(body.error.code, "not-found");
});

Deno.test("editJobRecord - an unknown workCode is a 400", async () => {
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
    request({ recordId: "record-1", workCode: "NOT-A-REAL-CODE" }),
  );

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
});

Deno.test("editJobRecord - an unauthenticated caller gets 401, never reaching the repository", async () => {
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = createHandler(
    new InMemoryUserRepository(),
    new InMemoryJobRecordRepository(),
    new InMemoryAuditLogRepository(),
    rejecting,
  );

  const response = await handler(request({ recordId: "record-1", notes: "x" }));

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
