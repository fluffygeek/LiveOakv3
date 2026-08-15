import { isCentralWallClockTime } from "../../../packages/shared/src/centralTime.ts";
import {
  generateStateExport,
  type StateExportSummary,
} from "../../../functions/src/notifications/stateExportService.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { StateExportRepository } from "../../../functions/src/notifications/stateExportRepository.ts";
import { defineScheduledHandler, type VerifyScheduledSecret } from "../_shared/scheduledHandler.ts";

// 9pm Central -- after the 8pm Discrepancy email (ticket #27; scheduled-ping/index.ts's
// TARGET_HOUR = 20 placeholder stands in for that job today, since it isn't built on
// Supabase yet), matching the existing Firebase job's `schedule: "0 21 * * *",
// timeZone: "America/Chicago"` (functions/src/index.ts's nightlyStateExport).
const TARGET_HOUR = 21;
const TARGET_MINUTE = 0;

export interface NightlyStateExportResult {
  fired: boolean;
  nowIso: string;
  summary?: StateExportSummary;
}

/**
 * Testable core of the nightlyStateExport scheduled Edge Function -- the real-work analog
 * of scheduled-ping/index.ts's do-nothing placeholder. The migration backing this
 * (supabase/migrations/20260814230000_state_exports_table.sql) schedules a pg_cron job that
 * fires every minute in UTC (managed Supabase can't set cron.timezone -- see
 * 20260814194632_scheduling_infra.sql's comment), so `isCentralWallClockTime` is what turns
 * exactly one invocation a day into the real one, DST-correct across the fall-back/
 * spring-forward transitions.
 *
 * Calls stateExportService.ts's `generateStateExport` completely unchanged: same
 * group-by-state logic, same one-summary-per-run shape -- only the repositories backing it
 * (Postgres vs. Firestore) and the transport (pg_cron-triggered Edge Function vs. Cloud
 * Scheduler) differ.
 *
 * Kept in its own module (mirrors createJobRecord/handler.ts) so tests can exercise `handle`
 * without Deno.serve or a real service_role client. `now` is injectable (mirrors
 * stateExportService.ts's own `now?` dependency) so tests can deterministically exercise
 * both the fired and not-fired branches without waiting for a real clock to hit 21:00
 * Central.
 */
export function createHandler(
  jobRecordRepo: JobRecordRepository,
  stateExportRepo: StateExportRepository,
  verifySecret?: VerifyScheduledSecret,
  now: () => string = () => new Date().toISOString(),
): (req: Request) => Promise<Response> {
  return defineScheduledHandler<NightlyStateExportResult>({
    verifySecret,
    handle: async () => {
      const nowIso = now();
      const fired = isCentralWallClockTime(nowIso, TARGET_HOUR, TARGET_MINUTE);
      if (!fired) {
        return { fired, nowIso };
      }
      // Reuses `nowIso` (rather than letting generateStateExport call its own default
      // `now()`) so the run's generatedAt matches the instant that satisfied the
      // wall-clock check above.
      const summary = await generateStateExport({
        jobRecordRepo,
        stateExportRepo,
        now: () => nowIso,
      });
      return { fired, nowIso, summary };
    },
  });
}
