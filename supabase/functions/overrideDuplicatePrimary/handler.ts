import { overrideDuplicatePrimary as overrideDuplicatePrimaryService } from "../../../functions/src/jobRecords/jobRecordReviewService.ts";
import { parseRecordId } from "../../../functions/src/jobRecords/validation.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Payroll/Application Administrator flip which record in a Duplicate group is the
 * primary (payable) one -- the Edge Function analog of functions/src/jobRecords/handlers.ts's
 * `overrideDuplicatePrimary` Firebase callable. Reuses jobRecordReviewService.ts's
 * `overrideDuplicatePrimary` completely unchanged: same requirePayrollOrApplicationAdministrator
 * + requireEditableByPayroll authorization checks, same NotDuplicateError guard for a record
 * with no active Duplicate link, same atomic `jobRecordRepo.updateMany` write of both sides of
 * the primary flip, same "duplicate-primary-overridden" audit-log writes -- only the transport
 * and repository backing differ.
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
  return defineResolvedAccessHandler<string>(userRepo, {
    verifyCaller,
    parse: parseRecordId,
    handle: (caller, recordId) =>
      overrideDuplicatePrimaryService(caller.email, caller.roles, recordId, {
        jobRecordRepo,
        auditLogRepo,
      }),
  });
}
