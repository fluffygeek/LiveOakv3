import { extractStateCode, type JobRecord } from "@liveoakv3/shared";
import type { JobRecordRepository } from "../jobRecords/jobRecordRepository.js";
import type { StateExportRepository } from "./stateExportRepository.js";

const UNKNOWN_STATE = "UNKNOWN";

export interface StateExportDeps {
  jobRecordRepo: JobRecordRepository;
  stateExportRepo: StateExportRepository;
  now?: () => string;
  generateId?: () => string;
}

export interface StateExportSummary {
  runId: string;
  generatedAt: string;
  stateCounts: Record<string, number>;
}

const defaultNow = () => new Date().toISOString();
const defaultGenerateId = () => crypto.randomUUID();

export function groupJobRecordsByState(records: JobRecord[]): Record<string, JobRecord[]> {
  const grouped: Record<string, JobRecord[]> = {};
  for (const record of records) {
    const state = extractStateCode(record.verifiedAddress ?? record.address) ?? UNKNOWN_STATE;
    (grouped[state] ??= []).push(record);
  }
  return grouped;
}

/**
 * Reads the master Job Records table fresh on every run and writes one
 * StateExportBatch document per state — a derived, regenerated-nightly
 * artifact (ADR-0003), not a separately maintained store.
 */
export async function generateStateExport(deps: StateExportDeps): Promise<StateExportSummary> {
  const now = deps.now ?? defaultNow;
  const generateId = deps.generateId ?? defaultGenerateId;

  const records = await deps.jobRecordRepo.list();
  const grouped = groupJobRecordsByState(records);
  const generatedAt = now();
  const runId = generateId();

  const batches = Object.entries(grouped).map(([state, stateRecords]) => ({
    id: `${runId}-${state}`,
    runId,
    generatedAt,
    state,
    records: stateRecords,
  }));
  await deps.stateExportRepo.saveBatches(batches);

  return {
    runId,
    generatedAt,
    stateCounts: Object.fromEntries(
      Object.entries(grouped).map(([state, stateRecords]) => [state, stateRecords.length]),
    ),
  };
}
