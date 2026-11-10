import {
  CLONE_ERROR_CODES,
  CloneConfigError,
  FALLBACK_CLONE_DURATIONS,
  canStopRecording,
  classifyInputLevel,
  describeCloneError,
  evaluateTake,
  markerFraction,
  meterFraction,
  fallbackCloneScript,
  parseCloneConfigFromJSON,
  parseCloneIntroSteps,
  parseCloneRecordingTips,
  parseVoiceLanguages,
  localeForVoiceLanguage,
  recordingProgress,
  sampleFileTypeForUri,
  shouldAutoStop,
  shouldDiscardPendingProfile,
  splitParagraphs,
} from './VoiceClone';
import { apiErrorFromResponse } from '../services/ApiError';
import { VOICE_CLONING } from '../config/constants';
import i18n from '../i18n';
import {
  backendCloneCreationLimitError,
  backendCloneCreationLimitMonthlyError,
} from '../test-utils/contract-fixtures';

const fullConfig = {
  enabled: true,
  provider: 'CARTESIA',
  language: 'tr',
  minSeconds: 15,
  targetSeconds: 30,
  maxSeconds: 60,
  scriptTitle: 'Uykucu Ayı',
  script: 'Bir varmış bir yokmuş.',
  consentVersion: '2026-09-27',
  consentTitle: 'Ses kaydı açık rıza metni',
  consentText: 'Birinci paragraf.\n\nİkinci paragraf.',
};

