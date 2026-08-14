import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  AccessDeniedError,
  DiscrepancyActiveError,
  ForbiddenError,
  InvalidArgumentError,
  JobRecordNotFoundError,
  LastAdministratorError,
  NotAllowlistedError,
  NotDuplicateError,
  UserNotFoundError,
} from "../../../functions/src/access/errors.ts";

export class UnauthenticatedError extends Error {}

export interface Caller {
  email: string;
}

export type VerifyCaller = (req: Request) => Promise<Caller>;

/**
 * Verifies the Supabase Auth JWT on the incoming request and resolves the
 * caller's verified email. The Edge Function analog of `requireCaller` in
 * functions/src/callableHandler.ts, minus access resolution — no Postgres
 * UserRepository exists yet, so handlers that need roles/allowlist data
 * layer that on top of the email this returns.
 */
// Lazily created and cached across requests handled by the same warm Deno
// isolate — created on first use rather than at module load so importing
// this module (e.g. in tests, which inject their own VerifyCaller) never
// requires SUPABASE_URL/SUPABASE_ANON_KEY to be set.
let cachedClient: SupabaseClient | undefined;

function getSupabaseClient(): SupabaseClient {
  if (!cachedClient) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
    }
    cachedClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return cachedClient;
}

export const verifyCaller: VerifyCaller = async (req) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthenticatedError("Sign-in required");
  }
  const jwt = authHeader.slice("Bearer ".length);
  const { data, error } = await getSupabaseClient().auth.getUser(jwt);
  if (error || !data.user?.email) {
    throw new UnauthenticatedError("Sign-in required");
  }
  return { email: data.user.email };
};

const STATUS_BY_CODE = {
  unauthenticated: 401,
  "permission-denied": 403,
  "not-found": 404,
  "invalid-argument": 400,
  "failed-precondition": 412,
  internal: 500,
} as const;

type ErrorCode = keyof typeof STATUS_BY_CODE;

function codeFor(error: unknown): ErrorCode {
  if (error instanceof UnauthenticatedError) return "unauthenticated";
  if (
    error instanceof AccessDeniedError ||
    error instanceof NotAllowlistedError ||
    error instanceof ForbiddenError
  ) {
    return "permission-denied";
  }
  if (
    error instanceof LastAdministratorError ||
    error instanceof DiscrepancyActiveError ||
    error instanceof NotDuplicateError
  ) {
    return "failed-precondition";
  }
  if (error instanceof UserNotFoundError || error instanceof JobRecordNotFoundError) {
    return "not-found";
  }
  if (error instanceof InvalidArgumentError) return "invalid-argument";
  return "internal";
}

/**
 * Translates a thrown domain error into the HTTP response a client sees —
 * the Edge Function analog of `toHttpsError` in
 * functions/src/callableHandler.ts. The status-code mapping table is the
 * same one `toHttpsError` uses, carried over unchanged.
 */
export function toErrorResponse(error: unknown): Response {
  const code = codeFor(error);
  const message =
    code !== "internal" && error instanceof Error ? error.message : "Unexpected error";
  return new Response(JSON.stringify({ error: { code, message } }), {
    status: STATUS_BY_CODE[code],
    headers: { "content-type": "application/json" },
  });
}

/**
 * Defines an HTTP-served Edge Function that authenticates the caller,
 * optionally parses/validates the request payload, and translates any
 * thrown domain error to the right HTTP response — the Edge Function analog
 * of `defineCallable` in functions/src/callableHandler.ts.
 */
export function defineEdgeHandler<TInput = void, TResult = unknown>(config: {
  parse?: (data: unknown) => TInput;
  handle: (caller: Caller, input: TInput) => Promise<TResult>;
  verifyCaller?: VerifyCaller;
}): (req: Request) => Promise<Response> {
  const resolveCaller = config.verifyCaller ?? verifyCaller;
  return async (req: Request): Promise<Response> => {
    try {
      const caller = await resolveCaller(req);
      let input: TInput;
      if (config.parse) {
        let raw: unknown;
        try {
          raw = await req.json();
        } catch {
          throw new InvalidArgumentError("Request body must be valid JSON");
        }
        input = config.parse(raw);
      } else {
        input = undefined as TInput;
      }
      const result = await config.handle(caller, input);
      return new Response(JSON.stringify({ data: result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
