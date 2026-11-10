import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { I18N_OPTIONS, I18nOptions } from 'nestjs-i18n';
import { SettingsService } from './settings.service';

/**
 * Keeps nestjs-i18n's `fallbackLanguage` equal to the `i18n.fallbackLocale`
 * setting. The library reads the option object on every translate() call
 * (missing key, unsupported language), so updating the object in place makes
 * the setting take effect without a restart.
 */
@Injectable()
export class I18nSettingsSync implements OnModuleInit, OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;

  constructor(
    @Inject(I18N_OPTIONS) private readonly options: I18nOptions,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.apply();
    this.unsubscribe = this.settings.onChange(() => this.apply());
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private apply(): void {
    this.options.fallbackLanguage = this.settings.get('i18n.fallbackLocale');
  }
}
