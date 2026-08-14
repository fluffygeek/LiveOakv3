import { toErrorResponse, UnauthenticatedError } from "./callableHandler.ts";

export type VerifyScheduledSecret = (req: Request) => void;

/**
 * Verifies a pg_cron-triggered request came from our own scheduled job, not
 * an arbitrary caller. Scheduled jobs act on behalf of the system, not a
 * signed-in user, so this checks the request against the project's
 * `service_role` key — auto-provided to every Edge Function as
 * `SUPABASE_SERVICE_ROLE_KEY` — rather than resolving a caller via
 * `verifyCaller`/a Supabase Auth JWT. The pg_cron migration backing this
 * stores that same key in Vault as the "service token" it sends.
 */
export const verifyScheduledSecret: VerifyScheduledSecret = (req) => {
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  if (authHeader !== `Bearer ${serviceRoleKey}`) {
    throw new UnauthenticatedError("Invalid scheduler credentials");
  }
};

/**
 * Defines an HTTP-served Edge Function meant to be invoked by a pg_cron job
 * (via net.http_post), not a signed-in user — the scheduled-job analog of
 * `defineEdgeHandler`. Verifies the request's scheduler credentials, runs
 * the handler, and translates any thrown domain error to the same HTTP
 * responses `defineEdgeHandler` produces (reusing `toErrorResponse`).
 */
export function defineScheduledHandler<TResult = unknown>(config: {
  handle: () => Promise<TResult>;
  verifySecret?: VerifyScheduledSecret;
}): (req: Request) => Promise<Response> {
  const verify = config.verifySecret ?? verifyScheduledSecret;
  return async (req: Request): Promise<Response> => {
    try {
      verify(req);
      const result = await config.handle();
      return new Response(JSON.stringify({ data: result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
