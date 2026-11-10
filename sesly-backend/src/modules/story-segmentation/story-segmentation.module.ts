import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { LlmPreprocessingModule } from '../llm-preprocessing/llm-preprocessing.module';
import { StorySegmentationService } from './story-segmentation.service';

@Module({
  imports: [PrismaModule, LlmPreprocessingModule],
  providers: [StorySegmentationService],
  exports: [StorySegmentationService],
})
export class StorySegmentationModule {}
