import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { I18nService } from 'nestjs-i18n';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { SettingsService } from './modules/settings/settings.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Default Express JSON limit is 100kb; the admin bulk story import
  // (POST /admin/stories/import) sends batches of up to 1.5 MB.
  app.useBodyParser('json', { limit: '2mb' });
  app.useBodyParser('urlencoded', { limit: '2mb', extended: true });

  // Get config service
  const configService = app.get(ConfigService);
  const i18nService = app.get<I18nService<Record<string, unknown>>>(I18nService);

  // Enable CORS with logging
  const corsOrigins = configService.get<string[]>('app.corsOrigins') || [];
  logger.log(`Enabled CORS Origins: ${JSON.stringify(corsOrigins)}`);

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Security headers
  app.use(helmet());

  // Global exception filter - MUST be before other global configs
  app.useGlobalFilters(new HttpExceptionFilter(i18nService, app.get(SettingsService)));

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Swagger documentation (disabled in production)
  if (process.env.NODE_ENV === 'development') {
    const config = new DocumentBuilder()
      .setTitle('Sesly API')
      .setDescription('AI-Powered Voice Cloning Backend API')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Authentication', 'User authentication and registration')
      .addTag('Users', 'User profile management')
      .addTag('Voice Profiles', 'Voice cloning and training')
      .addTag('Stories', 'Story library and audio generation')
      .addTag('Subscriptions', 'Subscription and payment management')
      .addTag('Usage', 'Usage tracking and limits')
      .addTag('Webhooks', 'Webhook handlers')
      .addTag('Health', 'Health check endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);

    logger.log(`📚 API Documentation: http://localhost:${configService.get<number>('app.port') || 3000}/api/docs`);
  }

  // Get port
  const port = configService.get<number>('app.port') || 3000;

  // Graceful shutdown
  app.enableShutdownHooks();

  await app.listen(port);
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
