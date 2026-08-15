import { assertEquals } from "jsr:@std/assert@1";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { normalizeAddress, noDuplicateLink, type JobRecord } from "@liveoakv3/shared";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import { InMemoryJobRecordRepository } from "../../../functions/src/jobRecords/inMemoryJobRecordRepository.ts";
import { PostgresJobRecordRepository } from "./postgresJobRecordRepository.ts";

/**
 * Contract test suite for `JobRecordRepository.createWithDuplicateLinking` (ticket #22's
 * "asserting parity" requirement): the same scenarios run once against
 * `InMemoryJobRecordRepository` (the double `jobRecordService.test.ts` exercises) and once
 * against `PostgresJobRecordRepository` (this ticket's real Postgres row-locking
 * implementation, backed by a real local Postgres instance -- see `postgresRepo()` below).
 *
 * Each scenario is a small function of `(repo, technicianEmail)` using only the
 * `JobRecordRepository` interface, so the exact same code exercises both implementations.
 * `duplicateLink(...)` below intentionally re-derives the same first-submitted-wins-primary
 * math as jobRecordService.ts's (unexported, unmodified-per-#22) `computeDuplicateLinks` --
 * this suite's job is to prove the REPOSITORY correctly locks/threads/persists whatever
 * `buildRecord` decides, not to re-verify the linking algorithm itself (jobRecordService.
 * test.ts's existing, unmodified coverage already does that against the in-memory double).
 */

function sixMonthsBefore(iso: string): string {
  const date = new Date(iso);
  date.setUTCMonth(date.getUTCMonth() - 6);
  return date.toISOString();
}

