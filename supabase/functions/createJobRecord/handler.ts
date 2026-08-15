import {
  createJobRecord as createJobRecordService,
  type CreateJobRecordInput,
} from "../../../functions/src/jobRecords/jobRecordService.ts";
import { parseCreateJobRecordInput } from "../../../functions/src/jobRecords/validation.ts";
import { NotConfiguredAddressVerifier } from "../../../functions/src/jobRecords/notConfiguredAddressVerifier.ts";
import type { JobRecordRepository } from "../../../functions/src/jobRecords/jobRecordRepository.ts";
import type { AuditLogRepository } from "../../../functions/src/jobRecords/auditLogRepository.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lets a Technician submit a new Job Record from the mobile app -- the Edge Function analog
 * of functions/src/jobRecords/handlers.ts's `createJobRecord` Firebase callable. Reuses
 * jobRecordService.ts's `createJobRecord` completely unchanged: same requireTechnician
 * authorization check, same field validation, same address-verification/timestamp-suspect
 * logic -- only the caller-authentication transport (Supabase Auth JWT vs. Firebase ID
 * token) and the repositories backing it (Postgres/no-op vs. Firestore) differ.
 *
 * Also reuses `parseCreateJobRecordInput` (validation.ts) unchanged for the request-body
 * parsing, and `NotConfiguredAddressVerifier` unchanged -- no address-verification vendor is
 * configured on the Supabase side either, same as on Firebase today.
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
  auditLogRepo: AuditLogRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler<CreateJobRecordInput>(userRepo, {
    verifyCaller,
    parse: parseCreateJobRecordInput,
    handle: (caller, input) =>
      createJobRecordService(caller.email, caller.roles, input, {
        jobRecordRepo,
        auditLogRepo,
        addressVerifier: new NotConfiguredAddressVerifier(),
      }),
  });
}
