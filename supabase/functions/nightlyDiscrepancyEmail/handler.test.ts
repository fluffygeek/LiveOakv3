import { assertEquals } from "jsr:@std/assert@1";
import type { JobRecord } from "../../../packages/shared/src/jobRecord.ts";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import { InMemoryUserRepository } from "../../../functions/src/access/inMemoryUserRepository.ts";
import { InMemoryJobRecordRepository } from "../../../functions/src/jobRecords/inMemoryJobRecordRepository.ts";
import { FakeEmailSender } from "../../../functions/src/notifications/fakeEmailSender.ts";
import { UnauthenticatedError } from "../_shared/callableHandler.ts";
import { createHandler } from "./handler.ts";

function jobRecord(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    recordId: "record-1",
    jobId: "DISPATCH-123",
    technicianEmail: "tech@example.com",
    address: "123 Main St, Springfield, IL 62704",
    verifiedAddress: null,
    addressVerificationStatus: "unverified",
    workCode: "WC-01",
    footage: 100,
    photoUrls: ["a", "b", "c"],
    notes: "",
    submittedAt: "2026-01-15T12:00:00.000Z",
    createdAt: "2026-01-15T12:00:00.000Z",
    timestampSuspect: false,
    duplicate: { isDuplicate: false, linkedRecordIds: [], isPrimary: false },
    discrepancy: false,
    discrepancyReason: null,
    closed: false,
    picturesDownloaded: false,
    ...overrides,
  };
}

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    email: "payroll@example.com",
    roles: ["payrollAdministrator"],
    active: true,
    invitedAt: "2026-01-15T12:00:00.000Z",
    updatedAt: "2026-01-15T12:00:00.000Z",
    onDistributionList: true,
    ...overrides,
  };
}

const acceptAll = () => {};

// 2026-02-02T02:00:00.000Z is 20:00 Central on 2026-02-01 (CST, UTC-6) -- squarely inside
// the fired window, and one hour before nightlyStateExport/handler.test.ts's FIRED_NOW
// (21:00 Central), matching the 8pm-before-9pm ordering guarantee.
const FIRED_NOW = "2026-02-02T02:00:00.000Z";
// Two hours earlier, same Central calendar day -- outside the fired window.
const NOT_FIRED_NOW = "2026-02-02T00:00:00.000Z";

function request(): Request {
  return new Request("http://localhost/nightlyDiscrepancyEmail", { method: "POST" });
}

Deno.test("createHandler - at 20:00 Central, sends the Discrepancy email, returning fired: true with a result", async () => {
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(
    jobRecord({ recordId: "with-discrepancy", discrepancy: true, discrepancyReason: "ADDRESS" }),
  );
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(user({ email: "payroll@example.com" }));
  const emailSender = new FakeEmailSender();

  const handler = createHandler(jobRecordRepo, userRepo, emailSender, acceptAll, () => FIRED_NOW);
  const response = await handler(request());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.fired, true);
  assertEquals(body.data.nowIso, FIRED_NOW);
  assertEquals(body.data.result, { sent: true, recipientCount: 1, discrepancyCount: 1 });

  const sent = emailSender.all();
  assertEquals(sent.length, 1);
  assertEquals(sent[0]?.to, ["payroll@example.com"]);
  assertEquals(sent[0]?.body.includes("with-discrepancy"), true);
});

Deno.test("createHandler - outside 20:00 Central, does no work and returns fired: false with no result", async () => {
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(jobRecord({ discrepancy: true, discrepancyReason: "ADDRESS" }));
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(user());
  const emailSender = new FakeEmailSender();

  const handler = createHandler(jobRecordRepo, userRepo, emailSender, acceptAll, () => NOT_FIRED_NOW);
  const response = await handler(request());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.fired, false);
  assertEquals(body.data.nowIso, NOT_FIRED_NOW);
  assertEquals(body.data.result, undefined);
  assertEquals(emailSender.all().length, 0);
});

Deno.test("createHandler - at 20:00 Central with no Distribution List recipients, fires but does not send", async () => {
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(jobRecord({ discrepancy: true, discrepancyReason: "ADDRESS" }));
  const userRepo = new InMemoryUserRepository();
  const emailSender = new FakeEmailSender();

  const handler = createHandler(jobRecordRepo, userRepo, emailSender, acceptAll, () => FIRED_NOW);
  const response = await handler(request());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.fired, true);
  assertEquals(body.data.result, { sent: false, recipientCount: 0, discrepancyCount: 1 });
  assertEquals(emailSender.all().length, 0);
});

Deno.test("createHandler - rejects a request that fails scheduler-secret verification, without doing any work", async () => {
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(jobRecord({ discrepancy: true, discrepancyReason: "ADDRESS" }));
  const userRepo = new InMemoryUserRepository();
  userRepo.seed(user());
  const emailSender = new FakeEmailSender();
  const rejectAll = () => {
    throw new UnauthenticatedError("Invalid scheduler credentials");
  };

  const handler = createHandler(jobRecordRepo, userRepo, emailSender, rejectAll, () => FIRED_NOW);
  const response = await handler(request());

  assertEquals(response.status, 401);
  assertEquals(emailSender.all().length, 0);
});
