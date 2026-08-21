import { unlinkDuplicate as unlinkDuplicateService } from "../../../functions/src/jobRecords/jobRecordReviewService.ts";
import { parseUnlinkDuplicateInput } from "../../../functions/src/jobRecords/validation.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Payroll/Application Administrator unlink two records that were flagged as a
 * false-positive Duplicate -- the Edge Function analog of
 * functions/src/jobRecords/handlers.ts's `unlinkDuplicate` Firebase callable. Reuses
 * jobRecordReviewService.ts's `unlinkDuplicate` completely unchanged: same
 * requirePayrollOrApplicationAdministrator + requireEditableByPayroll authorization checks
 * (on both records), same NotDuplicateError guard when the two records aren't actually
 * linked, same atomic `jobRecordRepo.updateMany` write of both sides of the unlink, same
 * "duplicate-unlinked" audit-log writes -- only the transport and repository backing differ.
 *
 * Also reuses `parseUnlinkDuplicateInput` (validation.ts) unchanged for the request-body
 * parsing.
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
  auditLogRepo: AuditLogRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler<{ recordId: string; otherRecordId: string }>(userRepo, {
    verifyCaller,
    parse: parseUnlinkDuplicateInput,
    handle: (caller, { recordId, otherRecordId }) =>
      unlinkDuplicateService(caller.email, caller.roles, recordId, otherRecordId, {
        jobRecordRepo,
        auditLogRepo,
      }),
  });
}
