import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  I18N_LOCALES,
  SETTING_GROUPS,
  SETTINGS_REGISTRY,
  SettingDefinition,
  getSettingDefinition,
  isSettingKey,
  readI18nLocales,
  validateSettingValue,
} from './settings.registry';
import {
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_SPEED_MAX,
  SONIC3_SPEED_MIN,
  SONIC3_VOLUME_MAX,
  SONIC3_VOLUME_MIN,
} from '../tts-providers/cartesia/cartesia-emotions.constants';

// CLAUDE.md UI text rules: no emoji, no em-dash, no AI-signature glyphs.
const FORBIDDEN_UI_CHARS = /[—–…→←•·★✓✔›»⚡]|\p{Extended_Pictographic}/u;

const def = (key: string): SettingDefinition => getSettingDefinition(key)!;
const base: SettingDefinition = {
  key: 'test.key',
  group: 'tts',
  type: 'string',
  envVar: 'TEST_KEY',
  default: 'x',
  label: 'Test',
  description: 'Test',
  unit: null,
};
const message = (d: SettingDefinition, raw: unknown): string => {
  const result = validateSettingValue(d, raw);
  if (result.ok) throw new Error(`expected ${JSON.stringify(raw)} to be rejected`);
  return result.message;
};
const value = (d: SettingDefinition, raw: unknown) => {
  const result = validateSettingValue(d, raw);
  if (result.ok === false) throw new Error(result.message);
  return result.value;
};

