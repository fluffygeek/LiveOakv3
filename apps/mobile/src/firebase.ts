import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

// @firebase/auth ^1.13 auto-detects React Native (via the "react-native"
// package export condition) and persists to AsyncStorage automatically —
// no more manual initializeAuth()/getReactNativePersistence() wiring.
// @react-native-async-storage/async-storage is an optional peer dep for this.

// Placeholder values for local development against the emulator suite.
// Replace via EXPO_PUBLIC_* env vars once a real Firebase project exists.
const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
  authDomain:
    process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "liveoakv3-dev.firebaseapp.com",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "liveoakv3-dev",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const functions = getFunctions(app);

// localhost works for a simulator/emulator; a physical device needs the
// dev machine's LAN IP set via EXPO_PUBLIC_FIREBASE_EMULATOR_HOST.
const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST ?? "localhost";

if (__DEV__) {
  connectAuthEmulator(auth, `http://${emulatorHost}:9099`, {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, emulatorHost, 5001);
}
