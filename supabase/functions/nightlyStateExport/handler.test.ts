import { assertEquals } from "jsr:@std/assert@1";
import type { JobRecord } from "../../../packages/shared/src/jobRecord.ts";
import type { StateExportBatch } from "../../../packages/shared/src/stateExport.ts";
import type {
  DuplicateLinkingResult,
  JobRecordRepository,
} from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { StateExportRepository } from "../../../functions/src/notifications/stateExportRepository.ts";
import { UnauthenticatedError } from "../_shared/callableHandler.ts";
import { createHandler } from "./handler.ts";

/** Test double — never used by production code (mirrors createJobRecord/handler.test.ts's
 * locally-defined InMemoryJobRecordRepository, kept minimal since this file only exercises
 * the handler's wall-clock-gating/transport wiring, not real Duplicate matching). */
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
class InMemoryStateExportRepository implements StateExportRepository {
  private readonly batches: StateExportBatch[] = [];

  saveBatches(batches: StateExportBatch[]): Promise<void> {
    this.batches.push(...batches);
    return Promise.resolve();
  }

  all(): StateExportBatch[] {
    return [...this.batches];
  }
}

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

const acceptAll = () => {};

// 2026-02-02T03:00:00.000Z is 21:00 Central on 2026-02-01 (CST, UTC-6) -- squarely inside
// the fired window.
const FIRED_NOW = "2026-02-02T03:00:00.000Z";
// Two hours earlier, same Central calendar day -- outside the fired window.
const NOT_FIRED_NOW = "2026-02-02T01:00:00.000Z";

function request(): Request {
  return new Request("http://localhost/nightlyStateExport", { method: "POST" });
}

Deno.test("createHandler - at 21:00 Central, generates and saves the export, returning fired: true with a summary", async () => {
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(jobRecord({ recordId: "il-1", address: "1 Main St, Springfield, IL 62704" }));
  jobRecordRepo.seed(jobRecord({ recordId: "tx-1", address: "2 Elm St, Austin, TX 73301" }));
  const stateExportRepo = new InMemoryStateExportRepository();

  const handler = createHandler(jobRecordRepo, stateExportRepo, acceptAll, () => FIRED_NOW);
  const response = await handler(request());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.fired, true);
  assertEquals(body.data.nowIso, FIRED_NOW);
  assertEquals(body.data.summary.stateCounts, { IL: 1, TX: 1 });

  const saved = stateExportRepo.all();
  assertEquals(saved.length, 2);
  assertEquals(saved.every((b) => b.generatedAt === FIRED_NOW), true);
});

Deno.test("createHandler - outside 21:00 Central, does no work and returns fired: false with no summary", async () => {
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(jobRecord());
  const stateExportRepo = new InMemoryStateExportRepository();

  const handler = createHandler(jobRecordRepo, stateExportRepo, acceptAll, () => NOT_FIRED_NOW);
  const response = await handler(request());

  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.data.fired, false);
  assertEquals(body.data.nowIso, NOT_FIRED_NOW);
  assertEquals(body.data.summary, undefined);
  assertEquals(stateExportRepo.all().length, 0);
});

Deno.test("createHandler - rejects a request that fails scheduler-secret verification, without doing any work", async () => {
  const jobRecordRepo = new InMemoryJobRecordRepository();
  jobRecordRepo.seed(jobRecord());
  const stateExportRepo = new InMemoryStateExportRepository();
  const rejectAll = () => {
    throw new UnauthenticatedError("Invalid scheduler credentials");
  };

  const handler = createHandler(jobRecordRepo, stateExportRepo, rejectAll, () => FIRED_NOW);
  const response = await handler(request());

  assertEquals(response.status, 401);
  assertEquals(stateExportRepo.all().length, 0);
});
