/**
 * UI language preference.
 *
 * Supported: Türkçe ('tr') and English ('en'). The preference is a device
 * level setting (it must work on Onboarding and Login, before any account
 * exists), stored in AsyncStorage. No stored value means "follow the device":
 * Turkish devices get Turkish, every other locale gets English.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type UiLanguage = 'tr' | 'en';

export const UI_LANGUAGES: readonly UiLanguage[] = ['tr', 'en'];

/** Each language in its own name, as the settings control shows them. */
export const UI_LANGUAGE_NAMES: Record<UiLanguage, string> = {
  tr: 'Türkçe',
  en: 'English',
};

export const UI_LANGUAGE_STORAGE_KEY = '@sesly/uiLanguage';

export function isUiLanguage(value: unknown): value is UiLanguage {
  return value === 'tr' || value === 'en';
}

/**
 * Map a BCP-47 tag or bare language code to a supported UI language.
 * "tr", "tr-TR", "tr_CY" are Turkish; anything else, including nothing, is
 * English, the wider fallback for a device that is not set to Turkish.
 */
export function resolveUiLanguage(tag: string | null | undefined): UiLanguage {
  if (!tag) return 'en';
  const code = tag.trim().toLowerCase().split(/[-_]/)[0];
  return code === 'tr' ? 'tr' : 'en';
}

/**
 * First locale of the device. expo-localization is a native module; a
 * development build made before it was added does not contain it, so a
 * failure here must not take the app down. Falls back to Turkish, the
 * product's first language.
 */
export function getDeviceUiLanguage(): UiLanguage {
  try {
    // Required lazily so a missing native module is caught here.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Localization = require('expo-localization') as typeof import('expo-localization');
    const first = Localization.getLocales()[0];
    if (!first) return 'tr';
    return resolveUiLanguage(first.languageCode ?? first.languageTag);
  } catch (err) {
    console.warn('[i18n] device locale unavailable, using Turkish:', err);
    return 'tr';
  }
}

/** Stored pick, or null when the user never chose (follow the device). */
export async function readStoredUiLanguage(): Promise<UiLanguage | null> {
  try {
    const raw = await AsyncStorage.getItem(UI_LANGUAGE_STORAGE_KEY);
    return isUiLanguage(raw) ? raw : null;
  } catch (err) {
    console.warn('[i18n] reading the stored language failed:', err);
    return null;
  }
}

/** Persist a pick; `null` clears it so the app follows the device again. */
export async function storeUiLanguage(language: UiLanguage | null): Promise<void> {
  try {
    if (language) {
      await AsyncStorage.setItem(UI_LANGUAGE_STORAGE_KEY, language);
    } else {
      await AsyncStorage.removeItem(UI_LANGUAGE_STORAGE_KEY);
    }
  } catch (err) {
    console.warn('[i18n] storing the language failed:', err);
  }
}
