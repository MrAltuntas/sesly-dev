/**
 * Dev-only Firebase Auth emulator hook for local end-to-end testing.
 *
 * Active only in __DEV__ builds AND when FIREBASE_AUTH_EMULATOR_HOST is set in
 * the environment Metro was started with (surfaced via app.config.js extra),
 * e.g. FIREBASE_AUTH_EMULATOR_HOST=10.0.2.2:9099 for the Android emulator.
 * Release builds never read it. See e2e/README.md.
 */
import Constants from 'expo-constants';
import { LogBox } from 'react-native';
import { connectAuthEmulator, getAuth } from '@react-native-firebase/auth';

let connected = false;

/**
 * Dev-only: silence the LogBox overlay for automated E2E runs (E2E=1 in the
 * Metro environment). Its bottom toasts cover buttons and swallow Maestro taps.
 * Errors still reach Metro's terminal log.
 */
export function silenceLogBoxForE2EIfConfigured(): void {
  if (!__DEV__ || !Constants.expoConfig?.extra?.E2E) return;
  LogBox.ignoreAllLogs(true);
}

export function connectFirebaseEmulatorsIfConfigured(): void {
  if (!__DEV__ || connected) return;
  const host = Constants.expoConfig?.extra?.FIREBASE_AUTH_EMULATOR_HOST;
  if (typeof host !== 'string' || host.length === 0) return;
  connectAuthEmulator(getAuth(), `http://${host}`);
  connected = true;
  console.warn(`[firebase] Auth emulator enabled at ${host}`);
}
