import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { AudioController } from './audio.controller';
import { AudioService } from './audio.service';
import { NarrationCacheService } from './narration-cache.service';
import { AudioGenerationProcessor } from './processors/audio-generation.processor';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { TTSProvidersModule } from '../tts-providers/tts-providers.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsageModule } from '../usage/usage.module';
import { StorySegmentationModule } from '../story-segmentation/story-segmentation.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    TTSProvidersModule,
    NotificationsModule,
    UsageModule,
    StorySegmentationModule,
    BullModule.registerQueue({
      name: 'audio-generation',
    }),
  ],
  controllers: [AudioController],
  providers: [AudioService, AudioGenerationProcessor, NarrationCacheService],
  exports: [AudioService, NarrationCacheService],
})
export class AudioModule {}
