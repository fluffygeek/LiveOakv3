import {
  editJobRecord as editJobRecordService,
  type EditableJobRecordPatch,
} from "../../../functions/src/jobRecords/jobRecordReviewService.ts";
import { parseEditJobRecordPatch } from "../../../functions/src/jobRecords/validation.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Payroll/Application Administrator edit a Job Record's fields -- the Edge Function
 * analog of functions/src/jobRecords/handlers.ts's `editJobRecord` Firebase callable. Reuses
 * jobRecordReviewService.ts's `editJobRecord` completely unchanged: same
 * requirePayrollOrApplicationAdministrator + requireEditableByPayroll authorization checks,
 * same per-field validation and photo-minimum re-check, same before/after audit-log write --
 * only the transport and repository backing differ.
 *
 * Also reuses `parseEditJobRecordPatch` (validation.ts) unchanged for the request-body
 * parsing -- only fields present in the request body are parsed onto the patch, matching
 * `EditableJobRecordPatch`'s "partial edit" semantics.
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
  return defineResolvedAccessHandler<{ recordId: string; patch: EditableJobRecordPatch }>(
    userRepo,
    {
      verifyCaller,
      parse: parseEditJobRecordPatch,
      handle: (caller, { recordId, patch }) =>
        editJobRecordService(caller.email, caller.roles, recordId, patch, {
          jobRecordRepo,
          auditLogRepo,
        }),
    },
  );
}
