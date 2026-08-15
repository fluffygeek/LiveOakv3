import { assertEquals } from "jsr:@std/assert@1";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UserRecord } from "../../../packages/shared/src/user.ts";
import { PostgresUserRepository } from "./postgresUserRepository.ts";

/** Row shape as stored by the fake table — mirrors the `users` migration's snake_case columns. */
interface FakeRow {
  email: string;
  roles: string[];
  active: boolean;
  invited_at: string;
  updated_at: string;
  on_distribution_list: boolean;
}

/**
 * A minimal fake standing in for the slice of the `@supabase/supabase-js` query-builder
 * API `PostgresUserRepository` actually calls (`.from(...).select("*")`, optionally
 * `.eq(...).maybeSingle()`, and `.upsert(...)`) — enough to exercise the repository's
 * row↔UserRecord mapping and upsert-by-email semantics without a live Postgres instance,
 * matching the fakes-over-real-I/O style the rest of this codebase's Deno tests use
 * (see callableHandler.test.ts's fakeVerifyCaller).
 */
function fakeClient(seed: FakeRow[] = []): { client: SupabaseClient; rows: Map<string, FakeRow> } {
  const rows = new Map(seed.map((row) => [row.email, row]));

  function selectResult() {
    const all = [...rows.values()];
    return {
      eq: (_column: string, value: string) => ({
        maybeSingle: () =>
          Promise.resolve({ data: rows.get(value) ?? null, error: null }),
      }),
      // `.select("*")` alone (no `.eq`) is awaited directly by listUsers, so this needs
      // to be thenable too.
      then: (
        onfulfilled?: ((value: { data: FakeRow[]; error: null }) => unknown) | null,
      ) => Promise.resolve({ data: all, error: null }).then(onfulfilled ?? undefined),
    };
  }

  const table = {
    select: (_columns: string) => selectResult(),
    upsert: (row: FakeRow) => {
      rows.set(row.email, row);
      return Promise.resolve({ data: null, error: null });
    },
  };

  const client = {
    from: (_table: string) => table,
  } as unknown as SupabaseClient;

  return { client, rows };
}

const RECORD: UserRecord = {
  email: "tech@example.com",
  roles: ["technician"],
  active: true,
  invitedAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  onDistributionList: false,
};

const ROW: FakeRow = {
  email: RECORD.email,
  roles: RECORD.roles,
  active: RECORD.active,
  invited_at: RECORD.invitedAt,
  updated_at: RECORD.updatedAt,
  on_distribution_list: RECORD.onDistributionList,
};

Deno.test("PostgresUserRepository.getUser - returns null when no row matches", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresUserRepository(client);
  assertEquals(await repo.getUser("nobody@example.com"), null);
});

Deno.test("PostgresUserRepository.getUser - maps a matching row to a UserRecord", async () => {
  const { client } = fakeClient([ROW]);
  const repo = new PostgresUserRepository(client);
  assertEquals(await repo.getUser(RECORD.email), RECORD);
});

Deno.test("PostgresUserRepository.putUser - upserts a new record, readable via getUser", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresUserRepository(client);
  await repo.putUser(RECORD);
  assertEquals(await repo.getUser(RECORD.email), RECORD);
});

Deno.test("PostgresUserRepository.putUser - overwrites an existing row for the same email", async () => {
  const { client } = fakeClient([ROW]);
  const repo = new PostgresUserRepository(client);
  const updated: UserRecord = { ...RECORD, active: false, roles: [] };
  await repo.putUser(updated);
  assertEquals(await repo.getUser(RECORD.email), updated);
});

Deno.test("PostgresUserRepository.listUsers - returns all rows mapped to UserRecords", async () => {
  const other: FakeRow = {
    email: "admin@example.com",
    roles: ["applicationAdministrator"],
    active: true,
    invited_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
    on_distribution_list: true,
  };
  const { client } = fakeClient([ROW, other]);
  const repo = new PostgresUserRepository(client);
  const users = await repo.listUsers();
  assertEquals(users.length, 2);
  assertEquals(
    users.find((u) => u.email === "admin@example.com"),
    {
      email: "admin@example.com",
      roles: ["applicationAdministrator"],
      active: true,
      invitedAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      onDistributionList: true,
    },
  );
});

Deno.test("PostgresUserRepository.listUsers - returns an empty array when the table is empty", async () => {
  const { client } = fakeClient([]);
  const repo = new PostgresUserRepository(client);
  assertEquals(await repo.listUsers(), []);
});
