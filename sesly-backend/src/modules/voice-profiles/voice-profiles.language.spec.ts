import { renderMessage } from '../../test-utils/i18n';
import { serverText } from '../../common/i18n/server-text';
import { BadRequestException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { VoiceProfilesService } from './voice-profiles.service';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockVoiceProfile } from '../../test-utils/mock-factories';
import { VOICE_LANGUAGES, VOICE_LANGUAGE_CODES } from '../../common/constants/voice-languages';
import {
  CLONE_CONSENT_TEXT,
  CLONE_CONSENT_TEXT_EN,
  CLONE_CONSENT_VERSION,
  CLONE_CONSENT_VERSION_EN,
  CLONE_LANGUAGE_CONTENT,
  CLONE_SCRIPT,
  CLONE_SCRIPT_EN,
  CLONE_TEST_SAMPLE_TEXT,
  CLONE_TEST_SAMPLE_TEXT_EN,
  buildCloneConfig,
  cloneContentFor,
} from './clone-config.constants';
import { requireCloneLanguage, resolveCloneLanguages } from './clone-languages';
import { CreateVoiceProfileV2Dto } from './dto/create-voice-profile-v2.dto';
import { CreateVoiceProfileDto } from './dto/create-voice-profile.dto';
import {
  isAllowedVoiceProfileLanguage,
  voiceProfileLanguageMessage,
} from './dto/voice-language.validator';

// Characters banned from user-facing copy (CLAUDE.md UI text rules).
const FORBIDDEN_UI_CHARS = /[—–…→←•·★✓›⚡]|\p{Extended_Pictographic}/u;

const words = (text: string) => text.split(/\s+/).filter(Boolean);

