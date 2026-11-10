import * as path from 'path';
import { AcceptLanguageResolver, HeaderResolver, I18nOptions, QueryResolver } from 'nestjs-i18n';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { SettingsService } from './settings.service';

/**
 * Factories that connect framework modules (registered in AppModule) to the
 * runtime settings. Kept out of app.module.ts so they are unit tested.
 */

/**
 * Global rate limiter options. `ttl` and `limit` are resolver functions, so
 * @nestjs/throttler asks for them on every request and a change in the admin
 * panel applies immediately. The throttler works in milliseconds; the setting
 * is in seconds.
 */
export function buildThrottlerOptions(settings: SettingsService): ThrottlerModuleOptions {
  return [
    {
      name: 'default',
      ttl: () => settings.get('rateLimit.ttl') * 1000,
      limit: () => settings.get('rateLimit.limit'),
    },
  ];
}

/**
 * nestjs-i18n options. The fallback language starts as the current
 * i18n.fallbackLocale (environment or code default at this point of the boot)
 * and is kept in step with the setting by I18nSettingsSync.
 */
export function buildI18nOptions(settings: SettingsService): I18nOptions {
  return {
    fallbackLanguage: settings.get('i18n.fallbackLocale'),
    loaderOptions: {
      path: path.join(__dirname, '..', '..', 'i18n'),
      watch: true,
    },
    resolvers: [
      { use: QueryResolver, options: ['lang'] },
      AcceptLanguageResolver,
      new HeaderResolver(['x-lang']),
    ],
  };
}
