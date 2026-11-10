/**
 * Everything the launch needs from the device, in one storage round trip:
 * ONE AsyncStorage.multiGet (onboarding flag, cached user, cached
 * /app/config, palette, UI language) next to the token check (one encrypted
 * read pass, ApiClient keeps the tokens in memory afterwards).
 *
 * Raw values travel as they were stored; each consumer parses its own
 * (readCachedUser, parseStoredAppConfig, initUiLanguage, preloadStoredPalette)
 * so nothing reads storage a second time.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import ApiClient from '../services/ApiClient';
import { STORAGE_KEYS } from '../config/constants';
import { CACHED_USER_STORAGE_KEY } from '../session/userCache';
import { UI_LANGUAGE_STORAGE_KEY } from '../i18n/language';
import { PALETTE_STORAGE_KEY } from '../theme/ThemeProvider';

export interface BootSnapshot {
  hasSeenOnboarding: boolean;
  /** Raw `@sesly/me`. */
  cachedUserRaw: string | null;
  /** Raw `@sesly/appConfig`. */
  appConfigRaw: string | null;
  /** Raw `@sesly/palette`. */
  palette: string | null;
  /** Raw `@sesly/uiLanguage`. */
  uiLanguage: string | null;
  hasTokens: boolean;
}

export const BOOT_SNAPSHOT_KEYS = [
  STORAGE_KEYS.HAS_SEEN_ONBOARDING,
  CACHED_USER_STORAGE_KEY,
  STORAGE_KEYS.APP_CONFIG,
  PALETTE_STORAGE_KEY,
  UI_LANGUAGE_STORAGE_KEY,
] as const;

async function readStoredValues(): Promise<Map<string, string | null>> {
  try {
    const pairs = await AsyncStorage.multiGet([...BOOT_SNAPSHOT_KEYS]);
    return new Map(pairs.map(([key, value]) => [key, value ?? null]));
  } catch (error) {
    // A first launch without its flags is the safe reading.
    console.warn('[boot] reading the stored launch values failed:', error);
    return new Map();
  }
}

async function readHasTokens(): Promise<boolean> {
  try {
    return await ApiClient.hasValidTokens();
  } catch (error) {
    console.warn('[boot] reading the stored tokens failed:', error);
    return false;
  }
}

/** Never throws. */
export async function readBootSnapshot(): Promise<BootSnapshot> {
  const [values, hasTokens] = await Promise.all([readStoredValues(), readHasTokens()]);
  const get = (key: string): string | null => values.get(key) ?? null;
  return {
    hasSeenOnboarding: get(STORAGE_KEYS.HAS_SEEN_ONBOARDING) === 'true',
    cachedUserRaw: get(CACHED_USER_STORAGE_KEY),
    appConfigRaw: get(STORAGE_KEYS.APP_CONFIG),
    palette: get(PALETTE_STORAGE_KEY),
    uiLanguage: get(UI_LANGUAGE_STORAGE_KEY),
    hasTokens,
  };
}
