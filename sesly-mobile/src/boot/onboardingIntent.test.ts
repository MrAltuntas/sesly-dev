/**
 * The onboarding intent: stored by "Sesimi kaydet", taken once after the
 * first sign-in.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ONBOARDING_INTENT_STORAGE_KEY,
  setOnboardingIntent,
  takeOnboardingIntent,
} from './onboardingIntent';

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('onboarding intent', () => {
  it('set then take returns record once and null after', async () => {
    await setOnboardingIntent('record');
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBe('record');

    await expect(takeOnboardingIntent()).resolves.toBe('record');
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBeNull();
    await expect(takeOnboardingIntent()).resolves.toBeNull();
  });

  it('is null when nothing was stored ("Atla")', async () => {
    await expect(takeOnboardingIntent()).resolves.toBeNull();
    expect(AsyncStorage.removeItem).not.toHaveBeenCalled();
  });

  it('removes and ignores an unknown stored value', async () => {
    await AsyncStorage.setItem(ONBOARDING_INTENT_STORAGE_KEY, 'listen');
    await expect(takeOnboardingIntent()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY)).resolves.toBeNull();
  });

  it('never throws when storage fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(setOnboardingIntent('record')).resolves.toBeUndefined();

    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('read failed'));
    await expect(takeOnboardingIntent()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('still returns the intent when it cannot be removed', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await setOnboardingIntent('record');
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    await expect(takeOnboardingIntent()).resolves.toBe('record');
  });
});
