import type { JobRecord } from "@liveoakv3/shared";
import { invokeFunction } from "../supabase";
import type { JobRecordSubmission } from "./storage";

/**
 * Submits a new Job Record via the createJobRecord Edge Function (ticket #21) — replaces the
 * old httpsCallable(functions, "createJobRecord") call now that createJobRecord is ported
 * onto the Edge-Function transport (supabase/functions/createJobRecord). Unwraps the Edge
 * Function response via `invokeFunction` (apps/mobile/src/supabase.ts).
 */
export async function submitJobRecord(
  submission: JobRecordSubmission,
): Promise<JobRecord> {
  return invokeFunction<JobRecord, JobRecordSubmission>("createJobRecord", submission);
}

export interface WeeklyList {
  startIso: string;
  endIso: string;
  records: JobRecord[];
}

/**
 * Fetches the calling Technician's own Job Record submissions for the requested week via the
 * listMyWeeklyJobRecords Edge Function (ticket #26) — replaces the old
 * httpsCallable(functions, "listMyWeeklyJobRecords") call now that listMyWeeklyJobRecords is
 * ported onto the Edge-Function transport (supabase/functions/listMyWeeklyJobRecords). Unwraps
 * the Edge Function response the same way `submitJobRecord` above does.
 */
export async function getMyWeeklyJobRecords(weekOffset: number): Promise<WeeklyList> {
  return invokeFunction<WeeklyList>("listMyWeeklyJobRecords", { weekOffset });
}
