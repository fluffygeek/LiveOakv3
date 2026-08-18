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
  // NOTE: these are local device URIs — submitJobRecord (api.ts) uploads them to Supabase
  // Storage via photoUpload.ts immediately before calling createJobRecord, swapping in the
  // real storage-object paths that actually get persisted (ticket #29). Kept as local URIs
  // here (rather than uploading at draft/enqueue time) so a submission queued offline below
  // re-attempts the upload from scratch on every sync retry — see api.ts's submitJobRecord.
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
