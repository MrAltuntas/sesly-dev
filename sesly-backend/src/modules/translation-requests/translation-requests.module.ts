import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TranslationRequestsService } from './translation-requests.service';

/**
 * Users asking for a story in another language (table
 * `story_translation_requests`). The HTTP routes live in StoriesController
 * (user side) and AdminContentController (admin side); this module only
 * holds the service so both can use it without a module cycle.
 */
@Module({
  imports: [PrismaModule, NotificationsModule],
  providers: [TranslationRequestsService],
  exports: [TranslationRequestsService],
})
export class TranslationRequestsModule {}
