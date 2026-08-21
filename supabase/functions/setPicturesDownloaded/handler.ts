import { setPicturesDownloaded as setPicturesDownloadedService } from "../../../functions/src/jobRecords/jobRecordReviewService.ts";
import { parseSetFlagInput } from "../../../functions/src/jobRecords/validation.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Payroll/Application Administrator toggle a Job Record's Pictures Downloaded flag --
 * the Edge Function analog of functions/src/jobRecords/handlers.ts's `setPicturesDownloaded`
 * Firebase callable. Reuses jobRecordReviewService.ts's `setPicturesDownloaded` completely
 * unchanged: same requirePayrollOrApplicationAdministrator authorization check (note it is
 * *not* gated by requireEditableByPayroll -- Pictures Downloaded tracks retrieval independent
 * of Discrepancy/Closed status, per that function's own comment), same audit-log write on
 * change -- only the transport and repository backing differ.
 *
 * Also reuses `parseSetFlagInput` (validation.ts) unchanged for the request-body parsing --
 * the same `{ recordId, value }` shape `setClosed` (#24, not yet ported) will eventually
 * share.
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
  return defineResolvedAccessHandler<{ recordId: string; value: boolean }>(userRepo, {
    verifyCaller,
    parse: parseSetFlagInput,
    handle: (caller, { recordId, value }) =>
      setPicturesDownloadedService(caller.email, caller.roles, recordId, value, {
        jobRecordRepo,
        auditLogRepo,
      }),
  });
}
