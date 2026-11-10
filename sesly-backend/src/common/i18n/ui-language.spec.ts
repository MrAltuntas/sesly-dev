import {
  DEFAULT_UI_LANGUAGE,
  parseUiLanguage,
  uiLanguageFromAcceptLanguage,
  uiLanguageOrDefault,
} from './ui-language';
import {
  recordUserUiLanguage,
  resolveUserUiLanguage,
  resolveUserUiLanguages,
} from './user-ui-language';

describe('UI language', () => {
  it('parseUiLanguage: tr / en, any case, region suffix ignored; anything else is null', () => {
    for (const value of ['en', 'EN', 'en-US', 'en_GB', ' en ']) expect(parseUiLanguage(value)).toBe('en');
    for (const value of ['tr', 'TR', 'tr-TR']) expect(parseUiLanguage(value)).toBe('tr');
    for (const value of ['de', 'de-DE', 'english', '', '*', null, undefined, 5, 'en,tr']) {
      expect(parseUiLanguage(value)).toBeNull();
    }
  });

  it('Accept-Language: the first entry decides', () => {
    expect(uiLanguageFromAcceptLanguage('en')).toBe('en');
    expect(uiLanguageFromAcceptLanguage('en-US,en;q=0.9,tr;q=0.8')).toBe('en');
    expect(uiLanguageFromAcceptLanguage('tr-TR,tr;q=0.9')).toBe('tr');
    expect(uiLanguageFromAcceptLanguage(['en-GB'])).toBe('en');
    expect(uiLanguageFromAcceptLanguage('de-DE,en;q=0.5')).toBeNull();
    expect(uiLanguageFromAcceptLanguage('*')).toBeNull();
    expect(uiLanguageFromAcceptLanguage(undefined)).toBeNull();
  });

  it('the default is Turkish', () => {
    expect(DEFAULT_UI_LANGUAGE).toBe('tr');
    expect(uiLanguageOrDefault(null)).toBe('tr');
    expect(uiLanguageOrDefault('EN')).toBe('en');
  });
});

describe('stored UI language of users', () => {
  const prismaWith = (overrides: Record<string, jest.Mock>) => ({
    userPreferences: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({}),
      ...overrides,
    },
  });

  it('resolve: the stored language, else Turkish (no row, junk value, database error, no user)', async () => {
    const prisma = prismaWith({ findUnique: jest.fn().mockResolvedValue({ uiLanguage: 'en' }) });
    await expect(resolveUserUiLanguage(prisma as any, 'u1')).resolves.toBe('en');
    expect(prisma.userPreferences.findUnique).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: { uiLanguage: true },
    });

    await expect(resolveUserUiLanguage(prismaWith({}) as any, 'u1')).resolves.toBe('tr');
    const junk = prismaWith({ findUnique: jest.fn().mockResolvedValue({ uiLanguage: 'xx' }) });
    await expect(resolveUserUiLanguage(junk as any, 'u1')).resolves.toBe('tr');
    const broken = prismaWith({ findUnique: jest.fn().mockRejectedValue(new Error('db down')) });
    await expect(resolveUserUiLanguage(broken as any, 'u1')).resolves.toBe('tr');
    await expect(resolveUserUiLanguage(prismaWith({}) as any, null)).resolves.toBe('tr');
  });

  it('resolve many: one query, every id in the map', async () => {
    const prisma = prismaWith({
      findMany: jest.fn().mockResolvedValue([{ userId: 'u2', uiLanguage: 'en' }]),
    });
    const map = await resolveUserUiLanguages(prisma as any, ['u1', 'u2', 'u1', null]);
    expect(prisma.userPreferences.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.userPreferences.findMany).toHaveBeenCalledWith({
      where: { userId: { in: ['u1', 'u2'] } },
      select: { userId: true, uiLanguage: true },
    });
    expect([...map.entries()]).toEqual([
      ['u1', 'tr'],
      ['u2', 'en'],
    ]);

    const empty = prismaWith({});
    expect((await resolveUserUiLanguages(empty as any, [])).size).toBe(0);
    expect(empty.userPreferences.findMany).not.toHaveBeenCalled();
    const broken = prismaWith({ findMany: jest.fn().mockRejectedValue(new Error('db down')) });
    expect([...(await resolveUserUiLanguages(broken as any, ['u1'])).values()]).toEqual(['tr']);
  });

  it('record: upserts a known language, ignores null and never throws', async () => {
    const prisma = prismaWith({});
    await recordUserUiLanguage(prisma as any, 'u1', 'en');
    expect(prisma.userPreferences.upsert).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      update: { uiLanguage: 'en' },
      create: { userId: 'u1', uiLanguage: 'en' },
    });

    await recordUserUiLanguage(prisma as any, 'u1', null);
    expect(prisma.userPreferences.upsert).toHaveBeenCalledTimes(1);

    const broken = prismaWith({ upsert: jest.fn().mockRejectedValue(new Error('db down')) });
    await expect(recordUserUiLanguage(broken as any, 'u1', 'tr')).resolves.toBeUndefined();
  });
});
