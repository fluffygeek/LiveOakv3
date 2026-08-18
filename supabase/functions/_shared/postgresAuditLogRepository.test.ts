import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuditLogEntry } from "../../../packages/shared/src/auditLog.ts";
import { PostgresAuditLogRepository } from "./postgresAuditLogRepository.ts";

/** Row shape as stored by the fake table — mirrors the audit_log migration's snake_case
 * columns. */
type FakeRow = Record<string, unknown> & { id: string };

/**
 * A minimal fake standing in for the slice of the `@supabase/supabase-js` query-builder API
 * `PostgresAuditLogRepository` actually calls (`.from(...).insert(...)`, `.select("*")`
 * chained with `.eq()`/`.order()`) -- enough to exercise the repository's row<->AuditLogEntry
 * mapping and ordering without a live Postgres instance, matching
 * postgresJobRecordRepository.test.ts's fakes-over-real-I/O style.
 */
function fakeClient(seed: FakeRow[] = []): { client: SupabaseClient; rows: FakeRow[] } {
  const rows: FakeRow[] = [...seed];

  function builder(filters: Array<(row: FakeRow) => boolean>, sortKey?: string): unknown {
    const applyFilters = () => {
      const filtered = rows.filter((row) => filters.every((f) => f(row)));
      if (!sortKey) return filtered;
      return [...filtered].sort((a, b) =>
        (a[sortKey] as string) < (b[sortKey] as string) ? -1 : 1,
      );
    };
    return {
      eq: (column: string, value: unknown) =>
        builder([...filters, (row: FakeRow) => row[column] === value], sortKey),
      order: (column: string, _opts?: { ascending?: boolean }) =>
        builder(filters, column),
      then: (
        onfulfilled?: ((value: { data: FakeRow[]; error: null }) => unknown) | null,
      ) => Promise.resolve({ data: applyFilters(), error: null }).then(onfulfilled ?? undefined),
    };
  }

  const table = {
    select: (_columns: string) => builder([]),
    insert: (row: FakeRow) => {
      rows.push(row);
      return Promise.resolve({ data: null, error: null });
    },
  };

  const client = {
    from: (_table: string) => table,
  } as unknown as SupabaseClient;

  return { client, rows };
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

Deno.test("PostgresAuditLogRepository.listByRecordId - returns an empty array when no entries match", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresAuditLogRepository(client);

  assertEquals(await repo.listByRecordId("record-1"), []);
});

Deno.test("PostgresAuditLogRepository.append - inserts a row, readable via listByRecordId", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresAuditLogRepository(client);
  const entry = sampleEntry();

  await repo.append(entry);
  const fetched = await repo.listByRecordId("record-1");

  assertEquals(fetched, [entry]);
});

Deno.test("PostgresAuditLogRepository.listByRecordId - filters by recordId", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresAuditLogRepository(client);
  await repo.append(sampleEntry({ id: "entry-1", recordId: "record-1" }));
  await repo.append(sampleEntry({ id: "entry-2", recordId: "record-2" }));

  const fetched = await repo.listByRecordId("record-1");

  assertEquals(fetched.map((e) => e.id), ["entry-1"]);
});

Deno.test("PostgresAuditLogRepository.listByRecordId - returns entries ordered by timestamp ascending", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresAuditLogRepository(client);
  await repo.append(
    sampleEntry({ id: "entry-later", recordId: "record-1", timestamp: "2026-01-02T00:00:00.000Z" }),
  );
  await repo.append(
    sampleEntry({ id: "entry-earlier", recordId: "record-1", timestamp: "2026-01-01T00:00:00.000Z" }),
  );

  const fetched = await repo.listByRecordId("record-1");

  assertEquals(fetched.map((e) => e.id), ["entry-earlier", "entry-later"]);
});

Deno.test("PostgresAuditLogRepository.append - round-trips null before/after", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresAuditLogRepository(client);
  const entry = sampleEntry({ before: null, after: null });

  await repo.append(entry);
  const fetched = await repo.listByRecordId("record-1");

  assertEquals(fetched[0].before, null);
  assertEquals(fetched[0].after, null);
});