describe('parseCloneConfigFromJSON', () => {
  it('parses a complete backend response', () => {
    const config = parseCloneConfigFromJSON(fullConfig);
    // An older backend names no locale and no language choice: Turkish only.
    expect(config).toEqual({ ...fullConfig, locale: 'tr-TR', supportedLanguages: [] });
  });

  it('reads the voice language, its locale and the languages on offer', () => {
    const config = parseCloneConfigFromJSON({
      ...fullConfig,
      language: 'en',
      locale: 'en-US',
      supportedLanguages: [
        { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
        { code: 'en', locale: 'en-US', nativeName: 'English', englishName: 'English' },
      ],
    });
    expect(config.language).toBe('en');
    expect(config.locale).toBe('en-US');
    expect(config.supportedLanguages).toEqual([
      { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
      { code: 'en', locale: 'en-US', nativeName: 'English', englishName: 'English' },
    ]);
  });

  it('normalises the language and finds the locale when the backend sends none', () => {
    // A locale in `language` is reduced to the content language code.
    expect(parseCloneConfigFromJSON({ ...fullConfig, language: 'tr-TR' }).language).toBe('tr');
    expect(parseCloneConfigFromJSON({ ...fullConfig, language: undefined }).language).toBe('tr');
    expect(parseCloneConfigFromJSON({ ...fullConfig, language: 42 }).locale).toBe('tr-TR');
    // The locale of the language comes from the list, else from the code.
    const fromList = parseCloneConfigFromJSON({
      ...fullConfig,
      language: 'en',
      supportedLanguages: [{ code: 'en', locale: 'en-GB', nativeName: 'English' }],
    });
    expect(fromList.locale).toBe('en-GB');
    expect(parseCloneConfigFromJSON({ ...fullConfig, language: 'en' }).locale).toBe('en-US');
    expect(localeForVoiceLanguage('de')).toBe('de');
  });

  it('falls back per field for durations and script only', () => {
    const config = parseCloneConfigFromJSON({
      consentVersion: 'v3',
      consentText: 'Metin',
    });
    expect(config.enabled).toBe(true);
    expect(config.minSeconds).toBe(VOICE_CLONING.FALLBACK_MIN_SECONDS);
    expect(config.targetSeconds).toBe(VOICE_CLONING.FALLBACK_TARGET_SECONDS);
    expect(config.maxSeconds).toBe(VOICE_CLONING.FALLBACK_MAX_SECONDS);
    expect(config.script).toBe(VOICE_CLONING.FALLBACK_SCRIPT_TR);
    expect(config.scriptTitle).toBe(VOICE_CLONING.FALLBACK_SCRIPT_TITLE_TR);
    expect(config.consentTitle).toBeTruthy();
    expect(config.consentVersion).toBe('v3');
  });

  it('a config without a script reads the fallback of its own language', () => {
    const english = parseCloneConfigFromJSON({ consentVersion: 'v3', consentText: 'Text', language: 'en' });
    expect(english.scriptTitle).toBe('A Starry Night');
    expect(english.script).toBe(VOICE_CLONING.FALLBACK_SCRIPT_EN);
    expect(english.script.startsWith('When evening comes')).toBe(true);
    // A served script always wins.
    const served = parseCloneConfigFromJSON({
      consentVersion: 'v3',
      consentText: 'Text',
      language: 'en',
      scriptTitle: 'Served',
      script: 'Served text.',
    });
    expect(served.scriptTitle).toBe('Served');
    expect(served.script).toBe('Served text.');
    expect(fallbackCloneScript('tr-TR').title).toBe('Ayışığı Ormanı');
    expect(fallbackCloneScript('de').title).toBe('A Starry Night');
  });

  it('accepts numeric strings and a numeric consent version', () => {
    const config = parseCloneConfigFromJSON({
      ...fullConfig,
      minSeconds: '20',
      maxSeconds: '50',
      consentVersion: 4,
    });
    expect(config.minSeconds).toBe(20);
    expect(config.maxSeconds).toBe(50);
    expect(config.consentVersion).toBe('4');
  });

  it('refuses a config without consent text or version', () => {
    expect(() =>
      parseCloneConfigFromJSON({ ...fullConfig, consentText: '' }),
    ).toThrow(CloneConfigError);
    expect(() =>
      parseCloneConfigFromJSON({ ...fullConfig, consentVersion: undefined }),
    ).toThrow(CloneConfigError);
    expect(() => parseCloneConfigFromJSON(null)).toThrow(CloneConfigError);
    expect(() => parseCloneConfigFromJSON([fullConfig])).toThrow(CloneConfigError);
  });

  it('respects enabled: false', () => {
    expect(parseCloneConfigFromJSON({ ...fullConfig, enabled: false }).enabled).toBe(false);
  });

  it('falls back to the whole duration set when max < min', () => {
    const config = parseCloneConfigFromJSON({
      ...fullConfig,
      minSeconds: 40,
      maxSeconds: 20,
    });
    expect(config.minSeconds).toBe(FALLBACK_CLONE_DURATIONS.minSeconds);
    expect(config.maxSeconds).toBe(FALLBACK_CLONE_DURATIONS.maxSeconds);
  });

  it('clamps the target into [min, max] and ignores non-positive values', () => {
    expect(
      parseCloneConfigFromJSON({ ...fullConfig, targetSeconds: 90 }).targetSeconds,
    ).toBe(60);
    expect(
      parseCloneConfigFromJSON({ ...fullConfig, targetSeconds: 5 }).targetSeconds,
    ).toBe(15);
    expect(
      parseCloneConfigFromJSON({ ...fullConfig, minSeconds: -3 }).minSeconds,
    ).toBe(VOICE_CLONING.FALLBACK_MIN_SECONDS);
  });
});

describe('clone config intro steps + recording tips', () => {
  const introSteps = [
    { title: 'Sessiz bir oda bul', body: 'Çevren sessiz olsun.' },
    { title: 'Masalı oku', body: 'Yaklaşık 30 saniye oku.' },
  ];
  const recordingTips = [
    { icon: 'quiet', text: 'Sessiz bir odada kaydet.' },
    { icon: 'distance', text: 'Telefonu bir karış uzakta tut.' },
    { icon: 'calm', text: 'Sakin oku.' },
    { icon: 'pauses', text: 'Uzun duraklama yapma.' },
  ];

  it('parses served intro steps and recording tips', () => {
    const config = parseCloneConfigFromJSON({ ...fullConfig, introSteps, recordingTips });
    expect(config.introSteps).toEqual(introSteps);
    expect(config.recordingTips).toEqual(recordingTips);
  });

  it('leaves both fields out for an older backend that omits them', () => {
    const config = parseCloneConfigFromJSON(fullConfig);
    expect(config).not.toHaveProperty('introSteps');
    expect(config).not.toHaveProperty('recordingTips');
  });

  it('never throws on invalid shapes and leaves the field out', () => {
    for (const bad of [null, 'metin', 42, {}, { title: 'x', body: 'y' }, [], [null, 3, 'x']]) {
      const config = parseCloneConfigFromJSON({
        ...fullConfig,
        introSteps: bad,
        recordingTips: bad,
      });
      expect(config.introSteps).toBeUndefined();
      expect(config.recordingTips).toBeUndefined();
      // The rest of the config is unaffected.
      expect(config.consentVersion).toBe(fullConfig.consentVersion);
    }
  });

  it('drops malformed intro steps and trims the rest', () => {
    expect(
      parseCloneIntroSteps([
        { title: '  Sessiz bir oda bul ', body: ' Çevren sessiz olsun. ' },
        { title: 'Başlık yok gövde var' },
        { body: 'Gövde var başlık yok' },
        { title: '   ', body: 'Boş başlık' },
        { title: 5, body: 'Sayı başlık' },
        ['Başlık', 'Gövde'],
        null,
      ]),
    ).toEqual([{ title: 'Sessiz bir oda bul', body: 'Çevren sessiz olsun.' }]);
  });

  it('drops tips without text and keeps unknown icon keys with a null icon', () => {
    expect(
      parseCloneRecordingTips([
        { icon: 'quiet', text: ' Sessiz bir odada kaydet. ' },
        { icon: 'headphones', text: 'Kulaklık takma.' },
        { text: 'İkonsuz ipucu.' },
        { icon: 'calm' },
        { icon: 'pauses', text: '  ' },
        { icon: 'distance', text: 7 },
        'Sadece metin',
      ]),
    ).toEqual([
      { icon: 'quiet', text: 'Sessiz bir odada kaydet.' },
      { icon: null, text: 'Kulaklık takma.' },
      { icon: null, text: 'İkonsuz ipucu.' },
    ]);
  });

  it('keeps the usable items when only some are malformed', () => {
    const config = parseCloneConfigFromJSON({
      ...fullConfig,
      introSteps: [{ title: 'Tek adım', body: 'Açıklama.' }, { title: '' }],
      recordingTips: [{ icon: 'quiet' }, { icon: 'pauses', text: 'Akıcı oku.' }],
    });
    expect(config.introSteps).toEqual([{ title: 'Tek adım', body: 'Açıklama.' }]);
    expect(config.recordingTips).toEqual([{ icon: 'pauses', text: 'Akıcı oku.' }]);
  });
});

describe('splitParagraphs', () => {
  it('splits on blank lines and trims', () => {
    expect(splitParagraphs(' A\n\n  B \r\n\r\nC\nD ')).toEqual(['A', 'B', 'C\nD']);
  });
});

describe('recording duration gating', () => {
  const d = { minSeconds: 15, targetSeconds: 30, maxSeconds: 60 };

  it('allows stopping only from minSeconds', () => {
    expect(canStopRecording(0, d)).toBe(false);
    expect(canStopRecording(14.9, d)).toBe(false);
    expect(canStopRecording(15, d)).toBe(true);
    expect(canStopRecording(42, d)).toBe(true);
  });

  it('auto-stops at maxSeconds', () => {
    expect(shouldAutoStop(59.9, d)).toBe(false);
    expect(shouldAutoStop(60, d)).toBe(true);
  });

  it('rejects takes without speech or under the minimum', () => {
    const noSpeech = evaluateTake(0, false, d);
    expect(noSpeech.ok).toBe(false);
    if (!noSpeech.ok) expect(noSpeech.reason).toBe('no_speech');

    const short = evaluateTake(12, true, d);
    expect(short.ok).toBe(false);
    if (!short.ok) {
      expect(short.reason).toBe('too_short');
      expect(short.message).toBe(
        'Kayıt çok kısa. En az 15 saniye okuman gerekiyor, lütfen yeniden kaydet.',
      );
    }

    expect(evaluateTake(15, true, d).ok).toBe(true);
    expect(evaluateTake(60, true, d).ok).toBe(true);
  });

  it('names the minimum in whole seconds in the UI language', async () => {
    const odd = { minSeconds: 12.2, targetSeconds: 30, maxSeconds: 60 };
    const tr = evaluateTake(5, true, odd);
    if (!tr.ok) expect(tr.message).toContain('En az 13 saniye');

    await i18n.changeLanguage('en');
    const en = evaluateTake(5, true, FALLBACK_CLONE_DURATIONS);
    expect(en.ok).toBe(false);
    if (!en.ok) {
      expect(en.message).toContain(`${FALLBACK_CLONE_DURATIONS.minSeconds} seconds`);
      expect(en.message).not.toContain('saniye');
    }
  });

  it('maps progress and markers onto the max scale', () => {
    expect(recordingProgress(30, d)).toBe(0.5);
    expect(recordingProgress(90, d)).toBe(1);
    expect(recordingProgress(-1, d)).toBe(0);
    expect(markerFraction(d.minSeconds, d)).toBe(0.25);
    expect(markerFraction(d.targetSeconds, d)).toBe(0.5);
  });
});

describe('classifyInputLevel', () => {
  it('is idle without samples', () => {
    expect(classifyInputLevel([], 'ios')).toBe('idle');
  });

  it('uses the iOS average-power thresholds', () => {
    expect(classifyInputLevel([-60, -55, -50], 'ios')).toBe('quiet');
    expect(classifyInputLevel([-60, -25, -30], 'ios')).toBe('good');
    expect(classifyInputLevel([-20, -5, -4], 'ios')).toBe('loud');
    // A single hot sample is not enough to warn.
    expect(classifyInputLevel([-20, -5, -25], 'ios')).toBe('good');
  });

  it('uses the hotter Android peak thresholds', () => {
    // -35 dBFS peak is quiet on Android but fine on iOS.
    expect(classifyInputLevel([-35, -36], 'android')).toBe('quiet');
    expect(classifyInputLevel([-35, -36], 'ios')).toBe('good');
    expect(classifyInputLevel([-12, -8], 'android')).toBe('good');
    expect(classifyInputLevel([-0.5, -1], 'android')).toBe('loud');
  });

  it('meterFraction clamps dBFS to 0..1', () => {
    expect(meterFraction(-160)).toBe(0);
    expect(meterFraction(-30)).toBe(0.5);
    expect(meterFraction(3)).toBe(1);
  });
});

describe('sampleFileTypeForUri', () => {
  it('maps iOS WAV and Android m4a takes', () => {
    expect(sampleFileTypeForUri('file:///x/recording-1.wav')).toEqual({
      mimeType: 'audio/wav',
      extension: 'wav',
    });
    expect(sampleFileTypeForUri('file:///x/recording-1.M4A')).toEqual({
      mimeType: 'audio/m4a',
      extension: 'm4a',
    });
  });
});

describe('describeCloneError', () => {
  const err = (status: number, code: string, message?: string) =>
    apiErrorFromResponse(status, {
      success: false,
      statusCode: status,
      code,
      ...(message ? { message } : {}),
    });

  it('sends CONSENT_REQUIRED back to the consent step', () => {
    const info = describeCloneError(err(400, CLONE_ERROR_CODES.CONSENT_REQUIRED), 'free');
    expect(info.action).toBe('reconsent');
    expect(info.code).toBe('CONSENT_REQUIRED');
    // Generic 400 fallback text is replaced with a specific explanation.
    expect(info.message).toContain('açık rıza');
  });

  it('a known code never shows the backend sentence, even in Turkish', () => {
    const info = describeCloneError(
      err(400, CLONE_ERROR_CODES.CONSENT_REQUIRED, 'Onay metni güncellendi.'),
      'free',
    );
    expect(info.message).toBe(
      'Sesini kaydedebilmemiz için açık rıza metnini yeniden onaylaman gerekiyor.',
    );
  });

  it('follows training for VOICE_ALREADY_UPLOADED and keeps the profile', () => {
    const error = err(409, CLONE_ERROR_CODES.VOICE_ALREADY_UPLOADED);
    expect(describeCloneError(error, 'free').action).toBe('track');
    expect(shouldDiscardPendingProfile(error)).toBe(false);
  });

  it('VOICE_LANGUAGE_NOT_SUPPORTED explains it and offers nothing to retry', () => {
    const error = err(400, CLONE_ERROR_CODES.VOICE_LANGUAGE_NOT_SUPPORTED, 'Bu dil desteklenmiyor.');
    for (const plan of ['free', 'mini', 'premium'] as const) {
      const info = describeCloneError(error, plan);
      expect(info.action).toBe('none');
      expect(info.code).toBe('VOICE_LANGUAGE_NOT_SUPPORTED');
      expect(info.message).toBe('Bu dilde ses kaydı şu an yapılamıyor. Başka bir dil seç.');
    }
    // The PENDING profile of a refused upload is still discarded.
    expect(shouldDiscardPendingProfile(error)).toBe(true);
  });

  it('own-voice places: plans for Free and Mini (Premium has more), none for Premium', () => {
    const slot = err(403, CLONE_ERROR_CODES.CLONE_SLOT_LIMIT, 'En fazla 1 kendi sesini ekleyebilirsin.');
    expect(describeCloneError(slot, 'free').action).toBe('paywall');
    expect(describeCloneError(slot, 'mini').action).toBe('paywall');
    expect(describeCloneError(slot, 'premium').action).toBe('none');
    // Free: deleting never gives the lifetime voice back, so it is not offered.
    expect(describeCloneError(slot, 'free').message).not.toContain('silebilir');
    expect(describeCloneError(slot, 'mini').message).toContain('Premium');
    expect(describeCloneError(slot, 'premium').message).toContain('silebilirsin');
  });

  it('narrator places: plans for Free only (Mini and Premium both have 10)', () => {
    const preset = err(403, CLONE_ERROR_CODES.PRESET_SLOT_LIMIT);
    expect(describeCloneError(preset, 'free').action).toBe('paywall');
    expect(describeCloneError(preset, 'mini').action).toBe('none');
    expect(describeCloneError(preset, 'premium').action).toBe('none');
    expect(describeCloneError(preset, 'mini').message).toBe(
      describeCloneError(preset, 'premium').message,
    );
  });

  describe('CLONE_CREATION_LIMIT (the plan\'s own-voice creations are used up)', () => {
    const creationLimit = (data: Record<string, unknown>) =>
      apiErrorFromResponse(403, {
        success: false,
        statusCode: 403,
        code: CLONE_ERROR_CODES.CLONE_CREATION_LIMIT,
        message: 'Kendi ses oluşturma hakkın doldu.',
        ...data,
      });
    const lifetime = creationLimit({ plan: 'FREE', limit: 1, used: 1, period: 'lifetime', renewsAt: null });
    const monthly = (plan: string, limit: number) =>
      creationLimit({ plan, limit, used: limit, period: 'month', renewsAt: '2026-11-01T12:00:00.000Z' });

    it('paywall for free and mini, none for premium, never retry', () => {
      expect(describeCloneError(lifetime, 'free').action).toBe('paywall');
      expect(describeCloneError(monthly('MINI', 2), 'mini').action).toBe('paywall');
      expect(describeCloneError(monthly('PRO', 5), 'premium').action).toBe('none');
      for (const plan of ['free', 'mini', 'premium'] as const) {
        expect(describeCloneError(lifetime, plan).action).not.toBe('retry');
      }
    });

    it('the plan named by the error wins over the caller\'s', () => {
      // A stale client tier: the backend says the user is on Premium.
      expect(describeCloneError(monthly('PRO', 5), 'free').action).toBe('none');
    });

    it('the lifetime copy says it never renews and never mentions a month', () => {
      const info = describeCloneError(lifetime, 'free');
      expect(info.title).toBe('Kendi ses hakkını kullandın');
      expect(info.message).toContain('Bu hak yenilenmez');
      expect(info.message).toContain('Mini ya da Premium');
      expect(info.message).not.toMatch(/\bay\b|ayki|ayda|month/i);
      expect(info.message).not.toContain('Kendi ses oluşturma hakkın doldu.');
    });

    it('the monthly copy names the limit and the renewal date', () => {
      const mini = describeCloneError(monthly('MINI', 2), 'mini');
      expect(mini.title).toBe('Bu ayki yeni ses hakkın doldu');
      expect(mini.message).toBe(
        "Planında ayda 2 yeni ses kaydı var. 1 Kasım'da yenilenir. Premium planda daha fazlası var.",
      );
      const premium = describeCloneError(monthly('PRO', 5), 'premium');
      expect(premium.message).toBe("Planında ayda 5 yeni ses kaydı var. 1 Kasım'da yenilenir.");
    });

    it('maps the backend contract fixtures (FREE lifetime, MINI monthly)', () => {
      const free = describeCloneError(
        apiErrorFromResponse(403, backendCloneCreationLimitError),
        'free',
      );
      expect(free).toMatchObject({
        code: 'CLONE_CREATION_LIMIT',
        title: 'Kendi ses hakkını kullandın',
        action: 'paywall',
      });
      expect(free.message).not.toBe(backendCloneCreationLimitError.message);

      const mini = describeCloneError(
        apiErrorFromResponse(403, backendCloneCreationLimitMonthlyError),
        'mini',
      );
      expect(mini.title).toBe('Bu ayki yeni ses hakkın doldu');
      expect(mini.message).toContain('ayda 2 yeni ses');
      expect(mini.action).toBe('paywall');
      // Refused at upload: the PENDING placeholder is discarded (it holds the slot).
      expect(
        shouldDiscardPendingProfile(apiErrorFromResponse(403, backendCloneCreationLimitMonthlyError)),
      ).toBe(true);
    });

    it('fills a missing period and limit from the plan', () => {
      const bare = apiErrorFromResponse(403, { code: CLONE_ERROR_CODES.CLONE_CREATION_LIMIT });
      expect(describeCloneError(bare, 'free').title).toBe('Kendi ses hakkını kullandın');
      expect(describeCloneError(bare, 'mini').message).toContain('ayda 2 yeni ses');
    });

    it('is English in the English UI', async () => {
      await i18n.changeLanguage('en');
      const info = describeCloneError(lifetime, 'free');
      expect(info.title).toBe('You have used your own voice');
      expect(info.message).toContain('It does not renew');
      expect(info.message).not.toMatch(/[çğışöüİ]/);
    });
  });

  describe('in the English UI', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('en');
    });

    it('a known code shows English copy, never the Turkish backend sentence', () => {
      const info = describeCloneError(
        apiErrorFromResponse(403, {
          statusCode: 403,
          code: CLONE_ERROR_CODES.CLONE_SLOT_LIMIT,
          message: 'Planın en fazla 1 kendi ses kaydına izin veriyor.',
          limit: 1,
        }),
        'free',
      );
      expect(info.title).toBe('You have used your own voices');
      expect(info.message).not.toContain('Planın');
      expect(info.message).not.toMatch(/[çğışöüİ]/);
    });

    it('an unknown code with a Turkish server sentence falls back to the upload text', () => {
      const info = describeCloneError(
        err(422, 'SOMETHING_NEW', 'Ses dosyası okunamadı.'),
        'free',
      );
      expect(info.action).toBe('retry');
      expect(info.message).toBe('Your recording could not be uploaded. Try again.');
    });
  });

  it('an unknown code keeps the server sentence in the Turkish UI', () => {
    const info = describeCloneError(err(422, 'SOMETHING_NEW', 'Ses dosyası okunamadı.'), 'free');
    expect(info.message).toBe('Ses dosyası okunamadı.');
    expect(info.action).toBe('retry');
  });

  it('treats everything else as a retryable upload failure', () => {
    const network = apiErrorFromResponse(undefined, null);
    const info = describeCloneError(network, 'free');
    expect(info.action).toBe('retry');
    expect(info.code).toBe('NETWORK_ERROR');
    expect(shouldDiscardPendingProfile(network)).toBe(true);

    const internal = describeCloneError(new Error('Invalid response'), 'free');
    expect(internal.action).toBe('retry');
    expect(internal.message).not.toContain('Invalid');
  });

  it('never surfaces a 5xx body as the message', () => {
    const info = describeCloneError(
      apiErrorFromResponse(500, { code: CLONE_ERROR_CODES.CONSENT_REQUIRED, message: 'Internal server error' }),
      'free',
    );
    expect(info.message).not.toContain('Internal');
  });
});

describe('parseVoiceLanguages', () => {
  it('never throws and drops what it cannot use', () => {
    expect(parseVoiceLanguages(undefined)).toEqual([]);
    expect(parseVoiceLanguages('tr,en')).toEqual([]);
    expect(parseVoiceLanguages({ code: 'tr' })).toEqual([]);
    expect(
      parseVoiceLanguages([
        null,
        'tr',
        { nativeName: 'Dilsiz' },
        { code: 'TR', locale: 'tr-TR', nativeName: ' Türkçe ', englishName: 'Turkish' },
        // The same language twice is listed once.
        { code: 'tr-TR', nativeName: 'Türkçe (2)' },
        // Only a locale: the code comes from it; names fall back.
        { locale: 'en-US' },
        { code: 'de', nativeName: 'Deutsch' },
      ]),
    ).toEqual([
      { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
      { code: 'en', locale: 'en-US', nativeName: 'EN', englishName: 'EN' },
      { code: 'de', locale: 'de', nativeName: 'Deutsch', englishName: 'Deutsch' },
    ]);
  });
});
