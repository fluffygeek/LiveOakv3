import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobRecord, StateExportBatch } from "../../../packages/shared/src/index.ts";
import type { StateExportRepository } from "../../../functions/src/notifications/stateExportRepository.ts";

const TABLE = "state_exports";

/** Shape of a row in the `state_exports` table
 * (supabase/migrations/20260814230000_state_exports_table.sql) -- snake_case columns,
 * `records` stored as jsonb. */
interface StateExportRow {
  id: string;
  run_id: string;
  generated_at: string;
  state: string;
  records: JobRecord[];
}

function toRow(batch: StateExportBatch): StateExportRow {
  return {
    id: batch.id,
    run_id: batch.runId,
    generated_at: batch.generatedAt,
    state: batch.state,
    records: batch.records,
  };
}

/**
 * Postgres adapter for the `state_exports` table -- the Edge Function analog of
 * functions/src/notifications/firestoreStateExportRepository.ts. Thin by design: grouping
 * Job Records by state and building each StateExportBatch lives in stateExportService.ts,
 * not here -- this class only translates StateExportBatch[] into rows and persists them.
 *
 * Unlike FirestoreStateExportRepository (which needs an explicit WriteBatch to commit every
 * state's document together), a single multi-row `.insert()` call is already one Postgres
 * statement -- atomic by construction, no separate transaction API required. Mirrors
 * PostgresJobRecordRepository.updateMany's single-upsert-call pattern.
 */
export class PostgresStateExportRepository implements StateExportRepository {
  constructor(private readonly client: SupabaseClient) {}

  async saveBatches(batches: StateExportBatch[]): Promise<void> {
    if (batches.length === 0) return;
    const { error } = await this.client.from(TABLE).insert(batches.map(toRow));
    if (error) {
      throw new Error(`Failed to save ${batches.length} state export batches: ${error.message}`);
    }
  }
}
