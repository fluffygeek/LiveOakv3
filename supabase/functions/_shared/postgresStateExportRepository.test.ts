import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobRecord, StateExportBatch } from "../../../packages/shared/src/index.ts";
import { PostgresStateExportRepository } from "./postgresStateExportRepository.ts";

/** Row shape as stored by the fake table -- mirrors the `state_exports` migration's
 * snake_case columns. */
interface FakeRow {
  id: string;
  run_id: string;
  generated_at: string;
  state: string;
  records: JobRecord[];
}

/**
 * A minimal fake standing in for the slice of the `@supabase/supabase-js` query-builder API
 * `PostgresStateExportRepository` actually calls (`.from(...).insert(rows)`) -- enough to
 * exercise the repository's batch-to-row mapping and atomic-multi-row-insert semantics
 * without a live Postgres instance, matching postgresUserRepository.test.ts's fake-client
 * style.
 */
function fakeClient(
  seed: FakeRow[] = [],
  opts: { failOnInsert?: boolean } = {},
): { client: SupabaseClient; rows: FakeRow[] } {
  const rows: FakeRow[] = [...seed];

  const table = {
    insert: (newRows: FakeRow[]) => {
      if (opts.failOnInsert) {
        return Promise.resolve({ data: null, error: { message: "insert failed" } });
      }
      rows.push(...newRows);
      return Promise.resolve({ data: null, error: null });
    },
  };

  const client = {
    from: (_table: string) => table,
  } as unknown as SupabaseClient;

  return { client, rows };
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

function batch(overrides: Partial<StateExportBatch> = {}): StateExportBatch {
  return {
    id: "run-1-IL",
    runId: "run-1",
    generatedAt: "2026-02-01T03:00:00.000Z",
    state: "IL",
    records: [jobRecord()],
    ...overrides,
  };
}

Deno.test("PostgresStateExportRepository.saveBatches - inserts one row per batch", async () => {
  const { client, rows } = fakeClient([]);
  const repo = new PostgresStateExportRepository(client);

  const ilBatch = batch({ id: "run-1-IL", state: "IL" });
  const txBatch = batch({
    id: "run-1-TX",
    state: "TX",
    records: [jobRecord({ recordId: "tx-1" })],
  });

  await repo.saveBatches([ilBatch, txBatch]);

  assertEquals(rows.length, 2);
  assertEquals(rows.find((r) => r.id === "run-1-IL"), {
    id: "run-1-IL",
    run_id: "run-1",
    generated_at: "2026-02-01T03:00:00.000Z",
    state: "IL",
    records: ilBatch.records,
  });
  assertEquals(rows.find((r) => r.id === "run-1-TX")?.records, txBatch.records);
});

Deno.test("PostgresStateExportRepository.saveBatches - does nothing for an empty batch list", async () => {
  const { client, rows } = fakeClient([]);
  const repo = new PostgresStateExportRepository(client);

  await repo.saveBatches([]);

  assertEquals(rows.length, 0);
});

Deno.test("PostgresStateExportRepository.saveBatches - throws when the insert fails", async () => {
  const { client } = fakeClient([], { failOnInsert: true });
  const repo = new PostgresStateExportRepository(client);

  let threw = false;
  try {
    await repo.saveBatches([batch()]);
  } catch (error) {
    threw = true;
    assertEquals((error as Error).message.includes("insert failed"), true);
  }
  assertEquals(threw, true);
});
