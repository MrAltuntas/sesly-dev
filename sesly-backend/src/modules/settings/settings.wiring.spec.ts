import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AcceptLanguageResolver, QueryResolver } from 'nestjs-i18n';
import { ThrottlerStorageService } from '@nestjs/throttler';
import * as fs from 'fs';
import { buildI18nOptions, buildThrottlerOptions } from './settings.wiring';
import { I18nSettingsSync } from './i18n-settings.sync';
import { UserThrottlerGuard } from '../../common/guards/user-throttler.guard';
import { createSettingsStub } from '../../test-utils/settings-stub';

describe('settings wiring', () => {
  describe('buildThrottlerOptions', () => {
    it('resolves ttl (seconds to ms) and limit from the settings on every call', () => {
      const settings = createSettingsStub();
      const [options] = buildThrottlerOptions(settings as any) as any[];

      expect(options.name).toBe('default');
      expect(options.ttl()).toBe(60_000);
      expect(options.limit()).toBe(300);

      settings.values['rateLimit.ttl'] = 30;
      settings.values['rateLimit.limit'] = 45;
      expect(options.ttl()).toBe(30_000);
      expect(options.limit()).toBe(45);
    });

    it('the real throttler guard enforces the live limit per request', async () => {
      const settings = createSettingsStub({ 'rateLimit.ttl': 60, 'rateLimit.limit': 30 });
      const storage = new ThrottlerStorageService();
      const guard = new UserThrottlerGuard(buildThrottlerOptions(settings as any), storage, new Reflector());
      await guard.onModuleInit();

      class DemoController {
        handler() {
          return undefined;
        }
      }
      const headers: Record<string, unknown> = {};
      const context = {
        getType: () => 'http',
        getHandler: () => DemoController.prototype.handler,
        getClass: () => DemoController,
        switchToHttp: () => ({
          getRequest: () => ({ url: '/demo', headers: {}, user: { id: 'u1' } }),
          getResponse: () => ({ header: (name: string, value: unknown) => (headers[name] = value) }),
        }),
      } as unknown as ExecutionContext;

      try {
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(headers['X-RateLimit-Limit']).toBe(30);

        // Panel change: the very next request is measured against the new limit.
        settings.values['rateLimit.limit'] = 2;
        await expect(guard.canActivate(context)).resolves.toBe(true);
        expect(headers['X-RateLimit-Limit']).toBe(2);
        await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 429 });
      } finally {
        storage.onApplicationShutdown();
      }
    });
  });

  describe('buildI18nOptions', () => {
    it('uses the fallback locale setting and points at the translation folder', () => {
      const options = buildI18nOptions(createSettingsStub({ 'i18n.fallbackLocale': 'en' }) as any);
      expect(options.fallbackLanguage).toBe('en');
      expect(buildI18nOptions(createSettingsStub() as any).fallbackLanguage).toBe('tr');

      const dir = (options.loaderOptions as { path: string }).path;
      expect(fs.existsSync(`${dir}/tr`)).toBe(true);
      expect(fs.existsSync(`${dir}/en`)).toBe(true);

      expect(options.resolvers).toHaveLength(3);
      expect(options.resolvers?.[0]).toEqual({ use: QueryResolver, options: ['lang'] });
      expect(options.resolvers?.[1]).toBe(AcceptLanguageResolver);
    });
  });

  describe('I18nSettingsSync', () => {
    it('sets the library fallback language at start and again on every settings change', () => {
      const settings = createSettingsStub({ 'i18n.fallbackLocale': 'en' });
      let listener: () => void = () => undefined;
      const unsubscribe = jest.fn();
      settings.onChange.mockImplementation((fn: () => void) => {
        listener = fn;
        return unsubscribe;
      });
      const options: any = { fallbackLanguage: 'tr' };
      const sync = new I18nSettingsSync(options, settings as any);

      sync.onModuleInit();
      expect(options.fallbackLanguage).toBe('en');

      settings.values['i18n.fallbackLocale'] = 'tr';
      listener();
      expect(options.fallbackLanguage).toBe('tr');

      sync.onModuleDestroy();
      sync.onModuleDestroy();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('onModuleDestroy before init is a no-op', () => {
      expect(() => new I18nSettingsSync({} as any, createSettingsStub() as any).onModuleDestroy()).not.toThrow();
    });
  });
});
