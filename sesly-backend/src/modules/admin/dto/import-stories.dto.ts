import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AgeGroup,
  ContentWarning,
  LanguageLevel,
  StoryCategory,
  StoryOrigin,
  StoryRightsBasis,
  StoryTextFidelity,
  TranslationMethod,
} from '../../../common/enums/prisma.enums';
import {
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_SPEED_MAX,
  SONIC3_SPEED_MIN,
  SONIC3_VOLUME_MAX,
  SONIC3_VOLUME_MIN,
} from '../../tts-providers/cartesia/cartesia-emotions.constants';
import {
  PAUSE_AFTER_MAX_MS,
  SEGMENTS_MAX_COUNT,
  SEGMENT_MAX_CHARS,
} from '../../story-segmentation/story-segments';
import {
  OptionalContentWarnings,
  OptionalEnum,
  OptionalText,
  OptionalUrl,
  OptionalYear,
} from './story-field.decorators';

const list = (o: Record<string, string>) => Object.values(o).join(', ');

/** Languages the bulk import accepts. */
export const IMPORT_LANGUAGES = ['tr', 'en'] as const;
/** Lower-case letters, digits and hyphens (pairKey, partOf). */
export const IMPORT_KEY_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const IMPORT_MAX_STORIES = 300;
export const IMPORT_MAX_TAGS = 20;
export const IMPORT_BATCH_MAX_LENGTH = 120;

/** One segment of a story prepared offline (order = array order). */
export class ImportSegmentDto {
  @ApiProperty({ description: 'Text the TTS reads aloud' })
  @IsString({ message: 'Segment metni metin olmalıdır.' })
  @IsNotEmpty({ message: 'Segment metni boş olamaz.' })
  @MaxLength(SEGMENT_MAX_CHARS, { message: `Segment metni en fazla ${SEGMENT_MAX_CHARS} karakter olabilir.` })
  text: string;

  @ApiPropertyOptional({ enum: SONIC3_EXTENDED_EMOTIONS as unknown as string[] })
  @IsOptional()
  @IsIn(SONIC3_EXTENDED_EMOTIONS as unknown as string[], { message: 'Desteklenmeyen duygu.' })
  emotion?: string;

  @ApiPropertyOptional({ minimum: SONIC3_SPEED_MIN, maximum: SONIC3_SPEED_MAX, example: 0.85 })
  @IsOptional()
  @IsNumber({}, { message: 'Hız sayı olmalıdır.' })
  @Min(SONIC3_SPEED_MIN, { message: `Hız en az ${SONIC3_SPEED_MIN} olabilir.` })
  @Max(SONIC3_SPEED_MAX, { message: `Hız en fazla ${SONIC3_SPEED_MAX} olabilir.` })
  speed?: number;

  @ApiPropertyOptional({ minimum: SONIC3_VOLUME_MIN, maximum: SONIC3_VOLUME_MAX })
  @IsOptional()
  @IsNumber({}, { message: 'Ses düzeyi sayı olmalıdır.' })
  @Min(SONIC3_VOLUME_MIN, { message: `Ses düzeyi en az ${SONIC3_VOLUME_MIN} olabilir.` })
  @Max(SONIC3_VOLUME_MAX, { message: `Ses düzeyi en fazla ${SONIC3_VOLUME_MAX} olabilir.` })
  volume?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: PAUSE_AFTER_MAX_MS, example: 600 })
  @IsOptional()
  @IsInt({ message: 'Ara (ms) tam sayı olmalıdır.' })
  @Min(0, { message: 'Ara (ms) negatif olamaz.' })
  @Max(PAUSE_AFTER_MAX_MS, { message: `Ara en fazla ${PAUSE_AFTER_MAX_MS} ms olabilir.` })
  pauseAfterMs?: number;
}

/**
 * One story of a bulk import file. See docs/story-pipeline.md for the
 * format and how each field maps onto the Story columns.
 */
export class ImportStoryItemDto {
  @ApiProperty({ example: 'Kırmızı Başlıklı Kız' })
  @IsString({ message: 'Başlık metin olmalıdır.' })
  @IsNotEmpty({ message: 'Başlık zorunludur.' })
  @MaxLength(300, { message: 'Başlık en fazla 300 karakter olabilir.' })
  title: string;

