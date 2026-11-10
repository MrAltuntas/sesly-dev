/**
 * The onboarding pictures decoded at boot (LA-5): the first picture first,
 * nothing shown while a picture decodes, the decoded picture once ready, the
 * bundled file when nothing was decoded, a decode fails or takes too long,
 * and after the screen let go of them.
 */

import { Platform } from 'react-native';
import { Image as ExpoImage } from 'expo-image';

import {
  ONBOARDING_PICTURES,
  ONBOARDING_PICTURE_WAIT_MS,
  onboardingPictureSources,
  prefetchOnboardingPictures,
  releaseOnboardingPictures,
  resetOnboardingPicturesForTests,
  subscribeOnboardingPictures,
} from './onboardingPictures';

type Deferred = { resolve: (value: unknown) => void; reject: (error: unknown) => void };

// The shared expo-image mock has no loadAsync; each test puts one on it.
const image = ExpoImage as unknown as { loadAsync?: jest.Mock };
let decodes: Array<{ source: unknown; options: unknown } & Deferred>;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const ref = (name: string) => ({ name, width: 1080, height: 1440 });

beforeEach(() => {
  jest.useFakeTimers();
  resetOnboardingPicturesForTests();
  decodes = [];
  image.loadAsync = jest.fn(
    (source: unknown, options: unknown) =>
      new Promise((resolve, reject) => {
        decodes.push({ source, options, resolve, reject });
      }),
  );
});

afterEach(() => {
  resetOnboardingPicturesForTests();
  delete image.loadAsync;
  jest.restoreAllMocks();
});

describe('onboarding picture prefetch', () => {
  it('shows the bundled files when nothing was decoded ahead', () => {
    expect(onboardingPictureSources()).toEqual({
      house: ONBOARDING_PICTURES.house,
      voice: ONBOARDING_PICTURES.voice,
      sleep: ONBOARDING_PICTURES.sleep,
    });
  });

  it('decodes the first picture first, at the window width, and shows nothing until it is ready', async () => {
    const listener = jest.fn();
    subscribeOnboardingPictures(listener);
    prefetchOnboardingPictures();

    expect(onboardingPictureSources()).toEqual({ house: null, voice: null, sleep: null });
    expect(listener).toHaveBeenCalled();
    expect(decodes.map(d => d.source)).toEqual([ONBOARDING_PICTURES.house]);
    const { maxWidth, maxHeight } = decodes[0].options as { maxWidth: number; maxHeight: number };
    expect(maxWidth).toBeGreaterThan(0);
    expect(maxHeight).toBe(Math.round((maxWidth * 4) / 3));

    const house = ref('house');
    decodes[0].resolve(house);
    await flush();

    expect(onboardingPictureSources().house).toBe(house);
    // Then the other two, together.
    expect(decodes.map(d => d.source)).toEqual([
      ONBOARDING_PICTURES.house,
      ONBOARDING_PICTURES.voice,
      ONBOARDING_PICTURES.sleep,
    ]);
    expect(onboardingPictureSources().voice).toBeNull();
    const voice = ref('voice');
    const sleep = ref('sleep');
    decodes[1].resolve(voice);
    decodes[2].resolve(sleep);
    await flush();
    expect(onboardingPictureSources()).toEqual({ house, voice, sleep });
  });

  it('keeps one snapshot object between changes', async () => {
    prefetchOnboardingPictures();
    const before = onboardingPictureSources();
    expect(onboardingPictureSources()).toBe(before);
    decodes[0].resolve(ref('house'));
    await flush();
    expect(onboardingPictureSources()).not.toBe(before);
  });

  it('runs once per launch', () => {
    prefetchOnboardingPictures();
    prefetchOnboardingPictures();
    expect(image.loadAsync).toHaveBeenCalledTimes(1);
  });

  it('a failed decode shows the bundled file and still decodes the others', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    prefetchOnboardingPictures();
    decodes[0].reject(new Error('decode'));
    await flush();

    expect(onboardingPictureSources().house).toBe(ONBOARDING_PICTURES.house);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('house'), expect.any(Error));
    expect(decodes).toHaveLength(3);
    warn.mockRestore();
  });

  it('a loadAsync that throws leaves the bundled files', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    image.loadAsync!.mockImplementation(() => {
      throw new Error('no native module');
    });
    prefetchOnboardingPictures();
    await flush();

    expect(onboardingPictureSources()).toEqual(ONBOARDING_PICTURES);
    warn.mockRestore();
  });

  it(`a decode still running after ${ONBOARDING_PICTURE_WAIT_MS} ms gives way to the bundled file`, async () => {
    prefetchOnboardingPictures();
    jest.advanceTimersByTime(ONBOARDING_PICTURE_WAIT_MS - 1);
    expect(onboardingPictureSources().house).toBeNull();

    jest.advanceTimersByTime(1);
    expect(onboardingPictureSources()).toEqual(ONBOARDING_PICTURES);

    // A late decode is not swapped in under the file.
    decodes[0].resolve(ref('house'));
    await flush();
    expect(onboardingPictureSources().house).toBe(ONBOARDING_PICTURES.house);
  });

  it('releasing drops the decoded pictures and ignores a decode that ends later', async () => {
    prefetchOnboardingPictures();
    decodes[0].resolve(ref('house'));
    await flush();

    releaseOnboardingPictures();
    expect(onboardingPictureSources()).toEqual(ONBOARDING_PICTURES);

    decodes[1].resolve(ref('voice'));
    await flush();
    expect(onboardingPictureSources()).toEqual(ONBOARDING_PICTURES);
    // The wait timer went with them.
    jest.advanceTimersByTime(ONBOARDING_PICTURE_WAIT_MS);
    expect(onboardingPictureSources()).toEqual(ONBOARDING_PICTURES);
  });

  it('an unsubscribed listener is not told', () => {
    const listener = jest.fn();
    subscribeOnboardingPictures(listener)();
    prefetchOnboardingPictures();
    expect(listener).not.toHaveBeenCalled();
  });

  it('does nothing without loadAsync', () => {
    delete image.loadAsync;
    prefetchOnboardingPictures();
    expect(onboardingPictureSources()).toEqual(ONBOARDING_PICTURES);
  });

  it('does nothing on Android before 8.0', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    jest.spyOn(Platform, 'Version', 'get').mockReturnValue(25);
    prefetchOnboardingPictures();
    expect(image.loadAsync).not.toHaveBeenCalled();
    expect(onboardingPictureSources()).toEqual(ONBOARDING_PICTURES);
  });
});
