import { initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// Placeholder values for local development against the emulator suite.
// Replace via VITE_* env vars once a real Firebase project exists.
//
// Sign-in and access resolution moved to Supabase Auth (see ./supabase.ts and
// ./auth/useAuth.ts, ticket #18) — this module now only backs the Cloud Functions
// callables that haven't been ported to Edge Functions yet (ManageUsersScreen,
// JobRecordReviewScreen).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? "liveoakv3-dev.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? "liveoakv3-dev",
};

export const app = initializeApp(firebaseConfig);
export const functions = getFunctions(app);

if (import.meta.env.DEV) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
