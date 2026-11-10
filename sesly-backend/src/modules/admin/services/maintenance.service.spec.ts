import { MaintenanceService } from './maintenance.service';

// Never talk to a real Redis: every `new Redis()` returns an in-memory fake.
const mockRedisInstances: any[] = [];
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((opts: any) => {
    const store = new Map<string, string>();
    const inst = {
      opts,
      store,
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
      quit: jest.fn().mockResolvedValue('OK'),
      on: jest.fn(),
    };
    mockRedisInstances.push(inst);
    return inst;
  }),
}));

const REDIS_KEY = 'sesly:maintenance-mode';

describe('MaintenanceService', () => {
  let now: number;
  let dateSpy: jest.SpyInstance;
  let config: { get: jest.Mock };
  let service: MaintenanceService;

  const redis = () => mockRedisInstances[mockRedisInstances.length - 1];
  const flush = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    mockRedisInstances.length = 0;
    now = 1_000_000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    config = {
      get: jest.fn((key: string) =>
        ({ 'redis.host': 'redis.test', 'redis.port': 6390, 'redis.password': 'pw' })[key],
      ),
    };
    service = new MaintenanceService(config as any);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  describe('before init (no Redis client)', () => {
    it('reads default to OFF and never throw', async () => {
      await expect(service.getEnabled()).resolves.toBe(false);
      expect(service.getEnabledSync()).toBe(false);
      await flush();
    });

    it('setEnabled refuses to pretend it persisted', async () => {
      await expect(service.setEnabled(true)).rejects.toThrow(/not initialized/);
      expect(service.getEnabledSync()).toBe(false);
    });

    it('onModuleDestroy is a no-op', async () => {
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    });
  });

  describe('onModuleInit', () => {
    it('connects with the configured redis settings and registers an error handler', async () => {
      await service.onModuleInit();

      expect(redis().opts).toMatchObject({
        host: 'redis.test',
        port: 6390,
        password: 'pw',
        lazyConnect: false,
        maxRetriesPerRequest: 2,
      });
      expect(redis().on).toHaveBeenCalledWith('error', expect.any(Function));
      // The error handler only logs.
      const handler = redis().on.mock.calls[0][1];
      expect(() => handler(new Error('boom'))).not.toThrow();
    });

    it('falls back to localhost:6379 when redis config is missing', async () => {
      config.get.mockReturnValue(undefined);
      await service.onModuleInit();
      expect(redis().opts).toMatchObject({ host: 'localhost', port: 6379 });
    });

    it('warms the cache: a persisted "1" means ON right after boot (survives restarts)', async () => {
      const Redis = jest.requireMock('ioredis').default as jest.Mock;
      Redis.mockImplementationOnce((opts: any) => {
        const inst = {
          opts,
          get: jest.fn().mockResolvedValue('1'),
          set: jest.fn(),
          quit: jest.fn(),
          on: jest.fn(),
        };
        mockRedisInstances.push(inst);
        return inst;
      });

      await service.onModuleInit();

      expect(redis().get).toHaveBeenCalledWith(REDIS_KEY);
      expect(service.getEnabledSync()).toBe(true);
    });

    it('a Redis read failure during boot does not crash the app (stays OFF)', async () => {
      const Redis = jest.requireMock('ioredis').default as jest.Mock;
      Redis.mockImplementationOnce((opts: any) => {
        const inst = { opts, get: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), set: jest.fn(), quit: jest.fn(), on: jest.fn() };
        mockRedisInstances.push(inst);
        return inst;
      });

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(service.getEnabledSync()).toBe(false);
    });
  });

  describe('after init', () => {
    beforeEach(async () => {
      await service.onModuleInit();
      redis().get.mockClear();
    });

    it('setEnabled(true) persists "1" and flips the sync read immediately', async () => {
      await expect(service.setEnabled(true)).resolves.toBe(true);

      expect(redis().set).toHaveBeenCalledWith(REDIS_KEY, '1');
      expect(service.getEnabledSync()).toBe(true);
      await expect(service.getEnabled()).resolves.toBe(true);
      expect(redis().get).not.toHaveBeenCalled();
    });

    it('setEnabled(false) persists "0"', async () => {
      await service.setEnabled(true);
      await service.setEnabled(false);

      expect(redis().set).toHaveBeenLastCalledWith(REDIS_KEY, '0');
      expect(service.getEnabledSync()).toBe(false);
    });

    it('getEnabled: served from cache within 5s, re-read from Redis after the TTL', async () => {
      await service.setEnabled(false);
      // Another instance turned maintenance on.
      redis().store.set(REDIS_KEY, '1');

      now += 4_999;
      await expect(service.getEnabled()).resolves.toBe(false);
      expect(redis().get).not.toHaveBeenCalled();

      now += 1;
      await expect(service.getEnabled()).resolves.toBe(true);
      expect(redis().get).toHaveBeenCalledWith(REDIS_KEY);
    });

    it('only the literal "1" means ON', async () => {
      for (const [stored, expected] of [
        ['0', false],
        ['true', false],
        ['1', true],
      ] as const) {
        redis().store.set(REDIS_KEY, stored);
        now += 10_000;
        await expect(service.getEnabled()).resolves.toBe(expected);
      }
      redis().store.delete(REDIS_KEY);
      now += 10_000;
      await expect(service.getEnabled()).resolves.toBe(false);
    });

    it('a Redis blip keeps serving the last known value (does not flip ON -> OFF)', async () => {
      await service.setEnabled(true);
      redis().get.mockRejectedValueOnce(new Error('timeout'));

      now += 10_000;
      await expect(service.getEnabled()).resolves.toBe(true);
      // ...and it backs off for another TTL instead of hammering Redis.
      await expect(service.getEnabled()).resolves.toBe(true);
      expect(redis().get).toHaveBeenCalledTimes(1);
    });

    it('getEnabledSync: returns the cached value now and refreshes in the background when stale', async () => {
      await service.setEnabled(false);
      redis().store.set(REDIS_KEY, '1');

      expect(service.getEnabledSync()).toBe(false); // fresh cache, no Redis call
      expect(redis().get).not.toHaveBeenCalled();

      now += 5_000;
      expect(service.getEnabledSync()).toBe(false); // still the old value on this request
      await flush();
      expect(redis().get).toHaveBeenCalledTimes(1);
      expect(service.getEnabledSync()).toBe(true); // next request sees the refresh
    });

    it('getEnabledSync: a failing background refresh never surfaces to the caller', async () => {
      await service.setEnabled(true);
      redis().get.mockRejectedValueOnce(new Error('down'));
      now += 5_000;

      expect(service.getEnabledSync()).toBe(true);
      await flush();
      expect(service.getEnabledSync()).toBe(true);
    });

    it('onModuleDestroy quits the client; a quit error is swallowed', async () => {
      redis().quit.mockRejectedValueOnce(new Error('already closed'));
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(redis().quit).toHaveBeenCalledTimes(1);
    });
  });
});