function baseRecord(overrides: Partial<JobRecord> & Pick<JobRecord, "recordId">): JobRecord {
  return {
    jobId: "DISPATCH-1",
    technicianEmail: "contract-tech@example.com",
    address: "123 Main St",
    verifiedAddress: null,
    addressVerificationStatus: "unverified",
    workCode: "WC-01",
    footage: 100,
    photoUrls: ["a", "b", "c"],
    notes: "",
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

/** Mirrors jobRecordService.ts's computeDuplicateLinks -- see file doc comment above. */
function duplicateLinks(
  newRecordId: string,
  matches: JobRecord[],
): { newRecordDuplicate: JobRecord["duplicate"]; updatedMatches: JobRecord[] } {
  if (matches.length === 0) {
    return { newRecordDuplicate: noDuplicateLink(), updatedMatches: [] };
  }
  const existingPrimary = matches.find((match) => match.duplicate.isPrimary);
  const primaryId =
    existingPrimary?.recordId ??
    matches.reduce((earliest, match) =>
      match.submittedAt < earliest.submittedAt ? match : earliest,
    ).recordId;
  const allIds = [newRecordId, ...matches.map((match) => match.recordId)];
  const updatedMatches = matches.map((match) => ({
    ...match,
    duplicate: {
      isDuplicate: true,
      linkedRecordIds: allIds.filter((id) => id !== match.recordId),
      isPrimary: match.recordId === primaryId,
    },
  }));
  return {
    newRecordDuplicate: {
      isDuplicate: true,
      linkedRecordIds: matches.map((match) => match.recordId),
      isPrimary: newRecordId === primaryId,
    },
    updatedMatches,
  };
}

async function submit(
  repo: JobRecordRepository,
  recordId: string,
  overrides: Partial<JobRecord> = {},
): Promise<JobRecord> {
  const address = overrides.address ?? "123 Main St";
  const submittedAt = overrides.submittedAt ?? "2026-01-01T12:00:00.000Z";
  return repo.createWithDuplicateLinking(
    normalizeAddress(address),
    sixMonthsBefore(submittedAt),
    (matches) => {
      const { newRecordDuplicate, updatedMatches } = duplicateLinks(recordId, matches);
      return {
        record: baseRecord({ recordId, address, submittedAt, duplicate: newRecordDuplicate, ...overrides }),
        updatedMatches,
      };
    },
  );
}

// ---- Scenarios -- each takes a fresh repository and a technicianEmail known to satisfy
// that repository's constraints (Postgres's `users` FK; in-memory has none). ----

async function linksSameAddressWithinWindow(
  repo: JobRecordRepository,
  technicianEmail: string,
): Promise<void> {
  const address = `123 Main St ${crypto.randomUUID()}`; // unique per run, see file doc comment
  const existing = baseRecord({
    recordId: `existing-${crypto.randomUUID()}`,
    technicianEmail,
    address,
    submittedAt: "2025-10-01T12:00:00.000Z",
  });
  await repo.update(existing);

  const newRecordId = `new-${crypto.randomUUID()}`;
  const record = await submit(repo, newRecordId, { technicianEmail, address });

  assertEquals(record.duplicate, {
    isDuplicate: true,
    linkedRecordIds: [existing.recordId],
    isPrimary: false, // existing was submitted first
  });

  const updatedExisting = await repo.getById(existing.recordId);
  assertEquals(updatedExisting?.duplicate, {
    isDuplicate: true,
    linkedRecordIds: [newRecordId],
    isPrimary: true,
  });
}

async function doesNotLinkOutsideWindow(
  repo: JobRecordRepository,
  technicianEmail: string,
): Promise<void> {
  const address = `456 Old Ave ${crypto.randomUUID()}`;
  const existing = baseRecord({
    recordId: `existing-${crypto.randomUUID()}`,
    technicianEmail,
    address,
    submittedAt: "2025-01-01T12:00:00.000Z", // a full year before submission below
  });
  await repo.update(existing);

  const record = await submit(repo, `new-${crypto.randomUUID()}`, { technicianEmail, address });

  assertEquals(record.duplicate, noDuplicateLink());
}

async function doesNotLinkDifferentAddress(
  repo: JobRecordRepository,
  technicianEmail: string,
): Promise<void> {
  const existing = baseRecord({
    recordId: `existing-${crypto.randomUUID()}`,
    technicianEmail,
    address: `789 Oak Ave ${crypto.randomUUID()}`,
    submittedAt: "2025-10-01T12:00:00.000Z",
  });
  await repo.update(existing);

  const record = await submit(repo, `new-${crypto.randomUUID()}`, {
    technicianEmail,
    address: `321 Elm St ${crypto.randomUUID()}`,
  });

  assertEquals(record.duplicate, noDuplicateLink());
}

/**
 * The scenario ticket #22 is actually about: two submissions for an address with ZERO
 * existing rows race each other. Without real locking, both could see zero matches and
 * neither would link to the other (the lost-update bug `createWithDuplicateLinking`'s
 * contract exists to prevent) -- matches jobRecordService.test.ts's own concurrent test's
 * assertions (one primary, both isDuplicate: true).
 */
async function concurrentSubmissionsForNewAddressBothLink(
  repo: JobRecordRepository,
  technicianEmail: string,
): Promise<void> {
  // Warm up two concurrent sessions BEFORE the timed race below. A lazily-pooled Postgres
  // client (postgres.js opens connections on demand) only opens its second physical
  // connection the first time two `sql.begin()` calls are genuinely in flight at once; if
  // that first-ever concurrent pair is the one this test measures, the second transaction's
  // apparent "wait" can just be normal connection-setup latency rather than the row/advisory
  // lock actually being exercised -- which would let a broken locking implementation pass
  // this test by accident. Submitting a throwaway pair at an unrelated address first forces
  // both connections to exist before the real assertion, so the timed race below is genuine.
  const warmupAddress = `warmup ${crypto.randomUUID()}`;
  await Promise.all([
    submit(repo, `warmup-a-${crypto.randomUUID()}`, { technicianEmail, address: warmupAddress }),
    submit(repo, `warmup-b-${crypto.randomUUID()}`, { technicianEmail, address: warmupAddress }),
  ]);

  const address = `999 Brand New Ave ${crypto.randomUUID()}`;
  const idA = `concurrent-a-${crypto.randomUUID()}`;
  const idB = `concurrent-b-${crypto.randomUUID()}`;

  await Promise.all([
    submit(repo, idA, { technicianEmail, address, jobId: "JOB-A" }),
    submit(repo, idB, { technicianEmail, address, jobId: "JOB-B" }),
  ]);

  // Re-fetch current state rather than trusting the returned objects -- a record returned
  // by an earlier call can be updated afterward by a later concurrent one, exactly like
  // jobRecordService.test.ts's equivalent assertion comment explains.
  const stored = await Promise.all([idA, idB].map((id) => repo.getById(id)));
  const primaries = stored.filter((r) => r?.duplicate.isPrimary);
  const linked = stored.filter((r) => r?.duplicate.isDuplicate);
  assertEquals(primaries.length, 1);
  assertEquals(linked.length, 2);
}

const SCENARIOS: Array<[string, (repo: JobRecordRepository, technicianEmail: string) => Promise<void>]> = [
  ["links a new record to an existing one at the same address within the 6-month window, first-submitted primary", linksSameAddressWithinWindow],
  ["does not link a same-address record submitted outside the 6-month window", doesNotLinkOutsideWindow],
  ["does not link a record with a different address", doesNotLinkDifferentAddress],
  ["links two genuinely concurrent submissions for the same brand-new address to each other", concurrentSubmissionsForNewAddressBothLink],
];

// ---- InMemoryJobRecordRepository ----

for (const [name, scenario] of SCENARIOS) {
  Deno.test(`createWithDuplicateLinking contract (InMemory) - ${name}`, async () => {
    await scenario(new InMemoryJobRecordRepository(), "contract-tech@example.com");
  });
}

// ---- PostgresJobRecordRepository, against a real local Postgres instance ----
//
// No PostgREST/`.rpc()` fake stands in here on purpose -- ticket #22's whole point is that a
// fake could pass this suite while missing the real row-locking behavior. This requires
// `supabase start` (or an equivalent local Postgres + PostgREST pair) to be running; see the
// class doc comment on PostgresJobRecordRepository and this ticket's PR description for how
// that was verified in CI-less local development. Connection details default to the
// well-known `supabase start` local values (the same for every local Supabase project) and
// are overridable via env vars for a different local setup.

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const CONTRACT_TECHNICIAN_EMAIL = "contract-tech@example.com";

// One shared connection + repository for the whole Postgres half of the suite -- postgres.js
// pools connections internally, so concurrent `sql.begin()` calls (the concurrency scenario)
// correctly get separate sessions from one client, exactly as production wiring would.
const directSql = postgres(DB_URL);
const postgresRepo = new PostgresJobRecordRepository(createClient(API_URL, SERVICE_ROLE_KEY), directSql);

async function ensureContractTechnicianExists(): Promise<void> {
  await directSql`
    insert into users (email, roles, active, invited_at, updated_at, on_distribution_list)
    values (${CONTRACT_TECHNICIAN_EMAIL}, '{technician}', true, now(), now(), false)
    on conflict (email) do nothing
  `;
}

for (const [name, scenario] of SCENARIOS) {
  Deno.test(`createWithDuplicateLinking contract (Postgres, real DB) - ${name}`, async () => {
    await ensureContractTechnicianExists();
    await scenario(postgresRepo, CONTRACT_TECHNICIAN_EMAIL);
  });
}

// Deno keeps the process alive while the pooled connection is open -- close it once every
// test above has registered/run.
globalThis.addEventListener("unload", () => {
  directSql.end({ timeout: 1 }).catch(() => {});
});
