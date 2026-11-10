/* eslint-disable no-console */
/**
 * Export the Sesly OpenAPI specification to `docs/openapi.json`.
 *
 * Usage:
 *   npm run openapi:export
 *   # or
 *   npx ts-node -r tsconfig-paths/register scripts/export-openapi.ts
 *
 * The script bootstraps the NestJS application without starting an HTTP
 * listener, builds the same Swagger document that `main.ts` builds in
 * development, writes it to `docs/openapi.json`, then shuts the app down.
 */
import 'reflect-metadata';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

async function exportOpenApi(): Promise<void> {
  const logger = new Logger('ExportOpenAPI');

  // Bootstrap the app without listening. We pass `logger: false` to keep
  // stdout tidy, and `abortOnError: false` so schema introspection does not
  // blow up on optional infrastructure (redis/postgres) being unavailable.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });

  try {
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

    const outputPath = resolve(__dirname, '..', 'docs', 'openapi.json');
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const json = JSON.stringify(document, null, 2);
    writeFileSync(outputPath, json, 'utf-8');

    const pathCount = document.paths ? Object.keys(document.paths).length : 0;
    logger.log(
      `OpenAPI spec written to ${outputPath} (${Buffer.byteLength(json, 'utf-8')} bytes, ${pathCount} paths)`,
    );
  } finally {
    await app.close();
  }
}

exportOpenApi()
  .then(() => {
    // Ensure Node exits even if some timer/handle lingers (e.g. Bull queues)
    setTimeout(() => process.exit(0), 100).unref();
  })
  .catch((error) => {
    console.error('Failed to export OpenAPI spec:', error);
    process.exit(1);
  });
