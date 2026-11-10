const mockRedisClient = {
  connect: jest.fn(),
  ping: jest.fn(),
  info: jest.fn(),
  quit: jest.fn(),
};

// Module-level mock: no real Redis connection is ever attempted.
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => mockRedisClient),
}));

import Redis from 'ioredis';
import { RedisHealthService } from './redis-health.service';

const RedisCtor = Redis as unknown as jest.Mock;

describe('RedisHealthService', () => {
  let config: Record<string, unknown>;

  const build = () =>
    new RedisHealthService({ get: jest.fn((key: string) => config[key]) } as any);

  beforeEach(() => {
    config = { REDIS_HOST: 'redis.test', REDIS_PORT: 6390, REDIS_PASSWORD: 'secret' };
    mockRedisClient.connect.mockResolvedValue(undefined);
    mockRedisClient.ping.mockResolvedValue('PONG');
    mockRedisClient.info.mockResolvedValue('# Server\r\nredis_version:7.2.4\r\nredis_mode:standalone\r\n');
    mockRedisClient.quit.mockResolvedValue('OK');
  });

  describe('onModuleInit (startup check)', () => {
    it('connects lazily with fail-fast options, pings, reads info and disconnects', async () => {
      await expect(build().onModuleInit()).resolves.toBeUndefined();

      expect(RedisCtor).toHaveBeenCalledTimes(1);
      const opts = RedisCtor.mock.calls[0][0];
      expect(opts).toMatchObject({
        host: 'redis.test',
        port: 6390,
        password: 'secret',
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      expect(opts.retryStrategy()).toBeNull();
      expect(mockRedisClient.connect).toHaveBeenCalledTimes(1);
      expect(mockRedisClient.ping).toHaveBeenCalledTimes(1);
      expect(mockRedisClient.info).toHaveBeenCalledWith('server');
      expect(mockRedisClient.quit).toHaveBeenCalledTimes(1);
    });

    it('defaults to localhost:6379 without password', async () => {
      config = {};
      await build().onModuleInit();
      expect(RedisCtor.mock.calls[0][0]).toMatchObject({
        host: 'localhost',
        port: 6379,
        password: undefined,
      });
    });

    it('tolerates an info payload without a version line', async () => {
      mockRedisClient.info.mockResolvedValue('# Server\r\n');
      await expect(build().onModuleInit()).resolves.toBeUndefined();
    });

    it('fails startup with a descriptive error when the connection is refused', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:6390'));

      await expect(build().onModuleInit()).rejects.toThrow(
        'Failed to connect to Redis at redis.test:6390. Redis is required for audio generation queue. ' +
          'Error: connect ECONNREFUSED 127.0.0.1:6390',
      );
      expect(mockRedisClient.ping).not.toHaveBeenCalled();
      // cleanup attempted
      expect(mockRedisClient.quit).toHaveBeenCalledTimes(1);
    });

    it('fails startup on an unexpected PING reply', async () => {
      mockRedisClient.ping.mockResolvedValue('LOADING');
      await expect(build().onModuleInit()).rejects.toThrow('Error: Unexpected Redis response: LOADING');
      expect(mockRedisClient.info).not.toHaveBeenCalled();
    });

    it('ignores errors from the cleanup quit()', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('NOAUTH Authentication required'));
      mockRedisClient.quit.mockRejectedValue(new Error('Connection is closed.'));
      await expect(build().onModuleInit()).rejects.toThrow('Error: NOAUTH Authentication required');
    });
  });

  describe('isHealthy (runtime probe)', () => {
    it('returns true on PONG and closes the probe client', async () => {
      await expect(build().isHealthy()).resolves.toBe(true);
      expect(RedisCtor.mock.calls[0][0]).toMatchObject({
        host: 'redis.test',
        port: 6390,
        password: 'secret',
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      expect(mockRedisClient.quit).toHaveBeenCalledTimes(1);
    });

    it('returns false for a non-PONG reply', async () => {
      mockRedisClient.ping.mockResolvedValue('LOADING');
      await expect(build().isHealthy()).resolves.toBe(false);
    });

    it('returns false (never throws) when the connection fails', async () => {
      mockRedisClient.connect.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(build().isHealthy()).resolves.toBe(false);
    });

    it('creates a fresh client per probe', async () => {
      const service = build();
      await service.isHealthy();
      await service.isHealthy();
      expect(RedisCtor).toHaveBeenCalledTimes(2);
    });
  });
});
