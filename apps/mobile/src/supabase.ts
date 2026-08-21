import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, FunctionsHttpError } from "@supabase/supabase-js";

// Local dev default matches supabase/config.toml's [api] port (54321). The real project
// URL is supplied via EXPO_PUBLIC_SUPABASE_URL once a deployed Supabase project exists
// (hosting config is a separate ticket — out of scope here).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
// Unlike Firebase's emulator (which accepts any placeholder apiKey), Supabase validates
// the anon key against the project's real JWT signing key even locally, so there's no
// safe placeholder default — set EXPO_PUBLIC_SUPABASE_ANON_KEY (e.g. from `supabase status`).
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Unlike @firebase/auth (which auto-detects React Native and persists to AsyncStorage
// automatically — see apps/mobile/src/firebase.ts), @supabase/supabase-js does NOT
// auto-detect the platform: without an explicit storage adapter here, sessions would
// silently fail to survive an app restart.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// UX-level hint only, passed as the Google OAuth `hd` extraParam on
// Google.useIdTokenAuthRequest — the Workspace domain is authoritatively enforced
// server-side in resolveAccess (functions/src/access/accessService.ts), called from the
// resolveMyAccess Edge Function the exact same way it's called from today's Firebase
// callable.
export const workspaceDomain = process.env.EXPO_PUBLIC_WORKSPACE_DOMAIN ?? "example.com";

/**
 * Invokes a Supabase Edge Function and unwraps its response into a resolved value or a
 * thrown `Error` -- the mobile counterpart of apps/web/src/supabase.ts's `invokeFunction`,
 * fixing the same pre-existing bug apps/mobile/src/jobRecords/api.ts and
 * apps/mobile/src/auth/useAuth.ts had been carrying: every `defineEdgeHandler`-built Edge
 * Function (supabase/functions/_shared/callableHandler.ts) responds `{ data: result }` on
 * success, but `@supabase/functions-js`'s `FunctionsClient.invoke()` parses the *entire*
 * response body as `data` -- so `supabase.functions.invoke(name)` actually resolves
 * `data: { data: result }`, not `data: result`, unless unwrapped here. This also restores
 * the real server error message (`{ error: { code, message } }`, written by
 * callableHandler.ts's `toErrorResponse`) instead of `FunctionsHttpError`'s hardcoded
 * generic one.
 */
export async function invokeFunction<TResult, TBody extends object = Record<string, unknown>>(
  name: string,
  body?: TBody,
): Promise<TResult> {
  // Cast at the boundary: callers pass concrete request-payload interfaces (e.g.
  // JobRecordSubmission), which -- unlike inline object-literal types -- TypeScript
  // doesn't treat as assignable to an indexed type without an explicit cast, even though
  // they're plain JSON-serializable objects at runtime.
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
