import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '@prisma/prisma.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { StorageModule } from '@modules/storage/storage.module';
import { AudioModule } from '@modules/audio/audio.module';
import { AdminAuthModule } from '@modules/admin-auth/admin-auth.module';
import { CollectionsModule } from '@modules/collections/collections.module';
import { LegalDocumentsModule } from '@modules/legal-documents/legal-documents.module';
import { LlmPreprocessingModule } from '@modules/llm-preprocessing/llm-preprocessing.module';
import { TTSProvidersModule } from '@modules/tts-providers/tts-providers.module';
import { UsersModule } from '@modules/users/users.module';
import { StoryLlmModule } from '@modules/story-llm/story-llm.module';
import { TranslationRequestsModule } from '@modules/translation-requests/translation-requests.module';
import { EmailModule } from '@modules/email/email.module';
import { AdminContentController } from './controllers/admin-content.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminOpsController } from './controllers/admin-ops.controller';
import { AdminService } from './admin.service';
import { AdminStoriesService } from './services/admin-stories.service';
import { AdminStoryImportService } from './services/admin-story-import.service';
import { AdminStorySegmentsService } from './services/admin-story-segments.service';
import { AdminStoryReviewService } from './services/admin-story-review.service';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminUsersService } from './services/admin-users.service';
import { AdminStorageService } from './services/admin-storage.service';
import { MaintenanceService } from './services/maintenance.service';
import { VoiceCloneTesterService } from './services/voice-clone-tester.service';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    StorageModule,
    AudioModule,
    AdminAuthModule,
    CollectionsModule,
    LegalDocumentsModule,
    LlmPreprocessingModule,
    TTSProvidersModule,
    UsersModule,
    StoryLlmModule,
    TranslationRequestsModule,
    EmailModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.adminSecret') || configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.expiresIn'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [
    AdminContentController,
    AdminUsersController,
    AdminOpsController,
  ],
  providers: [
    AdminService,
    AdminStoriesService,
    AdminStoryImportService,
    AdminStorySegmentsService,
    AdminStoryReviewService,
    AdminAnalyticsService,
    AdminUsersService,
    AdminStorageService,
    MaintenanceService,
    VoiceCloneTesterService,
  ],
  exports: [AdminService, MaintenanceService],
})
export class AdminModule { }
