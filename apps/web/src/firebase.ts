import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, GoogleAuthProvider } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// Placeholder values for local development against the emulator suite.
// Replace via VITE_* env vars once a real Firebase project exists.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "liveoakv3-dev.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "liveoakv3-dev",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);

export const googleProvider = new GoogleAuthProvider();
// UX-level hint only — the Workspace domain is authoritatively enforced
// server-side in resolveAccess (functions/src/access/accessService.ts).
const workspaceDomain = import.meta.env.VITE_WORKSPACE_DOMAIN ?? "example.com";
googleProvider.setCustomParameters({ hd: workspaceDomain });

if (import.meta.env.DEV) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
