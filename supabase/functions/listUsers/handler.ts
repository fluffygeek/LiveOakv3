import { listUsers as listUsersService } from "../../../functions/src/access/accessService.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import type { VerifyCaller } from "../_shared/callableHandler.ts";
import { defineResolvedAccessHandler } from "../_shared/resolvedAccessHandler.ts";

/**
 * Lists every allowlisted user (active and revoked) — the Edge Function analog of
 * functions/src/access/handlers.ts's `listUsers` Firebase callable. Reuses
 * accessService.ts's `listUsers` completely unchanged: same requireApplicationAdministrator
 * authorization check.
 *
 * Kept in its own module (rather than inline in index.ts) so tests can import it without
 * triggering index.ts's production wiring (`Deno.serve`, the real service_role client).
 */
export function createHandler(
  repo: UserRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineResolvedAccessHandler(repo, {
    verifyCaller,
    handle: (caller) => listUsersService(repo, caller.roles),
  });
}
