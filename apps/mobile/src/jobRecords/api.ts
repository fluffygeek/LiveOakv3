import type { JobRecord } from "@liveoakv3/shared";
import { supabase } from "../supabase";
import type { JobRecordSubmission } from "./storage";

/**
 * Submits a new Job Record via the createJobRecord Edge Function (ticket #21) — replaces the
 * old httpsCallable(functions, "createJobRecord") call now that createJobRecord is ported
 * onto the Edge-Function transport (supabase/functions/createJobRecord). Unwraps the
 * `{ data, error }` result the same way apps/mobile/src/auth/useAuth.ts and
 * apps/web/src/admin/ManageUsersScreen.tsx already do for supabase.functions.invoke calls.
 */
export async function submitJobRecord(
  submission: JobRecordSubmission,
): Promise<JobRecord> {
  const { data, error } = await supabase.functions.invoke<JobRecord>("createJobRecord", {
    body: submission,
  });
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("createJobRecord returned no data");
  }
  return data;
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
 * the `{ data, error }` result the same way `submitJobRecord` above does.
 */
export async function getMyWeeklyJobRecords(weekOffset: number): Promise<WeeklyList> {
  const { data, error } = await supabase.functions.invoke<WeeklyList>(
    "listMyWeeklyJobRecords",
    { body: { weekOffset } },
  );
  if (error) {
    throw error;
  }
  if (!data) {
    throw new Error("listMyWeeklyJobRecords returned no data");
  }
  return data;
}
