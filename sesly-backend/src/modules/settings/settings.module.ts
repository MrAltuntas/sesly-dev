import { Global, Module } from '@nestjs/common';
import { SettingsService } from './settings.service';

/**
 * Global so any consumer can inject SettingsService without importing the
 * module (it replaces env reads that were available everywhere).
 * PrismaModule is global too, so nothing is imported here.
 */
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
