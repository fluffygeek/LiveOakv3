import { listJobRecordAuditLog as listJobRecordAuditLogService } from "../../../functions/src/jobRecords/jobRecordReviewService.ts";
import { parseRecordId } from "../../../functions/src/jobRecords/validation.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Payroll/Application Administrator fetch a Job Record's audit history -- the Edge
 * Function analog of functions/src/jobRecords/handlers.ts's `listJobRecordAuditLog` Firebase
 * callable. Reuses jobRecordReviewService.ts's `listJobRecordAuditLog` completely unchanged:
 * same requirePayrollOrApplicationAdministrator authorization check, same
 * oldest-first-ordering contract (functions/src/jobRecords/auditLogRepository.ts's
 * listByRecordId doc comment) -- only the transport and repository backing differ.
 *
 * Uses `defineResolvedAccessHandler` because requirePayrollOrApplicationAdministrator needs
 * the caller's resolved roles, not just their verified email.
 *
 * Kept in its own module (rather than inline in index.ts) so tests can import it without
 * triggering index.ts's production wiring.
 */
export function createHandler(
  userRepo: UserRepository,
  auditLogRepo: AuditLogRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler<string>(userRepo, {
    verifyCaller,
    parse: parseRecordId,
    handle: (caller, recordId) =>
      listJobRecordAuditLogService(caller.roles, recordId, { auditLogRepo }),
  });
}
