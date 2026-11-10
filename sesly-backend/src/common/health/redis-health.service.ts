import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisHealthService implements OnModuleInit {
  private readonly logger = new Logger(RedisHealthService.name);
  private redisClient: Redis;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.checkRedisConnection();
  }

  private async checkRedisConnection(): Promise<void> {
    const redisHost = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const redisPort = this.configService.get<number>('REDIS_PORT') || 6379;
    const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

    this.logger.log(`Checking Redis connection at ${redisHost}:${redisPort}...`);

    this.redisClient = new Redis({
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      retryStrategy: () => null, // Don't retry on init, fail fast
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      // Try to connect
      await this.redisClient.connect();

      // Test with PING command
      const response = await this.redisClient.ping();

      if (response === 'PONG') {
        this.logger.log(`✅ Redis connection successful at ${redisHost}:${redisPort}`);

        // Get Redis info
        const info = await this.redisClient.info('server');
        const versionMatch = info.match(/redis_version:([^\r\n]+)/);
        if (versionMatch) {
          this.logger.log(`   Redis version: ${versionMatch[1]}`);
        }

        // Disconnect after health check
        await this.redisClient.quit();
      } else {
        throw new Error(`Unexpected Redis response: ${response}`);
      }
    } catch (error: any) {
      this.logger.error('❌ Redis connection failed!');
      this.logger.error(`   Host: ${redisHost}:${redisPort}`);
      this.logger.error(`   Error: ${error.message}`);
      this.logger.error('');
      this.logger.error('🔴 REDIS IS REQUIRED FOR AUDIO GENERATION');
      this.logger.error('   Please ensure Redis is running:');
      this.logger.error('   - Docker: docker-compose up -d redis');
      this.logger.error('   - Local: redis-server');
      this.logger.error('   - Or update REDIS_HOST/REDIS_PORT in .env');
      this.logger.error('');

      // Cleanup
      if (this.redisClient) {
        try {
          await this.redisClient.quit();
        } catch (quitError) {
          // Ignore quit errors
        }
      }

      throw new Error(
        `Failed to connect to Redis at ${redisHost}:${redisPort}. ` +
        `Redis is required for audio generation queue. Error: ${error.message}`
      );
    }
  }

  /**
   * Health check for runtime monitoring
   */
  async isHealthy(): Promise<boolean> {
    const testClient = new Redis({
      host: this.configService.get<string>('REDIS_HOST') || 'localhost',
      port: this.configService.get<number>('REDIS_PORT') || 6379,
      password: this.configService.get<string>('REDIS_PASSWORD'),
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });

    try {
      await testClient.connect();
      const response = await testClient.ping();
      await testClient.quit();
      return response === 'PONG';
    } catch (error) {
      this.logger.warn('Redis health check failed', error);
      return false;
    }
  }
}
