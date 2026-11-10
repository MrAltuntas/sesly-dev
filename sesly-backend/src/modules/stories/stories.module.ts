import { Module, forwardRef } from '@nestjs/common';
import { StoriesController } from './stories.controller';
import { StoriesService } from './stories.service';
import { PrismaModule } from '@prisma/prisma.module';
import { NarrationsModule } from '@modules/narrations/narrations.module';
import { AudioModule } from '@modules/audio/audio.module';
import { StorageModule } from '@modules/storage/storage.module';
import { TranslationRequestsModule } from '@modules/translation-requests/translation-requests.module';

@Module({
  imports: [
    PrismaModule,
    AudioModule,
    StorageModule,
    TranslationRequestsModule,
    forwardRef(() => NarrationsModule),
  ],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
