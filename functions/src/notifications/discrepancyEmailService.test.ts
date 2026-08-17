import { beforeEach, describe, expect, it } from "vitest";
import { noDuplicateLink, type JobRecord, type UserRecord } from "@liveoakv3/shared";
import { InMemoryUserRepository } from "../access/inMemoryUserRepository.ts";
import { InMemoryJobRecordRepository } from "../jobRecords/inMemoryJobRecordRepository.ts";
import { FakeEmailSender } from "./fakeEmailSender.ts";
import { getDistributionListRecipients, sendDiscrepancyEmail } from "./discrepancyEmailService.ts";

const NOW = "2026-02-01T02:00:00.000Z";

function record(overrides: Partial<JobRecord> = {}): JobRecord {
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
    submittedAt: NOW,
    createdAt: NOW,
    timestampSuspect: false,
    duplicate: noDuplicateLink(),
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
    invitedAt: NOW,
    updatedAt: NOW,
    onDistributionList: true,
    ...overrides,
  };
}

describe("getDistributionListRecipients", () => {
  let userRepo: InMemoryUserRepository;

  beforeEach(() => {
    userRepo = new InMemoryUserRepository();
  });

  it("includes an active, listed Payroll Administrator", async () => {
    userRepo.seed(user({ email: "payroll@example.com" }));
    expect(await getDistributionListRecipients(userRepo)).toEqual(["payroll@example.com"]);
  });

  it("includes an active, listed Application Administrator", async () => {
    userRepo.seed(
      user({ email: "admin@example.com", roles: ["applicationAdministrator"] }),
    );
    expect(await getDistributionListRecipients(userRepo)).toEqual(["admin@example.com"]);
  });

  it("excludes a user not on the Distribution List", async () => {
    userRepo.seed(user({ email: "not-listed@example.com", onDistributionList: false }));
    expect(await getDistributionListRecipients(userRepo)).toEqual([]);
  });

  it("excludes a revoked (inactive) user even if listed", async () => {
    userRepo.seed(user({ email: "revoked@example.com", active: false }));
    expect(await getDistributionListRecipients(userRepo)).toEqual([]);
  });

  it("excludes a Technician-only user even if somehow listed", async () => {
    userRepo.seed(
      user({ email: "tech@example.com", roles: ["technician"], onDistributionList: true }),
    );
    expect(await getDistributionListRecipients(userRepo)).toEqual([]);
  });
});

describe("sendDiscrepancyEmail", () => {
  let jobRecordRepo: InMemoryJobRecordRepository;
  let userRepo: InMemoryUserRepository;
  let emailSender: FakeEmailSender;

  beforeEach(() => {
    jobRecordRepo = new InMemoryJobRecordRepository();
    userRepo = new InMemoryUserRepository();
    emailSender = new FakeEmailSender();
  });

  function deps() {
    return { jobRecordRepo, userRepo, emailSender };
  }

  it("sends to every Distribution List recipient, listing active Discrepancies", async () => {
    userRepo.seed(user({ email: "payroll@example.com" }));
    jobRecordRepo.seed(
      record({ recordId: "with-discrepancy", discrepancy: true, discrepancyReason: "ADDRESS" }),
    );

    const result = await sendDiscrepancyEmail(deps());

    expect(result).toEqual({ sent: true, recipientCount: 1, discrepancyCount: 1 });
    expect(emailSender.all()).toHaveLength(1);
    expect(emailSender.all()[0]?.to).toEqual(["payroll@example.com"]);
    expect(emailSender.all()[0]?.body).toContain("with-discrepancy");
  });

  it("excludes records without an active Discrepancy", async () => {
    userRepo.seed(user());
    jobRecordRepo.seed(record({ recordId: "cleared", discrepancy: false }));
    jobRecordRepo.seed(
      record({ recordId: "active", discrepancy: true, discrepancyReason: "FOOTAGE" }),
    );

    const result = await sendDiscrepancyEmail(deps());

    expect(result.discrepancyCount).toBe(1);
    expect(emailSender.all()[0]?.body).toContain("active");
    expect(emailSender.all()[0]?.body).not.toContain("cleared");
  });

  it("still reports an unresolved Discrepancy on a second run", async () => {
    userRepo.seed(user());
    jobRecordRepo.seed(
      record({ recordId: "still-active", discrepancy: true, discrepancyReason: "OTHER" }),
    );

    await sendDiscrepancyEmail(deps());
    const secondRun = await sendDiscrepancyEmail(deps());

    expect(secondRun.discrepancyCount).toBe(1);
    expect(emailSender.all()).toHaveLength(2);
    expect(emailSender.all()[1]?.body).toContain("still-active");
  });

  it("skips sending when the Distribution List has no eligible recipients", async () => {
    jobRecordRepo.seed(record({ discrepancy: true, discrepancyReason: "ADDRESS" }));

    const result = await sendDiscrepancyEmail(deps());

    expect(result).toEqual({ sent: false, recipientCount: 0, discrepancyCount: 1 });
    expect(emailSender.all()).toHaveLength(0);
  });

  it("still sends a report when there are no active Discrepancies", async () => {
    userRepo.seed(user());

    const result = await sendDiscrepancyEmail(deps());

    expect(result).toEqual({ sent: true, recipientCount: 1, discrepancyCount: 0 });
    expect(emailSender.all()[0]?.body).toContain("No active Discrepancies");
  });
});
