import * as fs from 'fs';
import * as path from 'path';
import {
  SONIC3_EMOTION_LABELS_TR,
  SONIC3_EXTENDED_EMOTIONS,
} from '../tts-providers/cartesia/cartesia-emotions.constants';
import {
  CONTENT_LANGUAGES,
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_TURKISH_NAMES,
  DEFAULT_CONTENT_LANGUAGE,
} from '../../common/constants/content-languages';
import { VOICE_LANGUAGES, VOICE_LANGUAGE_CODES } from '../../common/constants/voice-languages';

/**
 * Typed registry of every runtime setting the admin panel can change.
 *
 * Resolution order at read time (SettingsService.get):
 *   1. database override (table system_settings, written from the panel)
 *   2. environment variable named in `envVar`
 *   3. the code default below
 *
 * DELIBERATELY NOT SETTINGS, environment only:
 *   - every API key and secret (GEMINI_API_KEY, CARTESIA_API_KEY, JWT_*,
 *     store credentials, RESEND_API_KEY, Firebase / Google credentials)
 *   - every URL (GEMINI_API_URL, CARTESIA_API_URL, FRONTEND_URL, ...)
 *   - CARTESIA_VERSION (the request/response shapes in cartesia-tts.service
 *     are written against one dated API version; it changes with the code)
 *   - database, Redis, CORS and storage configuration
 * A compromised admin account must not be able to read a secret or point a
 * keyed request at another host. Do not add any of these here.
 */

export type SettingType = 'int' | 'float' | 'string' | 'enum' | 'boolean' | 'stringList';
export type SettingValue = number | string | boolean | string[];
export type SettingGroup = 'rateLimit' | 'i18n' | 'content' | 'llm' | 'tts';

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  type: SettingType;
  /** Environment variable used when the panel has no override. */
  envVar: string;
  /** Code default, used when neither the panel nor the environment has a valid value. */
  default: SettingValue;
  /** Turkish label shown in the admin panel. */
  label: string;
  /** Turkish description shown in the admin panel. */
  description: string;
  /** Turkish unit label, or null when the value has no unit. */
  unit: string | null;
  /** Inclusive bounds for int / float. */
  min?: number;
  max?: number;
  /** UI increment hint for number inputs. Not enforced by validation. */
  step?: number;
  /** Allowed values for enum, allowed items for stringList. */
  options?: readonly string[];
  /**
   * Turkish display name of each option, shown in the admin panel instead
   * of the raw value. An option without an entry is shown as its value.
   */
  optionLabels?: Readonly<Record<string, string>>;
  /** Shape a string value (or each stringList item) must match. */
  pattern?: RegExp;
  /** Human description of `pattern` for the error message (Turkish). */
  patternHint?: string;
  /** Longest accepted string / list item. */
  maxLength?: number;
}

/** Turkish titles for the groups, in display order. */
export const SETTING_GROUPS: ReadonlyArray<{ id: SettingGroup; label: string; description: string }> = [
  {
    id: 'rateLimit',
    label: 'İstek sınırı',
    description: 'Bir kullanıcının ya da IP adresinin tek bir uç noktaya gönderebileceği istek sayısı.',
  },
  {
    id: 'i18n',
    label: 'Dil',
    description: 'API hata mesajlarının hangi dilde döneceği.',
  },
  {
    id: 'content',
    label: 'İçerik dilleri',
    description: 'Masalların hangi dillerde sunulacağı. Arayüz ve hata mesajı dilinden bağımsızdır.',
  },
  {
    id: 'llm',
    label: 'Yapay zeka (Gemini)',
    description:
      'Hikaye metnini bölümlere ayıran, çeviren, dil seviyesini ve yaş grubunu belirleyen modelin ayarları.',
  },
  {
    id: 'tts',
    label: 'Seslendirme',
    description: 'Google ve Cartesia ses üretimi ayarları.',
  },
];

const FALLBACK_LOCALES = ['en', 'tr'];