describe('voice languages in the clone flow', () => {
  let prisma: MockPrismaService;
  let google: any;
  let cartesia: any;
  let storage: any;
  let queue: any;
  let settings: SettingsStub;
  let service: VoiceProfilesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    google = { getProviderName: () => 'GOOGLE', getAvailableVoices: jest.fn().mockResolvedValue([]), textToSpeech: jest.fn() };
    cartesia = {
      getProviderName: () => 'CARTESIA',
      getAvailableVoices: jest.fn().mockResolvedValue([]),
      textToSpeech: jest.fn().mockResolvedValue(Buffer.from('mp3')),
    };
    storage = {
      uploadFile: jest.fn(async (_b: Buffer, key: string) => `https://storage.googleapis.com/b/${key}`),
      deleteFolder: jest.fn().mockResolvedValue(undefined),
      fileExists: jest.fn().mockResolvedValue(false),
      generatePresignedUrl: jest.fn(async (key: string) => `signed:${key}`),
    };
    queue = { add: jest.fn().mockResolvedValue({}) };
    settings = createSettingsStub();
    service = new VoiceProfilesService(
      prisma as any,
      storage,
      {
        getAllProviders: () => [google, cartesia],
        getProvider: (p: string) => (p.toLowerCase() === 'cartesia' ? cartesia : google),
        getCloningProvider: jest.fn(),
      } as any,
      queue,
      {} as any,
      settings as any,
    );

    // A FREE user with room for one more clone.
    prisma.subscription.findUnique.mockResolvedValue(null);
    prisma.voiceProfile.count.mockResolvedValue(0);
    prisma.usageLimit.findUnique.mockResolvedValue(null);
    prisma.usageLifetime.findUnique.mockResolvedValue(null);
    prisma.voiceProfile.create.mockImplementation(async ({ data }: any) =>
      createMockVoiceProfile({ ...data, id: 'vp-1' }),
    );
  });

  describe('GET /voice-profiles/clone-config?language=', () => {
    it('no language (app builds in the field): the Turkish texts, unchanged', () => {
      const config = service.getCloneConfig();

      expect(config).toMatchObject({
        language: 'tr',
        locale: 'tr-TR',
        scriptTitle: 'Yıldızlı Bir Gece',
        script: CLONE_SCRIPT,
        consentVersion: '2026-10-v2',
        consentTitle: 'Sesin için açık rıza',
        consentText: CLONE_CONSENT_TEXT,
      });
      expect(config.introSteps[0].title).toBe('Sessiz bir oda bul');
      expect(config.recordingTips[0].text).toBe('Sessiz bir odada kaydet.');
    });

    it('lists the supported voice languages with their native names', () => {
      expect(service.getCloneConfig().supportedLanguages).toEqual([
        { code: 'tr', locale: 'tr-TR', nativeName: 'Türkçe', englishName: 'Turkish' },
        { code: 'en', locale: 'en-US', nativeName: 'English', englishName: 'English' },
      ]);
      // Same list whichever language is asked for, and never the accent label.
      expect(service.getCloneConfig('en').supportedLanguages).toEqual(
        service.getCloneConfig('tr').supportedLanguages,
      );
    });

    it.each(['en', 'EN', 'en-US', 'en-GB'])('language=%s serves every text in English', (language) => {
      const config = service.getCloneConfig(language);

      expect(config).toMatchObject({
        enabled: true,
        provider: 'CARTESIA',
        language: 'en',
        locale: 'en-US',
        minSeconds: 15,
        targetSeconds: 30,
        maxSeconds: 60,
        scriptTitle: 'A Starry Night',
        script: CLONE_SCRIPT_EN,
        consentVersion: CLONE_CONSENT_VERSION_EN,
        consentTitle: 'Explicit consent for your voice',
        consentText: CLONE_CONSENT_TEXT_EN,
      });
      expect(config.introSteps.map((step) => step.title)).toEqual([
        'Find a quiet room',
        'Read a story for about 30 seconds',
        'Let your voice get ready',
      ]);
      expect(config.introSteps[1].body).toContain('at least 15 seconds');
      expect(config.recordingTips.map((tip) => tip.icon)).toEqual(['quiet', 'distance', 'calm', 'pauses']);
      expect(config.recordingTips[0].text).toBe('Record in a quiet room.');
    });

    it('a repeated parameter uses the first value', () => {
      expect(service.getCloneConfig(['en', 'tr']).language).toBe('en');
    });

    it.each(['de', 'de-DE', 'klingon', '12'])(
      'language=%s is a coded 400 with the list the client may offer',
      (language) => {
        let error: any;
        try {
          service.getCloneConfig(language);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toEqual({
          code: 'VOICE_LANGUAGE_NOT_SUPPORTED',
          message: 'errors.voiceProfiles.cloneLanguageNotSupported',
          supportedLanguages: ['tr', 'en'],
        });
        expect(renderMessage(error)).toBe('Bu dilde ses kaydı henüz desteklenmiyor.');
        expect(renderMessage(error)).not.toMatch(FORBIDDEN_UI_CHARS);
        expect(renderMessage(error, 'en')).not.toMatch(FORBIDDEN_UI_CHARS);
      },
    );

    it('English can be switched off from the panel (tts.cloneLanguages) without a deploy', () => {
      settings.values['tts.cloneLanguages'] = ['tr'];

      expect(service.getCloneConfig().supportedLanguages.map((l) => l.code)).toEqual(['tr']);
      expect(() => service.getCloneConfig('en')).toThrow(BadRequestException);
      expect(service.getCloneConfig('tr').language).toBe('tr');
    });

    it('an empty or unknown setting falls back to Turkish, so cloning is never switched off by accident', () => {
      for (const value of [[], ['xx'], undefined]) {
        settings.values['tts.cloneLanguages'] = value as any;
        expect(resolveCloneLanguages(settings as any).map((l) => l.code)).toEqual(['tr']);
        expect(service.getCloneConfig().language).toBe('tr');
      }
    });

    it('the setting cannot reorder the languages: catalogue order is kept', () => {
      settings.values['tts.cloneLanguages'] = ['en', 'tr'];
      expect(resolveCloneLanguages(settings as any).map((l) => l.code)).toEqual(['tr', 'en']);
    });

    it('Turkish switched off: a request without a language is told so instead of getting English texts', () => {
      settings.values['tts.cloneLanguages'] = ['en'];
      // Old builds send no language and can only show the Turkish flow.
      expect(() => requireCloneLanguage(settings as any, undefined)).toThrow(BadRequestException);
      expect(requireCloneLanguage(settings as any, 'en').code).toBe('en');
    });
  });

  describe('the texts themselves', () => {
    it('every voice language has complete clone texts and its own consent version', () => {
      const versions = new Set<string>();
      for (const code of VOICE_LANGUAGE_CODES) {
        const content = CLONE_LANGUAGE_CONTENT[code];
        expect(content.script.split('\n\n')).toHaveLength(3);
        expect(content.consentText.split('\n\n')).toHaveLength(8);
        expect(content.introSteps).toHaveLength(3);
        expect(content.recordingTips.map((tip) => tip.icon)).toEqual(['quiet', 'distance', 'calm', 'pauses']);
        expect(content.testSampleText.length).toBeGreaterThan(20);
        versions.add(content.consentVersion);
        for (const text of [
          content.script,
          content.scriptTitle,
          content.consentText,
          content.consentTitle,
          content.testSampleText,
          ...content.introSteps.flatMap((step) => [step.title, step.body]),
          ...content.recordingTips.map((tip) => tip.text),
        ]) {
          expect(text).not.toMatch(FORBIDDEN_UI_CHARS);
        }
      }
      expect(versions.size).toBe(VOICE_LANGUAGE_CODES.length);
      expect(CLONE_CONSENT_VERSION_EN).not.toBe(CLONE_CONSENT_VERSION);
    });

    it('the consent versions were bumped for the contact address change (each language its own id)', () => {
      expect(CLONE_CONSENT_VERSION).toBe('2026-10-v2');
      expect(CLONE_CONSENT_VERSION_EN).toBe('2026-10-en-v2');
      expect(CLONE_LANGUAGE_CONTENT.tr.consentVersion).toBe(CLONE_CONSENT_VERSION);
      expect(CLONE_LANGUAGE_CONTENT.en.consentVersion).toBe(CLONE_CONSENT_VERSION_EN);
    });

    it('English script: a calm passage of the same reading time, no digits, plain ASCII, full sentences', () => {
      const count = words(CLONE_SCRIPT_EN).length;
      // English needs more words than Turkish (125) for the same 50 to 55 s.
      expect(count).toBeGreaterThanOrEqual(135);
      expect(count).toBeLessThanOrEqual(160);
      expect(CLONE_SCRIPT_EN).not.toMatch(/\d/);
      expect(CLONE_SCRIPT_EN).not.toMatch(/[!?"]/);
      expect(CLONE_SCRIPT_EN).toMatch(/^[A-Za-z ,.\n]+$/);
      expect(CLONE_SCRIPT_EN.trim()).toMatch(/\.$/);
      // Sounds a clone needs to hear: th, sh, ch, j, zh, ng, w, v, z.
      for (const sample of ['the', 'hush', 'cheek', 'Juniper', 'treasure', 'evening', 'waits', 'village', 'closes']) {
        expect(CLONE_SCRIPT_EN).toContain(sample);
      }
    });

    it('English consent: the same eight points as the Turkish one, in the same order', () => {
      const tr = CLONE_CONSENT_TEXT.split('\n\n');
      const en = CLONE_CONSENT_TEXT_EN.split('\n\n');
      expect(en).toHaveLength(tr.length);

      const points: Array<[string, string]> = [
        ['yapay bir kopyasını', 'artificial copy of your voice'],
        ['biyometrik veri', 'biometric data'],
        ['Amaç:', 'Purpose:'],
        ['Yurt dışına aktarım:', 'Transfer abroad:'],
        ['Saklama süresi:', 'Retention period:'],
        ['Yalnızca kendi sesin:', 'Your own voice only:'],
        ['Rızanı geri alma:', 'Withdrawing your consent:'],
        ['açık rıza vermiş olursun', 'you give your explicit consent'],
      ];
      points.forEach(([turkish, english], index) => {
        expect(tr[index]).toContain(turkish);
        expect(en[index]).toContain(english);
      });

      // Facts that must be identical in both.
      for (const fact of ['6698', 'KVKK', 'Cartesia, Inc.', 'info@sesly.io']) {
        expect(CLONE_CONSENT_TEXT).toContain(fact);
        expect(CLONE_CONSENT_TEXT_EN).toContain(fact);
      }
      // The old, wrong contact address is gone from both.
      expect(CLONE_CONSENT_TEXT).not.toContain('destek@sesly.app');
      expect(CLONE_CONSENT_TEXT_EN).not.toContain('destek@sesly.app');
      expect(tr[6]).toContain('info@sesly.io adresine yazabilirsin');
      expect(en[6]).toContain('you can write to info@sesly.io');
      expect(CLONE_CONSENT_TEXT_EN).toContain('United States of America');
      expect(CLONE_CONSENT_TEXT_EN).toContain('does not sell them to third parties');
    });

    it('cloneContentFor resolves a stored profile language, unknown ones fall back to Turkish', () => {
      expect(cloneContentFor('en-US').consentVersion).toBe(CLONE_CONSENT_VERSION_EN);
      expect(cloneContentFor('en').testSampleText).toBe(CLONE_TEST_SAMPLE_TEXT_EN);
      expect(cloneContentFor('tr').consentVersion).toBe(CLONE_CONSENT_VERSION);
      for (const legacy of ['de-DE', '', null, undefined]) {
        expect(cloneContentFor(legacy).consentVersion).toBe(CLONE_CONSENT_VERSION);
      }
    });

    it('buildCloneConfig defaults to Turkish with every language on offer and returns fresh copies', () => {
      const config = buildCloneConfig();
      expect(config.language).toBe('tr');
      expect(config.supportedLanguages).toHaveLength(VOICE_LANGUAGES.length);
      config.introSteps[0].title = 'changed';
      config.supportedLanguages[0].nativeName = 'changed';
      expect(buildCloneConfig().introSteps[0].title).toBe('Sessiz bir oda bul');
      expect(buildCloneConfig().supportedLanguages[0].nativeName).toBe('Türkçe');
    });
  });

  describe('POST /voice-profiles/v2 (clone) stores the chosen language', () => {
    const createClone = (language?: string) =>
      service.createVoiceProfileV2('u1', {
        name: 'Annem',
        provider: 'CARTESIA',
        voiceId: 'custom-cloning-pending',
        ...(language === undefined ? {} : { language }),
      } as any);

    it.each([
      [undefined, 'tr-TR', 'tr'],
      ['tr', 'tr-TR', 'tr'],
      ['tr-TR', 'tr-TR', 'tr'],
      ['en', 'en-US', 'en'],
      ['en-US', 'en-US', 'en'],
      ['en-GB', 'en-US', 'en'],
    ])('language %p is stored as %p and answered as contentLanguage %p', async (sent, stored, code) => {
      const result: any = await createClone(sent);

      expect(prisma.voiceProfile.create.mock.calls[0][0].data).toMatchObject({
        kind: 'CLONE',
        provider: 'CARTESIA',
        status: 'PENDING',
        language: stored,
      });
      expect(result.profile).toMatchObject({ language: stored, contentLanguage: code, kind: 'CLONE' });
    });

    it('an unsupported language is a coded 400 before any slot check or write', async () => {
      const err = await createClone('de').catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'VOICE_LANGUAGE_NOT_SUPPORTED',
        supportedLanguages: ['tr', 'en'],
      });
      expect(prisma.voiceProfile.count).not.toHaveBeenCalled();
      expect(prisma.voiceProfile.create).not.toHaveBeenCalled();
    });

    it('a language switched off in the panel cannot be cloned in', async () => {
      settings.values['tts.cloneLanguages'] = ['tr'];

      await expect(createClone('en')).rejects.toBeInstanceOf(BadRequestException);
      await expect(createClone('tr')).resolves.toBeDefined();
    });

    it('the legacy POST /voice-profiles takes the language too and defaults to Turkish', async () => {
      await service.createVoiceProfile('u1', { name: 'Annem' });
      await service.createVoiceProfile('u1', { name: 'Mum', language: 'en' });

      expect(prisma.voiceProfile.create.mock.calls.map((call: any[]) => call[0].data.language)).toEqual([
        'tr-TR',
        'en-US',
      ]);
    });

    it('a ready-made voice remembers the language it was added for, whatever the body says', async () => {
      const result: any = await service.createVoiceProfileV2('u1', {
        name: 'Narrator',
        provider: 'GOOGLE',
        voiceId: 'en-US-Chirp3-HD-Achernar',
        language: 'tr',
      } as any);

      expect(prisma.voiceProfile.create.mock.calls[0][0].data).toMatchObject({
        kind: 'PRESET',
        voiceId: 'en-US-Chirp3-HD-Achernar',
        language: 'en-US',
      });
      expect(result.profile).toMatchObject({ language: 'en-US', contentLanguage: 'en' });
    });
  });

  describe('create DTO validation', () => {
    // Messages as a Turkish client gets them (the DTO holds i18n keys).
    const errorsOf = async (dto: object, body: Record<string, unknown>) =>
      (await validate(plainToInstance(dto as any, body) as object))
        .filter((e) => e.property === 'language')
        .flatMap((e) => Object.values(e.constraints ?? {}))
        .map((message) => serverText(message, 'tr'));

    const clone = (language?: unknown) => ({
      name: 'Annem',
      provider: 'CARTESIA',
      voiceId: 'custom-cloning-pending',
      ...(language === undefined ? {} : { language }),
    });

    it.each([undefined, 'tr', 'en', 'tr-TR', 'en-US', 'EN'])('a clone accepts language %p', async (language) => {
      await expect(errorsOf(CreateVoiceProfileV2Dto, clone(language))).resolves.toEqual([]);
    });

    it.each(['de', 'de-DE', 'turkish', '', 'x'])('a clone rejects language %p in Turkish', async (language) => {
      const messages = await errorsOf(CreateVoiceProfileV2Dto, clone(language));
      expect(messages).toContain('Geçersiz ses dili. Geçerli diller: tr, en.');
    });

    it('a clone rejects a language that is not a string', async () => {
      expect((await errorsOf(CreateVoiceProfileV2Dto, clone(42))).length).toBeGreaterThan(0);
    });

    it('a ready-made voice accepts any language that has ready-made voices and rejects the rest', async () => {
      const preset = (language: string) => ({
        name: 'Narrator',
        provider: 'GOOGLE',
        voiceId: 'de-DE-Chirp3-HD-Achernar',
        language,
      });
      await expect(errorsOf(CreateVoiceProfileV2Dto, preset('de-DE'))).resolves.toEqual([]);
      await expect(errorsOf(CreateVoiceProfileV2Dto, preset('tr-TR'))).resolves.toEqual([]);
      const messages = await errorsOf(CreateVoiceProfileV2Dto, preset('ru'));
      expect(messages).toEqual(['Geçersiz ses dili. Geçerli diller: tr, en, de, fr, es, it, nl, pt, ar.']);
    });

    it('the legacy create DTO validates the language as a clone language', async () => {
      await expect(errorsOf(CreateVoiceProfileDto, { name: 'Annem' })).resolves.toEqual([]);
      await expect(errorsOf(CreateVoiceProfileDto, { name: 'Annem', language: 'en' })).resolves.toEqual([]);
      expect(await errorsOf(CreateVoiceProfileDto, { name: 'Annem', language: 'fr' })).toContain(
        'Geçersiz ses dili. Geçerli diller: tr, en.',
      );
    });

    it('the rule itself', () => {
      expect(isAllowedVoiceProfileLanguage('en-US', 'CARTESIA')).toBe(true);
      expect(isAllowedVoiceProfileLanguage('en-US')).toBe(true);
      expect(isAllowedVoiceProfileLanguage('fr', 'cartesia')).toBe(false);
      expect(isAllowedVoiceProfileLanguage('fr', 'google')).toBe(true);
      expect(isAllowedVoiceProfileLanguage('ru', 'GOOGLE')).toBe(false);
      expect(isAllowedVoiceProfileLanguage('??', 'GOOGLE')).toBe(false);
      expect(isAllowedVoiceProfileLanguage(null, 'GOOGLE')).toBe(false);
      expect(voiceProfileLanguageMessage()).not.toMatch(FORBIDDEN_UI_CHARS);
      expect(voiceProfileLanguageMessage('GOOGLE')).not.toMatch(FORBIDDEN_UI_CHARS);
    });
  });

  describe('upload: the consent version of the language the clone was started in', () => {
    const reference = {
      originalname: 'reference_1.m4a',
      mimetype: 'audio/m4a',
      size: 1000,
      buffer: Buffer.from('ref'),
    } as Express.Multer.File;

    const pendingClone = (language: string) =>
      createMockVoiceProfile({
        id: 'vp-1',
        userId: 'u1',
        provider: 'CARTESIA',
        kind: 'CLONE',
        status: 'PENDING',
        voiceId: 'pending-x',
        language,
        sampleAudioUrl: null,
        consentAudioUrl: null,
      });

    const upload = (consentVersion: string) =>
      service.uploadVoiceSamples('u1', 'vp-1', { referenceAudio: reference, consentVersion } as any);

    beforeEach(() => {
      prisma.voiceProfile.updateMany.mockResolvedValue({ count: 1 });
      prisma.usageLimit.upsert.mockResolvedValue({});
      prisma.usageLimit.updateMany.mockResolvedValue({ count: 1 });
      prisma.usageLifetime.upsert.mockResolvedValue({});
      prisma.usageLifetime.updateMany.mockResolvedValue({ count: 1 });
    });

    it('an English clone needs the English consent version and stores it', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(pendingClone('en-US'));

      const result: any = await upload(CLONE_CONSENT_VERSION_EN);

      expect(prisma.voiceProfile.updateMany.mock.calls[0][0].data).toMatchObject({
        status: 'PROCESSING',
        consentVersion: CLONE_CONSENT_VERSION_EN,
      });
      expect(result.profile).toMatchObject({ status: 'PROCESSING', contentLanguage: 'en', language: 'en-US' });
      expect(queue.add).toHaveBeenCalledTimes(1);
    });

    it('the Turkish consent does not cover an English clone (and the other way round)', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(pendingClone('en-US'));
      let err = await upload(CLONE_CONSENT_VERSION).catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.getResponse()).toMatchObject({
        code: 'CONSENT_REQUIRED',
        consentVersion: CLONE_CONSENT_VERSION_EN,
        language: 'en',
      });

      prisma.voiceProfile.findFirst.mockResolvedValue(pendingClone('tr-TR'));
      err = await upload(CLONE_CONSENT_VERSION_EN).catch((e) => e);
      expect(err.getResponse()).toMatchObject({
        code: 'CONSENT_REQUIRED',
        consentVersion: CLONE_CONSENT_VERSION,
        language: 'tr',
      });
      expect(storage.uploadFile).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it.each([
      ['tr-TR', '2026-09-v1', CLONE_CONSENT_VERSION, 'tr'],
      ['en-US', '2026-10-en-v1', CLONE_CONSENT_VERSION_EN, 'en'],
    ])(
      'a %s clone consented to the text before the bump (%s) gets CONSENT_REQUIRED with the new version, so the app asks again',
      async (language, stale, current, code) => {
        prisma.voiceProfile.findFirst.mockResolvedValue(pendingClone(language));

        const err = await upload(stale).catch((e) => e);

        expect(err).toBeInstanceOf(BadRequestException);
        expect(err.getResponse()).toMatchObject({ code: 'CONSENT_REQUIRED', consentVersion: current, language: code });
        expect(storage.uploadFile).not.toHaveBeenCalled();
        expect(queue.add).not.toHaveBeenCalled();

        // The re-consent: the clone config of that language serves the version the upload now carries.
        expect(service.getCloneConfig(code).consentVersion).toBe(current);
        await expect(upload(current)).resolves.toMatchObject({ profile: { status: 'PROCESSING', contentLanguage: code } });
      },
    );

    it.each(['tr-TR', 'tr'])('a Turkish clone stored as %p still uploads with the Turkish version (builds in the field)', async (language) => {
      prisma.voiceProfile.findFirst.mockResolvedValue(pendingClone(language));

      await expect(upload(CLONE_CONSENT_VERSION)).resolves.toMatchObject({
        profile: { status: 'PROCESSING', contentLanguage: 'tr' },
      });
    });
  });

  describe('every list says which language a voice is', () => {
    const rows = () => [
      createMockVoiceProfile({ id: 'clone-tr', provider: 'CARTESIA', kind: 'CLONE', voiceId: 'c-1', language: 'tr' }),
      createMockVoiceProfile({ id: 'clone-en', provider: 'CARTESIA', kind: 'CLONE', voiceId: 'c-2', language: 'en-US' }),
      createMockVoiceProfile({ id: 'preset-tr', provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Achernar', language: 'tr-TR' }),
      createMockVoiceProfile({ id: 'preset-en', provider: 'GOOGLE', voiceId: 'en-US-Chirp3-HD-Puck', language: 'en-US' }),
      createMockVoiceProfile({ id: 'preset-de', provider: 'GOOGLE', voiceId: 'de-DE-Chirp3-HD-Kore', language: 'de-DE' }),
    ];

    beforeEach(() => {
      prisma.voiceProfile.findMany.mockResolvedValue(rows());
    });

    it('GET /voice-profiles: contentLanguage next to the stored locale, clones and ready-made voices alike', async () => {
      const list: any[] = await service.getVoiceProfiles('u1');

      expect(list.map((p) => [p.id, p.language, p.contentLanguage])).toEqual([
        ['clone-tr', 'tr', 'tr'],
        ['clone-en', 'en-US', 'en'],
        ['preset-tr', 'tr-TR', 'tr'],
        ['preset-en', 'en-US', 'en'],
        ['preset-de', 'de-DE', 'de'],
      ]);
      expect(prisma.voiceProfile.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it.each([
      ['tr', ['clone-tr', 'preset-tr']],
      ['en', ['clone-en', 'preset-en']],
      ['EN', ['clone-en', 'preset-en']],
      ['en-US', ['clone-en', 'preset-en']],
      ['tr,de', ['clone-tr', 'preset-tr', 'preset-de']],
      [['en', 'de'], ['clone-en', 'preset-en', 'preset-de']],
      ['fr', []],
      ['', ['clone-tr', 'clone-en', 'preset-tr', 'preset-en', 'preset-de']],
      [' , ', ['clone-tr', 'clone-en', 'preset-tr', 'preset-en', 'preset-de']],
    ])('GET /voice-profiles?language=%p returns %p', async (language, expected) => {
      const list: any[] = await service.getVoiceProfiles('u1', language as any);
      expect(list.map((p) => p.id)).toEqual(expected);
    });

    it('GET /voice-profiles/:id/status carries language and contentLanguage', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(rows()[1]);

      await expect(service.getVoiceProfileStatus('u1', 'clone-en')).resolves.toMatchObject({
        id: 'clone-en',
        language: 'en-US',
        contentLanguage: 'en',
      });
    });
  });

  describe('clone preview uses a sentence in the language of the voice', () => {
    const readyClone = (language: string) =>
      createMockVoiceProfile({
        id: 'vp-1',
        userId: 'u1',
        provider: 'CARTESIA',
        kind: 'CLONE',
        voiceId: 'c-1',
        language,
        sampleAudioUrl: null,
      });

    it.each([
      ['en-US', CLONE_TEST_SAMPLE_TEXT_EN],
      ['tr-TR', CLONE_TEST_SAMPLE_TEXT],
      ['tr', CLONE_TEST_SAMPLE_TEXT],
    ])('a %s clone without a stored sample reads its own language', async (language, text) => {
      prisma.voiceProfile.findFirst.mockResolvedValue(readyClone(language));

      await service.getVoiceProfileSample('u1', 'vp-1');

      expect(cartesia.textToSpeech).toHaveBeenCalledWith(text, 'c-1', { language });
      expect(storage.uploadFile.mock.calls[0][1]).toBe('voice-samples/u1/vp-1/previews/default.mp3');
    });

    it('POST /voice-profiles/preview of an own English clone: default English line, custom text untouched', async () => {
      prisma.voiceProfile.findFirst.mockResolvedValue(readyClone('en-US'));

      await service.previewVoice('u1', { voiceId: 'c-1', provider: 'CARTESIA' } as any);
      await service.previewVoice('u1', { voiceId: 'c-1', provider: 'CARTESIA', text: 'Good night.' } as any);

      expect(cartesia.textToSpeech.mock.calls.map((call: any[]) => call[0])).toEqual([
        CLONE_TEST_SAMPLE_TEXT_EN,
        'Good night.',
      ]);
      expect(cartesia.textToSpeech.mock.calls[0][2]).toEqual({ language: 'en-US' });
    });
  });
});
