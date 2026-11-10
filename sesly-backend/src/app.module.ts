import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bull';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { I18nModule } from 'nestjs-i18n';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Config
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
import jwtConfig from './config/jwt.config';
import googleConfig from './config/google.config';
import firebaseConfig from './config/firebase.config';
import cartesiaConfig from './config/cartesia.config';
import geminiConfig from './config/gemini.config';

// Prisma
import { PrismaModule } from './prisma/prisma.module';

// Guards & Filters & Interceptors
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { MaintenanceGuard } from './common/guards/maintenance.guard';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

// Health Checks
import { RedisHealthService } from './common/health/redis-health.service';

// Seeders
import { AdminUserSeeder } from './database/seeders/admin-user.seeder';

// Modules
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { StorageModule } from './modules/storage/storage.module';
import { EmailModule } from './modules/email/email.module';
import { TTSProvidersModule } from './modules/tts-providers/tts-providers.module';
import { VoiceProfilesModule } from './modules/voice-profiles/voice-profiles.module';
import { StoriesModule } from './modules/stories/stories.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { UsageModule } from './modules/usage/usage.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AudioModule } from './modules/audio/audio.module';
import { AdminAuthModule } from './modules/admin-auth/admin-auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { NarrationsModule } from './modules/narrations/narrations.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { LegalDocumentsModule } from './modules/legal-documents/legal-documents.module';
import { UserPreferencesModule } from './modules/user-preferences/user-preferences.module';
import { PlaylistsModule } from './modules/playlists/playlists.module';
import { AppConfigModule } from './modules/app-config/app-config.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SettingsService } from './modules/settings/settings.service';
import { I18nSettingsSync } from './modules/settings/i18n-settings.sync';
import { buildI18nOptions, buildThrottlerOptions } from './modules/settings/settings.wiring';

@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, jwtConfig, googleConfig, firebaseConfig, cartesiaConfig, geminiConfig],
    }),

    // Internationalization. The fallback language is the i18n.fallbackLocale
    // runtime setting; I18nSettingsSync (below) keeps it current afterwards.
    I18nModule.forRootAsync({
      inject: [SettingsService],
      useFactory: (settings: SettingsService) => buildI18nOptions(settings),
    }),

    // Rate limiting (enforced by UserThrottlerGuard below). The default is
    // deliberately lenient: buckets are per route AND per user (or IP), so
    // 300/min per route can never be hit by normal app use (mobile polls
    // voice status every 5 s, narration every 4 s, audio every 3 s). Abuse-
    // sensitive routes tighten it with @Throttle (clone upload 5/hour,
    // voice creation, previews).
    // Window and limit are the rateLimit.ttl / rateLimit.limit runtime
    // settings, resolved per request so a panel change applies at once.
    ThrottlerModule.forRootAsync({
      inject: [SettingsService],
      useFactory: (settings: SettingsService) => buildThrottlerOptions(settings),
    }),

    // Bull Queue (Redis-based)
    BullModule.forRootAsync({
      useFactory: () => ({
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
        },
      }),
    }),

    // Core modules
    PrismaModule,
    SettingsModule,

    // Feature modules
    AuthModule,
    UsersModule,
    StorageModule,
    EmailModule,
    TTSProvidersModule,
    VoiceProfilesModule,
    StoriesModule,
    SubscriptionsModule,
    UsageModule,
    WebhooksModule,
    NotificationsModule,
    AudioModule,
    AdminAuthModule,
    AdminModule,
    NarrationsModule,
    CollectionsModule,
    LegalDocumentsModule,
    UserPreferencesModule,
    PlaylistsModule,
    AppConfigModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Health Checks
    RedisHealthService,
    // Global Interceptors
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global Guards — order matters. Global guards execute in the order they
    // are registered, so MaintenanceGuard runs BEFORE JwtAuthGuard. That way
    // an unauthenticated client still sees a 503 during maintenance instead
    // of a confusing 401.
    {
      provide: APP_GUARD,
      useClass: MaintenanceGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // After JwtAuthGuard so the limiter can key on the authenticated user id.
    {
      provide: APP_GUARD,
      useClass: UserThrottlerGuard,
    },
    // Global exception filter: HttpExceptionFilter (main.ts) is the only
    // catch-all and maps Prisma errors itself (mapPrismaError). A second
    // global @Catch() filter here never ran: Nest uses the last registered one.
    // Runtime Seeders
    AdminUserSeeder,
    // Keeps nestjs-i18n's fallback language in step with the runtime setting.
    I18nSettingsSync,
  ],
})
export class AppModule { }
