import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
} from '../../../common/constants/content-languages';
import { StoryLlmTaskStatus, StoryLlmTaskType } from '../../../common/enums/prisma.enums';
import { normaliseLanguageParam } from '../../stories/story-query.util';

/** Most stories one translate-batch / assess-batch request may name. */
export const STORY_LLM_BATCH_IDS_MAX = 200;

const STORY_IDS_MESSAGE = `Masal kimlikleri bir liste olmalıdır (en fazla ${STORY_LLM_BATCH_IDS_MAX} masal).`;
const STORY_ID_MESSAGE = 'Masal kimliği boş olmayan bir metin olmalıdır (en fazla 100 karakter).';

/** "true" / "false" (query string, form) and real booleans; anything else is left for the validator. */
const toBoolean = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const cleaned = value.trim().toLowerCase();
  if (cleaned === 'true') return true;
  if (cleaned === 'false') return false;
  return value;
};

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || undefined : value;

const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || undefined : value;

/** Body of POST /admin/stories/:id/translate. */
export class TranslateStoryDto {
  @ApiProperty({ enum: CONTENT_LANGUAGE_CODES, description: 'Language to translate the story into' })
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  targetLanguage: string;

  @ApiPropertyOptional({
    description:
      'Overwrite the sibling in that language when it is still a DRAFT machine translation',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'replaceDraft true ya da false olmalıdır.' })
  replaceDraft?: boolean;
}

/** Body of POST /admin/stories/translate-batch. */
export class TranslateBatchDto {
  @ApiProperty({ type: [String], maxItems: STORY_LLM_BATCH_IDS_MAX })
  @IsArray({ message: STORY_IDS_MESSAGE })
  @ArrayMinSize(1, { message: 'En az bir masal seçilmelidir.' })
  @ArrayMaxSize(STORY_LLM_BATCH_IDS_MAX, { message: STORY_IDS_MESSAGE })
  @IsString({ each: true, message: STORY_ID_MESSAGE })
  @IsNotEmpty({ each: true, message: STORY_ID_MESSAGE })
  @MaxLength(100, { each: true, message: STORY_ID_MESSAGE })
  storyIds: string[];

  @ApiProperty({ enum: CONTENT_LANGUAGE_CODES })
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  targetLanguage: string;
}

/** Body of POST /admin/stories/:id/level/assess. */
export class AssessLevelDto {
  @ApiPropertyOptional({ description: 'Overwrite a level that was set by hand (MANUAL)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'force true ya da false olmalıdır.' })
  force?: boolean;
}

/** Body of POST /admin/stories/:id/age-group/assess. */
export class AssessAgeGroupDto {
  @ApiPropertyOptional({ description: 'Overwrite an age group that was chosen by hand (MANUAL)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'force true ya da false olmalıdır.' })
  force?: boolean;
}

/** Query of GET /admin/stories/translation-requests. */
export class TranslationRequestsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: ['pending', 'fulfilled'],
    description: 'pending (default): still wanted. fulfilled: a version was published.',
  })
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() || undefined : value))
  @IsIn(['pending', 'fulfilled'], { message: 'Durum pending ya da fulfilled olmalıdır.' })
  status?: 'pending' | 'fulfilled';

  @ApiPropertyOptional({ enum: CONTENT_LANGUAGE_CODES, description: 'Only requests for this language' })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language?: string;
}

/** Body of POST /admin/stories/level/assess-batch. Every field is optional. */
export class AssessLevelBatchDto {
  @ApiPropertyOptional({
    type: [String],
    maxItems: STORY_LLM_BATCH_IDS_MAX,
    description: 'Only these stories. Absent or empty: every story (of `language` when given).',
  })
  @IsOptional()
  @IsArray({ message: STORY_IDS_MESSAGE })
  @ArrayMaxSize(STORY_LLM_BATCH_IDS_MAX, { message: STORY_IDS_MESSAGE })
  @IsString({ each: true, message: STORY_ID_MESSAGE })
  @IsNotEmpty({ each: true, message: STORY_ID_MESSAGE })
  @MaxLength(100, { each: true, message: STORY_ID_MESSAGE })
  storyIds?: string[];

  @ApiPropertyOptional({ enum: CONTENT_LANGUAGE_CODES, description: 'Only stories of this language' })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language?: string;

  @ApiPropertyOptional({
    description: 'Only stories that have no level yet. Default false: stories with an AI level are assessed again.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean({ message: 'onlyMissing true ya da false olmalıdır.' })
  onlyMissing?: boolean;
}

/** Query of GET /admin/stories/llm-tasks. */
export class StoryLlmTasksQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Tasks of one story' })
  @IsOptional()
  @Transform(blankToUndefined)
  @IsString({ message: STORY_ID_MESSAGE })
  @MaxLength(100, { message: STORY_ID_MESSAGE })
  storyId?: string;

  @ApiPropertyOptional({ enum: StoryLlmTaskStatus })
  @IsOptional()
  @Transform(upper)
  @IsEnum(StoryLlmTaskStatus, {
    message: 'Durum şu değerlerden biri olmalıdır: PENDING, RUNNING, DONE, FAILED.',
  })
  status?: StoryLlmTaskStatus;

  @ApiPropertyOptional({ enum: StoryLlmTaskType })
  @IsOptional()
  @Transform(upper)
  @IsEnum(StoryLlmTaskType, {
    message: 'Görev türü şu değerlerden biri olmalıdır: TRANSLATE, ASSESS_LEVEL, ASSESS_AGE_GROUP.',
  })
  type?: StoryLlmTaskType;
}
