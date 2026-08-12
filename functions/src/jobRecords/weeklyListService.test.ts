import { beforeEach, describe, expect, it } from "vitest";
import { noDuplicateLink, type JobRecord } from "@liveoakv3/shared";
import { ForbiddenError, InvalidArgumentError } from "../access/errors.js";
import { InMemoryJobRecordRepository } from "./inMemoryJobRecordRepository.js";
import { listMyWeeklyJobRecords } from "./weeklyListService.js";

// 2026-01-06 (Tuesday) is inside the Sun 2026-01-04 .. Sun 2026-01-11 Eastern week.
const NOW = () => "2026-01-06T12:00:00.000Z";
const CURRENT_WEEK_START = "2026-01-04T05:00:00.000Z"; // Sunday midnight ET

function record(overrides: Partial<JobRecord> = {}): JobRecord {
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

describe("listMyWeeklyJobRecords", () => {
  let jobRecordRepo: InMemoryJobRecordRepository;

  beforeEach(() => {
    jobRecordRepo = new InMemoryJobRecordRepository();
  });

  function deps() {
    return { jobRecordRepo, now: NOW };
  }

  it("returns the current week's window and the caller's records within it", async () => {
    jobRecordRepo.seed(record({ recordId: "record-1", submittedAt: "2026-01-06T15:00:00.000Z" }));

    const result = await listMyWeeklyJobRecords(
      "tech@example.com",
      ["technician"],
      0,
      deps(),
    );

    expect(result.startIso).toBe("2026-01-04T05:00:00.000Z");
    expect(result.endIso).toBe("2026-01-11T05:00:00.000Z");
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.recordId).toBe("record-1");
  });

  it("rejects a caller without the technician role", async () => {
    await expect(
      listMyWeeklyJobRecords("admin@example.com", ["applicationAdministrator"], 0, deps()),
    ).rejects.toThrow(ForbiddenError);
  });

  it("only returns the requesting technician's own records", async () => {
    jobRecordRepo.seed(
      record({ recordId: "mine", technicianEmail: "tech@example.com" }),
    );
    jobRecordRepo.seed(
      record({ recordId: "someone-elses", technicianEmail: "other-tech@example.com" }),
    );

    const result = await listMyWeeklyJobRecords(
      "tech@example.com",
      ["technician"],
      0,
      deps(),
    );

    expect(result.records.map((r) => r.recordId)).toEqual(["mine"]);
  });

  it("excludes a record submitted just before the Sunday-midnight-ET boundary (prior week)", async () => {
    const justBefore = new Date(CURRENT_WEEK_START);
    justBefore.setUTCMinutes(justBefore.getUTCMinutes() - 1);
    jobRecordRepo.seed(record({ recordId: "prior-week", submittedAt: justBefore.toISOString() }));

    const result = await listMyWeeklyJobRecords(
      "tech@example.com",
      ["technician"],
      0,
      deps(),
    );

    expect(result.records).toHaveLength(0);
  });

  it("includes a record submitted exactly at the Sunday-midnight-ET boundary (new week)", async () => {
    jobRecordRepo.seed(
      record({ recordId: "new-week", submittedAt: CURRENT_WEEK_START }),
    );

    const result = await listMyWeeklyJobRecords(
      "tech@example.com",
      ["technician"],
      0,
      deps(),
    );

    expect(result.records.map((r) => r.recordId)).toEqual(["new-week"]);
  });

  it("returns a prior week's records when weekOffset is negative", async () => {
    jobRecordRepo.seed(
      record({ recordId: "two-weeks-ago", submittedAt: "2025-12-23T15:00:00.000Z" }),
    );
    jobRecordRepo.seed(
      record({ recordId: "this-week", submittedAt: "2026-01-06T15:00:00.000Z" }),
    );

    const result = await listMyWeeklyJobRecords(
      "tech@example.com",
      ["technician"],
      -2,
      deps(),
    );

    expect(result.records.map((r) => r.recordId)).toEqual(["two-weeks-ago"]);
    expect(result.startIso).toBe("2025-12-21T05:00:00.000Z");
    expect(result.endIso).toBe("2025-12-28T05:00:00.000Z");
  });

  it("rejects a positive (future) weekOffset", async () => {
    await expect(
      listMyWeeklyJobRecords("tech@example.com", ["technician"], 1, deps()),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("rejects a non-integer weekOffset", async () => {
    await expect(
      listMyWeeklyJobRecords("tech@example.com", ["technician"], -1.5, deps()),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("returns records sorted by submittedAt ascending", async () => {
    jobRecordRepo.seed(record({ recordId: "later", submittedAt: "2026-01-08T10:00:00.000Z" }));
    jobRecordRepo.seed(record({ recordId: "earlier", submittedAt: "2026-01-05T10:00:00.000Z" }));

    const result = await listMyWeeklyJobRecords(
      "tech@example.com",
      ["technician"],
      0,
      deps(),
    );

    expect(result.records.map((r) => r.recordId)).toEqual(["earlier", "later"]);
  });
});