  @ApiProperty({ enum: IMPORT_LANGUAGES })
  @IsIn(IMPORT_LANGUAGES as unknown as string[], { message: 'Dil "tr" ya da "en" olmalıdır.' })
  language: string;

  @ApiProperty({ description: 'Full story text, paragraphs separated by a blank line' })
  @IsString({ message: 'Metin metin olmalıdır.' })
  @IsNotEmpty({ message: 'Metin zorunludur.' })
  @MaxLength(200_000, { message: 'Metin en fazla 200000 karakter olabilir.' })
  text: string;

  @ApiProperty({ enum: StoryCategory })
  @IsEnum(StoryCategory, { message: `Kategori şu değerlerden biri olmalıdır: ${list(StoryCategory)}.` })
  category: StoryCategory;

  @ApiProperty({ enum: AgeGroup })
  @IsEnum(AgeGroup, { message: `Yaş grubu şu değerlerden biri olmalıdır: ${list(AgeGroup)}.` })
  ageGroup: AgeGroup;

  @ApiPropertyOptional({ enum: LanguageLevel })
  @IsOptional()
  @IsEnum(LanguageLevel, { message: `Seviye şu değerlerden biri olmalıdır: ${list(LanguageLevel)}.` })
  level?: LanguageLevel;

  @ApiPropertyOptional({ type: [String], example: ['hayvanlar', 'fabl'] })
  @IsOptional()
  @IsArray({ message: 'Etiketler bir dizi olmalıdır.' })
  @ArrayMaxSize(IMPORT_MAX_TAGS, { message: `En fazla ${IMPORT_MAX_TAGS} etiket olabilir.` })
  @IsString({ each: true, message: 'Her etiket metin olmalıdır.' })
  @MaxLength(50, { each: true, message: 'Bir etiket en fazla 50 karakter olabilir.' })
  tags?: string[];

  @OptionalText('Açıklama', 1000)
  description?: string | null;

