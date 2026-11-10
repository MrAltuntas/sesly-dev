/**
 * The native splash release: one hideAsync whatever calls it, the safety
 * timer, a failing native module, and the onboarding picture hold.
 */

import * as SplashScreen from 'expo-splash-screen';

import {
  ONBOARDING_PICTURE_HOLD_MS,
  SPLASH_SAFETY_TIMEOUT_MS,
  holdSplashForOnboardingPicture,
  isOnboardingPictureLate,
  isSplashReleased,
  markOnboardingPictureReady,
  releaseSplash,
  resetSplashForTests,
  splashReleaseReason,
  startSplashSafetyTimer,
  subscribeOnboardingPictureLate,
} from './splash';

const hideAsync = SplashScreen.hideAsync as jest.Mock;

beforeEach(() => {
  jest.useFakeTimers();
  resetSplashForTests();
  hideAsync.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  resetSplashForTests();
});

describe('releaseSplash', () => {
  it('calls hideAsync once for many calls and keeps the first reason', () => {
    releaseSplash('first-route');
    releaseSplash('first-route');
    releaseSplash('safety-timeout');

    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(isSplashReleased()).toBe(true);
    expect(splashReleaseReason()).toBe('first-route');
  });

  it('does not throw when hideAsync rejects', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    hideAsync.mockRejectedValue(new Error('no splash module'));

    expect(() => releaseSplash('first-route')).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith('[splash] hideAsync failed:', expect.any(Error));
    expect(isSplashReleased()).toBe(true);
  });

  it('does not throw when hideAsync throws synchronously', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    hideAsync.mockImplementation(() => {
      throw new Error('native module missing');
    });

    expect(() => releaseSplash('first-route')).not.toThrow();
    expect(isSplashReleased()).toBe(true);
  });
});

describe('startSplashSafetyTimer', () => {
  it('releases after 12 s when nothing else did', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    startSplashSafetyTimer();

    jest.advanceTimersByTime(SPLASH_SAFETY_TIMEOUT_MS - 1);
    expect(hideAsync).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(splashReleaseReason()).toBe('safety-timeout');
  });

  it('starts one timer for many calls', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    startSplashSafetyTimer();
    jest.advanceTimersByTime(6000);
    startSplashSafetyTimer();
    jest.advanceTimersByTime(6000);

    expect(hideAsync).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(SPLASH_SAFETY_TIMEOUT_MS);
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('never fires after the first route released the splash', () => {
    startSplashSafetyTimer();
    releaseSplash('first-route');

    jest.advanceTimersByTime(SPLASH_SAFETY_TIMEOUT_MS * 2);

    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(splashReleaseReason()).toBe('first-route');
  });

  it('does nothing once the splash is gone', () => {
    releaseSplash('first-route');
    startSplashSafetyTimer();
    jest.advanceTimersByTime(SPLASH_SAFETY_TIMEOUT_MS);
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });
});

describe('the onboarding picture hold', () => {
  it('keeps the splash until the first picture is ready', async () => {
    const settled = jest.fn();
    void holdSplashForOnboardingPicture().then(settled);

    jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS - 100);
    await Promise.resolve();
    expect(hideAsync).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();

    markOnboardingPictureReady();
    await Promise.resolve();

    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(splashReleaseReason()).toBe('onboarding-picture');
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('releases after 800 ms when the picture never loads', async () => {
    const settled = jest.fn();
    void holdSplashForOnboardingPicture().then(settled);

    jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS - 1);
    expect(hideAsync).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await Promise.resolve();

    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledTimes(1);
    // A late picture does nothing more.
    markOnboardingPictureReady();
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('shares one hold between callers', async () => {
    const first = holdSplashForOnboardingPicture();
    const second = holdSplashForOnboardingPicture();
    expect(second).toBe(first);

    jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS);
    await expect(first).resolves.toBeUndefined();
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('resolves at once when the picture was ready before the hold', async () => {
    markOnboardingPictureReady();
    expect(hideAsync).toHaveBeenCalledTimes(1);

    await expect(holdSplashForOnboardingPicture()).resolves.toBeUndefined();
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('a ready picture releases the splash even when no hold was asked for', () => {
    markOnboardingPictureReady();
    markOnboardingPictureReady();
    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(splashReleaseReason()).toBe('onboarding-picture');
  });
});

describe('a late onboarding picture (LA-5)', () => {
  it('is late when the hold times out before the picture loaded, and tells its listeners once', async () => {
    const listener = jest.fn();
    const unsubscribe = subscribeOnboardingPictureLate(listener);
    void holdSplashForOnboardingPicture();

    jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS - 1);
    expect(isOnboardingPictureLate()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(isOnboardingPictureLate()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    // Told before the splash goes, so the screen has its fade by then.
    expect(hideAsync).toHaveBeenCalledTimes(1);

    // The picture landing afterwards changes nothing more.
    markOnboardingPictureReady();
    expect(isOnboardingPictureLate()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('is never late when the picture loaded under the splash', () => {
    const listener = jest.fn();
    subscribeOnboardingPictureLate(listener);
    void holdSplashForOnboardingPicture();

    jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS - 100);
    markOnboardingPictureReady();
    jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS * 2);

    expect(isOnboardingPictureLate()).toBe(false);
    expect(listener).not.toHaveBeenCalled();
  });

  it('is late when the splash was already gone at the hold (the safety timer)', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    startSplashSafetyTimer();
    jest.advanceTimersByTime(SPLASH_SAFETY_TIMEOUT_MS);
    expect(isOnboardingPictureLate()).toBe(false);

    void holdSplashForOnboardingPicture();
    expect(isOnboardingPictureLate()).toBe(true);
  });

  it('is not late when the picture was ready before the hold', () => {
    markOnboardingPictureReady();
    void holdSplashForOnboardingPicture();
    expect(isOnboardingPictureLate()).toBe(false);
  });

  it('an unsubscribed listener is not told', () => {
    const listener = jest.fn();
    subscribeOnboardingPictureLate(listener)();
    void holdSplashForOnboardingPicture();
    jest.advanceTimersByTime(ONBOARDING_PICTURE_HOLD_MS);

    expect(isOnboardingPictureLate()).toBe(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
