import {
  CONTENT_LANGUAGE_OPTION_LABELS,
  I18N_LOCALE_OPTION_LABELS,
  SETTINGS_REGISTRY,
  TTS_PROVIDER_OPTION_LABELS,
  getSettingDefinition,
  settingOptionLabels,
} from './settings.registry';
import { SettingsService } from './settings.service';
import {
  SONIC3_EMOTION_LABELS_TR,
  SONIC3_EXTENDED_EMOTIONS,
} from '../tts-providers/cartesia/cartesia-emotions.constants';
import { CONTENT_LANGUAGE_CODES } from '../../common/constants/content-languages';
import { createMockPrismaService } from '../../test-utils/prisma-mock';

/** Symbols the workspace copy rules ban from any text an admin reads. */
const BANNED = /[—–…→←•·✓★]|\p{Extended_Pictographic}/u;

describe('Turkish names of setting options', () => {
  it('settingOptionLabels pairs every option with its label, in option order', () => {
    expect(
      settingOptionLabels({ options: ['google', 'cartesia'], optionLabels: TTS_PROVIDER_OPTION_LABELS }),
    ).toEqual([
      { value: 'google', label: 'Google Cloud TTS' },
      { value: 'cartesia', label: 'Cartesia Sonic' },
    ]);
  });

  it('an option without a label is shown as its value; a setting without options has none', () => {
    expect(settingOptionLabels({ options: ['tr', 'xx'], optionLabels: { tr: 'Türkçe' } })).toEqual([
      { value: 'tr', label: 'Türkçe' },
      { value: 'xx', label: 'xx' },
    ]);
    expect(settingOptionLabels({ options: ['a'] })).toEqual([{ value: 'a', label: 'a' }]);
    expect(settingOptionLabels({})).toBeNull();
  });

  it('content languages: the Turkish name, with the own name of the language when it differs', () => {
    expect(Object.keys(CONTENT_LANGUAGE_OPTION_LABELS)).toEqual([...CONTENT_LANGUAGE_CODES]);
    expect(CONTENT_LANGUAGE_OPTION_LABELS.tr).toBe('Türkçe');
    expect(CONTENT_LANGUAGE_OPTION_LABELS.en).toBe('İngilizce (English)');
    expect(CONTENT_LANGUAGE_OPTION_LABELS.de).toBe('Almanca (Deutsch)');
    expect(CONTENT_LANGUAGE_OPTION_LABELS.ar).toBe('Arapça (العربية)');
  });

  it('locales and providers', () => {
    expect(I18N_LOCALE_OPTION_LABELS).toEqual({ tr: 'Türkçe', en: 'İngilizce' });
    expect(TTS_PROVIDER_OPTION_LABELS).toEqual({ google: 'Google Cloud TTS', cartesia: 'Cartesia Sonic' });
  });

  it('every emotion has a Turkish name with real Turkish letters', () => {
    expect(Object.keys(SONIC3_EMOTION_LABELS_TR).sort()).toEqual([...SONIC3_EXTENDED_EMOTIONS].sort());
    expect(SONIC3_EMOTION_LABELS_TR).toMatchObject({
      neutral: 'Nötr',
      excited: 'Heyecanlı',
      sad: 'Üzgün',
      scared: 'Korkmuş',
      surprised: 'Şaşkın',
      outraged: 'Öfkeli',
      disgusted: 'İğrenmiş',
      determined: 'Kararlı',
    });
    for (const label of Object.values(SONIC3_EMOTION_LABELS_TR)) {
      expect(label.trim()).toBe(label);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(BANNED);
    }
    // Distinct names, so two options never read the same in a dropdown.
    expect(new Set(Object.values(SONIC3_EMOTION_LABELS_TR)).size).toBe(SONIC3_EXTENDED_EMOTIONS.length);
  });

  it('every enum and list setting of the registry names all of its options', () => {
    const withOptions = SETTINGS_REGISTRY.filter((def) => def.options);
    expect(withOptions.map((def) => def.key)).toEqual([
      'i18n.defaultLocale',
      'i18n.fallbackLocale',
      'content.enabledLanguages',
      'content.defaultLanguage',
      'tts.defaultProvider',
      'tts.cloneLanguages',
      'tts.cartesia.defaultEmotion',
    ]);
    for (const def of withOptions) {
      const labels = settingOptionLabels(def)!;
      expect(labels.map((option) => option.value)).toEqual([...def.options!]);
      for (const option of labels) {
        expect(option.label).not.toMatch(BANNED);
        // Locales come from the i18n folder; a new folder may not have a name yet.
        if (!def.key.startsWith('i18n.')) expect(option.label).not.toBe(option.value);
      }
    }
    expect(settingOptionLabels(getSettingDefinition('i18n.defaultLocale')!)).toEqual(
      expect.arrayContaining([
        { value: 'tr', label: 'Türkçe' },
        { value: 'en', label: 'İngilizce' },
      ]),
    );
  });

  it('GET /admin/settings returns them next to the raw options', async () => {
    const prisma = createMockPrismaService();
    prisma.systemSetting.findMany.mockResolvedValue([]);
    const service = new SettingsService(prisma as any);

    const view = service.describe();
    const all = view.groups.flatMap((group) => group.settings);
    const byKey = (key: string) => all.find((setting) => setting.key === key)!;

    expect(byKey('tts.defaultProvider').constraints).toMatchObject({
      options: ['google', 'cartesia'],
      optionLabels: [
        { value: 'google', label: 'Google Cloud TTS' },
        { value: 'cartesia', label: 'Cartesia Sonic' },
      ],
    });
    expect(byKey('content.enabledLanguages').constraints.optionLabels).toContainEqual({
      value: 'en',
      label: 'İngilizce (English)',
    });
    expect(byKey('tts.cartesia.defaultEmotion').constraints.optionLabels).toContainEqual({
      value: 'peaceful',
      label: 'Huzurlu',
    });
    expect(byKey('rateLimit.ttl').constraints.optionLabels).toBeNull();
    expect(byKey('llm.autoAssessAgeGroup')).toMatchObject({
      type: 'boolean',
      value: true,
      label: 'Yaş grubunu otomatik belirle',
      envVar: 'LLM_AUTO_ASSESS_AGE_GROUP',
    });
  });
});
