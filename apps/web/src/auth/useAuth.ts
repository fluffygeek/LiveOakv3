import { useCallback, useEffect, useState } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import type { Role } from "@liveoakv3/shared";
import { auth, functions, googleProvider } from "../firebase";

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

  const signIn = useCallback(async () => {
    await signInWithPopup(auth, googleProvider);
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
  }, []);

  return { state, signIn, signOut };
}
