import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import {
  SETTINGS_BOOT_LOAD_TIMEOUT_MS,
  SETTINGS_REFRESH_INTERVAL_MS,
  SettingsService,
} from './settings.service';
import { SETTINGS_REGISTRY } from './settings.registry';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';

const ENV_VARS = SETTINGS_REGISTRY.map((def) => def.envVar);

const row = (key: string, value: unknown, extra: Record<string, unknown> = {}) => ({
  key,
  value,
  updatedAt: new Date('2026-10-13T10:00:00Z'),
  updatedByAdminId: 'admin-1',
  ...extra,
});

describe('SettingsService', () => {
  let prisma: MockPrismaService;
  let service: SettingsService;
  let savedEnv: Record<string, string | undefined>;
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  /** Table contents the mocked Prisma serves. */
  let table: Array<ReturnType<typeof row>>;

  const find = (view: ReturnType<SettingsService['describe']>, key: string) =>
    view.groups.flatMap((g) => g.settings).find((s) => s.key === key)!;

  beforeEach(() => {
    savedEnv = {};
    for (const name of ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }

    table = [];
    prisma = createMockPrismaService();
    (prisma as any).systemSetting.findMany.mockImplementation(async () => table.map((r) => ({ ...r })));
    (prisma as any).systemSetting.upsert.mockImplementation((args: any) => args);
    (prisma as any).systemSetting.deleteMany.mockImplementation(async ({ where }: any) => {
      const before = table.length;
      table = table.filter((r) => r.key !== where.key);
      return { count: before - table.length };
    });
    prisma.$transaction.mockImplementation(async (ops: any[]) => {
      for (const op of ops) {
        table = table.filter((r) => r.key !== op.where.key);
        table.push(row(op.where.key, op.create.value, { updatedByAdminId: op.create.updatedByAdminId }));
      }
      return ops;
    });

    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    service = new SettingsService(prisma as any);
  });

  afterEach(() => {
    service.onModuleDestroy();
    for (const name of ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('resolution order: panel, then environment, then code default', () => {
    it('code default when nothing else is set', () => {
      expect(service.get('llm.gemini.temperature')).toBe(0.2);
      expect(service.get('tts.defaultProvider')).toBe('cartesia');
      expect(service.get('rateLimit.limit')).toBe(300);
      expect(service.get('i18n.fallbackLocale')).toBe('tr');
    });

    it('environment variable beats the code default, parsed to the setting type and read live', () => {
      process.env.GEMINI_TEMPERATURE = '0.7';
      process.env.TTS_PROVIDER = 'GOOGLE';
      process.env.GEMINI_TIMEOUT_MS = '30000';
      expect(service.get('llm.gemini.temperature')).toBe(0.7);
      expect(service.get('tts.defaultProvider')).toBe('google');
      expect(service.get('llm.gemini.timeoutMs')).toBe(30000);

      process.env.GEMINI_TEMPERATURE = '0.9';
      expect(service.get('llm.gemini.temperature')).toBe(0.9);
    });

    it('database override beats the environment variable', async () => {
      process.env.GEMINI_MODEL = 'env-model';
      table = [row('llm.gemini.model', 'panel-model')];
      await service.refresh();
      expect(service.get('llm.gemini.model')).toBe('panel-model');
    });

    it('an invalid or empty environment value falls through to the default with one warning (value not logged)', () => {
      process.env.TTS_GOOGLE_SPEAKING_RATE = '9.5';
      process.env.GEMINI_THINKING_BUDGET = '   ';
      expect(service.get('tts.google.speakingRate')).toBe(0.92);
      expect(service.get('tts.google.speakingRate')).toBe(0.92);
      expect(service.get('llm.gemini.thinkingBudget')).toBe(0);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('TTS_GOOGLE_SPEAKING_RATE');
      expect(warn.mock.calls[0][0]).not.toContain('9.5');
    });

    it('the stale THROTTLE_* variables are ignored; the new names are honoured', () => {
      const saved = { ttl: process.env.THROTTLE_TTL, limit: process.env.THROTTLE_LIMIT };
      process.env.THROTTLE_TTL = '60';
      process.env.THROTTLE_LIMIT = '10';
      try {
        expect(service.get('rateLimit.limit')).toBe(300);
        process.env.RATE_LIMIT_MAX_REQUESTS = '120';
        process.env.RATE_LIMIT_TTL_SECONDS = '30';
        expect(service.get('rateLimit.limit')).toBe(120);
        expect(service.get('rateLimit.ttl')).toBe(30);
      } finally {
        if (saved.ttl === undefined) delete process.env.THROTTLE_TTL;
        else process.env.THROTTLE_TTL = saved.ttl;
        if (saved.limit === undefined) delete process.env.THROTTLE_LIMIT;
        else process.env.THROTTLE_LIMIT = saved.limit;
      }
    });

    it('an unknown key is a programming error', () => {
      expect(() => service.get('llm.gemini.apiKey' as any)).toThrow('Unknown setting key: llm.gemini.apiKey');
    });
  });

  describe('cache: load at start, periodic refresh', () => {
    it('loads the overrides in onModuleInit', async () => {
      table = [row('tts.cartesia.defaultSpeed', 1.1)];
      await service.onModuleInit();
      expect(service.get('tts.cartesia.defaultSpeed')).toBe(1.1);
    });

    it('picks up a change made elsewhere on the next interval tick, and a removed row falls back', async () => {
      jest.useFakeTimers();
      await service.onModuleInit();
      expect(service.get('llm.gemini.model')).toBe('gemini-3-flash-preview');

      table = [row('llm.gemini.model', 'changed-elsewhere')];
      await jest.advanceTimersByTimeAsync(SETTINGS_REFRESH_INTERVAL_MS - 1);
      expect(service.get('llm.gemini.model')).toBe('gemini-3-flash-preview');
      await jest.advanceTimersByTimeAsync(1);
      expect(service.get('llm.gemini.model')).toBe('changed-elsewhere');

      table = [];
      await jest.advanceTimersByTimeAsync(SETTINGS_REFRESH_INTERVAL_MS);
      expect(service.get('llm.gemini.model')).toBe('gemini-3-flash-preview');
      expect((prisma as any).systemSetting.findMany).toHaveBeenCalledTimes(3);
    });

    it('onModuleDestroy stops the refresh (and is safe to call twice or before init)', async () => {
      jest.useFakeTimers();
      new SettingsService(prisma as any).onModuleDestroy();
      await service.onModuleInit();
      service.onModuleDestroy();
      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(SETTINGS_REFRESH_INTERVAL_MS * 3);
      expect((prisma as any).systemSetting.findMany).toHaveBeenCalledTimes(1);
    });

    it('ignores rows for unknown keys and rows that no longer pass validation', async () => {
      table = [
        row('removed.setting', 1),
        row('tts.google.speakingRate', 9),
        row('tts.google.pitch', 1.5),
      ];
      await expect(service.refresh()).resolves.toBe(true);
      expect(service.get('tts.google.speakingRate')).toBe(0.92);
      expect(service.get('tts.google.pitch')).toBe(1.5);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('tts.google.speakingRate'));
    });

    it('notifies listeners only when an override actually changed; a failing listener does not break others', async () => {
      const bad = jest.fn(() => {
        throw new Error('boom');
      });
      const good = jest.fn();
      service.onChange(bad);
      const unsubscribe = service.onChange(good);

      await service.refresh();
      expect(good).not.toHaveBeenCalled();

      table = [row('tts.google.pitch', 1)];
      await service.refresh();
      await service.refresh();
      expect(good).toHaveBeenCalledTimes(1);
      expect(bad).toHaveBeenCalledTimes(1);

      table = [row('tts.google.pitch', 2)];
      await service.refresh();
      expect(good).toHaveBeenCalledTimes(2);

      unsubscribe();
      table = [];
      await service.refresh();
      expect(good).toHaveBeenCalledTimes(2);
      expect(bad).toHaveBeenCalledTimes(3);
    });
  });

  describe('database down', () => {
    it('boot does not throw: environment and default values are served, one warning is logged', async () => {
      (prisma as any).systemSetting.findMany.mockRejectedValue(new Error("Can't reach database server at localhost:5439"));
      process.env.GEMINI_MODEL = 'env-model';

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(service.get('llm.gemini.model')).toBe('env-model');
      expect(service.get('rateLimit.limit')).toBe(300);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('Could not load settings from the database');
    });

    it('a non-Error rejection is handled too', async () => {
      (prisma as any).systemSetting.findMany.mockRejectedValue('plain failure');
      await expect(service.refresh()).resolves.toBe(false);
      expect(warn.mock.calls[0][0]).toContain('plain failure');
    });

    it('boot does not hang on a database that never answers', async () => {
      jest.useFakeTimers();
      (prisma as any).systemSetting.findMany.mockReturnValue(new Promise(() => undefined));

      let done = false;
      const boot = service.onModuleInit().then(() => {
        done = true;
      });
      await jest.advanceTimersByTimeAsync(SETTINGS_BOOT_LOAD_TIMEOUT_MS - 1);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await boot;

      expect(service.get('tts.defaultProvider')).toBe('cartesia');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not load from the database in time'));
    });

    it('an outage after a good load keeps the last overrides, warns once, and recovers', async () => {
      jest.useFakeTimers();
      table = [row('llm.gemini.temperature', 0.6)];
      await service.onModuleInit();

      (prisma as any).systemSetting.findMany.mockRejectedValue(new Error('connection lost'));
      await jest.advanceTimersByTimeAsync(SETTINGS_REFRESH_INTERVAL_MS * 3);
      expect(service.get('llm.gemini.temperature')).toBe(0.6);
      expect(warn).toHaveBeenCalledTimes(1);

      table = [row('llm.gemini.temperature', 0.4)];
      (prisma as any).systemSetting.findMany.mockImplementation(async () => table);
      await jest.advanceTimersByTimeAsync(SETTINGS_REFRESH_INTERVAL_MS);
      expect(service.get('llm.gemini.temperature')).toBe(0.4);
      expect(log).toHaveBeenCalledWith('Settings database is reachable again.');
    });
  });

  describe('describe (GET /admin/settings)', () => {
    it('groups the whole registry in display order with Turkish labels', () => {
      const view = service.describe();
      expect(view.groups.map((g) => g.id)).toEqual(['rateLimit', 'i18n', 'content', 'llm', 'tts']);
      expect(view.groups.flatMap((g) => g.settings).map((s) => s.key)).toEqual(SETTINGS_REGISTRY.map((d) => d.key));
      expect(view.groups[2]).toMatchObject({ label: 'İçerik dilleri' });
      expect(view.groups[3]).toMatchObject({ label: 'Yapay zeka (Gemini)' });
    });

    it('reports value, source and the fallback a reset would give for each layer', async () => {
      process.env.GEMINI_TEMPERATURE = '0.5';
      table = [row('llm.gemini.temperature', 0.9), row('tts.google.pitch', 3)];
      await service.refresh();
      const view = service.describe();

      expect(find(view, 'llm.gemini.temperature')).toEqual({
        key: 'llm.gemini.temperature',
        group: 'llm',
        type: 'float',
        label: 'Sıcaklık',
        description: expect.any(String),
        unit: null,
        constraints: {
          min: 0,
          max: 2,
          step: 0.05,
          options: null,
          optionLabels: null,
          pattern: null,
          maxLength: null,
        },
        value: 0.9,
        source: 'panel',
        fallbackValue: 0.5,
        fallbackSource: 'env',
        defaultValue: 0.2,
        envVar: 'GEMINI_TEMPERATURE',
        updatedAt: '2026-10-13T10:00:00.000Z',
        updatedByAdminId: 'admin-1',
      });
      expect(find(view, 'tts.google.pitch')).toMatchObject({
        value: 3,
        source: 'panel',
        fallbackValue: -2,
        fallbackSource: 'default',
      });
      expect(find(view, 'llm.gemini.timeoutMs')).toMatchObject({
        value: 120000,
        source: 'default',
        fallbackValue: 120000,
        fallbackSource: 'default',
        unit: 'ms',
        updatedAt: null,
        updatedByAdminId: null,
      });
      process.env.TTS_PROVIDER = 'google';
      expect(find(service.describe(), 'tts.defaultProvider')).toMatchObject({
        value: 'google',
        source: 'env',
        constraints: expect.objectContaining({ options: ['google', 'cartesia'] }),
      });
      expect(find(view, 'llm.gemini.model').constraints).toMatchObject({
        pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$',
        maxLength: 100,
      });
    });
  });

  describe('update (PATCH /admin/settings)', () => {
    it('validates, persists in one transaction with the admin id, applies at once and audits', async () => {
      const listener = jest.fn();
      service.onChange(listener);

      const view = await service.update(
        { 'llm.gemini.model': ' gemini-3.8-flash ', 'tts.google.speakingRate': '1.05' },
        'admin-7',
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect((prisma as any).systemSetting.upsert.mock.calls.map((c: any[]) => c[0])).toEqual([
        {
          where: { key: 'llm.gemini.model' },
          create: { key: 'llm.gemini.model', value: 'gemini-3.8-flash', updatedByAdminId: 'admin-7' },
          update: { value: 'gemini-3.8-flash', updatedByAdminId: 'admin-7' },
        },
        {
          where: { key: 'tts.google.speakingRate' },
          create: { key: 'tts.google.speakingRate', value: 1.05, updatedByAdminId: 'admin-7' },
          update: { value: 1.05, updatedByAdminId: 'admin-7' },
        },
      ]);

      expect(service.get('llm.gemini.model')).toBe('gemini-3.8-flash');
      expect(service.get('tts.google.speakingRate')).toBe(1.05);
      expect(find(view, 'llm.gemini.model')).toMatchObject({
        value: 'gemini-3.8-flash',
        source: 'panel',
        updatedByAdminId: 'admin-7',
      });
      expect(listener).toHaveBeenCalledTimes(1);

      const audit = log.mock.calls.map((c) => c[0]).filter((m) => String(m).startsWith('AUDIT'));
      expect(audit).toEqual([
        'AUDIT setting changed key=llm.gemini.model old="gemini-3-flash-preview" new="gemini-3.8-flash" admin=admin-7',
        'AUDIT setting changed key=tts.google.speakingRate old=0.92 new=1.05 admin=admin-7',
      ]);
    });

    it('serves the new value even when the re-read after the write fails', async () => {
      (prisma as any).systemSetting.findMany.mockRejectedValue(new Error('down'));
      await service.update({ 'tts.cartesia.defaultEmotion': 'calm' }, null);
      expect(service.get('tts.cartesia.defaultEmotion')).toBe('calm');
      expect(log.mock.calls.map((c) => c[0])).toContainEqual(expect.stringContaining('admin=unknown'));
    });

    it.each([
      [{ 'llm.gemini.apiKey': 'x' }, 'Bilinmeyen ayar anahtarı: "llm.gemini.apiKey".'],
      [{ 'tts.google.speakingRate': 2.5 }, '"tts.google.speakingRate" ayarı 0.25 ile 2 arasında olmalıdır.'],
      [
        { 'llm.gemini.temperature': 0.3, 'tts.defaultProvider': 'azure' },
        '"tts.defaultProvider" ayarı şu değerlerden biri olmalıdır: google, cartesia.',
      ],
      [{}, 'Değiştirilecek en az bir ayar gönderilmelidir.'],
      [undefined, 'Değiştirilecek en az bir ayar gönderilmelidir.'],
    ])('rejects %j with a Turkish 400 and writes nothing', async (values, expected) => {
      const error = await service.update(values as any, 'admin-1').catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toBe(expected);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(service.get('llm.gemini.temperature')).toBe(0.2);
    });

    it('a failed transaction leaves the in-memory values untouched', async () => {
      prisma.$transaction.mockRejectedValue(new Error('write failed'));
      await expect(service.update({ 'llm.gemini.temperature': 1 }, 'admin-1')).rejects.toThrow('write failed');
      expect(service.get('llm.gemini.temperature')).toBe(0.2);
    });
  });

  describe('reset (DELETE /admin/settings/:key)', () => {
    it('removes the override, falls back to env then default, audits and notifies', async () => {
      process.env.GEMINI_TEMPERATURE = '0.5';
      table = [row('llm.gemini.temperature', 0.9)];
      await service.refresh();
      const listener = jest.fn();
      service.onChange(listener);

      const view = await service.reset('llm.gemini.temperature', 'admin-2');

      expect((prisma as any).systemSetting.deleteMany).toHaveBeenCalledWith({ where: { key: 'llm.gemini.temperature' } });
      expect(view).toMatchObject({ key: 'llm.gemini.temperature', value: 0.5, source: 'env', updatedAt: null });
      expect(service.get('llm.gemini.temperature')).toBe(0.5);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'AUDIT setting reset key=llm.gemini.temperature old=0.9 new=0.5 admin=admin-2',
      );
    });

    it('is idempotent for a setting without an override', async () => {
      const listener = jest.fn();
      service.onChange(listener);
      await expect(service.reset('tts.google.pitch', null)).resolves.toMatchObject({ value: -2, source: 'default' });
      expect(listener).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('AUDIT setting reset key=tts.google.pitch old=-2 new=-2 admin=unknown');
    });

    it('unknown key -> 404 with a Turkish message, nothing deleted', async () => {
      const error = await service.reset('nope', 'admin-1').catch((e) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('Bilinmeyen ayar anahtarı: "nope".');
      expect((prisma as any).systemSetting.deleteMany).not.toHaveBeenCalled();
    });
  });
});
