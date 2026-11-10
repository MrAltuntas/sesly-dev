import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { VoiceProfilesController } from './voice-profiles.controller';
import { VoiceProfilesService } from './voice-profiles.service';
import { VoiceTrainingProcessor } from './processors/voice-training.processor';
import { VOICE_TRAINING_QUEUE } from './processors/voice-training.job';
import {
  VOICE_MAINTENANCE_QUEUE,
  VoiceMaintenanceProcessor,
  VoiceMaintenanceService,
} from './voice-maintenance.service';
import { StorageModule } from '../storage/storage.module';
import { TTSProvidersModule } from '../tts-providers/tts-providers.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    BullModule.registerQueue(
      { name: VOICE_TRAINING_QUEUE },
      // Repeatable housekeeping job (stuck PROCESSING, abandoned PENDING,
      // failed upstream deletions). See VoiceMaintenanceService.
      { name: VOICE_MAINTENANCE_QUEUE },
    ),
    StorageModule,
    TTSProvidersModule,
    NotificationsModule,
  ],
  controllers: [VoiceProfilesController],
  providers: [
    VoiceProfilesService,
    VoiceTrainingProcessor,
    VoiceMaintenanceService,
    VoiceMaintenanceProcessor,
  ],
  exports: [VoiceProfilesService],
})
export class VoiceProfilesModule {}
