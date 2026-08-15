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

/** Test double — never used by production code. Only exercises the handler's transport/auth
 * wiring, not real window-filtering logic (see weeklyListService.test.ts for that) — so
 * `listByTechnicianAndWindow` here just filters by technician email, ignoring the window,
 * which is enough to confirm the caller's own email (not e.g. some other field) is threaded
 * through. */
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

  listByTechnicianAndWindow(technicianEmail: string): Promise<JobRecord[]> {
    return Promise.resolve(
      [...this.recordsById.values()].filter((r) => r.technicianEmail === technicianEmail),
    );
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

function request(body: unknown): Request {
  return new Request("http://localhost/listMyWeeklyJobRecords", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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

function jobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
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
    submittedAt: "2026-01-06T15:00:00.000Z",
    createdAt: "2026-01-06T15:00:00.000Z",
    timestampSuspect: false,
    duplicate: noDuplicateLink(),
    discrepancy: false,
    discrepancyReason: null,
    closed: false,
    picturesDownloaded: false,
    ...overrides,
  };
}

Deno.test("listMyWeeklyJobRecords - a Technician sees exactly their own records", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(technicianRecord("tech@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(jobRecord({ recordId: "mine", technicianEmail: "tech@example.com" }));
  jobRecordRepo.seed(
    jobRecord({ recordId: "someone-elses", technicianEmail: "other-tech@example.com" }),
  );
  const handler = createHandler(userRepo, jobRecordRepo, fakeVerifyCaller("tech@example.com"));

  const response = await handler(request({ weekOffset: 0 }));

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(
    body.data.records.map((r: JobRecord) => r.recordId),
    ["mine"],
  );
});

Deno.test("listMyWeeklyJobRecords - a non-Technician caller is rejected", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed({
    email: "admin@example.com",
    roles: ["applicationAdministrator"],
    active: true,
    invitedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    onDistributionList: false,
  });
  const handler = createHandler(
    userRepo,
    new InMemoryJobRecordRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(request({ weekOffset: 0 }));

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("listMyWeeklyJobRecords - a positive weekOffset is a 400", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(technicianRecord("tech@example.com"));
  const handler = createHandler(
    userRepo,
    new InMemoryJobRecordRepository(),
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(request({ weekOffset: 1 }));

  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, "invalid-argument");
});

Deno.test("listMyWeeklyJobRecords - weekOffset defaults to 0 when absent", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(technicianRecord("tech@example.com"));
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(jobRecord({ recordId: "mine", technicianEmail: "tech@example.com" }));
  const handler = createHandler(userRepo, jobRecordRepo, fakeVerifyCaller("tech@example.com"));

  const response = await handler(request({}));

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(
    body.data.records.map((r: JobRecord) => r.recordId),
    ["mine"],
  );
});

Deno.test("listMyWeeklyJobRecords - an unauthenticated caller gets 401, never reaching the repository", async () => {
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = createHandler(
    new InMemoryUserRepository(),
    new InMemoryJobRecordRepository(),
    rejecting,
  );

  const response = await handler(request({ weekOffset: 0 }));

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
