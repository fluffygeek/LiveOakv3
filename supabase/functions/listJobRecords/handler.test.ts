import { assertEquals } from "jsr:@std/assert@1";
import { noDuplicateLink, type JobRecord } from "../../../packages/shared/src/jobRecord.ts";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type {
  DuplicateLinkingResult,
  JobRecordRepository,
} from "../../../functions/src/jobRecords/jobRecordRepository.ts";
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
 * listJobRecords's transport/auth wiring, not Duplicate matching. */
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

function fakeVerifyCaller(email: string): VerifyCaller {
  return () => Promise.resolve({ email });
}

function request(): Request {
  return new Request("http://localhost/listJobRecords", { method: "POST" });
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

Deno.test("listJobRecords - a Payroll/Application Administrator sees every Job Record", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(sampleRecord({ recordId: "record-1" }));
  jobRecordRepo.seed(sampleRecord({ recordId: "record-2" }));
  const handler = createHandler(userRepo, jobRecordRepo, fakeVerifyCaller("admin@example.com"));

  const response = await handler(request());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.length, 2);
});

Deno.test("listJobRecords - a Technician caller (not an admin) is rejected", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed({
    email: "tech@example.com",
    roles: ["technician"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const handler = createHandler(
    userRepo,
    new InMemoryJobRecordRepository(),
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(request());

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("listJobRecords - an unauthenticated caller gets 401, never reaching the repository", async () => {
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = createHandler(
    new InMemoryUserRepository(),
    new InMemoryJobRecordRepository(),
    rejecting,
  );

  const response = await handler(request());

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
