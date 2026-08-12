import { submitJobRecord } from "./api";
import { getQueue, removeFromQueue } from "./storage";

let inFlight: Promise<void> | null = null;

async function runSync(): Promise<void> {
  const queue = await getQueue();
  for (const { localId, ...submission } of queue) {
    try {
      await submitJobRecord(submission);
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
