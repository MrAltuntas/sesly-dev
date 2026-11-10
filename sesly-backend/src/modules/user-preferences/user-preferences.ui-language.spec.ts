import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserPreferencesService } from './user-preferences.service';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { normaliseUiLanguagePreference } from './content-language-preference';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockUserPreferences } from '../../test-utils/mock-factories';
import { createSettingsStub } from '../../test-utils/settings-stub';
import { serverText } from '../../common/i18n/server-text';

const USER = 'auth-user-1';

const check = async (plain: Record<string, unknown>) => {
  const dto = plainToInstance(UpdateUserPreferencesDto, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors, messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
};

describe('UI language preference (uiLanguage)', () => {
  let prisma: MockPrismaService;
  let service: UserPreferencesService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new UserPreferencesService(
      prisma as any,
      createSettingsStub({ 'content.enabledLanguages': ['tr', 'en'], 'content.defaultLanguage': 'tr' }) as any,
    );
    prisma.userPreferences.findUnique.mockResolvedValue(null);
    prisma.userPreferences.upsert.mockImplementation(async (args: any) => ({
      ...createMockUserPreferences({ userId: USER }),
      ...args.create,
      ...args.update,
    }));
  });

  describe('request body', () => {
    it.each([
      ['en', 'en'],
      ['EN', 'en'],
      ['en-US', 'en'],
      ['tr_TR', 'tr'],
      ['TR', 'tr'],
    ])('accepts %p as %p', async (value, expected) => {
      const { dto, errors } = await check({ uiLanguage: value });
      expect(errors).toHaveLength(0);
      expect(dto.uiLanguage).toBe(expected);
    });

    it('null and a blank string clear it', async () => {
      expect((await check({ uiLanguage: null })).dto.uiLanguage).toBeNull();
      expect((await check({ uiLanguage: '  ' })).dto.uiLanguage).toBeNull();
    });

    it.each(['de', 'english', 'xx-YY', 5, true])('rejects %p with a localized message', async (value) => {
      const { messages } = await check({ uiLanguage: value });
      expect(messages).toEqual(['errors.validation.uiLanguage']);
      expect(serverText(messages[0], 'tr')).toBe('Geçersiz arayüz dili. Geçerli diller: tr, en.');
      expect(serverText(messages[0], 'en')).toBe('Invalid UI language. Valid languages: tr, en.');
    });

    it('a body without it (app builds in the field) stays valid', async () => {
      const { dto, errors } = await check({ promoNotifications: true });
      expect(errors).toHaveLength(0);
      expect(dto.uiLanguage).toBeUndefined();
    });

    it('normaliseUiLanguagePreference leaves junk for the validator', () => {
      expect(normaliseUiLanguagePreference('de')).toBe('de');
      expect(normaliseUiLanguagePreference(7)).toBe(7);
      expect(normaliseUiLanguagePreference('EN-gb')).toBe('en');
    });
  });

  describe('PATCH /users/me/preferences', () => {
    it('stores it and answers with it', async () => {
      const res = await service.update(USER, { uiLanguage: 'en' });

      const call = prisma.userPreferences.upsert.mock.calls[0][0];
      expect(call.update).toEqual({ uiLanguage: 'en' });
      expect(call.create).toMatchObject({ userId: USER, uiLanguage: 'en' });
      expect(res.uiLanguage).toBe('en');
    });

    it('null clears it; not sent leaves the column alone', async () => {
      await service.update(USER, { uiLanguage: null });
      expect(prisma.userPreferences.upsert.mock.calls[0][0].update).toEqual({ uiLanguage: null });

      await service.update(USER, { promoNotifications: true });
      expect(prisma.userPreferences.upsert.mock.calls[1][0].update).toEqual({ promoNotifications: true });
    });
  });

  describe('GET /users/me/preferences', () => {
    it('null when never set, the stored value otherwise', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue(createMockUserPreferences({ userId: USER }));
      expect((await service.getOrCreate(USER)).uiLanguage).toBeNull();

      prisma.userPreferences.findUnique.mockResolvedValue({
        ...createMockUserPreferences({ userId: USER }),
        uiLanguage: 'en',
      });
      expect((await service.getOrCreate(USER)).uiLanguage).toBe('en');
    });
  });
});
