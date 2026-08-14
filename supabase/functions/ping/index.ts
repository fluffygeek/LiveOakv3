import { isAllowedWorkspaceDomain } from "../../../packages/shared/dist/workspaceDomain.js";
import { AccessDeniedError } from "../../../functions/src/access/errors.ts";
import { defineEdgeHandler } from "../_shared/callableHandler.ts";

// Placeholder until a real Workspace domain is configured for deployment — mirrors the
// default in functions/src/callableHandler.ts's ALLOWED_WORKSPACE_DOMAIN.
const ALLOWED_WORKSPACE_DOMAIN = Deno.env.get("ALLOWED_WORKSPACE_DOMAIN") ?? "example.com";

/**
 * Placeholder Edge Function proving the defineEdgeHandler seam end-to-end —
 * not a real feature. Exercises: caller auth resolution, a real
 * @liveoakv3/shared business-logic import running under Deno, and
 * domain-error-to-HTTP-response translation, ahead of any real handler
 * (Postgres-backed callables land in later tickets).
 */
const handler = defineEdgeHandler({
  handle: (caller) => {
    if (!isAllowedWorkspaceDomain(caller.email, ALLOWED_WORKSPACE_DOMAIN)) {
      throw new AccessDeniedError(`${caller.email} is not on the allowed Workspace domain`);
    }
    return Promise.resolve({ message: "pong", email: caller.email });
  },
});

Deno.serve(handler);
