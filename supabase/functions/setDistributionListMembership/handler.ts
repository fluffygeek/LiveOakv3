import { setDistributionListMembership as setDistributionListMembershipService } from "../../../functions/src/access/accessService.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import { parseEmail, parseOnDistributionList } from "../../../functions/src/access/validation.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

interface Input {
  email: string;
  onDistributionList: boolean;
}

/**
 * Adds or removes a user from the Distribution List — the Edge Function analog of
 * functions/src/access/handlers.ts's `setDistributionListMembership` Firebase callable.
 * Reuses accessService.ts's `setDistributionListMembership` completely unchanged: same
 * requireApplicationAdministrator authorization check, same UserNotFoundError for unknown
 * emails, same eligible-role restriction (Payroll/Application Administrator only).
 *
 * Kept in its own module (rather than inline in index.ts) so tests can import it without
 * triggering index.ts's production wiring (`Deno.serve`, the real service_role client).
 */
export function createHandler(
  repo: UserRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler<Input>(repo, {
    verifyCaller,
    parse: (data) => {
      const record = data as Record<string, unknown>;
      return {
        email: parseEmail(record.email),
        onDistributionList: parseOnDistributionList(record.onDistributionList),
      };
    },
    handle: (caller, { email, onDistributionList }) =>
      setDistributionListMembershipService(repo, caller.roles, email, onDistributionList),
  });
}