/** Locales that have a translation folder under src/i18n (dist/i18n at runtime). */
export function readI18nLocales(dir: string = path.join(__dirname, '..', '..', 'i18n')): string[] {
  try {
    const found = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    return found.length > 0 ? found : FALLBACK_LOCALES;
  } catch {
    return FALLBACK_LOCALES;
  }
}

export const I18N_LOCALES: readonly string[] = readI18nLocales();

/**
   * Content languages as the panel names them: the Turkish name, with the
   * name the language gives itself when that differs ("İngilizce (English)").
   */
export const CONTENT_LANGUAGE_OPTION_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  CONTENT_LANGUAGES.map((language) => {
    const turkish = CONTENT_LANGUAGE_TURKISH_NAMES[language.code];
    return [
      language.code,
      turkish === language.nativeName ? turkish : `${turkish} (${language.nativeName})`,
    ];
  }),
);

/** Locales of the API messages. A locale folder without an entry is shown by its code. */
export const I18N_LOCALE_OPTION_LABELS: Readonly<Record<string, string>> = {
  tr: 'Türkçe',
  en: 'İngilizce',
};

/** Clone languages as the panel names them, same style as the content languages. */
export const VOICE_LANGUAGE_OPTION_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  VOICE_LANGUAGES.map((language) => [
    language.code,
    language.turkishName === language.nativeName
      ? language.turkishName
      : `${language.turkishName} (${language.nativeName})`,
  ]),
);

export const TTS_PROVIDER_OPTION_LABELS: Readonly<Record<string, string>> = {
  google: 'Google Cloud TTS',
  cartesia: 'Cartesia Sonic',
};

const MODEL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODEL_ID_HINT = 'yalnızca harf, rakam, nokta, tire ve alt çizgi içerebilir';

