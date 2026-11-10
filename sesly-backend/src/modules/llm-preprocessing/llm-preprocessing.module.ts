import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmPreprocessingService } from './llm-preprocessing.service';
import { GeminiModelsService } from './gemini-models.service';

@Module({
  imports: [ConfigModule],
  providers: [LlmPreprocessingService, GeminiModelsService],
  exports: [LlmPreprocessingService, GeminiModelsService],
})
export class LlmPreprocessingModule {}
