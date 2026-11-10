import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { LlmPreprocessingModule } from '../llm-preprocessing/llm-preprocessing.module';
import { StoryLlmTasksService } from './story-llm-tasks.service';
import { StoryLlmProcessor } from './story-llm.processor';
import { STORY_LLM_QUEUE } from './story-llm.constants';

/**
 * Background LLM work on stories: machine translation and CEFR level
 * assessment (queue `story-llm`, table `story_llm_tasks`).
 */
@Module({
  imports: [
    PrismaModule,
    StorageModule,
    LlmPreprocessingModule,
    BullModule.registerQueue({ name: STORY_LLM_QUEUE }),
  ],
  providers: [StoryLlmTasksService, StoryLlmProcessor],
  exports: [StoryLlmTasksService],
})
export class StoryLlmModule {}