const definitions = [
  // ---------- Rate limiting ----------
  // The legacy THROTTLE_TTL / THROTTLE_LIMIT variables were never read by the
  // code (the throttler was hardcoded to 300 requests per 60 s) and production
  // still carries a stale THROTTLE_LIMIT=10, which would lock out the mobile
  // app's status polling. They are therefore NOT used as the fallback; the
  // new variable names below are.
  {
    key: 'rateLimit.ttl',
    group: 'rateLimit',
    type: 'int',
    envVar: 'RATE_LIMIT_TTL_SECONDS',
    default: 60,
    min: 10,
    max: 3600,
    step: 1,
    unit: 'saniye',
    label: 'Sınır penceresi',
    description:
      'İsteklerin sayıldığı süre. Sınır her uç nokta ve her kullanıcı (ya da IP) için ayrı tutulur. Kendi sınırı olan uç noktalar (ses yükleme gibi) bundan etkilenmez.',
  },
  {
    key: 'rateLimit.limit',
    group: 'rateLimit',
    type: 'int',
    envVar: 'RATE_LIMIT_MAX_REQUESTS',
    default: 300,
    min: 30,
    max: 10000,
    step: 10,
    unit: 'istek',
    label: 'Pencere başına istek',
    description:
      'Bir pencere içinde tek bir uç noktaya izin verilen istek sayısı. Mobil uygulama durum sorgularını birkaç saniyede bir yaptığı için çok düşük değerler uygulamayı bozar.',
  },

  // ---------- i18n ----------
  {
    key: 'i18n.defaultLocale',
    group: 'i18n',
    type: 'enum',
    optionLabels: I18N_LOCALE_OPTION_LABELS,
    envVar: 'DEFAULT_LOCALE',
    default: 'tr',
    options: I18N_LOCALES,
    unit: null,
    label: 'Varsayılan dil',
    description: 'İstek bir dil belirtmediğinde (Accept-Language başlığı yoksa) kullanılan dil.',
  },
  {
    key: 'i18n.fallbackLocale',
    group: 'i18n',
    type: 'enum',
    optionLabels: I18N_LOCALE_OPTION_LABELS,
    envVar: 'FALLBACK_LOCALE',
    default: 'tr',
    options: I18N_LOCALES,
    unit: null,
    label: 'Yedek dil',
    description: 'İstenen dil desteklenmiyorsa ya da o dilde çeviri eksikse kullanılan dil.',
  },

  // ---------- Content languages ----------
  // Read through resolveContentLanguages() (stories/content-language.ts),
  // which keeps the pair consistent: an empty list falls back to Turkish and
  // a default that is not enabled falls back to the first enabled language.
  {
    key: 'content.enabledLanguages',
    optionLabels: CONTENT_LANGUAGE_OPTION_LABELS,
    group: 'content',
    type: 'stringList',
    envVar: 'CONTENT_ENABLED_LANGUAGES',
    default: [DEFAULT_CONTENT_LANGUAGE] as string[],
    options: CONTENT_LANGUAGE_CODES,
    unit: null,
    label: 'Açık içerik dilleri',
    description:
      'Uygulamada sunulan masal dilleri. Listede olmayan bir dildeki masallar yayınlanmış olsa bile listelenmez. Boş bırakılırsa yalnızca Türkçe sunulur.',
  },
  {
    key: 'content.defaultLanguage',
    optionLabels: CONTENT_LANGUAGE_OPTION_LABELS,
    group: 'content',
    type: 'enum',
    envVar: 'CONTENT_DEFAULT_LANGUAGE',
    default: DEFAULT_CONTENT_LANGUAGE,
    options: CONTENT_LANGUAGE_CODES,
    unit: null,
    label: 'Varsayılan içerik dili',
    description:
      'İstek bir içerik dili belirtmediğinde gösterilen masalların dili. Eski uygulama sürümleri dil göndermediği için bu dili görür. Açık diller arasında değilse ilk açık dil kullanılır.',
  },

  // ---------- LLM (Gemini) ----------
  {
    key: 'llm.gemini.model',
    group: 'llm',
    type: 'string',
    envVar: 'GEMINI_MODEL',
    default: 'gemini-3-flash-preview',
    pattern: MODEL_ID_PATTERN,
    patternHint: MODEL_ID_HINT,
    maxLength: 100,
    unit: null,
    label: 'Gemini modeli',
    description: 'Hikayeyi bölümlere ayıran ve duygu etiketleyen model. Listede olmayan bir model adı elle de yazılabilir.',
  },
  {
    key: 'llm.gemini.temperature',
    group: 'llm',
    type: 'float',
    envVar: 'GEMINI_TEMPERATURE',
    default: 0.2,
    min: 0,
    max: 2,
    step: 0.05,
    unit: null,
    label: 'Sıcaklık',
    description: 'Düşük değer daha tutarlı, yüksek değer daha değişken çıktı verir. Bölümleme için düşük tutulmalıdır.',
  },
  {
    key: 'llm.gemini.thinkingBudget',
    group: 'llm',
    type: 'int',
    envVar: 'GEMINI_THINKING_BUDGET',
    default: 0,
    min: -1,
    max: 32768,
    step: 1,
    unit: 'token',
    label: 'Düşünme bütçesi',
    description: '0 düşünmeyi kapatır, -1 modelin kendisinin karar vermesini sağlar, pozitif değer sabit bütçedir.',
  },
  {
    key: 'llm.gemini.timeoutMs',
    group: 'llm',
    type: 'int',
    envVar: 'GEMINI_TIMEOUT_MS',
    default: 120000,
    min: 5000,
    max: 600000,
    step: 1000,
    unit: 'ms',
    label: 'Zaman aşımı',
    description: 'Gemini yanıtı bu süre içinde gelmezse istek iptal edilir.',
  },
  {
    key: 'llm.autoAssessLevel',
    group: 'llm',
    type: 'boolean',
    envVar: 'LLM_AUTO_ASSESS_LEVEL',
    default: true,
    unit: null,
    label: 'Dil seviyesini otomatik belirle',
    description:
      'Açıkken bir masal eklendiğinde, metni değiştiğinde, çevrildiğinde ya da tohumlandığında dil seviyesi (A1-C2) arka planda yapay zeka ile belirlenir. Elle girilen seviyelere dokunulmaz. Kapalıyken yalnızca panelden başlatılan değerlendirmeler çalışır.',
  },
  {
    key: 'llm.autoAssessAgeGroup',
    group: 'llm',
    type: 'boolean',
    envVar: 'LLM_AUTO_ASSESS_AGE_GROUP',
    default: true,
    unit: null,
    label: 'Yaş grubunu otomatik belirle',
    description:
      'Açıkken yaş grubu seçilmeden eklenen bir masalın yaş grubu arka planda yapay zeka ile belirlenir. Metni değişen bir masalın yaş grubu yalnızca daha önce yapay zeka belirlediyse yeniden değerlendirilir. Elle seçilen ya da kaynağı kayıtlı olmayan yaş gruplarına dokunulmaz. Kapalıyken yalnızca panelden başlatılan değerlendirmeler çalışır.',
  },

  // ---------- TTS ----------
  {
    key: 'tts.defaultProvider',
    optionLabels: TTS_PROVIDER_OPTION_LABELS,
    group: 'tts',
    type: 'enum',
    envVar: 'TTS_PROVIDER',
    default: 'cartesia',
    options: ['google', 'cartesia'],
    unit: null,
    label: 'Varsayılan sağlayıcı',
    description: 'Ses profili bir sağlayıcı belirtmediğinde kullanılan seslendirme sağlayıcısı.',
  },
  {
    key: 'tts.google.speakingRate',
    group: 'tts',
    type: 'float',
    envVar: 'TTS_GOOGLE_SPEAKING_RATE',
    default: 0.92,
    min: 0.25,
    max: 2,
    step: 0.01,
    unit: 'x',
    label: 'Google konuşma hızı',
    description: '1.0 normal hızdır. Masal anlatımı için biraz yavaş tutulur. Değişince hazır ses önizlemeleri yeniden üretilir.',
  },
  {
    key: 'tts.google.pitch',
    group: 'tts',
    type: 'float',
    envVar: 'TTS_GOOGLE_PITCH',
    default: -2,
    min: -20,
    max: 20,
    step: 0.5,
    unit: 'yarım ton',
    label: 'Google ses perdesi',
    description: 'Negatif değer sesi kalınlaştırır, pozitif değer inceltir. Chirp 3 HD hazır sesleri perde ayarını desteklemez, bu ayar onlara uygulanmaz.',
  },
  // Read through resolveCloneLanguages() (voice-profiles/clone-languages.ts):
  // an empty list falls back to Turkish.
  {
    key: 'tts.cloneLanguages',
    optionLabels: VOICE_LANGUAGE_OPTION_LABELS,
    group: 'tts',
    type: 'stringList',
    envVar: 'VOICE_CLONE_LANGUAGES',
    default: [...VOICE_LANGUAGE_CODES] as string[],
    options: VOICE_LANGUAGE_CODES,
    unit: null,
    label: 'Ses klonlama dilleri',
    description:
      'Kullanıcının kendi sesini kaydederken seçebileceği konuşma dilleri. Okuma metni ve açık rıza metni seçilen dilde gösterilir. Bir dili açmadan önce o dildeki açık rıza metninin hukuki incelemeden geçtiğinden emin olun. Boş bırakılırsa yalnızca Türkçe sunulur.',
  },
  {
    key: 'tts.cartesia.model',
    group: 'tts',
    type: 'string',
    envVar: 'CARTESIA_MODEL',
    default: 'sonic-3.6',
    pattern: MODEL_ID_PATTERN,
    patternHint: MODEL_ID_HINT,
    maxLength: 100,
    unit: null,
    label: 'Cartesia modeli',
    description: 'Klon seslerle seslendirme yapan model. Bir gerileme görülürse tarihli bir sürüm (ör. sonic-3.6-2026-08-27) sabitlenebilir.',
  },
  {
    key: 'tts.cartesia.defaultSpeed',
    group: 'tts',
    type: 'float',
    envVar: 'CARTESIA_DEFAULT_SPEED',
    default: 0.85,
    min: 0.6,
    max: 1.5,
    step: 0.05,
    unit: 'x',
    label: 'Cartesia varsayılan hız',
    description: 'Bölüm kendi hızını belirtmediğinde kullanılır. 1.0 normal hızdır.',
  },
  {
    key: 'tts.cartesia.defaultVolume',
    group: 'tts',
    type: 'float',
    envVar: 'CARTESIA_DEFAULT_VOLUME',
    default: 1,
    min: 0.5,
    max: 2,
    step: 0.05,
    unit: 'x',
    label: 'Cartesia varsayılan ses düzeyi',
    description: 'Bölüm kendi ses düzeyini belirtmediğinde kullanılır. 1.0 normal düzeydir.',
  },
  {
    key: 'tts.cartesia.defaultEmotion',
    optionLabels: SONIC3_EMOTION_LABELS_TR,
    group: 'tts',
    type: 'enum',
    envVar: 'CARTESIA_DEFAULT_EMOTION',
    default: 'neutral',
    options: SONIC3_EXTENDED_EMOTIONS,
    unit: null,
    label: 'Cartesia varsayılan duygu',
    description: 'Bölüm bir duygu belirtmediğinde kullanılan duygu.',
  },
  {
    key: 'tts.groupSegments',
    group: 'tts',
    type: 'boolean',
    envVar: 'TTS_GROUP_SEGMENTS',
    default: true,
    unit: null,
    label: 'Bölümleri birleştirerek seslendir',
    description:
      'Açıkken art arda gelen bölümler tek istekte seslendirilir: Cartesia aynı duygudaki bölümleri (hız ve ara etiketleriyle), Google 4500 bayta kadar bütün bölümleri birleştirir. Daha az istek ve daha az ek yeri olur, ücret değişmez (karakter başına). Kapalıyken her bölüm ayrı istektir (eski davranış).',
  },
  {
    key: 'tts.sharePresetAudio',
    group: 'tts',
    type: 'boolean',
    envVar: 'TTS_SHARE_PRESET_AUDIO',
    default: true,
    unit: null,
    label: 'Hazır ses seslendirmelerini paylaş',
    description:
      'Açıkken aynı masal, aynı segment sürümü, aynı hazır ses ve aynı Google ayarlarıyla istenen seslendirme bir kez üretilir ve bütün kullanıcılar aynı ses dosyasını dinler (her kullanıcının kendi seslendirme kaydı ve kotası ayrı kalır). Klon sesler hiçbir zaman paylaşılmaz. Kapalıyken her kullanıcının seslendirmesi ayrı üretilir (eski davranış); var olan paylaşılan sesler dinlenmeye devam eder.',
  },
] as const satisfies ReadonlyArray<SettingDefinition>;

