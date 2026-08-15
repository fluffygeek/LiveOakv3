import { resolveAccess, type ResolvedAccess } from "../../../functions/src/access/accessService.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import { defineEdgeHandler, type VerifyCaller } from "./callableHandler.ts";

// Placeholder until a real Workspace domain is configured for deployment — mirrors the
// default in functions/src/callableHandler.ts's ALLOWED_WORKSPACE_DOMAIN and
// resolveMyAccess/handler.ts's own copy of the same constant.
const ALLOWED_WORKSPACE_DOMAIN = Deno.env.get("ALLOWED_WORKSPACE_DOMAIN") ?? "example.com";

/**
 * Defines an Edge Function whose handler needs the caller's fully resolved roles, not just
 * their verified email — the Edge Function analog of functions/src/callableHandler.ts's
 * `defineCallable`, which calls `requireCaller` (resolveAccess under the hood) before every
 * Firebase callable runs.
 *
 * `defineEdgeHandler` (callableHandler.ts) only verifies the caller's Supabase Auth JWT and
 * hands handlers a bare `{ email }` — it has no notion of roles. But the admin functions
 * ported for ticket #20 (inviteUser, updateUserRoles, revokeUser, listUsers,
 * setDistributionListMembership) all authorize via accessService.ts's
 * `requireApplicationAdministrator`, which needs the caller's *own* resolved roles. This
 * wraps `defineEdgeHandler` with the same `resolveAccess` call
 * `resolveMyAccess/handler.ts` already performs standalone, so `handle` receives a full
 * `ResolvedAccess { email, roles }` — matching what `functions/src/access/handlers.ts`'s
 * Firebase callables receive as their `caller` argument today. Factored here once rather
 * than duplicated across all five handlers.
 */
export function defineResolvedAccessHandler<TInput = void, TResult = unknown>(
  repo: UserRepository,
  config: {
    parse?: (data: unknown) => TInput;
    handle: (caller: ResolvedAccess, input: TInput) => Promise<TResult>;
    verifyCaller?: VerifyCaller;
  },
): (req: Request) => Promise<Response> {
  return defineEdgeHandler<TInput, TResult>({
    parse: config.parse,
    verifyCaller: config.verifyCaller,
    handle: async (caller, input) => {
      const access = await resolveAccess(
        repo,
        { allowedWorkspaceDomain: ALLOWED_WORKSPACE_DOMAIN },
        caller.email,
      );
      return config.handle(access, input);
    },
  });
}
