import { useCallback, useEffect, useState } from "react";
import * as Google from "expo-auth-session/providers/google";
import * as WebBrowser from "expo-web-browser";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import type { Role } from "@liveoakv3/shared";
import { auth, functions } from "../firebase";

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
      const credential = GoogleAuthProvider.credential(response.params.id_token);
      void signInWithCredential(auth, credential);
    }
  }, [response]);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setState({ status: "signedOut" });
        return;
      }
      try {
        const resolveMyAccess = httpsCallable<void, ResolvedAccess>(
          functions,
          "resolveMyAccess",
        );
        const result = await resolveMyAccess();
        setState({ status: "signedIn", user, access: result.data });
      } catch {
        setState({ status: "denied" });
      }
    });
  }, []);

  const signIn = useCallback(() => {
    void promptAsync();
  }, [promptAsync]);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  return { state, signIn, signOut };
}
