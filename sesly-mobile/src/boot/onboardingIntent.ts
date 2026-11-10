/**
 * What the user chose on onboarding, kept until the first sign-in.
 *
 * "Sesimi kaydet" on the voice page stores 'record' and finishes onboarding;
 * after the first successful sign-in or sign-up the auth screen takes it
 * (read and removed) and resets to Main on the Sesim tab. "Atla" stores
 * nothing. Device-level and one-shot, so AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../config/constants';

export type OnboardingIntent = 'record';

export const ONBOARDING_INTENT_STORAGE_KEY = STORAGE_KEYS.ONBOARDING_INTENT;

function isOnboardingIntent(value: unknown): value is OnboardingIntent {
  return value === 'record';
}

/** Never throws; a failed write only warns (the user just lands on Home). */
export async function setOnboardingIntent(intent: OnboardingIntent): Promise<void> {
  try {
    await AsyncStorage.setItem(ONBOARDING_INTENT_STORAGE_KEY, intent);
  } catch (error) {
    console.warn('[onboardingIntent] could not store the intent:', error);
  }
}

/**
 * The stored intent, removed so it applies once. Null when none was stored
 * (or it could not be read). Never throws.
 */
export async function takeOnboardingIntent(): Promise<OnboardingIntent | null> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(ONBOARDING_INTENT_STORAGE_KEY);
  } catch (error) {
    console.warn('[onboardingIntent] could not read the intent:', error);
    return null;
  }
  if (raw === null) {
    return null;
  }
  try {
    await AsyncStorage.removeItem(ONBOARDING_INTENT_STORAGE_KEY);
  } catch (error) {
    console.warn('[onboardingIntent] could not remove the intent:', error);
  }
  return isOnboardingIntent(raw) ? raw : null;
}
