import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsIn, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { AgeGroup, LanguageLevel, StoryCategory } from '../../../common/enums/prisma.enums';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
} from '../../../common/constants/content-languages';
import {
  LANGUAGE_LEVEL_MESSAGE,
  STORY_SORTS,
  STORY_SORT_MESSAGE,
  StorySort,
  normaliseLanguageParam,
  parseBooleanParam,
  parseLanguageLevels,
  parseLanguageList,
} from '../story-query.util';

/**
 * Content-language filters shared by GET /stories and GET /stories/search.
 * All are optional: app versions in the field send none and keep getting
 * the default language only.
 */
export class StoryLanguageFilterDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Content language(s) of the stories, one or several (comma separated or repeated). Independent of Accept-Language. With a language the list is flat: one row per story per selected language. Absent (and no grouped=true): the content.defaultLanguage setting.',
    enum: CONTENT_LANGUAGE_CODES,
    isArray: true,
    example: 'tr,en',
  })
  @IsOptional()
  @Transform(({ value }) => parseLanguageList(value))
  @IsArray({ message: CONTENT_LANGUAGE_MESSAGE })
  @ArrayMaxSize(CONTENT_LANGUAGE_CODES.length, { message: CONTENT_LANGUAGE_MESSAGE })
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { each: true, message: CONTENT_LANGUAGE_MESSAGE })
  language?: string[];

  @ApiPropertyOptional({
    description:
      'true (and no language): one item per tale (translation group), shown in the content language of the caller when that version is published, else in the original language. Ignored when language is sent.',
  })
  @IsOptional()
  @Transform(({ value }) => parseBooleanParam(value))
  @IsBoolean({ message: 'errors.validation.groupedBoolean' })
  grouped?: boolean;

  @ApiPropertyOptional({
    description:
      'Content language to prefer in a grouped list. Wins over the stored contentLanguage preference; meant for anonymous callers.',
    enum: CONTENT_LANGUAGE_CODES,
  })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  prefer?: string;

  @ApiPropertyOptional({
    description: 'CEFR level filter, one or several (comma separated or repeated).',
    enum: LanguageLevel,
    isArray: true,
    example: 'A1,A2',
  })
  @IsOptional()
  @Transform(({ value }) => parseLanguageLevels(value))
  @IsArray({ message: LANGUAGE_LEVEL_MESSAGE })
  @ArrayMaxSize(6, { message: LANGUAGE_LEVEL_MESSAGE })
  @IsEnum(LanguageLevel, { each: true, message: LANGUAGE_LEVEL_MESSAGE })
  languageLevel?: LanguageLevel[];
}

export class StoryQueryDto extends StoryLanguageFilterDto {
  @ApiProperty({ enum: AgeGroup, required: false })
  @IsOptional()
  @IsEnum(AgeGroup)
  ageGroup?: AgeGroup;

  @ApiProperty({ enum: StoryCategory, required: false })
  @IsOptional()
  @IsEnum(StoryCategory)
  category?: StoryCategory;

  // Query strings arrive as "true"/"false"; `@Type(() => Boolean)` would turn
  // the string "false" into `true`, so map the literals explicitly.
  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return value;
  })
  @IsBoolean()
  isPremium?: boolean;

  @ApiPropertyOptional({
    description: 'Sort order. Absent keeps the default (newest first).',
    enum: STORY_SORTS,
  })
  @IsOptional()
  @IsIn(STORY_SORTS as unknown as string[], { message: STORY_SORT_MESSAGE })
  sort?: StorySort;
}
