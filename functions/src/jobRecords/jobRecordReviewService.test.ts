import { beforeEach, describe, expect, it } from "vitest";
import { noDuplicateLink, type JobRecord } from "@liveoakv3/shared";
import {
  DiscrepancyActiveError,
  ForbiddenError,
  InvalidArgumentError,
  JobRecordNotFoundError,
  NotDuplicateError,
} from "../access/errors.js";
import { InMemoryAuditLogRepository } from "./inMemoryAuditLogRepository.js";
import { InMemoryJobRecordRepository } from "./inMemoryJobRecordRepository.js";
import {
  editJobRecord,
  getJobRecord,
  listJobRecordAuditLog,
  listJobRecords,
  overrideDuplicatePrimary,
  setClosed,
  setDiscrepancy,
  setPicturesDownloaded,
  unlinkDuplicate,
} from "./jobRecordReviewService.js";

const NOW = () => "2026-02-01T09:00:00.000Z";
const GENERATE_ID = () => "audit-1";

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
    notes: "All clear",
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

describe("jobRecordReviewService", () => {
  let jobRecordRepo: InMemoryJobRecordRepository;
  let auditLogRepo: InMemoryAuditLogRepository;

  beforeEach(() => {
    jobRecordRepo = new InMemoryJobRecordRepository();
    auditLogRepo = new InMemoryAuditLogRepository();
  });

  function deps() {
    return { jobRecordRepo, auditLogRepo, now: NOW, generateId: GENERATE_ID };
  }

  const PAYROLL = ["payrollAdministrator"] as const;
  const APP_ADMIN = ["applicationAdministrator"] as const;
  const TECHNICIAN = ["technician"] as const;

  describe("listJobRecords / getJobRecord / listJobRecordAuditLog", () => {
    it("lists all Job Records for a Payroll Administrator", async () => {
      jobRecordRepo.seed(baseRecord());
      const records = await listJobRecords([...PAYROLL], { jobRecordRepo });
      expect(records).toHaveLength(1);
    });

    it("rejects a Technician from listing Job Records", async () => {
      await expect(listJobRecords([...TECHNICIAN], { jobRecordRepo })).rejects.toThrow(
        ForbiddenError,
      );
    });

    it("gets a single Job Record by id", async () => {
      jobRecordRepo.seed(baseRecord());
      const record = await getJobRecord([...PAYROLL], "record-1", { jobRecordRepo });
      expect(record.recordId).toBe("record-1");
    });

    it("throws JobRecordNotFoundError for an unknown record id", async () => {
      await expect(
        getJobRecord([...PAYROLL], "missing", { jobRecordRepo }),
      ).rejects.toThrow(JobRecordNotFoundError);
    });

    it("lists audit log entries for a record", async () => {
      await auditLogRepo.append({
        id: "e1",
        recordId: "record-1",
        actorEmail: "payroll@example.com",
        action: "edited",
        timestamp: NOW(),
        before: {},
        after: {},
      });
      const entries = await listJobRecordAuditLog([...PAYROLL], "record-1", { auditLogRepo });
      expect(entries).toHaveLength(1);
    });
  });

  describe("editJobRecord", () => {
    it("allows a Payroll Administrator to edit a non-Closed record's fields", async () => {
      jobRecordRepo.seed(baseRecord());

      const record = await editJobRecord(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        { footage: 150, notes: "Corrected footage" },
        deps(),
      );

      expect(record.footage).toBe(150);
      expect(record.notes).toBe("Corrected footage");
    });

    it("rejects a Technician from editing", async () => {
      jobRecordRepo.seed(baseRecord());
      await expect(
        editJobRecord("tech@example.com", [...TECHNICIAN], "record-1", { footage: 1 }, deps()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("throws JobRecordNotFoundError for an unknown record", async () => {
      await expect(
        editJobRecord("payroll@example.com", [...PAYROLL], "missing", { footage: 1 }, deps()),
      ).rejects.toThrow(JobRecordNotFoundError);
    });

    it("blocks a Payroll Administrator from editing a Closed record", async () => {
      jobRecordRepo.seed(baseRecord({ closed: true }));
      await expect(
        editJobRecord(
          "payroll@example.com",
          [...PAYROLL],
          "record-1",
          { footage: 1 },
          deps(),
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it("allows an Application Administrator to edit a Closed record", async () => {
      jobRecordRepo.seed(baseRecord({ closed: true }));
      const record = await editJobRecord(
        "admin@example.com",
        [...APP_ADMIN],
        "record-1",
        { footage: 200 },
        deps(),
      );
      expect(record.footage).toBe(200);
    });

    it("rejects an empty jobId", async () => {
      jobRecordRepo.seed(baseRecord());
      await expect(
        editJobRecord("payroll@example.com", [...PAYROLL], "record-1", { jobId: " " }, deps()),
      ).rejects.toThrow(InvalidArgumentError);
    });

    it("rejects a work code that isn't in the known table", async () => {
      jobRecordRepo.seed(baseRecord());
      await expect(
        editJobRecord(
          "payroll@example.com",
          [...PAYROLL],
          "record-1",
          { workCode: "NOT-A-CODE" },
          deps(),
        ),
      ).rejects.toThrow(InvalidArgumentError);
    });

    it("rejects negative footage", async () => {
      jobRecordRepo.seed(baseRecord());
      await expect(
        editJobRecord(
          "payroll@example.com",
          [...PAYROLL],
          "record-1",
          { footage: -5 },
          deps(),
        ),
      ).rejects.toThrow(InvalidArgumentError);
    });

    it("rejects a photoUrls edit that drops below the record's work code minimum", async () => {
      // WC-02 requires 4 photos; seed with exactly the minimum, then edit below it.
      jobRecordRepo.seed(baseRecord({ workCode: "WC-02", photoUrls: ["a", "b", "c", "d"] }));
      await expect(
        editJobRecord(
          "payroll@example.com",
          [...PAYROLL],
          "record-1",
          { photoUrls: ["a", "b", "c"] },
          deps(),
        ),
      ).rejects.toThrow(InvalidArgumentError);
    });

    it("rejects switching to a work code whose minimum the current photos no longer satisfy", async () => {
      jobRecordRepo.seed(baseRecord({ workCode: "WC-01", photoUrls: ["a", "b", "c"] }));
      await expect(
        editJobRecord(
          "payroll@example.com",
          [...PAYROLL],
          "record-1",
          { workCode: "WC-02" }, // requires 4, record only has 3
          deps(),
        ),
      ).rejects.toThrow(InvalidArgumentError);
    });

    it("writes a field-level 'edited' audit entry with before/after only for changed fields", async () => {
      jobRecordRepo.seed(baseRecord());
      await editJobRecord(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        { footage: 150 },
        deps(),
      );

      const entries = auditLogRepo.all();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        recordId: "record-1",
        actorEmail: "payroll@example.com",
        action: "edited",
        before: { footage: 100 },
        after: { footage: 150 },
      });
    });

    it("is a no-op (no repo write, no audit entry) when the patch matches the current values", async () => {
      jobRecordRepo.seed(baseRecord());
      await editJobRecord(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        { footage: 100 },
        deps(),
      );
      expect(auditLogRepo.all()).toHaveLength(0);
    });
  });

  describe("setDiscrepancy", () => {
    it("sets an active Discrepancy with a valid reason", async () => {
      jobRecordRepo.seed(baseRecord());
      const record = await setDiscrepancy(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        true,
        "ADDRESS",
        deps(),
      );
      expect(record.discrepancy).toBe(true);
      expect(record.discrepancyReason).toBe("ADDRESS");
    });

    it("rejects setting an active Discrepancy with an unknown reason", async () => {
      jobRecordRepo.seed(baseRecord());
      await expect(
        setDiscrepancy(
          "payroll@example.com",
          [...PAYROLL],
          "record-1",
          true,
          "NOT-A-REASON",
          deps(),
        ),
      ).rejects.toThrow(InvalidArgumentError);
    });

    it("rejects setting an active Discrepancy with no reason", async () => {
      jobRecordRepo.seed(baseRecord());
      await expect(
        setDiscrepancy("payroll@example.com", [...PAYROLL], "record-1", true, null, deps()),
      ).rejects.toThrow(InvalidArgumentError);
    });

    it("clears an active Discrepancy, dropping the reason regardless of what's passed", async () => {
      jobRecordRepo.seed(baseRecord({ discrepancy: true, discrepancyReason: "ADDRESS" }));
      const record = await setDiscrepancy(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        false,
        "ADDRESS",
        deps(),
      );
      expect(record.discrepancy).toBe(false);
      expect(record.discrepancyReason).toBeNull();
    });

    it("blocks a Payroll Administrator from setting Discrepancy on a Closed record", async () => {
      jobRecordRepo.seed(baseRecord({ closed: true }));
      await expect(
        setDiscrepancy(
          "payroll@example.com",
          [...PAYROLL],
          "record-1",
          true,
          "ADDRESS",
          deps(),
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it("writes a 'discrepancy-set' audit entry", async () => {
      jobRecordRepo.seed(baseRecord());
      await setDiscrepancy(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        true,
        "FOOTAGE",
        deps(),
      );
      expect(auditLogRepo.all()).toMatchObject([
        {
          action: "discrepancy-set",
          before: { discrepancy: false, discrepancyReason: null },
          after: { discrepancy: true, discrepancyReason: "FOOTAGE" },
        },
      ]);
    });
  });

  describe("setPicturesDownloaded", () => {
    it("sets Pictures Downloaded even on a Closed record", async () => {
      jobRecordRepo.seed(baseRecord({ closed: true }));
      const record = await setPicturesDownloaded(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        true,
        deps(),
      );
      expect(record.picturesDownloaded).toBe(true);
    });

    it("sets Pictures Downloaded even while a Discrepancy is active", async () => {
      jobRecordRepo.seed(baseRecord({ discrepancy: true, discrepancyReason: "ADDRESS" }));
      const record = await setPicturesDownloaded(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        true,
        deps(),
      );
      expect(record.picturesDownloaded).toBe(true);
    });

    it("rejects a Technician from setting Pictures Downloaded", async () => {
      jobRecordRepo.seed(baseRecord());
      await expect(
        setPicturesDownloaded("tech@example.com", [...TECHNICIAN], "record-1", true, deps()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("is a no-op when the value is unchanged", async () => {
      jobRecordRepo.seed(baseRecord({ picturesDownloaded: true }));
      await setPicturesDownloaded("payroll@example.com", [...PAYROLL], "record-1", true, deps());
      expect(auditLogRepo.all()).toHaveLength(0);
    });
  });

  describe("setClosed", () => {
    it("closes a record with no active Discrepancy", async () => {
      jobRecordRepo.seed(baseRecord());
      const record = await setClosed(
        "payroll@example.com",
        [...PAYROLL],
        "record-1",
        true,
        deps(),
      );
      expect(record.closed).toBe(true);
    });

    it("blocks closing while a Discrepancy is active", async () => {
      jobRecordRepo.seed(baseRecord({ discrepancy: true, discrepancyReason: "ADDRESS" }));
      await expect(
        setClosed("payroll@example.com", [...PAYROLL], "record-1", true, deps()),
      ).rejects.toThrow(DiscrepancyActiveError);
    });

    it("blocks a Payroll Administrator from reopening an already-Closed record", async () => {
      jobRecordRepo.seed(baseRecord({ closed: true }));
      await expect(
        setClosed("payroll@example.com", [...PAYROLL], "record-1", false, deps()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("allows an Application Administrator to reopen a Closed record", async () => {
      jobRecordRepo.seed(baseRecord({ closed: true }));
      const record = await setClosed(
        "admin@example.com",
        [...APP_ADMIN],
        "record-1",
        false,
        deps(),
      );
      expect(record.closed).toBe(false);
    });

    it("writes a 'closed-set' audit entry", async () => {
      jobRecordRepo.seed(baseRecord());
      await setClosed("payroll@example.com", [...PAYROLL], "record-1", true, deps());
      expect(auditLogRepo.all()).toMatchObject([
        { action: "closed-set", before: { closed: false }, after: { closed: true } },
      ]);
    });
  });

  describe("overrideDuplicatePrimary", () => {
    function group(): [JobRecord, JobRecord] {
      const primary = baseRecord({
        recordId: "record-primary",
        duplicate: { isDuplicate: true, linkedRecordIds: ["record-1"], isPrimary: true },
      });
      const subordinate = baseRecord({
        recordId: "record-1",
        duplicate: { isDuplicate: true, linkedRecordIds: ["record-primary"], isPrimary: false },
      });
      return [primary, subordinate];
    }

    it("flips primary from the old record to the target and updates both", async () => {
      const [primary, subordinate] = group();
      jobRecordRepo.seed(primary);
      jobRecordRepo.seed(subordinate);

      const updated = await overrideDuplicatePrimary(
        "admin@example.com",
        [...APP_ADMIN],
        "record-1",
        deps(),
      );

      const newPrimary = updated.find((r) => r.recordId === "record-1");
      const oldPrimary = updated.find((r) => r.recordId === "record-primary");
      expect(newPrimary?.duplicate.isPrimary).toBe(true);
      expect(oldPrimary?.duplicate.isPrimary).toBe(false);

      await expect(jobRecordRepo.getById("record-1")).resolves.toMatchObject({
        duplicate: { isPrimary: true },
      });
      await expect(jobRecordRepo.getById("record-primary")).resolves.toMatchObject({
        duplicate: { isPrimary: false },
      });
    });

    it("is a no-op when the target is already primary", async () => {
      const [primary, subordinate] = group();
      jobRecordRepo.seed(primary);
      jobRecordRepo.seed(subordinate);

      await overrideDuplicatePrimary("admin@example.com", [...APP_ADMIN], "record-primary", deps());
      expect(auditLogRepo.all()).toHaveLength(0);
    });

    it("rejects overriding primary on a record that isn't part of a Duplicate group", async () => {
      jobRecordRepo.seed(baseRecord());
      await expect(
        overrideDuplicatePrimary("admin@example.com", [...APP_ADMIN], "record-1", deps()),
      ).rejects.toThrow(NotDuplicateError);
    });

    it("writes two 'duplicate-primary-overridden' audit entries", async () => {
      const [primary, subordinate] = group();
      jobRecordRepo.seed(primary);
      jobRecordRepo.seed(subordinate);

      await overrideDuplicatePrimary("admin@example.com", [...APP_ADMIN], "record-1", deps());

      const entries = auditLogRepo.all();
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.action === "duplicate-primary-overridden")).toBe(true);
    });
  });

  describe("unlinkDuplicate", () => {
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

    it("removes the link between two records, clearing isDuplicate when no links remain", async () => {
      const [a, b] = linkedPair();
      jobRecordRepo.seed(a);
      jobRecordRepo.seed(b);

      const { record, other } = await unlinkDuplicate(
        "admin@example.com",
        [...APP_ADMIN],
        "record-a",
        "record-b",
        deps(),
      );

      expect(record.duplicate).toEqual(noDuplicateLink());
      expect(other.duplicate).toEqual(noDuplicateLink());
    });

    it("keeps the remaining links intact when unlinking one pair out of a larger group", async () => {
      const a = baseRecord({
        recordId: "record-a",
        duplicate: {
          isDuplicate: true,
          linkedRecordIds: ["record-b", "record-c"],
          isPrimary: true,
        },
      });
      const b = baseRecord({
        recordId: "record-b",
        duplicate: { isDuplicate: true, linkedRecordIds: ["record-a"], isPrimary: false },
      });
      jobRecordRepo.seed(a);
      jobRecordRepo.seed(b);

      const { record } = await unlinkDuplicate(
        "admin@example.com",
        [...APP_ADMIN],
        "record-a",
        "record-b",
        deps(),
      );

      expect(record.duplicate).toEqual({
        isDuplicate: true,
        linkedRecordIds: ["record-c"],
        isPrimary: true,
      });
    });

    it("rejects unlinking two records that aren't linked", async () => {
      jobRecordRepo.seed(baseRecord({ recordId: "record-a" }));
      jobRecordRepo.seed(baseRecord({ recordId: "record-b" }));
      await expect(
        unlinkDuplicate("admin@example.com", [...APP_ADMIN], "record-a", "record-b", deps()),
      ).rejects.toThrow(NotDuplicateError);
    });

    it("blocks a Payroll Administrator from unlinking when either record is Closed", async () => {
      const [a, b] = linkedPair();
      jobRecordRepo.seed({ ...a, closed: true });
      jobRecordRepo.seed(b);
      await expect(
        unlinkDuplicate("payroll@example.com", [...PAYROLL], "record-a", "record-b", deps()),
      ).rejects.toThrow(ForbiddenError);
    });

    it("writes two 'duplicate-unlinked' audit entries", async () => {
      const [a, b] = linkedPair();
      jobRecordRepo.seed(a);
      jobRecordRepo.seed(b);

      await unlinkDuplicate("admin@example.com", [...APP_ADMIN], "record-a", "record-b", deps());

      const entries = auditLogRepo.all();
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.action === "duplicate-unlinked")).toBe(true);
    });
  });
});
