import { initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// Placeholder values for local development against the emulator suite.
// Replace via EXPO_PUBLIC_* env vars once a real Firebase project exists.
//
// Sign-in and access resolution moved to Supabase Auth (see ./supabase.ts and
// ./auth/useAuth.ts, ticket #19) — this module now only backs the Cloud Functions
// callables that haven't been ported to Edge Functions yet (jobRecords/api.ts).
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "liveoakv3-dev.firebaseapp.com",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "liveoakv3-dev",
};

export const app = initializeApp(firebaseConfig);
export const functions = getFunctions(app);

// localhost works for a simulator/emulator; a physical device needs the
// dev machine's LAN IP set via EXPO_PUBLIC_FIREBASE_EMULATOR_HOST.
const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? "localhost";

if (__DEV__) {
  connectFunctionsEmulator(functions, emulatorHost, 5001);
}
