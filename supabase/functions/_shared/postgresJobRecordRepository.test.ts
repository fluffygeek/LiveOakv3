import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import { noDuplicateLink, type JobRecord } from "../../../packages/shared/src/jobRecord.ts";
import { PostgresJobRecordRepository } from "./postgresJobRecordRepository.ts";

/** Row shape as stored by the fake table — mirrors the job_records migration's snake_case
 * columns. */
type FakeRow = Record<string, unknown> & { record_id: string };

/**
 * A minimal fake standing in for the slice of the `@supabase/supabase-js` query-builder API
 * `PostgresJobRecordRepository` actually calls (`.from(...).select("*")`, chained
 * `.eq()`/`.gte()`/`.lt()`, `.maybeSingle()`, `.upsert(...)`, `.insert(...)`) — enough to
 * exercise the repository's row↔JobRecord mapping and query filtering without a live
 * Postgres instance, matching postgresUserRepository.test.ts's fakes-over-real-I/O style.
 */
function fakeClient(seed: FakeRow[] = []): { client: SupabaseClient; rows: Map<string, FakeRow> } {
  const rows = new Map(seed.map((row) => [row.record_id, row]));

  function builder(filters: Array<(row: FakeRow) => boolean>): unknown {
    const applyFilters = () => [...rows.values()].filter((row) => filters.every((f) => f(row)));
    return {
      eq: (column: string, value: unknown) =>
        builder([...filters, (row: FakeRow) => row[column] === value]),
      gte: (column: string, value: unknown) =>
        builder([...filters, (row: FakeRow) => (row[column] as string) >= (value as string)]),
      lt: (column: string, value: unknown) =>
        builder([...filters, (row: FakeRow) => (row[column] as string) < (value as string)]),
      maybeSingle: () => Promise.resolve({ data: applyFilters()[0] ?? null, error: null }),
      then: (
        onfulfilled?: ((value: { data: FakeRow[]; error: null }) => unknown) | null,
      ) => Promise.resolve({ data: applyFilters(), error: null }).then(onfulfilled ?? undefined),
    };
  }

  const table = {
    select: (_columns: string) => builder([]),
    upsert: (rowOrRows: FakeRow | FakeRow[]) => {
      const incoming = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
      for (const row of incoming) rows.set(row.record_id, row);
      return Promise.resolve({ data: null, error: null });
    },
    insert: (row: FakeRow) => {
      rows.set(row.record_id, row);
      return Promise.resolve({ data: null, error: null });
    },
  };

  const client = {
    from: (_table: string) => table,
  } as unknown as SupabaseClient;

  return { client, rows };
}

function sampleRecord(overrides: Partial<JobRecord> = {}): JobRecord {
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
    notes: "notes",
    submittedAt: "2026-01-01T12:00:00.000Z",
    createdAt: "2026-01-01T12:00:05.000Z",
    timestampSuspect: false,
    duplicate: noDuplicateLink(),
    discrepancy: false,
    discrepancyReason: null,
    closed: false,
    picturesDownloaded: false,
    ...overrides,
  };
}

Deno.test("PostgresJobRecordRepository.getById - returns null when no row matches", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  assertEquals(await repo.getById("nope"), null);
});

Deno.test("PostgresJobRecordRepository.update - upserts a row, readable via getById, stripping the derived normalized_address_key", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  const record = sampleRecord();

  await repo.update(record);
  const fetched = await repo.getById("record-1");

  assertEquals(fetched, record);
});

Deno.test("PostgresJobRecordRepository.update - round-trips the duplicate jsonb column", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  const record = sampleRecord({
    duplicate: { isDuplicate: true, linkedRecordIds: ["record-2"], isPrimary: true },
  });

  await repo.update(record);
  const fetched = await repo.getById("record-1");

  assertEquals(fetched?.duplicate, {
    isDuplicate: true,
    linkedRecordIds: ["record-2"],
    isPrimary: true,
  });
});

