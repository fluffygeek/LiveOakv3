import { useCallback, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Role } from "@liveoakv3/shared";
import { invokeFunction, supabase, workspaceDomain } from "../supabase";

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

  const signIn = useCallback(async () => {
    // The `hd` query param is a UX hint only on Google's consent screen — the Workspace
    // domain is authoritatively enforced server-side (resolveMyAccess -> resolveAccess ->
    // isAllowedWorkspaceDomain), not by this parameter.
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { queryParams: { hd: workspaceDomain } },
    });
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return { state, signIn, signOut };
}
