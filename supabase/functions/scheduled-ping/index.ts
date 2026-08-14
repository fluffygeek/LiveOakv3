import { isCentralWallClockTime } from "../../../packages/shared/dist/centralTime.js";
import { defineScheduledHandler } from "../_shared/scheduledHandler.ts";

// 8pm Central — the same target hour as the real nightlyDiscrepancyEmail job (ticket #27)
// will use. This function only proves the scheduling harness; it does no real work.
const TARGET_HOUR = 20;
const TARGET_MINUTE = 0;

/**
 * Placeholder scheduled Edge Function proving the pg_cron + pg_net harness
 * end-to-end — not a real job. The migration backing this schedules it
 * every minute in UTC (cron.timezone isn't settable on managed Supabase —
 * see supabase/migrations), so this in-function check is what makes only
 * one invocation per day the real one, DST-correct.
 */
const handler = defineScheduledHandler({
  handle: () => {
    const nowIso = new Date().toISOString();
    const fired = isCentralWallClockTime(nowIso, TARGET_HOUR, TARGET_MINUTE);
    return Promise.resolve({ fired, nowIso });
  },
});

Deno.serve(handler);
