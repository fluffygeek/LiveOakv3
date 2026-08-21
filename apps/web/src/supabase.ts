import { createClient, FunctionsHttpError } from "@supabase/supabase-js";

// Local dev default matches supabase/config.toml's [api] port (54321). The real project
// URL is supplied via VITE_SUPABASE_URL once a deployed Supabase project exists (hosting
// config is a separate ticket — out of scope here).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "http://127.0.0.1:54321";
// Unlike Firebase's emulator (which accepts any placeholder apiKey), Supabase validates
// the anon key against the project's real JWT signing key even locally, so there's no
// safe placeholder default — set VITE_SUPABASE_ANON_KEY (e.g. from `supabase status`).
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// UX-level hint only, passed as the Google OAuth `hd` query param — the Workspace domain
// is authoritatively enforced server-side in resolveAccess
// (functions/src/access/accessService.ts), called from the resolveMyAccess Edge Function
// the exact same way it's called from today's Firebase callable.
export const workspaceDomain = import.meta.env.VITE_WORKSPACE_DOMAIN ?? "example.com";

/**
 * Invokes a Supabase Edge Function and unwraps its response into a resolved value or a
 * thrown `Error` -- the one shared home for a pattern that used to be copy-pasted three
 * times (useAuth.ts, ManageUsersScreen.tsx, JobRecordReviewScreen.tsx), each subtly buggy
 * in the same way. Two things are non-obvious enough to be worth doing exactly once:
 *
 * 1. Every `defineEdgeHandler`-built Edge Function (supabase/functions/_shared/
 *    callableHandler.ts) responds `{ data: result }` on success. But
 *    `@supabase/functions-js`'s `FunctionsClient.invoke()` parses the *entire* response
 *    body as `data` -- so `supabase.functions.invoke(name)` actually resolves
 *    `data: { data: result }`, not `data: result`. Without unwrapping that extra
 *    envelope here, every caller gets a double-wrapped object instead of the real result.
 * 2. `supabase-js` surfaces a non-2xx response as a `FunctionsHttpError` whose `.message`
 *    is a hardcoded generic string -- the real server error
 *    (`{ error: { code, message } }`, written by callableHandler.ts's `toErrorResponse`)
 *    sits unread on `error.context`, a `Response` that needs `await error.context.json()`.
 *    This restores the specific-error-message behavior `httpsCallable` used to give for
 *    free.
 */
export async function invokeFunction<TResult, TBody extends object = Record<string, unknown>>(
  name: string,
  body?: TBody,
): Promise<TResult> {
  // Cast at the boundary: callers may pass concrete request-payload interfaces which --
  // unlike inline object-literal types -- TypeScript doesn't treat as assignable to an
  // indexed type without an explicit cast, even though they're plain JSON-serializable
  // objects at runtime.
  const { data, error } = await supabase.functions.invoke<{ data: TResult }>(name, {
    body: body as Record<string, unknown> | undefined,
  });
  if (error) {
    throw await resolveInvokeError(name, error);
  }
  if (data === null || data === undefined) {
    throw new Error(`${name} returned no data`);
  }
  return data.data;
}

async function resolveInvokeError(name: string, error: unknown): Promise<Error> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body: unknown = await error.context.json();
      const message =
        body && typeof body === "object" && "error" in body
          ? (body as { error?: { message?: unknown } }).error?.message
          : undefined;
      if (typeof message === "string" && message.length > 0) {
        return new Error(message);
      }
    } catch {
      // Reading the real error body failed (network hiccup mid-error, non-JSON body,
      // etc.) -- fall through to the generic error below rather than losing the failure.
    }
  }
  return error instanceof Error ? error : new Error(`${name} failed`);
}
