import { renderMessage } from '../../test-utils/i18n';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserPreferencesService } from './user-preferences.service';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { normaliseContentLanguagePreference } from './content-language-preference';
import { CONTENT_LANGUAGE_MESSAGE } from '../../common/constants/content-languages';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockUserPreferences } from '../../test-utils/mock-factories';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

const USER = 'auth-user-1';

const check = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateUserPreferencesDto, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors, messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
};

describe('content language preference ("Masal dili")', () => {
  let prisma: MockPrismaService;
  let settings: SettingsStub;
  let service: UserPreferencesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    settings = createSettingsStub({
      'content.enabledLanguages': ['tr', 'en'],
      'content.defaultLanguage': 'tr',
    });
    service = new UserPreferencesService(prisma as any, settings as any);
    prisma.userPreferences.findUnique.mockResolvedValue(null);
    prisma.userPreferences.upsert.mockImplementation(async (args: any) => ({
      ...createMockUserPreferences({ userId: USER }),
      contentLanguage: null,
      ...args.create,
      ...args.update,
    }));
  });

  describe('GET /users/me/preferences', () => {
    it('a user who never chose has null and the default language as the effective one', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue(createMockUserPreferences({ userId: USER }));

      const res = await service.getOrCreate(USER);

      expect(res.contentLanguage).toBeNull();
      expect(res.effectiveContentLanguage).toBe('tr');
    });

    it('returns the stored language; the default setting is read at call time', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({
        ...createMockUserPreferences({ userId: USER }),
        contentLanguage: 'en',
      });
      expect(await service.getOrCreate(USER)).toMatchObject({
        contentLanguage: 'en',
        effectiveContentLanguage: 'en',
      });

      // The admin switches English off: the stored value stays, the effective one falls back.
      settings.values['content.enabledLanguages'] = ['tr', 'de'];
      settings.values['content.defaultLanguage'] = 'de';
      expect(await service.getOrCreate(USER)).toMatchObject({
        contentLanguage: 'en',
        effectiveContentLanguage: 'de',
      });
    });
  });

  describe('PATCH /users/me/preferences', () => {
    it('stores an enabled language and answers with it', async () => {
      const res = await service.update(USER, { contentLanguage: 'en' });

      const args = prisma.userPreferences.upsert.mock.calls[0][0];
      expect(args.update).toEqual({ contentLanguage: 'en' });
      expect(args.create).toMatchObject({ userId: USER, contentLanguage: 'en' });
      expect(res).toMatchObject({ contentLanguage: 'en', effectiveContentLanguage: 'en' });
    });

    it('null clears it: back to the default language', async () => {
      const res = await service.update(USER, { contentLanguage: null });

      expect(prisma.userPreferences.upsert.mock.calls[0][0].update).toEqual({ contentLanguage: null });
      expect(res).toMatchObject({ contentLanguage: null, effectiveContentLanguage: 'tr' });
    });

    it('not sent: the column is not written', async () => {
      await service.update(USER, { promoNotifications: true });

      expect(prisma.userPreferences.upsert.mock.calls[0][0].update).toEqual({ promoNotifications: true });
    });

    it('400 CONTENT_LANGUAGE_NOT_ENABLED for a language that is switched off; nothing is written', async () => {
      const error: any = await service.update(USER, { contentLanguage: 'de' }).catch((e) => e);

      expect(error.getStatus()).toBe(400);
      expect(error.getResponse()).toMatchObject({
        code: 'CONTENT_LANGUAGE_NOT_ENABLED',
        message: 'errors.preferences.contentLanguageNotEnabled',
        enabledLanguages: ['tr', 'en'],
      });
      expect(renderMessage(error)).toBe('Almanca şu anda masal dili olarak seçilemiyor.');
      expect(renderMessage(error, 'en')).toBe('German cannot be chosen as the story language right now.');
      expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
      expect(prisma.userPreferences.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('request body', () => {
    it('normalises the code; null and a blank string both mean "clear"', async () => {
      expect((await check({ contentLanguage: ' EN-gb ' })).dto.contentLanguage).toBe('en');
      expect((await check({ contentLanguage: null })).dto.contentLanguage).toBeNull();
      expect((await check({ contentLanguage: '  ' })).dto.contentLanguage).toBeNull();
      for (const value of [' EN-gb ', null, '  ']) {
        expect((await check({ contentLanguage: value })).errors).toHaveLength(0);
      }
    });

    it('a code that is not a content language is a 400 with the shared Turkish message', async () => {
      expect((await check({ contentLanguage: 'da' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
      expect((await check({ contentLanguage: 7 })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
    });

    it('a body without it (old clients) is valid and leaves it undefined', async () => {
      const { dto, errors } = await check({ sleepTimerFadeOut: false });
      expect(errors).toHaveLength(0);
      expect(dto.contentLanguage).toBeUndefined();
    });

    it('normaliseContentLanguagePreference', () => {
      expect(normaliseContentLanguagePreference(null)).toBeNull();
      expect(normaliseContentLanguagePreference('')).toBeNull();
      expect(normaliseContentLanguagePreference('tr-TR')).toBe('tr');
      expect(normaliseContentLanguagePreference(undefined)).toBeUndefined();
      expect(normaliseContentLanguagePreference(3)).toBe(3);
    });
  });
});
