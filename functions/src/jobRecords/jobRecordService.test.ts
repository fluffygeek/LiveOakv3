import { beforeEach, describe, expect, it } from "vitest";
import { noDuplicateLink, type JobRecord } from "@liveoakv3/shared";
import { ForbiddenError, InvalidArgumentError } from "../access/errors.js";
import { FakeAddressVerifier } from "./fakeAddressVerifier.js";
import { InMemoryAuditLogRepository } from "./inMemoryAuditLogRepository.js";
import { InMemoryJobRecordRepository } from "./inMemoryJobRecordRepository.js";
import { createJobRecord, type CreateJobRecordInput } from "./jobRecordService.js";

const SUBMITTED_AT = "2026-01-01T12:00:00.000Z";
const SERVER_NOW = () => "2026-01-01T12:00:05.000Z"; // 5s after submission — plausible
const GENERATE_ID = () => "record-1";

function validInput(overrides: Partial<CreateJobRecordInput> = {}): CreateJobRecordInput {
  return {
    jobId: "DISPATCH-123",
    address: "123 Main St, Springfield",
    workCode: "WC-01",
    footage: 100,
    notes: "All clear",
    photoUrls: ["photo-a", "photo-b", "photo-c"], // meets WC-01's placeholder minimum (3)
    isNewBuild: false,
    submittedAt: SUBMITTED_AT,
    ...overrides,
  };
}

