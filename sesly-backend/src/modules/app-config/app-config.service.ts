import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UiLanguage } from '../../common/i18n/ui-language';

export interface PlatformValues {
  android: string;
  ios: string;
}

/**
 * GET /app/config: what the mobile app needs before anything else
 * (force-update gate). Public, cacheable, allowed during maintenance.
 *
 *   minSupportedVersion  below this the app must update (blocking screen)
 *   latestVersion        below this the app may suggest an update
 *   storeUrl             where the update button points ('' = no store link)
 *   updateMessage        copy for the update screen in the request language
 *                        (English for Accept-Language en, else Turkish)
 */
export interface AppConfigResponse {
  minSupportedVersion: PlatformValues;
  latestVersion: PlatformValues;
  storeUrl: PlatformValues;
  updateMessage: string;
}

export const APP_CONFIG_DEFAULTS = {
  minVersion: '1.0.0',
  latestVersion: '1.0.8',
  storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.sesly',
  storeUrlIos: '',
  updateMessage: "Sesly'nin yeni bir sürümü var. Devam etmek için lütfen uygulamayı güncelle.",
  updateMessageEn: 'A new version of Sesly is available. Please update the app to continue.',
} as const;

const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** -1 / 0 / 1 for two x.y.z versions (numeric, not lexicographic). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);
  private readonly config: AppConfigResponse;
  private readonly updateMessageEn: string;

  constructor(private readonly configService: ConfigService) {
    // Env does not change at runtime: resolve (and warn about bad values) once.
    this.config = this.resolve();
    this.updateMessageEn =
      this.raw('APP_UPDATE_MESSAGE_EN') || APP_CONFIG_DEFAULTS.updateMessageEn;
  }

  /**
   * @param language UI language of the request (Accept-Language); only the
   *   update copy depends on it. Anything but 'en' gets the Turkish copy.
   */
  getConfig(language: UiLanguage | null = null): AppConfigResponse {
    return {
      minSupportedVersion: { ...this.config.minSupportedVersion },
      latestVersion: { ...this.config.latestVersion },
      storeUrl: { ...this.config.storeUrl },
      updateMessage: language === 'en' ? this.updateMessageEn : this.config.updateMessage,
    };
  }

  private resolve(): AppConfigResponse {
    const minAndroid = this.version('APP_MIN_VERSION_ANDROID', APP_CONFIG_DEFAULTS.minVersion);
    const minIos = this.version('APP_MIN_VERSION_IOS', APP_CONFIG_DEFAULTS.minVersion);

    return {
      minSupportedVersion: { android: minAndroid, ios: minIos },
      latestVersion: {
        android: this.atLeast(
          'APP_LATEST_VERSION_ANDROID',
          this.version('APP_LATEST_VERSION_ANDROID', APP_CONFIG_DEFAULTS.latestVersion),
          minAndroid,
        ),
        ios: this.atLeast(
          'APP_LATEST_VERSION_IOS',
          this.version('APP_LATEST_VERSION_IOS', APP_CONFIG_DEFAULTS.latestVersion),
          minIos,
        ),
      },
      storeUrl: {
        android: this.storeUrl('APP_STORE_URL_ANDROID', APP_CONFIG_DEFAULTS.storeUrlAndroid),
        ios: this.storeUrl('APP_STORE_URL_IOS', APP_CONFIG_DEFAULTS.storeUrlIos),
      },
      updateMessage: this.raw('APP_UPDATE_MESSAGE') || APP_CONFIG_DEFAULTS.updateMessage,
    };
  }

  private raw(key: string): string | undefined {
    const value = this.configService.get<string>(key);
    return typeof value === 'string' ? value.trim() : undefined;
  }

  /** x.y.z from the env, or the default (with a warning) for anything else. */
  private version(key: string, fallback: string): string {
    const value = this.raw(key);
    if (!value) return fallback;
    if (VERSION_PATTERN.test(value)) return value;
    this.logger.warn(`${key}="${value}" is not an x.y.z version; using ${fallback}`);
    return fallback;
  }

  /** latestVersion below minSupportedVersion makes no sense: clamp it up. */
  private atLeast(key: string, value: string, min: string): string {
    if (compareVersions(value, min) >= 0) return value;
    this.logger.warn(`${key} (${value}) is below the minimum supported version (${min}); using ${min}`);
    return min;
  }

  /** https URL from the env; unset / blank / invalid -> default. */
  private storeUrl(key: string, fallback: string): string {
    const value = this.raw(key);
    if (!value) return fallback;
    if (/^https:\/\/\S+$/i.test(value)) return value;
    this.logger.warn(`${key}="${value}" is not an https URL; using the default`);
    return fallback;
  }
}
