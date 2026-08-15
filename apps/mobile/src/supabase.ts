import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

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