export const SETTINGS_REGISTRY: ReadonlyArray<SettingDefinition> = definitions;

export type SettingKey = (typeof definitions)[number]['key'];

/** Value type of each setting, so `settings.get('rateLimit.ttl')` is a number. */
export interface SettingValueMap {
  'rateLimit.ttl': number;
  'rateLimit.limit': number;
  'i18n.defaultLocale': string;
  'i18n.fallbackLocale': string;
  'content.enabledLanguages': string[];
  'content.defaultLanguage': string;
  'llm.gemini.model': string;
  'llm.gemini.temperature': number;
  'llm.gemini.thinkingBudget': number;
  'llm.gemini.timeoutMs': number;
  'llm.autoAssessLevel': boolean;
  'llm.autoAssessAgeGroup': boolean;
  'tts.defaultProvider': 'google' | 'cartesia';
  'tts.google.speakingRate': number;
  'tts.google.pitch': number;
  'tts.cloneLanguages': string[];
  'tts.cartesia.model': string;
  'tts.cartesia.defaultSpeed': number;
  'tts.cartesia.defaultVolume': number;
  'tts.cartesia.defaultEmotion': string;
  'tts.groupSegments': boolean;
  'tts.sharePresetAudio': boolean;
}

/** Options of a setting with their Turkish display names, or null when it has none. */
export function settingOptionLabels(
  def: Pick<SettingDefinition, 'options' | 'optionLabels'>,
): Array<{ value: string; label: string }> | null {
  if (!def.options) return null;
  return def.options.map((value) => ({ value, label: def.optionLabels?.[value] ?? value }));
}