  /** SCARY, VIOLENCE, DEATH, SAD_ENDING, BAD_EXAMPLE, OLD_LANGUAGE, LONELINESS */
  @OptionalContentWarnings()
  contentWarnings?: ContentWarning[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean({ message: 'isPremium true ya da false olmalıdır.' })
  isPremium?: boolean;

  // ---------- Credit ----------

  @OptionalText('Yazar', 200)
  author?: string | null;

  @OptionalYear('Yazarın ölüm yılı')
  authorDeathYear?: number | null;

  @OptionalText('Derleyen', 200)
  collector?: string | null;

  @OptionalYear('Derleyenin ölüm yılı')
  collectorDeathYear?: number | null;

  @OptionalText('Çevirmen', 200)
  translator?: string | null;

  @OptionalYear('Çevirmenin ölüm yılı')
  translatorDeathYear?: number | null;

  @OptionalText('Derleme / kitap', 300)
  collection?: string | null;

  @OptionalUrl('Kaynak bağlantısı')
  sourceUrl?: string | null;

  @OptionalText('Kaynak baskı', 500)
  sourceEdition?: string | null;

  @OptionalYear('İlk yayım yılı')
  firstPublishedYear?: number | null;

  @OptionalText('Özgün başlık', 300)
  originalTitle?: string | null;

  @ApiPropertyOptional({ example: 'da' })
  @IsOptional()
  @Matches(/^[a-z]{2,3}$/, { message: 'Özgün dil iki ya da üç harfli bir dil kodu olmalıdır (ör. da, fa).' })
  originalLanguage?: string | null;

  @OptionalText('Lisans', 200)
  licence?: string | null;

  @OptionalUrl('Lisans bağlantısı')
  licenceUrl?: string | null;

  @OptionalText('Atıf metni', 2000)
  attribution?: string | null;

  @OptionalText('Hak dayanağı açıklaması', 4000)
  licenceBasis?: string | null;

  @OptionalEnum('Hak dayanağı', StoryRightsBasis)
  rightsBasis?: StoryRightsBasis | null;

  @OptionalEnum('Köken', StoryOrigin)
  origin?: StoryOrigin | null;

  @OptionalEnum('Metin sadakati', StoryTextFidelity)
  textFidelity?: StoryTextFidelity | null;

  // ---------- Translation ----------

  @ApiPropertyOptional({
    enum: TranslationMethod,
    description:
      'MACHINE: this text is our AI translation (the app shows "Yapay zekâ ile çevrildi"); HUMAN: a human translation',
  })
  @OptionalEnum('Çeviri yöntemi', TranslationMethod)
  translationMethod?: TranslationMethod | null;

  @ApiPropertyOptional({
    enum: IMPORT_LANGUAGES,
    example: 'en',
    description:
      'Language of the story in the same pairKey this text was translated from (needs pairKey, differs from language). Sets translatedFromId.',
  })
  @IsOptional()
  @IsIn(IMPORT_LANGUAGES as unknown as string[], { message: 'translatedFrom "tr" ya da "en" olmalıdır.' })
  translatedFrom?: string;

  // ---------- Linking ----------

  @ApiPropertyOptional({
    example: 'kirmizi-baslikli-kiz',
    description: 'Same key on a tr and an en story: one translation group (one story per language)',
  })
  @IsOptional()
  @Matches(IMPORT_KEY_PATTERN, { message: 'pairKey yalnızca küçük harf, rakam ve tire içerebilir.' })
  @MaxLength(80, { message: 'pairKey en fazla 80 karakter olabilir.' })
  pairKey?: string;

  @ApiPropertyOptional({
    example: 'kar-kralicesi',
    description: 'Same key on every part of one tale (per language); needs partNumber',
  })
  @IsOptional()
  @Matches(IMPORT_KEY_PATTERN, { message: 'partOf yalnızca küçük harf, rakam ve tire içerebilir.' })
  @MaxLength(80, { message: 'partOf en fazla 80 karakter olabilir.' })
  partOf?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 99 })
  @IsOptional()
  @IsInt({ message: 'partNumber tam sayı olmalıdır.' })
  @Min(1, { message: 'partNumber en az 1 olabilir.' })
  @Max(99, { message: 'partNumber en fazla 99 olabilir.' })
  partNumber?: number;

  // ---------- Segments (optional, prepared offline) ----------

  @ApiPropertyOptional({ type: [ImportSegmentDto] })
  @IsOptional()
  @IsArray({ message: 'segments bir dizi olmalıdır.' })
  @ArrayMinSize(1, { message: 'segments boş olamaz; segment yoksa alanı hiç göndermeyin.' })
  @ArrayMaxSize(SEGMENTS_MAX_COUNT, { message: `En fazla ${SEGMENTS_MAX_COUNT} segment olabilir.` })
  @ValidateNested({ each: true })
  @Type(() => ImportSegmentDto)
  segments?: ImportSegmentDto[];
}

/**
 * Body of POST /admin/stories/import. Items are validated one by one by
 * the service (a bad item is reported, the others are imported), so they
 * are plain objects here.
 */
export class ImportStoriesDto {
  @ApiProperty({ type: [ImportStoryItemDto] })
  @IsArray({ message: 'stories bir dizi olmalıdır.' })
  @ArrayMinSize(1, { message: 'En az bir masal gönderilmelidir.' })
  @ArrayMaxSize(IMPORT_MAX_STORIES, {
    message: `Tek istekte en fazla ${IMPORT_MAX_STORIES} masal gönderilebilir.`,
  })
  @IsObject({ each: true, message: 'Her masal bir nesne olmalıdır.' })
  stories: Record<string, unknown>[];

  @ApiPropertyOptional({ default: false, description: 'Validate and report, write nothing' })
  @IsOptional()
  @IsBoolean({ message: 'dryRun true ya da false olmalıdır.' })
  dryRun?: boolean;

  @ApiPropertyOptional({
    example: 'import-batch1.json',
    description:
      'Label of this import (the panel sends the file name; every request of one file sends the same label). Stored as Story.importBatch for the review view. Absent: the import date (YYYY-MM-DD).',
  })
  @IsOptional()
  @IsString({ message: 'Aktarım etiketi (batch) metin olmalıdır.' })
  @MaxLength(IMPORT_BATCH_MAX_LENGTH, {
    message: `Aktarım etiketi (batch) en fazla ${IMPORT_BATCH_MAX_LENGTH} karakter olabilir.`,
  })
  batch?: string;
}
