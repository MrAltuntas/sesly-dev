/**
 * The three onboarding pictures, decoded ahead of the screen on a first
 * launch.
 *
 * On the Onboarding boot route BootStore calls `prefetchOnboardingPictures`
 * as soon as the route is decided, next to the splash hold: expo-image
 * decodes the bundled WebPs (`Image.loadAsync`, at most the window's width in
 * pixels) while the fonts load and the navigator mounts, instead of only
 * once the screen's picture views mount. The first picture goes first, the
 * other two after it. (`Image.prefetch` takes URLs only; a release build
 * bundles the files as resources, so a decode is what works in both builds.)
 *
 * OnboardingScreen shows `onboardingPictureSources()[key]`: the decoded
 * picture once it is ready, nothing while it is still decoding (at most
 * ONBOARDING_PICTURE_WAIT_MS), and the bundled file when no prefetch ran or
 * it failed. The screen drops the decoded pictures when it unmounts
 * (`releaseOnboardingPictures`).
 */

import { Dimensions, PixelRatio, Platform } from 'react-native';
import { Image as ExpoImage, type ImageRef } from 'expo-image';

export type OnboardingPictureKey = 'house' | 'voice' | 'sleep';

/* eslint-disable @typescript-eslint/no-var-requires */
export const ONBOARDING_PICTURES: Readonly<Record<OnboardingPictureKey, number>> = {
  house: require('../../assets/images/onboarding/onboarding-1-bedtime-house.webp'),
  voice: require('../../assets/images/onboarding/onboarding-2-own-voice.webp'),
  sleep: require('../../assets/images/onboarding/onboarding-3-sleeping-child.webp'),
};
/* eslint-enable @typescript-eslint/no-var-requires */

const KEYS: readonly OnboardingPictureKey[] = ['house', 'voice', 'sleep'];

/** A picture still decoding after this long shows the bundled file instead. */
export const ONBOARDING_PICTURE_WAIT_MS = 3000;

/** The pictures are 3:4 (1080 x 1440). */
const PICTURE_ASPECT = 4 / 3;

/** A decoded picture, the bundled file, or nothing yet (still decoding). */
export type OnboardingPictureSource = ImageRef | number | null;

type Entry = { state: 'pending' } | { state: 'ready'; ref: ImageRef } | { state: 'failed' };

let entries: Partial<Record<OnboardingPictureKey, Entry>> = {};
let started = false;
// Bumped on release and reset: a decode that ends later is dropped.
let generation = 0;
let waitTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function sourceOf(key: OnboardingPictureKey): OnboardingPictureSource {
  const entry = entries[key];
  if (entry?.state === 'ready') return entry.ref;
  if (entry?.state === 'pending') return null;
  return ONBOARDING_PICTURES[key];
}

function buildSnapshot(): Readonly<Record<OnboardingPictureKey, OnboardingPictureSource>> {
  return { house: sourceOf('house'), voice: sourceOf('voice'), sleep: sourceOf('sleep') };
}

let snapshot = buildSnapshot();

function update(key: OnboardingPictureKey, entry: Entry | undefined): void {
  const next = { ...entries };
  if (entry) next[key] = entry;
  else delete next[key];
  entries = next;
  snapshot = buildSnapshot();
  listeners.forEach(listener => listener());
}

function clearWaitTimer(): void {
  if (waitTimer !== null) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
}

/** Decode size: the picture card is about the window's width. */
function decodeOptions(): { maxWidth: number; maxHeight: number } {
  const maxWidth = Math.max(1, Math.round(PixelRatio.getPixelSizeForLayoutSize(Dimensions.get('window').width)));
  return { maxWidth, maxHeight: Math.round(maxWidth * PICTURE_ASPECT) };
}

/** Decodes one picture; never rejects (a failure leaves the bundled file). */
function decode(key: OnboardingPictureKey, gen: number): Promise<void> {
  let load: Promise<ImageRef>;
  try {
    load = ExpoImage.loadAsync(ONBOARDING_PICTURES[key], decodeOptions());
  } catch (error) {
    load = Promise.reject(error);
  }
  return load.then(
    ref => {
      if (gen === generation && entries[key]?.state === 'pending') {
        update(key, { state: 'ready', ref });
      }
    },
    error => {
      if (gen === generation && entries[key]?.state === 'pending') {
        console.warn(`[onboarding] decoding the ${key} picture failed; using the file:`, error);
        update(key, { state: 'failed' });
      }
    },
  );
}

/**
 * Starts decoding the three pictures (the first one, then the other two).
 * Once per launch; does nothing where expo-image cannot decode ahead (no
 * `loadAsync`, Android before 8.0), so the screen loads the files itself.
 */
export function prefetchOnboardingPictures(): void {
  if (started) return;
  started = true;
  if (typeof ExpoImage.loadAsync !== 'function') return;
  if (Platform.OS === 'android' && typeof Platform.Version === 'number' && Platform.Version < 26) return;

  const gen = generation;
  KEYS.forEach(key => update(key, { state: 'pending' }));
  waitTimer = setTimeout(() => {
    waitTimer = null;
    if (gen !== generation) return;
    KEYS.forEach(key => {
      if (entries[key]?.state === 'pending') update(key, { state: 'failed' });
    });
  }, ONBOARDING_PICTURE_WAIT_MS);

  const [first, ...rest] = KEYS;
  void decode(first, gen).then(() => Promise.all(rest.map(key => decode(key, gen))));
}

/** What each picture view shows now (a stable object between changes). */
export function onboardingPictureSources(): Readonly<Record<OnboardingPictureKey, OnboardingPictureSource>> {
  return snapshot;
}

/** Calls `listener` whenever a source changes (`useSyncExternalStore`). Returns the unsubscribe. */
export function subscribeOnboardingPictures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Drops the decoded pictures (the screen unmounted): a later screen loads
 * the bundled files, and a decode still running is ignored when it ends.
 */
export function releaseOnboardingPictures(): void {
  generation += 1;
  clearWaitTimer();
  KEYS.forEach(key => {
    if (entries[key]) update(key, undefined);
  });
}

/** Test hook: back to the state of a fresh launch. */
export function resetOnboardingPicturesForTests(): void {
  generation += 1;
  clearWaitTimer();
  entries = {};
  started = false;
  snapshot = buildSnapshot();
  listeners.clear();
}
