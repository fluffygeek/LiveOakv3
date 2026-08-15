import {
  listMyWeeklyJobRecords as listMyWeeklyJobRecordsService,
  type WeeklyList,
} from "../../../functions/src/jobRecords/weeklyListService.ts";
import { parseWeeklyListInput } from "../../../functions/src/jobRecords/validation.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Technician see their own Job Record submissions for the current week -- the Edge
 * Function analog of functions/src/jobRecords/handlers.ts's `listMyWeeklyJobRecords` Firebase
 * callable. Reuses weeklyListService.ts's `listMyWeeklyJobRecords` completely unchanged: same
 * requireTechnician authorization check, same weekOffset validation, same Eastern week-window
 * math -- only the caller-authentication transport (Supabase Auth JWT vs. Firebase ID token)
 * and the repository backing it (Postgres/`listByTechnicianAndWindow`, added by #21, vs.
 * Firestore) differ.
 *
 * Also reuses `parseWeeklyListInput` (validation.ts) unchanged for the request-body parsing.
 *
 * Uses `defineResolvedAccessHandler` (not the plain `defineEdgeHandler`) because
 * requireTechnician needs the caller's resolved roles, not just their verified email.
 *
 * Kept in its own module (rather than inline in index.ts) so tests can import it without
 * triggering index.ts's production wiring (`Deno.serve`, the real service_role client).
 */
export function createHandler(
  userRepo: UserRepository,
  jobRecordRepo: JobRecordRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler<{ weekOffset: number }, WeeklyList>(userRepo, {
    verifyCaller,
    parse: parseWeeklyListInput,
    handle: (caller, { weekOffset }) =>
      listMyWeeklyJobRecordsService(caller.email, caller.roles, weekOffset, {
        jobRecordRepo,
      }),
  });
}
