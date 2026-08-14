import { createClient } from "@supabase/supabase-js";

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
