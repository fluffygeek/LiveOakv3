import { revokeUser as revokeUserService } from "../../../functions/src/access/accessService.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import { parseEmail } from "../../../functions/src/access/validation.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Deactivates an allowlisted user — the Edge Function analog of
 * functions/src/access/handlers.ts's `revokeUser` Firebase callable. Reuses
 * accessService.ts's `revokeUser` completely unchanged: same requireApplicationAdministrator
 * authorization check, same UserNotFoundError for unknown emails, same LastAdministratorError
 * guard.
 *
 * Kept in its own module (rather than inline in index.ts) so tests can import it without
 * triggering index.ts's production wiring (`Deno.serve`, the real service_role client).
 */
export function createHandler(
  repo: UserRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler<string, { revoked: true }>(repo, {
    verifyCaller,
    parse: (data) => parseEmail((data as Record<string, unknown>).email),
    handle: async (caller, email) => {
      await revokeUserService(repo, caller.roles, email);
      return { revoked: true };
    },
  });
}
