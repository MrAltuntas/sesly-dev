import * as fs from 'fs';
import * as path from 'path';
import {
  interpolate,
  localizedError,
  MESSAGE_ARGS_FIELD,
  resolveMessageArgs,
  serverText,
  serverTextInAllLanguages,
} from './server-text';
import { LanguageLevel } from '../enums/prisma.enums';
import { STORY_SORTS } from '../../modules/stories/story-query.util';
import { PRESET_VOICE_LANGUAGES } from '../constants/google-preset-voices';
import { formatEnglishDate, formatTurkishDate, formatUiDate } from '../utils/turkish-date';

const I18N_DIR = path.join(__dirname, '..', '..', 'i18n');

/** Every leaf of a catalogue as dotted key -> text. */
function leaves(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    Object.assign(out, leaves(value, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

function catalogue(language: string): Record<string, string> {
  const dir = path.join(I18N_DIR, language);
  const out: Record<string, string> = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    const namespace = file.replace(/\.json$/, '');
    Object.assign(out, leaves(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), namespace));
  }
  return out;
}

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

// Em dash, en dash, unicode ellipsis, arrows, bullet, middle dot, stars, check marks, emoji.
const FORBIDDEN = /[—–…←-⇿•·★☆✓✔]|\p{Extended_Pictographic}/u;

describe('server text catalogues (src/i18n)', () => {
  const tr = catalogue('tr');
  const en = catalogue('en');

  it('Turkish and English have the same keys and the same placeholders', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    for (const key of Object.keys(tr)) {
      expect({ key, placeholders: placeholders(en[key]) }).toEqual({ key, placeholders: placeholders(tr[key]) });
    }
  });

  it('no text breaks the UI text rules (em dash, unicode ellipsis, arrows, bullets, emoji)', () => {
    for (const [key, text] of [...Object.entries(tr), ...Object.entries(en)]) {
      expect({ key, ok: !FORBIDDEN.test(text) }).toEqual({ key, ok: true });
    }
  });

  it('the validation texts list exactly the values the validators accept', () => {
    const levels = Object.values(LanguageLevel).join(', ');
    expect(serverText('errors.validation.languageLevel', 'tr')).toBe(
      `Geçersiz dil seviyesi. Geçerli değerler: ${levels}.`,
    );
    expect(serverText('errors.validation.languageLevel', 'en')).toBe(`Invalid language level. Valid values: ${levels}.`);
    const sorts = STORY_SORTS.join(', ');
    expect(serverText('errors.validation.storySort', 'tr')).toBe(`Geçersiz sıralama. Geçerli değerler: ${sorts}.`);
    expect(serverText('errors.validation.storySort', 'en')).toBe(`Invalid sort order. Valid values: ${sorts}.`);
    const presets = PRESET_VOICE_LANGUAGES.join(', ');
    expect(serverText('errors.validation.presetVoiceLanguage', 'tr')).toBe(
      `Geçersiz ses dili. Geçerli diller: ${presets}.`,
    );
    expect(serverText('errors.validation.presetVoiceLanguage', 'en')).toBe(
      `Invalid voice language. Valid languages: ${presets}.`,
    );
  });
});

describe('serverText', () => {
  it('serves a key per language and fills the placeholders', () => {
    expect(serverText('notifications.voiceReady.body', 'tr', { voiceName: 'Annem' })).toBe(
      '"Annem" sesi artık kullanılabilir.',
    );
    expect(serverText('notifications.voiceReady.body', 'en', { voiceName: 'Mom' })).toBe('"Mom" is ready to use.');
  });

  it('falls back to Turkish for a language without texts, and to the key when nobody has it', () => {
    expect(serverText('messages.storyFallbackTitle', 'de')).toBe('Masal');
    expect(serverText('errors.nope.missing', 'en')).toBe('errors.nope.missing');
    expect(serverText('Bir cümle, anahtar değil.', 'en')).toBe('Bir cümle, anahtar değil.');
  });

  it('dates are written per language and localized values pick their language', () => {
    const args = { when: new Date(2026, 10, 1), name: { tr: 'İngilizce', en: 'English' }, n: 3 };
    expect(resolveMessageArgs(args, 'tr')).toEqual({ when: '1 Kasım', name: 'İngilizce', n: 3 });
    expect(resolveMessageArgs(args, 'en')).toEqual({ when: 'November 1', name: 'English', n: 3 });
    expect(resolveMessageArgs(args, 'de')).toEqual({ when: '1 Kasım', name: 'İngilizce', n: 3 });
    expect(resolveMessageArgs(undefined, 'tr')).toEqual({});
  });

  it('interpolate leaves an unknown placeholder alone', () => {
    expect(interpolate('{a} and {b}', { a: 1 })).toBe('1 and {b}');
  });

  it('serverTextInAllLanguages renders the key once per UI language', () => {
    expect(serverTextInAllLanguages('quota.none' as string)).toEqual({ tr: 'quota.none', en: 'quota.none' });
    expect(
      serverTextInAllLanguages('errors.quota.renews', { renewDate: new Date(2026, 10, 1) }),
    ).toEqual({ tr: ' Hakların 1 Kasım tarihinde yenilenir.', en: ' Your allowance renews on November 1.' });
  });

  it('localizedError carries the key and, only when given, the placeholder values', () => {
    expect(localizedError('errors.auth.userNotFound')).toEqual({ message: 'errors.auth.userNotFound' });
    expect(localizedError('errors.voiceSlots.cloneLimit', { limit: 1 })).toEqual({
      message: 'errors.voiceSlots.cloneLimit',
      [MESSAGE_ARGS_FIELD]: { limit: 1 },
    });
  });
});

describe('formatUiDate', () => {
  it('writes day and month per language', () => {
    const date = new Date(2026, 1, 3);
    expect(formatTurkishDate(date)).toBe('3 Şubat');
    expect(formatEnglishDate(date)).toBe('February 3');
    expect(formatUiDate(date, 'en')).toBe('February 3');
    expect(formatUiDate(date, 'tr')).toBe('3 Şubat');
    expect(formatUiDate(date, 'fr')).toBe('3 Şubat');
  });
});
