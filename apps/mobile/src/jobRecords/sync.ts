import { submitJobRecord } from "./api";
import { getQueue, removeFromQueue, updateQueuedSubmissionPhotos } from "./storage";

let inFlight: Promise<void> | null = null;

async function runSync(): Promise<void> {
  const queue = await getQueue();
  for (const { localId, ...submission } of queue) {
    try {
      // Persist each photo's real storage path back into this queued submission as soon as
      // it uploads, not just once the whole submission succeeds — so a crash or another
      // dropped connection partway through this retry doesn't lose track of what already
      // made it to Storage and re-upload it under a fresh UUID next time (ticket #29 code
      // review finding).
      await submitJobRecord(submission, (photoUrls) =>
        updateQueuedSubmissionPhotos(localId, photoUrls),
      );
      await removeFromQueue(localId);
    } catch {
      // Still offline, or a transient failure — retried on the next trigger.
    }
  }
}

/**
 * Best-effort: submits every queued record; leaves failures queued for the
 * next trigger (reconnect or app foreground). Concurrent callers (mount +
 * NetInfo's immediate current-state fire on subscribe both trigger this)
 * share the same in-flight run rather than each reading/writing the queue
 * independently, which would otherwise double-submit a queued record.
 */
export function syncQueuedSubmissions(): Promise<void> {
  if (!inFlight) {
    inFlight = runSync().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
