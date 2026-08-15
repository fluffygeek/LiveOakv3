import { getJobRecord as getJobRecordService } from "../../../functions/src/jobRecords/jobRecordReviewService.ts";
import { parseRecordId } from "../../../functions/src/jobRecords/validation.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Payroll/Application Administrator fetch a single Job Record by id -- the Edge
 * Function analog of functions/src/jobRecords/handlers.ts's `getJobRecord` Firebase
 * callable. Reuses jobRecordReviewService.ts's `getJobRecord` completely unchanged: same
 * requirePayrollOrApplicationAdministrator authorization check (note this is admin-only
 * despite being about a Job Record a Technician created), same JobRecordNotFoundError
 * behavior -- only the transport and repository backing differ.
 *
 * Uses `defineResolvedAccessHandler` because requirePayrollOrApplicationAdministrator needs
 * the caller's resolved roles, not just their verified email.
 *
 * Kept in its own module (rather than inline in index.ts) so tests can import it without
 * triggering index.ts's production wiring.
 */
export function createHandler(
  userRepo: UserRepository,
  jobRecordRepo: JobRecordRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler<string>(userRepo, {
    verifyCaller,
    parse: parseRecordId,
    handle: (caller, recordId) => getJobRecordService(caller.roles, recordId, { jobRecordRepo }),
  });
}
