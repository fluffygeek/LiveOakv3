import { httpsCallable } from "firebase/functions";
import type { JobRecord } from "@liveoakv3/shared";
import { functions } from "../firebase";
import type { JobRecordSubmission } from "./storage";

const createJobRecordFn = httpsCallable<JobRecordSubmission, JobRecord>(
  functions,
  "createJobRecord",
);

export async function submitJobRecord(
  submission: JobRecordSubmission,
): Promise<JobRecord> {
  const result = await createJobRecordFn(submission);
  return result.data;
}

export interface WeeklyList {
  startIso: string;
  endIso: string;
  records: JobRecord[];
}

const listMyWeeklyJobRecordsFn = httpsCallable<{ weekOffset: number }, WeeklyList>(
  functions,
  "listMyWeeklyJobRecords",
);

export async function getMyWeeklyJobRecords(weekOffset: number): Promise<WeeklyList> {
  const result = await listMyWeeklyJobRecordsFn({ weekOffset });
  return result.data;
}
