import { resolveAccess } from "../../../functions/src/access/accessService.ts";
import type { UserRepository } from "../../../functions/src/access/userRepository.ts";
import { defineEdgeHandler, type VerifyCaller } from "../_shared/callableHandler.ts";

// Placeholder until a real Workspace domain is configured for deployment — mirrors the
// default in functions/src/callableHandler.ts's ALLOWED_WORKSPACE_DOMAIN and
// supabase/functions/ping/index.ts's ALLOWED_WORKSPACE_DOMAIN.
const ALLOWED_WORKSPACE_DOMAIN = Deno.env.get("ALLOWED_WORKSPACE_DOMAIN") ?? "example.com";

/**
 * Called by the web client right after Supabase sign-in to learn the caller's resolved
 * roles (or that they've been denied) — the Edge Function analog of
 * functions/src/access/handlers.ts's `resolveMyAccess`. Reuses `resolveAccess`
 * (functions/src/access/accessService.ts) completely unchanged: same Workspace-domain
 * check (`isAllowedWorkspaceDomain`), same allowlist enforcement, same role resolution —
 * only the caller-authentication transport (Supabase Auth JWT vs. Firebase ID token) and
 * the repository backing it (Postgres vs. Firestore) differ.
 *
 * Kept in its own module (rather than inline in index.ts) so tests can import it without
 * triggering index.ts's production wiring (`Deno.serve`, the real service_role client,
 * which requires env vars this module has no need of).
 */
export function createHandler(
  repo: UserRepository,
  verifyCaller?: VerifyCaller,
): (req: Request) => Promise<Response> {
  return defineEdgeHandler({
    verifyCaller,
    handle: (caller) =>
      resolveAccess(repo, { allowedWorkspaceDomain: ALLOWED_WORKSPACE_DOMAIN }, caller.email),
  });
}