Deno.test("PostgresJobRecordRepository.updateMany - writes every record as one upsert call", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  const a = sampleRecord({ recordId: "record-a" });
  const b = sampleRecord({ recordId: "record-b" });

  await repo.updateMany([a, b]);

  assertEquals(await repo.getById("record-a"), a);
  assertEquals(await repo.getById("record-b"), b);
});

Deno.test("PostgresJobRecordRepository.list - returns every row mapped to a JobRecord", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  await repo.update(sampleRecord({ recordId: "record-a" }));
  await repo.update(sampleRecord({ recordId: "record-b" }));

  const all = await repo.list();

  assertEquals(all.length, 2);
});

Deno.test("PostgresJobRecordRepository.listByTechnicianAndWindow - filters by technician and [start, end)", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  await repo.update(
    sampleRecord({
      recordId: "in-window",
      technicianEmail: "tech@example.com",
      submittedAt: "2026-01-05T00:00:00.000Z",
    }),
  );
  await repo.update(
    sampleRecord({
      recordId: "other-tech",
      technicianEmail: "other@example.com",
      submittedAt: "2026-01-05T00:00:00.000Z",
    }),
  );
  await repo.update(
    sampleRecord({
      recordId: "outside-window",
      technicianEmail: "tech@example.com",
      submittedAt: "2026-02-01T00:00:00.000Z",
    }),
  );

  const results = await repo.listByTechnicianAndWindow(
    "tech@example.com",
    "2026-01-01T00:00:00.000Z",
    "2026-01-08T00:00:00.000Z",
  );

  assertEquals(results.map((r) => r.recordId), ["in-window"]);
});

Deno.test("PostgresJobRecordRepository.listWithActiveDiscrepancy - returns only records with discrepancy = true", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  await repo.update(sampleRecord({ recordId: "flagged", discrepancy: true }));
  await repo.update(sampleRecord({ recordId: "clean", discrepancy: false }));

  const results = await repo.listWithActiveDiscrepancy();

  assertEquals(results.map((r) => r.recordId), ["flagged"]);
});

Deno.test("PostgresJobRecordRepository.createWithDuplicateLinking - always calls buildRecord with zero matches (ticket #21 scope)", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  await repo.update(sampleRecord({ recordId: "existing", address: "123 Main St, Springfield" }));

  let receivedMatches: JobRecord[] | undefined;
  const newRecord = sampleRecord({ recordId: "new-record" });

  const result = await repo.createWithDuplicateLinking(
    "123 MAIN ST, SPRINGFIELD",
    "2025-07-01T00:00:00.000Z",
    (matches) => {
      receivedMatches = matches;
      return { record: newRecord, updatedMatches: [] };
    },
  );

  assertEquals(receivedMatches, []);
  assertEquals(result, newRecord);
});

Deno.test("PostgresJobRecordRepository.createWithDuplicateLinking - really persists the new record (not a no-op), visible via getById/list", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  const newRecord = sampleRecord({ recordId: "new-record", jobId: "DISPATCH-NEW" });

  await repo.createWithDuplicateLinking("123 MAIN ST", "2025-07-01T00:00:00.000Z", () => ({
    record: newRecord,
    updatedMatches: [],
  }));

  assertEquals(await repo.getById("new-record"), newRecord);
  assertEquals((await repo.list()).map((r) => r.recordId), ["new-record"]);
});

Deno.test("PostgresJobRecordRepository.createWithDuplicateLinking - also persists any updatedMatches buildRecord returns", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresJobRecordRepository(client);
  await repo.update(sampleRecord({ recordId: "existing" }));
  const newRecord = sampleRecord({ recordId: "new-record" });
  const updatedExisting = sampleRecord({
    recordId: "existing",
    duplicate: { isDuplicate: true, linkedRecordIds: ["new-record"], isPrimary: true },
  });

  await repo.createWithDuplicateLinking("123 MAIN ST", "2025-07-01T00:00:00.000Z", () => ({
    record: newRecord,
    updatedMatches: [updatedExisting],
  }));

  assertEquals((await repo.getById("existing"))?.duplicate.isDuplicate, true);
});
