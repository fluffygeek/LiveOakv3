import AsyncStorage from "@react-native-async-storage/async-storage";

const DRAFT_KEY = "liveoakv3.jobRecordDraft";
const QUEUE_KEY = "liveoakv3.jobRecordQueue";

// There is at most one draft slot — enforcing "one job at a time" is a
// structural property of this storage shape, not a runtime check.
export interface JobRecordDraft {
  jobId: string;
  address: string;
  workCode: string;
  footage: string;
  notes: string;
  isNewBuild: boolean;
  photoUris: string[];
}

export interface JobRecordSubmission {
  jobId: string;
  address: string;
  workCode: string;
  footage: number;
  notes: string;
  isNewBuild: boolean;
  // NOTE: local device (file://) URIs until submitJobRecord (api.ts) uploads them to
  // Supabase Storage via photoUpload.ts immediately before calling createJobRecord, at which
  // point each entry is swapped in-place for its real storage-object path (ticket #29). A
  // submission queued offline below may hold a mix of local URIs and already-uploaded storage
  // paths if a prior attempt got partway through — see photoUpload.ts's isLocalPhotoUri and
  // uploadJobRecordPhotos, and this file's updateQueuedSubmissionPhotos — so a retry only
  // re-uploads what's still a local URI instead of re-uploading everything from scratch.
  photoUrls: string[];
  /** Device-local time captured at the moment the Technician tapped Submit. */
  submittedAt: string;
}

export interface QueuedSubmission extends JobRecordSubmission {
  localId: string;
}

export async function getDraft(): Promise<JobRecordDraft | null> {
  const raw = await AsyncStorage.getItem(DRAFT_KEY);
  return raw ? (JSON.parse(raw) as JobRecordDraft) : null;
}

export async function saveDraft(draft: JobRecordDraft): Promise<void> {
  await AsyncStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

export async function clearDraft(): Promise<void> {
  await AsyncStorage.removeItem(DRAFT_KEY);
}

export async function getQueue(): Promise<QueuedSubmission[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedSubmission[]) : [];
}

async function saveQueue(queue: QueuedSubmission[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

/** Moves a submitted (but not yet synced) Job Record into the queue and frees up the draft slot. */
export async function enqueueSubmission(submission: JobRecordSubmission): Promise<void> {
  const queue = await getQueue();
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  queue.push({ ...submission, localId });
  await saveQueue(queue);
  await clearDraft();
}

export async function removeFromQueue(localId: string): Promise<void> {
  const queue = await getQueue();
  await saveQueue(queue.filter((item) => item.localId !== localId));
}

/** Persists a queued submission's photoUrls mid-retry -- called after each individual photo
 * finishes uploading during a background sync attempt (sync.ts), not just once the whole
 * submission succeeds. Without this, a submission that gets partway through re-uploading its
 * photos and then fails again (or the app is killed) forgets which photos already made it to
 * Storage on this attempt, and the next retry re-uploads them under fresh UUIDs -- permanently
 * orphaning the previous attempt's objects in the job-record-photos bucket (ticket #29 code
 * review finding). A no-op if the submission has since been removed from the queue (e.g. a
 * concurrent sync run already completed it). */
export async function updateQueuedSubmissionPhotos(
  localId: string,
  photoUrls: string[],
): Promise<void> {
  const queue = await getQueue();
  const updated = queue.map((item) => (item.localId === localId ? { ...item, photoUrls } : item));
  await saveQueue(updated);
}