const BY_KEY = new Map<string, SettingDefinition>(SETTINGS_REGISTRY.map((def) => [def.key, def]));

export function getSettingDefinition(key: string): SettingDefinition | undefined {
  return BY_KEY.get(key);
}

export function isSettingKey(key: string): key is SettingKey {
  return BY_KEY.has(key);
}

export type SettingValidation =
  | { ok: true; value: SettingValue }
  | { ok: false; message: string };

const fail = (message: string): SettingValidation => ({ ok: false, message });

function toNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function checkText(def: SettingDefinition, value: string, what: string): string | null {
  if (value.length === 0) return `${what} boş olamaz.`;
  if (def.maxLength !== undefined && value.length > def.maxLength) {
    return `${what} en fazla ${def.maxLength} karakter olabilir.`;
  }
  if (def.pattern && !def.pattern.test(value)) {
    return `${what} geçersiz biçimde${def.patternHint ? ` (${def.patternHint})` : ''}.`;
  }
  return null;
}

/**
 * Validate and normalise one raw value (from the panel, a database row or an
 * environment variable) against its definition. Error messages are Turkish
 * and always name the key, because the panel shows them verbatim.
 */
export function validateSettingValue(def: SettingDefinition, raw: unknown): SettingValidation {
  const name = `"${def.key}" ayarı`;

  switch (def.type) {
    case 'int':
    case 'float': {
      const value = toNumber(raw);
      if (value === null) return fail(`${name} sayı olmalıdır.`);
      if (def.type === 'int' && !Number.isInteger(value)) return fail(`${name} tam sayı olmalıdır.`);
      if (def.min !== undefined && def.max !== undefined && (value < def.min || value > def.max)) {
        return fail(`${name} ${def.min} ile ${def.max} arasında olmalıdır.`);
      }
      if (def.min !== undefined && value < def.min) return fail(`${name} en az ${def.min} olmalıdır.`);
      if (def.max !== undefined && value > def.max) return fail(`${name} en fazla ${def.max} olmalıdır.`);
      return { ok: true, value };
    }

    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (typeof raw === 'string') {
        const text = raw.trim().toLowerCase();
        if (text === 'true' || text === '1') return { ok: true, value: true };
        if (text === 'false' || text === '0') return { ok: true, value: false };
      }
      return fail(`${name} açık ya da kapalı olmalıdır.`);
    }

    case 'enum': {
      const options = def.options ?? [];
      if (typeof raw !== 'string') return fail(`${name} şu değerlerden biri olmalıdır: ${options.join(', ')}.`);
      const text = raw.trim();
      // Environment values are often upper case (TTS_PROVIDER=CARTESIA).
      const match = options.find((option) => option === text) ??
        options.find((option) => option.toLowerCase() === text.toLowerCase());
      if (match === undefined) {
        return fail(
          options.length > 12
            ? `${name} için "${text}" geçerli bir değer değil.`
            : `${name} şu değerlerden biri olmalıdır: ${options.join(', ')}.`,
        );
      }
      return { ok: true, value: match };
    }

    case 'string': {
      if (typeof raw !== 'string') return fail(`${name} metin olmalıdır.`);
      const text = raw.trim();
      const problem = checkText(def, text, name);
      return problem ? fail(problem) : { ok: true, value: text };
    }

    case 'stringList': {
      // The environment form is a comma separated string.
      const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null;
      if (items === null) return fail(`${name} bir liste olmalıdır.`);
      const cleaned: string[] = [];
      for (const item of items) {
        if (typeof item !== 'string') return fail(`${name} yalnızca metin öğeleri içerebilir.`);
        const text = item.trim();
        const problem = checkText(def, text, `${name} içindeki "${text}" öğesi`);
        if (problem) return fail(problem);
        if (def.options && !def.options.includes(text)) {
          return fail(`${name} içindeki "${text}" öğesi geçerli değil. Geçerli değerler: ${def.options.join(', ')}.`);
        }
        if (!cleaned.includes(text)) cleaned.push(text);
      }
      return { ok: true, value: cleaned };
    }
  }
}
