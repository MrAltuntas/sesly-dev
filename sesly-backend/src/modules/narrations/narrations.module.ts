import { Module } from '@nestjs/common';
import { NarrationsService } from './narrations.service';
import { NarrationsController } from './narrations.controller';
import { AudioModule } from '@modules/audio/audio.module';
import { PrismaModule } from '@prisma/prisma.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { StorageModule } from '@modules/storage/storage.module';
import { UsageModule } from '@modules/usage/usage.module';

@Module({
  imports: [PrismaModule, AudioModule, NotificationsModule, StorageModule, UsageModule],
  controllers: [NarrationsController],
  providers: [NarrationsService],
  exports: [NarrationsService],
})
export class NarrationsModule {}
