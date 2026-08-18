import { assertEquals } from "jsr:@std/assert@1";
import type { AuditLogEntry } from "../../../packages/shared/src/auditLog.ts";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
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

/** Test double — never used by production code. */
class InMemoryAuditLogRepository implements AuditLogRepository {
  private readonly entries: AuditLogEntry[] = [];

  append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }

  listByRecordId(recordId: string): Promise<AuditLogEntry[]> {
    return Promise.resolve(
      this.entries
        .filter((entry) => entry.recordId === recordId)
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    );
  }

  seed(entry: AuditLogEntry): void {
    this.entries.push(entry);
  }
}

function fakeVerifyCaller(email: string): VerifyCaller {
  return () => Promise.resolve({ email });
}

function request(body: unknown): Request {
  return new Request("http://localhost/listJobRecordAuditLog", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sampleEntry(overrides: Partial<AuditLogEntry> = {}): AuditLogEntry {
  return {
    id: "entry-1",
    recordId: "record-1",
    actorEmail: "admin@example.com",
    action: "edited",
    timestamp: "2026-01-01T12:00:00.000Z",
    before: { jobId: "OLD-1" },
    after: { jobId: "NEW-1" },
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

Deno.test("listJobRecordAuditLog - a Payroll/Application Administrator can fetch a Job Record's audit history", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const auditLogRepo = new InMemoryAuditLogRepository();
  auditLogRepo.seed(sampleEntry({ id: "entry-1", timestamp: "2026-01-01T12:00:00.000Z" }));
  auditLogRepo.seed(sampleEntry({ id: "entry-2", timestamp: "2026-01-02T12:00:00.000Z" }));
  const handler = createHandler(userRepo, auditLogRepo, fakeVerifyCaller("admin@example.com"));

  const response = await handler(request({ recordId: "record-1" }));

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(
    body.data.map((entry: AuditLogEntry) => entry.id),
    ["entry-1", "entry-2"],
  );
});

Deno.test("listJobRecordAuditLog - a Technician caller (not an admin) is rejected", async () => {
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
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("tech@example.com"),
  );

  const response = await handler(request({ recordId: "record-1" }));

  assertEquals(response.status, 403);
  const body = await response.json();
  assertEquals(body.error.code, "permission-denied");
});

Deno.test("listJobRecordAuditLog - an unknown recordId returns an empty array, not an error", async () => {
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(adminRecord("admin@example.com"));
  const handler = createHandler(
    userRepo,
    new InMemoryAuditLogRepository(),
    fakeVerifyCaller("admin@example.com"),
  );

  const response = await handler(request({ recordId: "does-not-exist" }));

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data, []);
});

Deno.test("listJobRecordAuditLog - an unauthenticated caller gets 401, never reaching the repository", async () => {
  const rejecting: VerifyCaller = () => {
    throw new UnauthenticatedError("Sign-in required");
  };
  const handler = createHandler(
    new InMemoryUserRepository(),
    new InMemoryAuditLogRepository(),
    rejecting,
  );

  const response = await handler(request({ recordId: "record-1" }));

  assertEquals(response.status, 401);
  const body = await response.json();
  assertEquals(body.error.code, "unauthenticated");
});
