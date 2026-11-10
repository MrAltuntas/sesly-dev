import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Persistent maintenance-mode flag.
 *
 * Single source of truth used by:
 *   - the admin Ops endpoint (`POST /admin/ops/system/maintenance`) for toggling
 *   - the global `MaintenanceGuard` for gating non-admin requests
 *
 * State lives in Redis so it survives restarts and is shared across
 * horizontally-scaled instances. An in-process cache (refreshed on a short
 * interval) keeps the hot path on the request pipeline from paying a Redis
 * round-trip per request.
 */
@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MaintenanceService.name);
  private readonly redisKey = 'sesly:maintenance-mode';
  private client: Redis | null = null;
  private cachedValue = false;
  private lastFetch = 0;
  private readonly cacheTtlMs = 5_000;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.client = new Redis({
      host: this.configService.get<string>('redis.host') || 'localhost',
      port: this.configService.get<number>('redis.port') || 6379,
      password: this.configService.get<string>('redis.password'),
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis error for maintenance flag: ${err.message}`);
    });

    // Warm the cache on boot so the first request doesn't see a stale default
    try {
      await this.refreshCache();
    } catch (err: any) {
      this.logger.warn(
        `Could not read initial maintenance flag from Redis: ${err?.message ?? err}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        // best-effort
      }
    }
  }

  async setEnabled(enabled: boolean): Promise<boolean> {
    if (!this.client) {
      // Should not happen after onModuleInit
      throw new Error('MaintenanceService Redis client is not initialized');
    }
    await this.client.set(this.redisKey, enabled ? '1' : '0');
    this.cachedValue = enabled;
    this.lastFetch = Date.now();
    this.logger.log(`Maintenance mode persisted: ${enabled}`);
    return enabled;
  }

  async getEnabled(): Promise<boolean> {
    // Refresh cache lazily; returns the cached value if it's fresh enough.
    if (Date.now() - this.lastFetch < this.cacheTtlMs) {
      return this.cachedValue;
    }
    return this.refreshCache();
  }

  /**
   * Synchronous read path for the request pipeline. Returns the most recently
   * observed value without talking to Redis — the async refresh happens on
   * the next tick so guards never add latency.
   */
  getEnabledSync(): boolean {
    // Fire-and-forget background refresh when the cache is stale. Errors
    // are logged but never propagate to the request.
    if (Date.now() - this.lastFetch >= this.cacheTtlMs) {
      this.refreshCache().catch((err) =>
        this.logger.warn(
          `Background maintenance flag refresh failed: ${err?.message ?? err}`,
        ),
      );
    }
    return this.cachedValue;
  }

  private async refreshCache(): Promise<boolean> {
    if (!this.client) {
      return this.cachedValue;
    }
    try {
      const value = await this.client.get(this.redisKey);
      this.cachedValue = value === '1';
      this.lastFetch = Date.now();
      return this.cachedValue;
    } catch (err: any) {
      this.logger.warn(
        `Failed to refresh maintenance flag from Redis: ${err?.message ?? err}`,
      );
      // Keep serving the last known value; don't flip it just because
      // Redis blipped.
      this.lastFetch = Date.now();
      return this.cachedValue;
    }
  }
}
