import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AgeGroup,
  LanguageLevel,
  StoryCategory,
  StoryOrigin,
  StoryStatus,
} from '../../../common/enums/prisma.enums';
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
  parseLanguageLevels,
} from '../../stories/story-query.util';

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() || undefined : value;

/** "true" / "false" from a query string; anything else is left for IsBoolean to refuse. */
export const toBool = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const text = value.trim().toLowerCase();
  if (text === '') return undefined;
  if (text === 'true' || text === '1') return true;
  if (text === 'false' || text === '0') return false;
  return value;
};

/** A calendar day, YYYY-MM-DD. */
export const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Largest page of the admin story list and of the review list (the panel
 * offers 25, 50, 100 and 200 rows per page).
 */
export const ADMIN_STORY_PAGE_MAX = 200;

/**
 * Page and page size of the admin story lists. Same fields and messages as
 * PaginationDto, but up to ADMIN_STORY_PAGE_MAX rows. Its own class rather
 * than a redeclared PaginationDto field: class-validator keeps the inherited
 * Max(100) for every class further down the chain.
 */
export class AdminStoryPageDto {
  @ApiPropertyOptional({ description: 'Page number (1-indexed)', minimum: 1, default: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: ADMIN_STORY_PAGE_MAX, default: 20, description: 'Rows per page' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Limit must be an integer' })
  @Min(1, { message: 'Limit must be at least 1' })
  @Max(ADMIN_STORY_PAGE_MAX, { message: `Limit must not exceed ${ADMIN_STORY_PAGE_MAX}` })
  limit?: number = 20;
}

/** Filters of GET /admin/stories. Every one is optional; absent means "all". */
export class AdminStoriesQueryDto extends AdminStoryPageDto {
  @ApiPropertyOptional({ enum: CONTENT_LANGUAGE_CODES, description: 'Content language' })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language?: string;

  @ApiPropertyOptional({ enum: StoryStatus })
  @IsOptional()
  @Transform(upper)
  @IsEnum(StoryStatus, { message: 'Durum şu değerlerden biri olmalıdır: DRAFT, PUBLISHED, ARCHIVED.' })
  status?: StoryStatus;

  @ApiPropertyOptional({
    enum: LanguageLevel,
    isArray: true,
    description: 'One or several CEFR levels (comma separated or repeated)',
  })
  @IsOptional()
  @Transform(({ value }) => parseLanguageLevels(value))
  @IsArray({ message: LANGUAGE_LEVEL_MESSAGE })
  @ArrayMaxSize(6, { message: LANGUAGE_LEVEL_MESSAGE })
  @IsEnum(LanguageLevel, { each: true, message: LANGUAGE_LEVEL_MESSAGE })
  languageLevel?: LanguageLevel[];

  @ApiPropertyOptional({ enum: StoryCategory })
  @IsOptional()
  @Transform(upper)
  @IsEnum(StoryCategory, { message: 'Geçersiz kategori.' })
  category?: StoryCategory;

  @ApiPropertyOptional({ enum: AgeGroup })
  @IsOptional()
  @Transform(upper)
  @IsEnum(AgeGroup, { message: 'Geçersiz yaş grubu.' })
  ageGroup?: AgeGroup;

  @ApiPropertyOptional({ enum: StoryOrigin })
  @IsOptional()
  @Transform(upper)
  @IsEnum(StoryOrigin, { message: 'Geçersiz köken.' })
  origin?: StoryOrigin;

  @ApiPropertyOptional({ description: 'Text searched in title and content (case-insensitive)' })
  @IsOptional()
  @IsString({ message: 'Arama metni geçersiz.' })
  @MaxLength(200, { message: 'Arama metni en fazla 200 karakter olabilir.' })
  q?: string;

  @ApiPropertyOptional({
    enum: CONTENT_LANGUAGE_CODES,
    description: 'Only stories that have no sibling (translation) in this language',
  })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  missingLanguage?: string;

  @ApiPropertyOptional({ enum: STORY_SORTS, description: 'Absent means newest first' })
  @IsOptional()
  @IsIn(STORY_SORTS as unknown as string[], { message: STORY_SORT_MESSAGE })
  sort?: StorySort;

  @ApiPropertyOptional({ type: Boolean, description: 'true: only stories that came from a bulk import; false: only the others' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean({ message: 'imported true ya da false olmalıdır.' })
  imported?: boolean;

  @ApiPropertyOptional({ description: 'Only the stories of this import (Story.importBatch, see GET /admin/stories/import-batches)' })
  @IsOptional()
  @IsString({ message: 'Aktarım etiketi geçersiz.' })
  @MaxLength(120, { message: 'Aktarım etiketi en fazla 120 karakter olabilir.' })
  importBatch?: string;

  @ApiPropertyOptional({ type: Boolean, description: 'true: marked "İncelendi"; false: not reviewed yet' })
  @IsOptional()
  @Transform(toBool)
  @IsBoolean({ message: 'reviewed true ya da false olmalıdır.' })
  reviewed?: boolean;

  @ApiPropertyOptional({ example: '2026-09-01', description: 'Created on or after this day (YYYY-MM-DD, UTC)' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'Başlangıç tarihi YYYY-AA-GG biçiminde olmalıdır.' })
  createdFrom?: string;

  @ApiPropertyOptional({ example: '2026-10-20', description: 'Created on or before this day (YYYY-MM-DD, UTC)' })
  @IsOptional()
  @Matches(DAY_PATTERN, { message: 'Bitiş tarihi YYYY-AA-GG biçiminde olmalıdır.' })
  createdTo?: string;
}

/** Views GET /admin/stories/ids can follow. */
export const STORY_ID_VIEWS = ['list', 'review'] as const;
export type StoryIdView = (typeof STORY_ID_VIEWS)[number];

/**
 * Filters of GET /admin/stories/ids: the same as the list. view=review
 * applies the review list defaults (imported drafts, import order).
 * page and limit are accepted and ignored.
 */
export class AdminStoryIdsQueryDto extends AdminStoriesQueryDto {
  @ApiPropertyOptional({ enum: STORY_ID_VIEWS, default: 'list', description: 'review: the defaults of GET /admin/stories/review' })
  @IsOptional()
  @IsIn(STORY_ID_VIEWS as unknown as string[], { message: 'view list ya da review olmalıdır.' })
  view?: StoryIdView;
}
