import { beforeEach, describe, expect, it } from "vitest";
import { noDuplicateLink, type JobRecord } from "@liveoakv3/shared";
import { InMemoryJobRecordRepository } from "../jobRecords/inMemoryJobRecordRepository.ts";
import { InMemoryStateExportRepository } from "./inMemoryStateExportRepository.ts";
import { generateStateExport, groupJobRecordsByState } from "./stateExportService.ts";

const NOW = () => "2026-02-01T03:00:00.000Z";
const GENERATE_ID = () => "run-1";

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
    submittedAt: "2026-01-15T12:00:00.000Z",
    createdAt: "2026-01-15T12:00:00.000Z",
    timestampSuspect: false,
    duplicate: noDuplicateLink(),
    discrepancy: false,
    discrepancyReason: null,
    closed: false,
    picturesDownloaded: false,
    ...overrides,
  };
}

describe("groupJobRecordsByState", () => {
  it("groups records by the state parsed from their address", () => {
    const grouped = groupJobRecordsByState([
      record({ recordId: "il-1", address: "1 Main St, Springfield, IL 62704" }),
      record({ recordId: "il-2", address: "2 Oak Ave, Chicago, IL 60601" }),
      record({ recordId: "tx-1", address: "3 Elm St, Austin, TX 73301" }),
    ]);

    expect(grouped.IL?.map((r) => r.recordId).sort()).toEqual(["il-1", "il-2"]);
    expect(grouped.TX?.map((r) => r.recordId)).toEqual(["tx-1"]);
  });

  it("prefers the vendor-verified address over the raw address when both are present", () => {
    const grouped = groupJobRecordsByState([
      record({
        recordId: "verified",
        address: "no state here",
        verifiedAddress: "1 Main St, Springfield, IL 62704",
      }),
    ]);

    expect(grouped.IL?.map((r) => r.recordId)).toEqual(["verified"]);
  });

  it("buckets an address with no parseable state under UNKNOWN", () => {
    const grouped = groupJobRecordsByState([
      record({ recordId: "no-state", address: "not a real address" }),
    ]);

    expect(grouped.UNKNOWN?.map((r) => r.recordId)).toEqual(["no-state"]);
  });
});

describe("generateStateExport", () => {
  let jobRecordRepo: InMemoryJobRecordRepository;
  let stateExportRepo: InMemoryStateExportRepository;

  beforeEach(() => {
    jobRecordRepo = new InMemoryJobRecordRepository();
    stateExportRepo = new InMemoryStateExportRepository();
  });

  function deps() {
    return { jobRecordRepo, stateExportRepo, now: NOW, generateId: GENERATE_ID };
  }

  it("saves one batch per state and reports correct counts", async () => {
    jobRecordRepo.seed(record({ recordId: "il-1", address: "1 Main St, Springfield, IL 62704" }));
    jobRecordRepo.seed(record({ recordId: "il-2", address: "2 Oak Ave, Chicago, IL 60601" }));
    jobRecordRepo.seed(record({ recordId: "tx-1", address: "3 Elm St, Austin, TX 73301" }));

    const summary = await generateStateExport(deps());

    expect(summary).toEqual({
      runId: "run-1",
      generatedAt: NOW(),
      stateCounts: { IL: 2, TX: 1 },
    });

    const batches = stateExportRepo.all();
    expect(batches).toHaveLength(2);
    const ilBatch = batches.find((b) => b.state === "IL");
    expect(ilBatch?.records.map((r) => r.recordId).sort()).toEqual(["il-1", "il-2"]);
  });

  it("reflects the master table exactly, with no divergence from what's stored", async () => {
    const seeded = record({ recordId: "exact", footage: 250, notes: "specific note" });
    jobRecordRepo.seed(seeded);

    await generateStateExport(deps());

    const batch = stateExportRepo.all()[0];
    expect(batch?.records[0]).toEqual(seeded);
  });

  it("produces no batches when there are no Job Records", async () => {
    const summary = await generateStateExport(deps());

    expect(summary.stateCounts).toEqual({});
    expect(stateExportRepo.all()).toHaveLength(0);
  });
});
