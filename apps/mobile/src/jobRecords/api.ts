import type { JobRecord } from "@liveoakv3/shared";
import { invokeFunction } from "../supabase";
import { uploadJobRecordPhotos } from "./photoUpload";
import type { JobRecordSubmission } from "./storage";

/**
 * Submits a new Job Record via the createJobRecord Edge Function (ticket #21) — replaces the
 * old httpsCallable(functions, "createJobRecord") call now that createJobRecord is ported
 * onto the Edge-Function transport (supabase/functions/createJobRecord). Unwraps the Edge
 * Function response via `invokeFunction` (apps/mobile/src/supabase.ts).
 *
 * Uploads `submission.photoUrls` (still local device URIs at this point, unless a prior
 * attempt already uploaded some — see storage.ts's JobRecordSubmission.photoUrls) to Supabase
 * Storage (ticket #29, photoUpload.ts) first, swapping in the real storage-object paths
 * createJobRecord then persists. Doing the upload here, immediately before createJobRecord,
 * rather than earlier at draft/enqueue time means a submission queued offline
 * (storage.ts's enqueueSubmission) still holds its original local URIs at enqueue time.
 *
 * `submission.photoUrls` is reassigned in place (not just the local `photoUrls` const) as
 * soon as uploadJobRecordPhotos resolves, and again after each individual photo via
 * `onPhotoUploaded` below — so if createJobRecord then fails, the caller's own `submission`
 * object (SubmitJobScreen.tsx's local const, or sync.ts's per-retry object) already reflects
 * whichever photos made it to Storage on this attempt. That's what lets a later re-enqueue or
 * retry skip re-uploading them under a fresh UUID instead of orphaning the previous attempt's
 * objects (ticket #29 code review finding). `onPhotoUploaded`, supplied by sync.ts, persists
 * that same progress to the AsyncStorage-backed queue after each photo — needed there (and
 * not for the fresh, not-yet-queued submission from SubmitJobScreen) because the in-memory
 * mutation alone doesn't survive the app being killed mid-retry.
 */
export async function submitJobRecord(
  submission: JobRecordSubmission,
  onPhotoUploaded?: (photoUrls: string[]) => Promise<void> | void,
): Promise<JobRecord> {
  const photoUrls = await uploadJobRecordPhotos(submission.photoUrls, async (updated) => {
    submission.photoUrls = updated;
    await onPhotoUploaded?.(updated);
  });
  submission.photoUrls = photoUrls;

  return invokeFunction<JobRecord, JobRecordSubmission>("createJobRecord", {
    ...submission,
    photoUrls,
  });
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
