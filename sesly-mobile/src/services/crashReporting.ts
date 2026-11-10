/**
 * Crash reporting (Firebase Crashlytics, @react-native-firebase/crashlytics).
 *
 * - Collection runs only in release builds: `initCrashReporting()` turns it
 *   on when `__DEV__` is false and off otherwise (firebase.json also keeps
 *   debug builds out with `crashlytics_debug_enabled: false`).
 * - JS errors: the Crashlytics module installs a global error handler when
 *   it is first created (here, at start), which records the error with its
 *   JS stack and then hands it to React Native's handler. Unhandled promise
 *   rejections: Hermes promises bypass the library's tracker, so release
 *   builds install Hermes' own rejection tracker and record each one as a
 *   non-fatal.
 * - The user is the Sesly user id only (`onSessionUserChange`), never an
 *   email or a name.
 * - `recordNonFatal(error, area, context)` for a failed narration or a
 *   failed purchase: a short breadcrumb with a few plain fields (codes,
 *   statuses, product ids), never personal data, then the error.
 * - `triggerTestCrash()` is for development builds only (the profile
 *   screen's version line, tapped seven times quickly): it crashes natively
 *   and the next start of the development build sends that one report, so
 *   it shows up in the console although development keeps collection off.
 *
 * Every call is safe without the native module (a build without it, tests):
 * it does nothing.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { onSessionUserChange } from '../stores/session';

type CrashlyticsModule = typeof import('@react-native-firebase/crashlytics');
type Crashlytics = ReturnType<CrashlyticsModule['getCrashlytics']>;

/** Where a non-fatal comes from (the breadcrumb's prefix). */
export type NonFatalArea = 'narration' | 'purchase' | 'app';

/** Plain values only: codes, statuses, product ids, counts. */
export type NonFatalContext = Record<string, string | number | boolean | null | undefined>;

/** Keys that could carry personal data are dropped whatever the caller passes. */
const BLOCKED_KEYS = /mail|name|phone|token|password|address|receipt|jws|signature/i;

/** A context value is cut to this many characters. */
const MAX_VALUE_LENGTH = 80;

let lib: CrashlyticsModule | null | undefined;
let instance: Crashlytics | null = null;
let started = false;
let stopUserSync: (() => void) | null = null;

function load(): { lib: CrashlyticsModule; crashlytics: Crashlytics } | null {
  if (lib === undefined) {
    try {
      lib = require('@react-native-firebase/crashlytics') as CrashlyticsModule;
    } catch (error) {
      console.warn('[crash] Crashlytics is not available:', error);
      lib = null;
    }
  }
  if (!lib) return null;
  if (!instance) {
    try {
      instance = lib.getCrashlytics();
    } catch (error) {
      console.warn('[crash] Crashlytics could not start:', error);
      lib = null;
      return null;
    }
  }
  return { lib, crashlytics: instance };
}

/** Runs `fn` with the module; a failure is logged, never thrown. */
function withCrashlytics(label: string, fn: (lib: CrashlyticsModule, crashlytics: Crashlytics) => unknown): void {
  const loaded = load();
  if (!loaded) return;
  try {
    const result = fn(loaded.lib, loaded.crashlytics);
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      (result as Promise<unknown>).catch(error => console.warn(`[crash] ${label} failed:`, error));
    }
  } catch (error) {
    console.warn(`[crash] ${label} failed:`, error);
  }
}

/** Collection on in release builds, off in development. */
export function isCollectionWanted(): boolean {
  return !__DEV__;
}

/** Only plain, short, non-personal fields, as "key=value" pairs. */
export function describeContext(context: NonFatalContext | undefined): string {
  if (!context) return '';
  return Object.entries(context)
    .filter(([key, value]) => value !== undefined && value !== null && !BLOCKED_KEYS.test(key))
    .map(([key, value]) => `${key}=${String(value).slice(0, MAX_VALUE_LENGTH)}`)
    .join(' ');
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'string') return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}

/**
 * Set the user id on the reports: the Sesly user id while signed in, an
 * empty id after sign-out.
 */
