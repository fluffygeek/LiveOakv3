import { listJobRecords as listJobRecordsService } from "../../../functions/src/jobRecords/jobRecordReviewService.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Payroll/Application Administrator list every Job Record -- the Edge Function analog
 * of functions/src/jobRecords/handlers.ts's `listJobRecords` Firebase callable. Reuses
 * jobRecordReviewService.ts's `listJobRecords` completely unchanged: same
 * requirePayrollOrApplicationAdministrator authorization check (admin-only despite being
 * about Job Records a Technician creates) -- only the transport and repository backing
 * differ.
 *
 * Uses `defineResolvedAccessHandler` because requirePayrollOrApplicationAdministrator needs
 * the caller's resolved roles, not just their verified email. Takes no input.
 *
 * Kept in its own module (rather than inline in index.ts) so tests can import it without
 * triggering index.ts's production wiring.
 */
export function createHandler(
  userRepo: UserRepository,
  jobRecordRepo: JobRecordRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler(userRepo, {
    verifyCaller,
    handle: (caller) => listJobRecordsService(caller.roles, { jobRecordRepo }),
  });
}
