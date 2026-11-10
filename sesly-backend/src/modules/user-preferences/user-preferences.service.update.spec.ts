import { BadRequestException } from '@nestjs/common';
import { UserPreferencesService } from './user-preferences.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { createMockUserPreferences } from '../../test-utils/mock-factories';
import { SettingsStub, createSettingsStub } from '../../test-utils/settings-stub';

const USER = 'auth-user-1';

const RESPONSE_KEYS = [
  'contentLanguage',
  'createdAt',
  'effectiveContentLanguage',
  'narrationReadyNotifications',
  'promoNotifications',
  'settings',
  'sleepTimerFadeOut',
  'sleepTimerLastDuration',
  'sleepTimerPauseWhenAsleep',
  'uiLanguage',
  'updatedAt',
  'userId',
  'voiceReadyNotifications',
];

describe('UserPreferencesService get / update', () => {
  let prisma: MockPrismaService;
  let service: UserPreferencesService;
  let settings: SettingsStub;

  beforeEach(() => {
    prisma = createMockPrismaService();
    settings = createSettingsStub({ 'content.enabledLanguages': ['tr', 'en'] });
    service = new UserPreferencesService(prisma as any, settings as any);

    // upsert echoes a row built from what would be written (update branch
    // over an existing row, or the create branch when there is none).
    prisma.userPreferences.upsert.mockImplementation(async (args: any) =>
      createMockUserPreferences({ userId: USER, ...args.create, ...args.update }),
    );
  });

  // -------------------------------------------------------------------------
  describe('getOrCreate', () => {
    it('returns the existing row without creating one', async () => {
      const row = createMockUserPreferences({ userId: USER, settings: { theme: 'dark' }, promoNotifications: true });
      prisma.userPreferences.findUnique.mockResolvedValue(row);

      const res = await service.getOrCreate(USER);

      expect(prisma.userPreferences.findUnique).toHaveBeenCalledWith({ where: { userId: USER } });
      expect(prisma.userPreferences.create).not.toHaveBeenCalled();
      expect(Object.keys(res).sort()).toEqual(RESPONSE_KEYS);
      expect(res).toMatchObject({ userId: USER, settings: { theme: 'dark' }, promoNotifications: true });
    });

    it('lazily creates the row with schema defaults (only userId is sent)', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue(null);
      prisma.userPreferences.create.mockResolvedValue(createMockUserPreferences({ userId: USER }));

      const res = await service.getOrCreate(USER);

      expect(prisma.userPreferences.create).toHaveBeenCalledWith({ data: { userId: USER } });
      expect(res).toMatchObject({
        userId: USER,
        voiceReadyNotifications: true,
        narrationReadyNotifications: true,
        promoNotifications: false,
        settings: {},
      });
    });

    it('does not leak extra DB columns into the response', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({
        ...createMockUserPreferences({ userId: USER }),
        internalFlag: 'x',
        user: { passwordHash: 'SECRET' },
      });
      const res = await service.getOrCreate(USER);
      expect(Object.keys(res).sort()).toEqual(RESPONSE_KEYS);
    });

    it.each([
      ['null', null],
      ['an array', ['a', 'b']],
      ['a string', 'dark'],
      ['a number', 42],
    ])('a stored settings value that is %s is normalised to {}', async (_label, stored) => {
      prisma.userPreferences.findUnique.mockResolvedValue(
        createMockUserPreferences({ userId: USER, settings: stored }),
      );
      const res = await service.getOrCreate(USER);
      expect(res.settings).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  describe('update', () => {
    it('shallow-merges settings into the stored bag (unrelated keys kept, sent keys replaced)', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({
        settings: { theme: 'light', language: 'tr', player: { speed: 1, loop: true } },
      });

      const res = await service.update(USER, { settings: { theme: 'dark', player: { speed: 1.25 } } });

      const merged = { theme: 'dark', language: 'tr', player: { speed: 1.25 } };
      const args = prisma.userPreferences.upsert.mock.calls[0][0];
      expect(prisma.userPreferences.findUnique).toHaveBeenCalledWith({
        where: { userId: USER },
        select: { settings: true },
      });
      expect(args.where).toEqual({ userId: USER });
      expect(args.update).toEqual({ settings: merged });
      expect(args.create).toEqual({ userId: USER, settings: merged });
      expect(res.settings).toEqual(merged);
    });

    it('explicit fields only: unset keys are never written (no accidental nulling)', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ settings: { theme: 'dark' } });

      await service.update(USER, { promoNotifications: true });

      const args = prisma.userPreferences.upsert.mock.calls[0][0];
      expect(args.update).toEqual({ promoNotifications: true });
      // settings untouched on update; create still seeds the existing bag.
      expect(args.update).not.toHaveProperty('settings');
      expect(args.create).toEqual({ userId: USER, promoNotifications: true, settings: { theme: 'dark' } });
    });

    it('writes every explicit column that was provided, including false values', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue(null);

      await service.update(USER, {
        sleepTimerFadeOut: false,
        sleepTimerPauseWhenAsleep: true,
        sleepTimerLastDuration: 45,
        voiceReadyNotifications: false,
        narrationReadyNotifications: false,
        promoNotifications: false,
      });

      expect(prisma.userPreferences.upsert.mock.calls[0][0].update).toEqual({
        sleepTimerFadeOut: false,
        sleepTimerPauseWhenAsleep: true,
        sleepTimerLastDuration: 45,
        voiceReadyNotifications: false,
        narrationReadyNotifications: false,
        promoNotifications: false,
      });
    });

    it('sleepTimerLastDuration: null clears the value', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue(null);

      const res = await service.update(USER, { sleepTimerLastDuration: null });

      expect(prisma.userPreferences.upsert.mock.calls[0][0].update).toEqual({ sleepTimerLastDuration: null });
      expect(res.sleepTimerLastDuration).toBeNull();
    });

    it('a missing row (brand-new user) is created with {} settings, never SQL NULL', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue(null);

      await service.update(USER, { sleepTimerFadeOut: true });

      expect(prisma.userPreferences.upsert.mock.calls[0][0].create).toEqual({
        userId: USER,
        sleepTimerFadeOut: true,
        settings: {},
      });
    });

    it('a corrupt stored settings value (array) is replaced, not spread into the merge', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ settings: ['x', 'y'] });

      await service.update(USER, { settings: { theme: 'dark' } });

      expect(prisma.userPreferences.upsert.mock.calls[0][0].update).toEqual({ settings: { theme: 'dark' } });
    });

    it('rejects a merged settings payload over 4096 bytes with 400 and writes nothing', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue({ settings: { a: 'x'.repeat(3000) } });

      const err = await service
        .update(USER, { settings: { b: 'y'.repeat(1100) } })
        .catch((e) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.message).toMatch(/^Settings object too large \(max 4096B, got \d+B\)$/);
      expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
    });

    it('the 4096-byte cap is measured in UTF-8 bytes and is inclusive', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue(null);
      // {"k":"..."} = 8 bytes of JSON overhead.
      const exactly = { k: 'a'.repeat(4096 - 8) };
      expect(Buffer.byteLength(JSON.stringify(exactly), 'utf8')).toBe(4096);
      await expect(service.update(USER, { settings: exactly })).resolves.toBeDefined();

      // Multi-byte Turkish characters count double: 2100 x 'ş' is > 4096 bytes
      // even though it is well under 4096 characters.
      prisma.userPreferences.upsert.mockClear();
      await expect(service.update(USER, { settings: { k: 'ş'.repeat(2100) } })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
    });

    it('the size cap is not applied when settings is not being updated', async () => {
      // A legacy oversized bag must not block toggling a notification.
      prisma.userPreferences.findUnique.mockResolvedValue({ settings: { a: 'x'.repeat(10_000) } });

      await expect(service.update(USER, { promoNotifications: false })).resolves.toBeDefined();
      expect(prisma.userPreferences.upsert.mock.calls[0][0].update).toEqual({ promoNotifications: false });
    });

    it('returns the response DTO shape', async () => {
      prisma.userPreferences.findUnique.mockResolvedValue(null);
      const res = await service.update(USER, { sleepTimerFadeOut: true });
      expect(Object.keys(res).sort()).toEqual(RESPONSE_KEYS);
      expect(res.userId).toBe(USER);
    });
  });
});
