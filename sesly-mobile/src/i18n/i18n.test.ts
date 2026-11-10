/**
 * i18n: language resolution, the stored preference, the locale-aware
 * uppercase helper, and the resource files themselves (same keys in both
 * languages, real English, no forbidden glyphs).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import i18n, { NAMESPACES, initUiLanguage, resources, setUiLanguage } from './index';
import {
  UI_LANGUAGES,
  UI_LANGUAGE_NAMES,
  UI_LANGUAGE_STORAGE_KEY,
  getDeviceUiLanguage,
  isUiLanguage,
  readStoredUiLanguage,
  resolveUiLanguage,
  storeUiLanguage,
} from './language';
import { currentLanguage, initialOf, languageCodeLabel, upper, upperCaseFor } from './text';
import { mockDeviceLocale } from '../test-utils/mocks/native-modules';

const setDevice = (languageCode: string | null, languageTag: string) => {
  mockDeviceLocale.locales = [{ languageCode, languageTag }];
};

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('tr');
});

describe('resolveUiLanguage', () => {
  it.each([
    ['tr', 'tr'],
    ['tr-TR', 'tr'],
    ['TR_cy', 'tr'],
    ['en', 'en'],
    ['en-GB', 'en'],
    ['de-DE', 'en'],
    ['', 'en'],
    [null, 'en'],
    [undefined, 'en'],
  ] as const)('%s resolves to %s', (tag, expected) => {
    expect(resolveUiLanguage(tag)).toBe(expected);
  });

  it('offers Türkçe and English under their own names', () => {
    expect(UI_LANGUAGES).toEqual(['tr', 'en']);
    expect(UI_LANGUAGE_NAMES).toEqual({ tr: 'Türkçe', en: 'English' });
    expect(isUiLanguage('en')).toBe(true);
    expect(isUiLanguage('de')).toBe(false);
  });
});

describe('device language', () => {
  it('uses the first device locale', () => {
    setDevice('en', 'en-US');
    expect(getDeviceUiLanguage()).toBe('en');
    setDevice(null, 'tr-TR');
    expect(getDeviceUiLanguage()).toBe('tr');
  });

  it('falls back to Turkish when there is no locale or the native module is missing', () => {
    mockDeviceLocale.locales = [];
    expect(getDeviceUiLanguage()).toBe('tr');

    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockDeviceLocale.error = new Error("Cannot find native module 'ExpoLocalization'");
    expect(getDeviceUiLanguage()).toBe('tr');
    expect(warn).toHaveBeenCalled();
  });
});

describe('stored preference', () => {
  it('no stored value means follow the device', async () => {
    setDevice('en', 'en-US');
    await expect(readStoredUiLanguage()).resolves.toBeNull();
    await expect(initUiLanguage()).resolves.toBe('en');
    expect(i18n.language).toBe('en');
    expect(currentLanguage()).toBe('en');
  });

  it('a stored pick wins over the device', async () => {
    setDevice('en', 'en-US');
    await storeUiLanguage('tr');
    await expect(initUiLanguage()).resolves.toBe('tr');
    expect(i18n.language).toBe('tr');
  });

  it('garbage in storage is ignored', async () => {
    await AsyncStorage.setItem(UI_LANGUAGE_STORAGE_KEY, 'klingon');
    await expect(readStoredUiLanguage()).resolves.toBeNull();
  });

  it('setUiLanguage switches, persists, and null returns to the device language', async () => {
    await expect(setUiLanguage('en')).resolves.toBe('en');
    expect(i18n.t('common:retry')).toBe('Try again');
    await expect(AsyncStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).resolves.toBe('en');

    await expect(setUiLanguage(null)).resolves.toBe('tr');
    expect(i18n.t('common:retry')).toBe('Tekrar dene');
    await expect(AsyncStorage.getItem(UI_LANGUAGE_STORAGE_KEY)).resolves.toBeNull();
  });

  it('storage failures do not throw', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(readStoredUiLanguage()).resolves.toBeNull();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    await expect(storeUiLanguage('en')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('uppercase helper', () => {
  it('applies Turkish casing in Turkish', () => {
    expect(upperCaseFor('tr', 'bildirimler')).toBe('BİLDİRİMLER');
    expect(upperCaseFor('tr', 'ışık')).toBe('IŞIK');
    expect(upperCaseFor('tr', 'Şifre (tekrar)')).toBe('ŞİFRE (TEKRAR)');
  });

  it('does not corrupt English', () => {
    expect(upperCaseFor('en', 'library')).toBe('LIBRARY');
    expect(upperCaseFor('en', 'sign in')).toBe('SIGN IN');
    expect(upperCaseFor('en', 'legal')).not.toContain('İ');
  });

  it('upper() follows the current UI language', async () => {
    expect(upper('legal bilgi')).toBe('LEGAL BİLGİ');
    await i18n.changeLanguage('en');
    expect(upper('legal info')).toBe('LEGAL INFO');
  });

  it('initialOf uppercases the first letter for the UI language', async () => {
    expect(initialOf('ipek')).toBe('İ');
    expect(initialOf('  zeynep')).toBe('Z');
    expect(initialOf('')).toBe('S');
    expect(initialOf(null, '?')).toBe('?');
    await i18n.changeLanguage('en');
    expect(initialOf('ian')).toBe('I');
  });

  it('language codes are plain ASCII uppercase even in Turkish', () => {
    expect(languageCodeLabel('it')).toBe('IT');
    expect(languageCodeLabel(' tr-TR')).toBe('TR');
    expect(languageCodeLabel('en')).toBe('EN');
  });
});

// ─────────────────────────────────────────────────────────────
// Resource files
// ─────────────────────────────────────────────────────────────

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

describe('resources', () => {
  it.each(NAMESPACES)('%s has exactly the same keys in Turkish and English', ns => {
    const tr = flatten(resources.tr[ns] as Tree);
    const en = flatten(resources.en[ns] as Tree);
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
  });

  it.each(NAMESPACES)('%s keeps the same interpolation variables and tags in both languages', ns => {
    const tr = flatten(resources.tr[ns] as Tree);
    const en = flatten(resources.en[ns] as Tree);
    const marks = (value: string) => (value.match(/\{\{\w+\}\}|<\/?\w+>/g) ?? []).sort();
    for (const key of Object.keys(tr)) {
      expect({ key, marks: marks(en[key]) }).toEqual({ key, marks: marks(tr[key]) });
    }
  });

  it('English is translated, not copied', () => {
    // Brand names and language-neutral values may be identical.
    const neutral = new Set(['auth.googleShort', 'auth.appleShort']);
    const same: string[] = [];
    for (const ns of NAMESPACES) {
      const tr = flatten(resources.tr[ns] as Tree);
      const en = flatten(resources.en[ns] as Tree);
      for (const key of Object.keys(tr)) {
        if (!neutral.has(`${ns}.${key}`) && tr[key] === en[key]) same.push(`${ns}.${key}`);
      }
    }
    expect(same).toEqual([]);
  });

  it('no emoji, em dash, arrow or decorative glyph in any string', () => {
    // Unicode ellipsis, dashes, arrows, bullets, stars, check marks, middle
    // dot, chevrons, curly quotes, and the emoji planes.
    const forbidden = /[…–—←-⇿•·★☆✓✔›‹»«“”‘’⚠-➿]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/;
    for (const lang of ['tr', 'en'] as const) {
      for (const ns of NAMESPACES) {
        for (const [key, value] of Object.entries(flatten(resources[lang][ns] as Tree))) {
          expect({ where: `${lang}/${ns}.${key}`, bad: forbidden.test(value) }).toEqual({
            where: `${lang}/${ns}.${key}`,
            bad: false,
          });
        }
      }
    }
  });

  it('never names a "Sesly Pro" plan: the plans are Ücretsiz, Mini and Premium', () => {
    const stale = /Sesly Pro|\bPro abonelik/;
    const found: string[] = [];
    for (const lang of ['tr', 'en'] as const) {
      for (const ns of NAMESPACES) {
        for (const [key, value] of Object.entries(flatten(resources[lang][ns] as Tree))) {
          if (stale.test(value)) found.push(`${lang}/${ns}.${key}`);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it('Turkish copy matches the mockups', () => {
    expect(i18n.t('nav:tabs.stories')).toBe('Masallar');
    expect(i18n.t('nav:tabs.discover')).toBe('Keşfet');
    expect(i18n.t('nav:tabs.library')).toBe('Kütüphane');
    expect(i18n.t('nav:tabs.voice')).toBe('Sesim');
    expect(i18n.t('nav:miniPlayer.narratorRemaining', { name: 'Zeynep', minutes: 4 })).toBe(
      'Zeynep anlatıyor, 4 dk kaldı',
    );
    expect(i18n.t('home:featured.tagNight')).toBe('Bu gecenin masalı');
    expect(i18n.t('onboarding:pages.sleep.title')).toBe('Her gece bir masal.');
    expect(i18n.t('auth:login.title')).toBe('Tekrar hoş geldin');
  });

  it('falls back to Turkish for a language without resources', async () => {
    await i18n.changeLanguage('de');
    expect(i18n.t('common:retry')).toBe('Tekrar dene');
    expect(currentLanguage()).toBe('tr');
  });
});
