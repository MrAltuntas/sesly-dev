/**
 * The native splash (expo-splash-screen) from the first frame to the first
 * screen.
 *
 * `src/setup/entry.ts` holds it at module load (preventAutoHideAsync). The
 * navigator mounts on the boot route behind it and releases it once that
 * route has drawn: RootNavigator's onReady calls `releaseSplash`, except on
 * the Onboarding route, which waits for its first picture so the
 * illustration never pops in: BootStore starts `holdSplashForOnboardingPicture`
 * once the navigator is ready and the screen's first picture calls
 * `markOnboardingPictureReady` from its onLoad. When the hold gives up first
 * (ONBOARDING_PICTURE_HOLD_MS on a slow device), the picture is late: the
 * screen reads `isOnboardingPictureLate` and fades it in instead of popping
 * it. A safety timer started on App's first render releases the splash if
 * all of that fails; it only fires on a bug.
 *
 * `releaseSplash` is the only caller of `hideAsync`.
 */

import * as SplashScreen from 'expo-splash-screen';

/** Above the longest boot wait (the 10 s restore cap). */
export const SPLASH_SAFETY_TIMEOUT_MS = 12000;

/** The onboarding route waits at most this long for its first picture. */
export const ONBOARDING_PICTURE_HOLD_MS = 800;

let released = false;
let releasedBecause: string | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;

let pictureReady = false;
let pictureHold: Promise<void> | null = null;
let resolvePictureHold: (() => void) | null = null;
let pictureHoldTimer: ReturnType<typeof setTimeout> | null = null;
// The hold ended before the first picture was ready.
let pictureLate = false;
const pictureLateListeners = new Set<() => void>();

function clearSafetyTimer(): void {
  if (safetyTimer !== null) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

/**
 * Hides the native splash (200 ms fade, set in entry.ts). Idempotent: only
 * the first call reaches `hideAsync`. Never throws; a failure only warns
 * (the splash module is missing in an old development build).
 */
export function releaseSplash(reason: string): void {
  if (released) {
    return;
  }
  released = true;
  releasedBecause = reason;
  clearSafetyTimer();
  try {
    SplashScreen.hideAsync().catch(error => {
      console.warn('[splash] hideAsync failed:', error);
    });
  } catch (error) {
    console.warn('[splash] hideAsync failed:', error);
  }
}

/** Whether the splash was released, and why (diagnostics and tests). */
export function splashReleaseReason(): string | null {
  return releasedBecause;
}

export function isSplashReleased(): boolean {
  return released;
}

/**
 * Releases the splash after SPLASH_SAFETY_TIMEOUT_MS whatever happened.
 * Called on App's first render; later calls do nothing.
 */
export function startSplashSafetyTimer(): void {
  if (released || safetyTimer !== null) {
    return;
  }
  safetyTimer = setTimeout(() => {
    safetyTimer = null;
    if (!released) {
      console.warn('[splash] released by the safety timer; the first route never reported ready');
      releaseSplash('safety-timeout');
    }
  }, SPLASH_SAFETY_TIMEOUT_MS);
}

/** The splash goes before the first picture: the screen fades it in when it lands. */
function markPictureLate(): void {
  if (pictureReady || pictureLate) {
    return;
  }
  pictureLate = true;
  pictureLateListeners.forEach(listener => listener());
}

function settlePictureHold(): void {
  if (pictureHoldTimer !== null) {
    clearTimeout(pictureHoldTimer);
    pictureHoldTimer = null;
  }
  const resolve = resolvePictureHold;
  resolvePictureHold = null;
  releaseSplash('onboarding-picture');
  resolve?.();
}

/**
 * The Onboarding boot route keeps the splash until its first picture has
 * loaded (`markOnboardingPictureReady`) or ONBOARDING_PICTURE_HOLD_MS passed,
 * then releases it. Resolves after the release. Every call shares one hold;
 * a picture that already loaded resolves at once.
 */
export function holdSplashForOnboardingPicture(): Promise<void> {
  if (pictureHold) {
    return pictureHold;
  }
  if (pictureReady || released) {
    // Already gone (the safety timer): late unless the picture loaded.
    markPictureLate();
    releaseSplash('onboarding-picture');
    pictureHold = Promise.resolve();
    return pictureHold;
  }
  pictureHold = new Promise<void>(resolve => {
    resolvePictureHold = resolve;
  });
  pictureHoldTimer = setTimeout(() => {
    pictureHoldTimer = null;
    markPictureLate();
    settlePictureHold();
  }, ONBOARDING_PICTURE_HOLD_MS);
  return pictureHold;
}

/**
 * Whether the hold ended before the first onboarding picture had loaded (it
 * timed out, or the splash was already gone), so the picture would pop in on
 * screen. Stays false when the picture loaded under the splash.
 */
export function isOnboardingPictureLate(): boolean {
  return pictureLate;
}

/** Calls `listener` when the first picture turns late (`useSyncExternalStore`). Returns the unsubscribe. */
export function subscribeOnboardingPictureLate(listener: () => void): () => void {
  pictureLateListeners.add(listener);
  return () => {
    pictureLateListeners.delete(listener);
  };
}

/**
 * The first onboarding picture has drawn (its onLoad). Ends the hold, or
 * releases the splash directly when no hold was asked for. Harmless after
 * the splash is gone.
 */
export function markOnboardingPictureReady(): void {
  if (pictureReady) {
    return;
  }
  pictureReady = true;
  settlePictureHold();
}

/** Test hook: back to the state of a fresh launch. */
export function resetSplashForTests(): void {
  clearSafetyTimer();
  if (pictureHoldTimer !== null) {
    clearTimeout(pictureHoldTimer);
  }
  released = false;
  releasedBecause = null;
  pictureReady = false;
  pictureLate = false;
  pictureLateListeners.clear();
  pictureHold = null;
  resolvePictureHold = null;
  pictureHoldTimer = null;
}