describe("createJobRecord", () => {
  let jobRecordRepo: InMemoryJobRecordRepository;
  let auditLogRepo: InMemoryAuditLogRepository;

  beforeEach(() => {
    jobRecordRepo = new InMemoryJobRecordRepository();
    auditLogRepo = new InMemoryAuditLogRepository();
  });

  function deps(overrides: { now?: () => string; generateId?: () => string } = {}) {
    return {
      jobRecordRepo,
      auditLogRepo,
      addressVerifier: new FakeAddressVerifier(),
      now: overrides.now ?? SERVER_NOW,
      generateId: overrides.generateId ?? GENERATE_ID,
    };
  }

  it("creates a Job Record with the submitted fields", async () => {
    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput(),
      deps(),
    );

    expect(record).toMatchObject({
      recordId: "record-1",
      jobId: "DISPATCH-123",
      technicianEmail: "tech@example.com",
      address: "123 Main St, Springfield",
      workCode: "WC-01",
      footage: 100,
      notes: "All clear",
      submittedAt: SUBMITTED_AT,
      createdAt: SERVER_NOW(),
    });
    await expect(jobRecordRepo.getById("record-1")).resolves.toMatchObject({
      jobId: "DISPATCH-123",
    });
  });

  it("rejects a caller without the technician role", async () => {
    await expect(
      createJobRecord("admin@example.com", ["applicationAdministrator"], validInput(), deps()),
    ).rejects.toThrow(ForbiddenError);
  });

  it("rejects an empty job id", async () => {
    await expect(
      createJobRecord("tech@example.com", ["technician"], validInput({ jobId: "  " }), deps()),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("rejects an empty address", async () => {
    await expect(
      createJobRecord("tech@example.com", ["technician"], validInput({ address: "" }), deps()),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("rejects a work code that isn't in the known table", async () => {
    await expect(
      createJobRecord(
        "tech@example.com",
        ["technician"],
        validInput({ workCode: "NOT-A-CODE" }),
        deps(),
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("rejects negative footage", async () => {
    await expect(
      createJobRecord("tech@example.com", ["technician"], validInput({ footage: -1 }), deps()),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("rejects non-integer footage", async () => {
    await expect(
      createJobRecord("tech@example.com", ["technician"], validInput({ footage: 10.5 }), deps()),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("rejects an empty submittedAt", async () => {
    await expect(
      createJobRecord(
        "tech@example.com",
        ["technician"],
        validInput({ submittedAt: "" }),
        deps(),
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("rejects a submittedAt that isn't a parseable timestamp", async () => {
    await expect(
      createJobRecord(
        "tech@example.com",
        ["technician"],
        validInput({ submittedAt: "not-a-date" }),
        deps(),
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("writes a 'created' audit log entry", async () => {
    await createJobRecord("tech@example.com", ["technician"], validInput(), deps());

    const entries = auditLogRepo.all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      recordId: "record-1",
      actorEmail: "tech@example.com",
      action: "created",
      before: null,
    });
  });

  it("does not flag the timestamp as suspect when submittedAt and createdAt are close", async () => {
    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput(),
      deps(),
    );

    expect(record.timestampSuspect).toBe(false);
  });

  it("flags the timestamp as suspect when createdAt is implausibly far from submittedAt", async () => {
    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput(),
      deps({ now: () => "2026-02-15T12:00:00.000Z" }), // 45 days later — offline sync shouldn't take that long
    );

    expect(record.timestampSuspect).toBe(true);
  });
});

describe("createJobRecord — photo minimum enforcement", () => {
  let jobRecordRepo: InMemoryJobRecordRepository;
  let auditLogRepo: InMemoryAuditLogRepository;

  beforeEach(() => {
    jobRecordRepo = new InMemoryJobRecordRepository();
    auditLogRepo = new InMemoryAuditLogRepository();
  });

  function deps() {
    return {
      jobRecordRepo,
      auditLogRepo,
      addressVerifier: new FakeAddressVerifier(),
      now: SERVER_NOW,
      generateId: GENERATE_ID,
    };
  }

  // WC-01's placeholder minimum is 3 photos.
  it("rejects fewer photos than the work code's minimum", async () => {
    await expect(
      createJobRecord(
        "tech@example.com",
        ["technician"],
        validInput({ workCode: "WC-01", photoUrls: ["a", "b"] }),
        deps(),
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });

  it("accepts exactly the work code's minimum photo count", async () => {
    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput({ workCode: "WC-01", photoUrls: ["a", "b", "c"] }),
      deps(),
    );

    expect(record.photoUrls).toEqual(["a", "b", "c"]);
  });

  it("accepts more than the work code's minimum photo count", async () => {
    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput({ workCode: "WC-01", photoUrls: ["a", "b", "c", "d"] }),
      deps(),
    );

    expect(record.photoUrls).toHaveLength(4);
  });

  it("enforces a different work code's own minimum (WC-02 requires 4)", async () => {
    await expect(
      createJobRecord(
        "tech@example.com",
        ["technician"],
        validInput({ workCode: "WC-02", photoUrls: ["a", "b", "c"] }),
        deps(),
      ),
    ).rejects.toThrow(InvalidArgumentError);
  });
});

describe("createJobRecord — address verification and new-build", () => {
  let jobRecordRepo: InMemoryJobRecordRepository;
  let auditLogRepo: InMemoryAuditLogRepository;

  beforeEach(() => {
    jobRecordRepo = new InMemoryJobRecordRepository();
    auditLogRepo = new InMemoryAuditLogRepository();
  });

  function deps(addressVerifier: FakeAddressVerifier) {
    return {
      jobRecordRepo,
      auditLogRepo,
      addressVerifier,
      now: SERVER_NOW,
      generateId: GENERATE_ID,
    };
  }

  it("marks the record verified and stores the vendor's normalized address on a match", async () => {
    const verifier = new FakeAddressVerifier({
      type: "match",
      normalizedAddress: "123 MAIN ST, SPRINGFIELD",
    });

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput({ isNewBuild: false }),
      deps(verifier),
    );

    expect(record.addressVerificationStatus).toBe("verified");
    expect(record.verifiedAddress).toBe("123 MAIN ST, SPRINGFIELD");
  });

  it("marks the record unverified (not blocked) on a vendor no-match", async () => {
    const verifier = new FakeAddressVerifier({ type: "noMatch" });

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput({ isNewBuild: false }),
      deps(verifier),
    );

    expect(record.addressVerificationStatus).toBe("unverified");
    expect(record.verifiedAddress).toBeNull();
  });

  it("marks the record unverified (not blocked) when the vendor call itself throws", async () => {
    const verifier = new FakeAddressVerifier({
      type: "throw",
      error: new Error("vendor timeout"),
    });

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput({ isNewBuild: false }),
      deps(verifier),
    );

    expect(record.addressVerificationStatus).toBe("unverified");
    expect(record.verifiedAddress).toBeNull();
  });

  it("skips verification entirely for a self-declared new build", async () => {
    const verifier = new FakeAddressVerifier({ type: "noMatch" });

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput({ isNewBuild: true }),
      deps(verifier),
    );

    expect(record.addressVerificationStatus).toBe("newBuild");
    expect(record.verifiedAddress).toBeNull();
  });
});

describe("createJobRecord — duplicate detection", () => {
  let jobRecordRepo: InMemoryJobRecordRepository;
  let auditLogRepo: InMemoryAuditLogRepository;

  beforeEach(() => {
    jobRecordRepo = new InMemoryJobRecordRepository();
    auditLogRepo = new InMemoryAuditLogRepository();
  });

  function deps() {
    return {
      jobRecordRepo,
      auditLogRepo,
      addressVerifier: new FakeAddressVerifier({ type: "noMatch" }), // exercise the raw-address matching path
      now: SERVER_NOW,
      generateId: GENERATE_ID,
    };
  }

  function existingRecord(overrides: Partial<JobRecord> = {}): JobRecord {
    return {
      recordId: "existing-1",
      jobId: "OLD-DISPATCH",
      technicianEmail: "other-tech@example.com",
      address: "123 Main St, Springfield",
      verifiedAddress: null,
      addressVerificationStatus: "unverified",
      workCode: "WC-01",
      footage: 50,
      photoUrls: ["x", "y", "z"],
      notes: "",
      submittedAt: "2025-10-01T12:00:00.000Z",
      createdAt: "2025-10-01T12:00:00.000Z",
      timestampSuspect: false,
      duplicate: noDuplicateLink(),
      discrepancy: false,
      discrepancyReason: null,
      closed: false,
      picturesDownloaded: false,
      ...overrides,
    };
  }

  it("does not mark a record as a duplicate when no other record shares its address", async () => {
    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput(),
      deps(),
    );

    expect(record.duplicate).toEqual(noDuplicateLink());
  });

  it("links a new record to an existing one with the same address inside the 6-month window, without a prior primary", async () => {
    jobRecordRepo.seed(existingRecord());

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput(), // submittedAt 2026-01-01, ~3 months after the existing record
      deps(),
    );

    expect(record.duplicate).toEqual({
      isDuplicate: true,
      linkedRecordIds: ["existing-1"],
      isPrimary: false,
    });

    const updatedExisting = await jobRecordRepo.getById("existing-1");
    expect(updatedExisting?.duplicate).toEqual({
      isDuplicate: true,
      linkedRecordIds: ["record-1"],
      isPrimary: true, // first-submitted becomes primary
    });
  });

  it("preserves an already-established primary when a third record joins the group", async () => {
    jobRecordRepo.seed(
      existingRecord({
        recordId: "existing-1",
        submittedAt: "2025-10-01T12:00:00.000Z",
        duplicate: { isDuplicate: true, linkedRecordIds: ["existing-2"], isPrimary: true },
      }),
    );
    jobRecordRepo.seed(
      existingRecord({
        recordId: "existing-2",
        submittedAt: "2025-11-01T12:00:00.000Z",
        duplicate: { isDuplicate: true, linkedRecordIds: ["existing-1"], isPrimary: false },
      }),
    );

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput(),
      deps(),
    );

    expect(record.duplicate.isDuplicate).toBe(true);
    expect(record.duplicate.isPrimary).toBe(false);
    expect(record.duplicate.linkedRecordIds.sort()).toEqual(["existing-1", "existing-2"]);

    const one = await jobRecordRepo.getById("existing-1");
    const two = await jobRecordRepo.getById("existing-2");
    expect(one?.duplicate.isDuplicate).toBe(true);
    expect(one?.duplicate.isPrimary).toBe(true);
    expect(one?.duplicate.linkedRecordIds.sort()).toEqual(["existing-2", "record-1"]);
    expect(two?.duplicate.isDuplicate).toBe(true);
    expect(two?.duplicate.isPrimary).toBe(false);
    expect(two?.duplicate.linkedRecordIds.sort()).toEqual(["existing-1", "record-1"]);
  });

  it("ignores a same-address record submitted outside the 6-month window", async () => {
    jobRecordRepo.seed(
      existingRecord({ submittedAt: "2025-01-01T12:00:00.000Z" }), // a full year before
    );

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput(),
      deps(),
    );

    expect(record.duplicate).toEqual(noDuplicateLink());
  });

  it("ignores a record with a different address", async () => {
    jobRecordRepo.seed(existingRecord({ address: "456 Oak Ave, Springfield" }));

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput(),
      deps(),
    );

    expect(record.duplicate).toEqual(noDuplicateLink());
  });

  it("matches addresses case- and whitespace-insensitively", async () => {
    jobRecordRepo.seed(existingRecord({ address: "123   MAIN st" }));

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput({ address: "123 Main St" }),
      deps(),
    );

    expect(record.duplicate.isDuplicate).toBe(true);
  });

  it("matches on the vendor-verified address when available, even if raw addresses differ", async () => {
    jobRecordRepo.seed(
      existingRecord({
        address: "123 Main Street",
        verifiedAddress: "123 MAIN ST",
      }),
    );

    const record = await createJobRecord(
      "tech@example.com",
      ["technician"],
      validInput({ address: "123 Main St." }),
      {
        jobRecordRepo,
        auditLogRepo,
        addressVerifier: new FakeAddressVerifier({
          type: "match",
          normalizedAddress: "123 MAIN ST",
        }),
        now: SERVER_NOW,
        generateId: GENERATE_ID,
      },
    );

    expect(record.duplicate.isDuplicate).toBe(true);
  });

  it("still links two concurrent submissions for the same address (no lost-update race)", async () => {
    let counter = 0;
    const generateId = () => `concurrent-${++counter}`;

    await Promise.all([
      createJobRecord(
        "tech-a@example.com",
        ["technician"],
        validInput({ jobId: "JOB-A" }),
        { jobRecordRepo, auditLogRepo, addressVerifier: new FakeAddressVerifier({ type: "noMatch" }), now: SERVER_NOW, generateId },
      ),
      createJobRecord(
        "tech-b@example.com",
        ["technician"],
        validInput({ jobId: "JOB-B" }),
        { jobRecordRepo, auditLogRepo, addressVerifier: new FakeAddressVerifier({ type: "noMatch" }), now: SERVER_NOW, generateId },
      ),
    ]);

    // Re-fetch current state rather than trusting the returned objects — a
    // record returned by an earlier call can be updated afterward by a
    // later concurrent one (e.g. once it's linked as a duplicate).
    const stored = await Promise.all(
      ["concurrent-1", "concurrent-2"].map((id) => jobRecordRepo.getById(id)),
    );
    const primaries = stored.filter((r) => r?.duplicate.isPrimary);
    const linked = stored.filter((r) => r?.duplicate.isDuplicate);
    expect(primaries).toHaveLength(1);
    expect(linked).toHaveLength(2);
  });
});
