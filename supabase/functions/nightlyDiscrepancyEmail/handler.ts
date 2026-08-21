import { isCentralWallClockTime } from "../../../packages/shared/src/centralTime.ts";
import {
  sendDiscrepancyEmail,
  type DiscrepancyEmailResult,
} from "../../../functions/src/notifications/discrepancyEmailService.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { EmailSender } from "../../../functions/src/notifications/emailSender.ts";
import { defineScheduledHandler, type VerifyScheduledSecret } from "../_shared/scheduledHandler.ts";

// 8pm Central -- before the 9pm state export (ticket #28,
// supabase/functions/nightlyStateExport/handler.ts's TARGET_HOUR = 21), matching the
// existing Firebase job's `schedule: "0 20 * * *", timeZone: "America/Chicago"`
// (functions/src/index.ts's nightlyDiscrepancyEmail).
const TARGET_HOUR = 20;
const TARGET_MINUTE = 0;

export interface NightlyDiscrepancyEmailResult {
  fired: boolean;
  nowIso: string;
  result?: DiscrepancyEmailResult;
}

/**
 * Testable core of the nightlyDiscrepancyEmail scheduled Edge Function -- the #27 analog of
 * nightlyStateExport/handler.ts (ticket #28), built on the same #17 scheduling harness. The
 * migration backing this (supabase/migrations/20260821000000_nightly_discrepancy_email_cron.sql)
 * schedules a pg_cron job that fires every minute in UTC (managed Supabase can't set
 * cron.timezone -- see 20260814194632_scheduling_infra.sql's comment), so
 * `isCentralWallClockTime` is what turns exactly one invocation a day into the real one,
 * DST-correct across the fall-back/spring-forward transitions.
 *
 * Calls discrepancyEmailService.ts's `sendDiscrepancyEmail` completely unchanged: same
 * `listWithActiveDiscrepancy` + Distribution List query, same email formatting -- only the
 * repositories backing it (Postgres vs. Firestore) and the transport (pg_cron-triggered Edge
 * Function vs. Cloud Scheduler) differ.
 *
 * Kept in its own module (mirrors nightlyStateExport/handler.ts) so tests can exercise
 * `handle` without Deno.serve or a real service_role client. `now` is injectable so tests can
 * deterministically exercise both the fired and not-fired branches without waiting for a real
 * clock to hit 20:00 Central.
 */
export function createHandler(
  jobRecordRepo: JobRecordRepository,
  userRepo: UserRepository,
  emailSender: EmailSender,
  verifySecret?: VerifyScheduledSecret,
  now: () => string = () => new Date().toISOString(),
): (req: Request) => Promise<Response> {
  return defineScheduledHandler<NightlyDiscrepancyEmailResult>({
    verifySecret,
    handle: async () => {
      const nowIso = now();
      const fired = isCentralWallClockTime(nowIso, TARGET_HOUR, TARGET_MINUTE);
      if (!fired) {
        return { fired, nowIso };
      }
      const result = await sendDiscrepancyEmail({ jobRecordRepo, userRepo, emailSender });
      return { fired, nowIso, result };
    },
  });
}
