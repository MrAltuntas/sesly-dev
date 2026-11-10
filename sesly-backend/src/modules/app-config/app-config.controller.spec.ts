import { Controller, Get, INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { MaintenanceGuard } from '../../common/guards/maintenance.guard';
import { MaintenanceService } from '../admin/services/maintenance.service';
import { AppConfigController, APP_CONFIG_CACHE_CONTROL } from './app-config.controller';
import { APP_CONFIG_DEFAULTS, AppConfigService } from './app-config.service';
import { ConfigService } from '@nestjs/config';

describe('AppConfigController (GET /app/config)', () => {
  it('is public and delegates to the service', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, AppConfigController.prototype.getConfig)).toBe(true);
    const service = { getConfig: jest.fn().mockReturnValue({ updateMessage: 'x' }) };
    expect(new AppConfigController(service as any).getConfig()).toEqual({ updateMessage: 'x' });
  });

  describe('HTTP (maintenance mode ON)', () => {
    @Controller('stories')
    class BlockedController {
      @Get()
      list() {
        return [];
      }
    }

    let app: INestApplication;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [AppConfigController, BlockedController],
        providers: [
          AppConfigService,
          { provide: ConfigService, useValue: { get: (key: string) => (key === 'APP_MIN_VERSION_ANDROID' ? '1.0.4' : undefined) } },
          { provide: MaintenanceService, useValue: { getEnabledSync: () => true } },
          { provide: APP_GUARD, useClass: MaintenanceGuard },
        ],
      }).compile();
      app = moduleRef.createNestApplication({ logger: false });
      await app.init();
    });

    afterAll(async () => {
      await app?.close();
    });

    it('is served during maintenance, cacheable, with the contract shape', async () => {
      const res = await request(app.getHttpServer()).get('/app/config');

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe(APP_CONFIG_CACHE_CONTROL);
      expect(res.body).toEqual({
        minSupportedVersion: { android: '1.0.4', ios: '1.0.0' },
        latestVersion: { android: '1.0.8', ios: '1.0.8' },
        storeUrl: { android: 'https://play.google.com/store/apps/details?id=com.sesly', ios: '' },
        updateMessage: "Sesly'nin yeni bir sürümü var. Devam etmek için lütfen uygulamayı güncelle.",
      });
    });

    it('updateMessage follows Accept-Language (English for en, Turkish otherwise); caches vary on it', async () => {
      const en = await request(app.getHttpServer()).get('/app/config').set('Accept-Language', 'en-US');
      expect(en.status).toBe(200);
      expect(en.headers['vary']).toContain('Accept-Language');
      expect(en.body.updateMessage).toBe('A new version of Sesly is available. Please update the app to continue.');
      expect(Object.keys(en.body).sort()).toEqual(['latestVersion', 'minSupportedVersion', 'storeUrl', 'updateMessage']);

      const de = await request(app.getHttpServer()).get('/app/config').set('Accept-Language', 'de');
      expect(de.body.updateMessage).toBe(APP_CONFIG_DEFAULTS.updateMessage);
    });

    it('other routes are still blocked with 503', async () => {
      expect((await request(app.getHttpServer()).get('/stories')).status).toBe(503);
    });
  });
});