export function setCrashUser(userId: string | null): void {
  withCrashlytics('setUserId', (crash, crashlytics) => crash.setUserId(crashlytics, userId ?? ''));
}

/** A failure the app handled, with a short breadcrumb. Never throws. */
export function recordNonFatal(error: unknown, area: NonFatalArea, context?: NonFatalContext): void {
  withCrashlytics('recordError', (crash, crashlytics) => {
    const details = describeContext(context);
    crash.log(crashlytics, details ? `${area}: ${details}` : area);
    crash.recordError(crashlytics, toError(error), `${area}_error`);
  });
}

interface HermesRejectionTracker {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
}

/**
 * Release builds: every unhandled promise rejection becomes a non-fatal.
 * Development keeps React Native's own tracker (the LogBox warning).
 */
export function trackUnhandledRejections(): boolean {
  if (__DEV__) return false;
  const hermes = (globalThis as { HermesInternal?: HermesRejectionTracker }).HermesInternal;
  if (!hermes?.enablePromiseRejectionTracker) return false;
  hermes.enablePromiseRejectionTracker({
    allRejections: true,
    onUnhandled: (id, rejection) => {
      recordNonFatal(rejection ?? new Error('Unhandled promise rejection'), 'app', {
        kind: 'unhandledRejection',
        id,
      });
    },
    onHandled: () => undefined,
  });
  return true;
}

/**
 * Once, at app start (index.ts): collection per build type, the global JS
 * error handler, the rejection tracker and the user id. Safe to call again.
 */
export function initCrashReporting(): void {
  if (started) return;
  started = true;
  withCrashlytics('setCrashlyticsCollectionEnabled', (crash, crashlytics) =>
    crash.setCrashlyticsCollectionEnabled(crashlytics, isCollectionWanted()),
  );
  try {
    trackUnhandledRejections();
  } catch (error) {
    console.warn('[crash] rejection tracking failed:', error);
  }
  stopUserSync = onSessionUserChange(setCrashUser);
  if (__DEV__) void sendTestCrashReport();
}

/** Set just before the test crash, so the next start sends that one report. */
export const TEST_CRASH_KEY = '@sesly/crash-test-pending';

/**
 * Development builds only: a native crash that reaches the console. The
 * report is written at the crash and sent at the next start: collection is
 * off in development, so that start sends it explicitly
 * (`sendUnsentReports`) when the marker says it was this test crash.
 */
export function triggerTestCrash(): boolean {
  if (!__DEV__) return false;
  withCrashlytics('crash', (crash, crashlytics) => {
    crash.log(crashlytics, 'app: test crash from the development build');
    return AsyncStorage.setItem(TEST_CRASH_KEY, '1').then(() => crash.crash(crashlytics));
  });
  return true;
}

/** Development start after the test crash: send its report, once. */
export async function sendTestCrashReport(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(TEST_CRASH_KEY)) !== '1') return false;
    await AsyncStorage.removeItem(TEST_CRASH_KEY);
  } catch (error) {
    console.warn('[crash] test crash marker could not be read:', error);
    return false;
  }
  withCrashlytics('sendUnsentReports', (crash, crashlytics) => crash.sendUnsentReports(crashlytics));
  return true;
}

/** Taps on the profile's version line that crash a development build. */
export const TEST_CRASH_TAPS = 7;
/** ...all within this window. */
export const TEST_CRASH_WINDOW_MS = 3000;

/**
 * The hidden test crash of development builds: `tap()` on every press of the
 * version line; the seventh within three seconds crashes. Always false in
 * release builds.
 */
export function createTestCrashTrigger(now: () => number = Date.now): { tap: () => boolean } {
  let taps: number[] = [];
  return {
    tap: () => {
      if (!__DEV__) return false;
      const at = now();
      taps = [...taps.filter(time => at - time < TEST_CRASH_WINDOW_MS), at];
      if (taps.length < TEST_CRASH_TAPS) return false;
      taps = [];
      return triggerTestCrash();
    },
  };
}

/** Test-only: forget the module and the listener. */
export function resetCrashReportingForTests(): void {
  stopUserSync?.();
  stopUserSync = null;
  started = false;
  lib = undefined;
  instance = null;
}
