import { useCallback, useEffect, useState } from "react";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import type { User } from "@supabase/supabase-js";
import type { Role } from "@liveoakv3/shared";
import { invokeFunction, supabase } from "../supabase";

WebBrowser.maybeCompleteAuthSession();

export interface ResolvedAccess {
  email: string;
  roles: Role[];
}

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "denied" }
  | { status: "signedIn"; user: User; access: ResolvedAccess };

export function useAuth() {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const [, response, promptAsync] = Google.useIdTokenAuthRequest({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    // UX-level hint only — the Workspace domain is authoritatively enforced
    // server-side in resolveAccess (functions/src/access/accessService.ts).
    extraParams: {
      hd: process.env.EXPO_PUBLIC_WORKSPACE_DOMAIN ?? "example.com",
    },
  });

  useEffect(() => {
    if (response?.type === "success" && response.params.id_token) {
      // Exchange the Google ID token expo-auth-session obtained for a Supabase session —
      // the mobile-specific analogue of signInWithCredential(auth, credential) against
      // Firebase. resolveMyAccess (invoked below) still authoritatively enforces the
      // Workspace domain server-side.
      void supabase.auth.signInWithIdToken({
        provider: "google",
        token: response.params.id_token,
      });
    }
  }, [response]);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const user = session?.user ?? null;
      if (!user) {
        setState({ status: "signedOut" });
        return;
      }
      try {
        // resolveMyAccess (supabase/functions/resolveMyAccess) resolves the caller's
        // roles server-side — same isAllowedWorkspaceDomain + allowlist enforcement the
        // Firebase callable of the same name provided, ported unchanged.
        const access = await invokeFunction<ResolvedAccess>("resolveMyAccess");
        setState({ status: "signedIn", user, access });
      } catch {
        setState({ status: "denied" });
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = useCallback(() => {
    void promptAsync();
  }, [promptAsync]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return { state, signIn, signOut };
}