describe('content language settings', () => {
  const enabled = getSettingDefinition('content.enabledLanguages')!;
  const fallback = getSettingDefinition('content.defaultLanguage')!;

  it('are registered in the "content" group with Turkish as the code default', () => {
    expect(enabled).toMatchObject({
      group: 'content',
      type: 'stringList',
      envVar: 'CONTENT_ENABLED_LANGUAGES',
      default: ['tr'],
    });
    expect(fallback).toMatchObject({
      group: 'content',
      type: 'enum',
      envVar: 'CONTENT_DEFAULT_LANGUAGE',
      default: 'tr',
    });
    expect(SETTING_GROUPS.map((g) => g.id)).toEqual(['rateLimit', 'i18n', 'content', 'llm', 'tts']);
    expect(SETTING_GROUPS.find((g) => g.id === 'content')!.label).toBe('İçerik dilleri');
  });

  it('both only accept codes of CONTENT_LANGUAGES', () => {
    const codes = ['tr', 'en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'ar', 'ru'];
    expect(enabled.options).toEqual(codes);
    expect(fallback.options).toEqual(codes);
  });

  it('enabledLanguages: a subset as a list or as the comma separated environment form', () => {
    expect(validateSettingValue(enabled, ['tr', 'en'])).toEqual({ ok: true, value: ['tr', 'en'] });
    expect(validateSettingValue(enabled, 'tr, en ,de')).toEqual({ ok: true, value: ['tr', 'en', 'de'] });
    expect(validateSettingValue(enabled, ['tr', 'tr'])).toEqual({ ok: true, value: ['tr'] });
  });

  it('enabledLanguages: rejects a language outside the list, naming the key', () => {
    const result = validateSettingValue(enabled, ['tr', 'da']);
    expect(result).toEqual({
      ok: false,
      message:
        '"content.enabledLanguages" ayarı içindeki "da" öğesi geçerli değil. Geçerli değerler: tr, en, de, fr, es, it, nl, pt, ar, ru.',
    });
    expect(validateSettingValue(enabled, 5).ok).toBe(false);
  });

  it('defaultLanguage: one listed code, case-insensitive', () => {
    expect(validateSettingValue(fallback, 'en')).toEqual({ ok: true, value: 'en' });
    expect(validateSettingValue(fallback, 'EN')).toEqual({ ok: true, value: 'en' });
    expect(validateSettingValue(fallback, 'da').ok).toBe(false);
  });
});

describe('settings registry', () => {
  it('registers exactly the agreed settings', () => {
    expect(SETTINGS_REGISTRY.map((d) => d.key)).toEqual([
      'rateLimit.ttl',
      'rateLimit.limit',
      'i18n.defaultLocale',
      'i18n.fallbackLocale',
      'content.enabledLanguages',
      'content.defaultLanguage',
      'llm.gemini.model',
      'llm.gemini.temperature',
      'llm.gemini.thinkingBudget',
      'llm.gemini.timeoutMs',
      'llm.autoAssessLevel',
      'llm.autoAssessAgeGroup',
      'tts.defaultProvider',
      'tts.google.speakingRate',
      'tts.google.pitch',
      'tts.cloneLanguages',
      'tts.cartesia.model',
      'tts.cartesia.defaultSpeed',
      'tts.cartesia.defaultVolume',
      'tts.cartesia.defaultEmotion',
      'tts.groupSegments',
      'tts.sharePresetAudio',
    ]);
  });

  it('never registers a secret, a URL or the Cartesia API version', () => {
    for (const d of SETTINGS_REGISTRY) {
      expect(`${d.key} ${d.envVar}`).not.toMatch(/KEY|SECRET|TOKEN|PASSWORD|URL|HOST|VERSION|DATABASE|REDIS|JWT|CORS/i);
    }
  });

  it('every definition is complete, unique and passes its own validation', () => {
    const groups = SETTING_GROUPS.map((g) => g.id);
    expect(new Set(SETTINGS_REGISTRY.map((d) => d.key)).size).toBe(SETTINGS_REGISTRY.length);
    expect(new Set(SETTINGS_REGISTRY.map((d) => d.envVar)).size).toBe(SETTINGS_REGISTRY.length);

    for (const d of SETTINGS_REGISTRY) {
      expect(groups).toContain(d.group);
      expect(d.key.startsWith(`${d.group}.`)).toBe(true);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
      expect(validateSettingValue(d, d.default)).toEqual({ ok: true, value: d.default });
      if (d.type === 'enum') expect(d.options?.length).toBeGreaterThan(0);
      if (d.type === 'int' || d.type === 'float') {
        expect(typeof d.min).toBe('number');
        expect(typeof d.max).toBe('number');
      }
    }
  });

  it('Turkish copy follows the UI text rules', () => {
    const texts = [
      ...SETTING_GROUPS.flatMap((g) => [g.label, g.description]),
      ...SETTINGS_REGISTRY.flatMap((d) => [d.label, d.description, d.unit ?? '', d.patternHint ?? '']),
    ];
    for (const text of texts) expect(text).not.toMatch(FORBIDDEN_UI_CHARS);
  });

  it('rate limit keeps the previous hardcoded behaviour (300 per 60 s) and ignores the stale THROTTLE_* names', () => {
    expect(def('rateLimit.ttl')).toMatchObject({ default: 60, unit: 'saniye', envVar: 'RATE_LIMIT_TTL_SECONDS' });
    expect(def('rateLimit.limit')).toMatchObject({ default: 300, min: 30, envVar: 'RATE_LIMIT_MAX_REQUESTS' });
    expect(SETTINGS_REGISTRY.map((d) => d.envVar)).not.toEqual(
      expect.arrayContaining(['THROTTLE_TTL', 'THROTTLE_LIMIT']),
    );
  });

  it('locale settings default to tr and offer the locales that have files', () => {
    expect([...I18N_LOCALES]).toEqual(['en', 'tr']);
    for (const key of ['i18n.defaultLocale', 'i18n.fallbackLocale']) {
      expect(def(key).default).toBe('tr');
      expect(def(key).options).toEqual(['en', 'tr']);
    }
  });

  it('provider ranges match the provider APIs', () => {
    expect(def('tts.google.speakingRate')).toMatchObject({ min: 0.25, max: 2, default: 0.92 });
    expect(def('tts.google.pitch')).toMatchObject({ min: -20, max: 20, default: -2 });
    expect(def('tts.cartesia.defaultSpeed')).toMatchObject({ min: SONIC3_SPEED_MIN, max: SONIC3_SPEED_MAX });
    expect(def('tts.cartesia.defaultVolume')).toMatchObject({ min: SONIC3_VOLUME_MIN, max: SONIC3_VOLUME_MAX });
    expect(def('tts.cartesia.defaultEmotion').options).toBe(SONIC3_EXTENDED_EMOTIONS);
    expect(def('tts.defaultProvider').options).toEqual(['google', 'cartesia']);
    expect(def('llm.gemini.temperature')).toMatchObject({ min: 0, max: 2 });
  });

  it('lookup helpers', () => {
    expect(isSettingKey('llm.gemini.model')).toBe(true);
    expect(isSettingKey('llm.gemini.apiKey')).toBe(false);
    expect(getSettingDefinition('nope')).toBeUndefined();
  });

  describe('readI18nLocales', () => {
    it('lists the directories, sorted, ignoring files', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesly-i18n-'));
      try {
        fs.mkdirSync(path.join(dir, 'tr'));
        fs.mkdirSync(path.join(dir, 'de'));
        fs.writeFileSync(path.join(dir, 'README.md'), 'x');
        expect(readI18nLocales(dir)).toEqual(['de', 'tr']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('falls back to en + tr when the folder is empty or missing', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sesly-i18n-'));
      try {
        expect(readI18nLocales(dir)).toEqual(['en', 'tr']);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      expect(readI18nLocales(path.join(dir, 'missing'))).toEqual(['en', 'tr']);
    });
  });
});

describe('validateSettingValue', () => {
  describe('numbers', () => {
    it('accepts numbers and numeric strings inside the range', () => {
      expect(value(def('llm.gemini.temperature'), 0.35)).toBe(0.35);
      expect(value(def('llm.gemini.temperature'), ' 1.5 ')).toBe(1.5);
      expect(value(def('llm.gemini.thinkingBudget'), -1)).toBe(-1);
      expect(value(def('rateLimit.limit'), '500')).toBe(500);
      expect(value(def('tts.google.speakingRate'), 0.25)).toBe(0.25);
      expect(value(def('tts.google.speakingRate'), 2)).toBe(2);
    });

    it.each([
      ['tts.google.speakingRate', 2.01],
      ['tts.google.speakingRate', 0.2],
      ['tts.google.speakingRate', 4],
      ['tts.cartesia.defaultSpeed', 0.59],
      ['tts.cartesia.defaultSpeed', 1.51],
      ['tts.cartesia.defaultVolume', 0.4],
      ['tts.cartesia.defaultVolume', 2.1],
      ['llm.gemini.temperature', -0.1],
      ['llm.gemini.timeoutMs', 1000],
      ['rateLimit.limit', 10],
      ['rateLimit.ttl', 0],
    ])('%s rejects out-of-range %p with a Turkish message naming the key and the range', (key, raw) => {
      const d = def(key);
      expect(message(d, raw)).toBe(`"${key}" ayarı ${d.min} ile ${d.max} arasında olmalıdır.`);
    });

    it.each([['abc'], [''], ['   '], [null], [undefined], [Number.NaN], [Number.POSITIVE_INFINITY], [true], [{}], [[1]]])(
      'rejects non-numeric %p',
      (raw) => {
        expect(message(def('llm.gemini.temperature'), raw)).toBe('"llm.gemini.temperature" ayarı sayı olmalıdır.');
      },
    );

    it('int settings reject fractions', () => {
      expect(message(def('rateLimit.limit'), 300.5)).toBe('"rateLimit.limit" ayarı tam sayı olmalıdır.');
      expect(message(def('llm.gemini.thinkingBudget'), '1.5')).toBe(
        '"llm.gemini.thinkingBudget" ayarı tam sayı olmalıdır.',
      );
    });

    it('one-sided bounds get their own message; no bounds accept anything finite', () => {
      const minOnly: SettingDefinition = { ...base, type: 'int', default: 1, min: 1 };
      const maxOnly: SettingDefinition = { ...base, type: 'float', default: 1, max: 5 };
      const free: SettingDefinition = { ...base, type: 'float', default: 1 };
      expect(message(minOnly, 0)).toBe('"test.key" ayarı en az 1 olmalıdır.');
      expect(value(minOnly, 10_000)).toBe(10_000);
      expect(message(maxOnly, 5.5)).toBe('"test.key" ayarı en fazla 5 olmalıdır.');
      expect(value(maxOnly, -100)).toBe(-100);
      expect(value(free, -1e9)).toBe(-1e9);
    });
  });

  describe('enum', () => {
    it('accepts an option, case-insensitively (environment values are often upper case)', () => {
      expect(value(def('tts.defaultProvider'), 'google')).toBe('google');
      expect(value(def('tts.defaultProvider'), ' CARTESIA ')).toBe('cartesia');
      expect(value(def('tts.cartesia.defaultEmotion'), 'calm')).toBe('calm');
      expect(value(def('i18n.fallbackLocale'), 'EN')).toBe('en');
    });

    it('lists the options when there are few, names the value when there are many', () => {
      expect(message(def('tts.defaultProvider'), 'elevenlabs')).toBe(
        '"tts.defaultProvider" ayarı şu değerlerden biri olmalıdır: google, cartesia.',
      );
      expect(message(def('i18n.defaultLocale'), 'de')).toBe(
        '"i18n.defaultLocale" ayarı şu değerlerden biri olmalıdır: en, tr.',
      );
      expect(message(def('tts.cartesia.defaultEmotion'), 'grumpy')).toBe(
        '"tts.cartesia.defaultEmotion" ayarı için "grumpy" geçerli bir değer değil.',
      );
    });

    it('rejects non-strings and a definition without options', () => {
      expect(message(def('tts.defaultProvider'), 1)).toContain('şu değerlerden biri olmalıdır');
      expect(message({ ...base, type: 'enum' }, 'x')).toBe('"test.key" ayarı şu değerlerden biri olmalıdır: .');
    });
  });

  describe('string', () => {
    it('trims and accepts model ids', () => {
      expect(value(def('llm.gemini.model'), '  gemini-3.8-flash ')).toBe('gemini-3.8-flash');
      expect(value(def('tts.cartesia.model'), 'sonic-3.6-2026-08-27')).toBe('sonic-3.6-2026-08-27');
    });

    it.each([
      ['', '"llm.gemini.model" ayarı boş olamaz.'],
      ['   ', '"llm.gemini.model" ayarı boş olamaz.'],
      ['a'.repeat(101), '"llm.gemini.model" ayarı en fazla 100 karakter olabilir.'],
      [
        'gemini x/beta',
        '"llm.gemini.model" ayarı geçersiz biçimde (yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir).',
      ],
      [
        '../v1/secret',
        '"llm.gemini.model" ayarı geçersiz biçimde (yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir).',
      ],
    ])('rejects %p', (raw, expected) => {
      expect(message(def('llm.gemini.model'), raw)).toBe(expected);
    });

    it('rejects non-strings; pattern without a hint and no constraints at all', () => {
      expect(message(def('llm.gemini.model'), 42)).toBe('"llm.gemini.model" ayarı metin olmalıdır.');
      expect(message({ ...base, pattern: /^a+$/ }, 'b')).toBe('"test.key" ayarı geçersiz biçimde.');
      expect(value(base, 'anything goes')).toBe('anything goes');
    });
  });

  describe('boolean', () => {
    const flag: SettingDefinition = { ...base, type: 'boolean', default: false };

    it.each([
      [true, true],
      [false, false],
      ['true', true],
      [' TRUE ', true],
      ['1', true],
      ['false', false],
      ['0', false],
    ])('%p -> %p', (raw, expected) => {
      expect(value(flag, raw)).toBe(expected);
    });

    it.each([['yes'], [1], [null], [undefined]])('rejects %p', (raw) => {
      expect(message(flag, raw)).toBe('"test.key" ayarı açık ya da kapalı olmalıdır.');
    });
  });

  describe('stringList', () => {
    const list: SettingDefinition = { ...base, type: 'stringList', default: ['tr'], options: ['en', 'tr', 'de'] };
    const freeList: SettingDefinition = { ...base, type: 'stringList', default: [], maxLength: 3, pattern: /^[a-z]+$/ };

    it('accepts arrays and the comma separated environment form, trimmed and de-duplicated', () => {
      expect(value(list, ['tr', 'en', 'tr'])).toEqual(['tr', 'en']);
      expect(value(list, 'en, tr ,en')).toEqual(['en', 'tr']);
      expect(value(list, [])).toEqual([]);
      expect(value(freeList, ['ab', 'abc'])).toEqual(['ab', 'abc']);
    });

    it('rejects a non-list, non-string items, items outside the options and malformed items', () => {
      expect(message(list, 5)).toBe('"test.key" ayarı bir liste olmalıdır.');
      expect(message(list, ['tr', 5])).toBe('"test.key" ayarı yalnızca metin öğeleri içerebilir.');
      expect(message(list, ['tr', 'fr'])).toBe(
        '"test.key" ayarı içindeki "fr" öğesi geçerli değil. Geçerli değerler: en, tr, de.',
      );
      expect(message(freeList, ['abcd'])).toBe('"test.key" ayarı içindeki "abcd" öğesi en fazla 3 karakter olabilir.');
      expect(message(freeList, ['A1'])).toBe('"test.key" ayarı içindeki "A1" öğesi geçersiz biçimde.');
      expect(message(freeList, 'ab,,c')).toBe('"test.key" ayarı içindeki "" öğesi boş olamaz.');
    });
  });
});
