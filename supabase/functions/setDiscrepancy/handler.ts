import { setDiscrepancy as setDiscrepancyService } from "../../../functions/src/jobRecords/jobRecordReviewService.ts";
import { parseSetDiscrepancyInput } from "../../../functions/src/jobRecords/validation.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Payroll/Application Administrator set or clear a Job Record's Discrepancy -- the
 * Edge Function analog of functions/src/jobRecords/handlers.ts's `setDiscrepancy` Firebase
 * callable. Reuses jobRecordReviewService.ts's `setDiscrepancy` completely unchanged: same
 * requirePayrollOrApplicationAdministrator + requireEditableByPayroll authorization checks,
 * same reason validation (via findDiscrepancyReason) when activating, same reason-drop when
 * clearing, same audit-log write on change -- only the transport and repository backing
 * differ.
 *
 * Also reuses `parseSetDiscrepancyInput` (validation.ts) unchanged for the request-body
 * parsing -- `{ recordId, active, reason }`, where `reason` may be `null`.
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
  return defineResolvedAccessHandler<{ recordId: string; active: boolean; reason: string | null }>(
    userRepo,
    {
      verifyCaller,
      parse: parseSetDiscrepancyInput,
      handle: (caller, { recordId, active, reason }) =>
        setDiscrepancyService(caller.email, caller.roles, recordId, active, reason, {
          jobRecordRepo,
          auditLogRepo,
        }),
    },
  );
}
