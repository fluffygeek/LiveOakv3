import { updateUserRoles as updateUserRolesService } from "../../../functions/src/access/accessService.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import { parseEmail, parseRoles } from "../../../functions/src/access/validation.ts";
import type { Role } from "../../../packages/shared/src/roles.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

interface Input {
  email: string;
  roles: Role[];
}

/**
 * Replaces an existing allowlisted user's roles — the Edge Function analog of
 * functions/src/access/handlers.ts's `updateUserRoles` Firebase callable. Reuses
 * accessService.ts's `updateUserRoles` completely unchanged: same
 * requireApplicationAdministrator authorization check, same UserNotFoundError for unknown
 * emails, same LastAdministratorError guard, same role dedup.
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
      return { email: parseEmail(record.email), roles: parseRoles(record.roles) };
    },
    handle: (caller, { email, roles }) =>
      updateUserRolesService(repo, caller.roles, email, roles),
  });
}
