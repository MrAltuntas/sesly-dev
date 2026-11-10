import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/** Most stories one bulk request may name. */
export const BULK_MAX_STORIES = 200;
/** Most stories one bulk review request may name (the update runs in chunks). */
export const BULK_REVIEW_MAX_STORIES = 1000;
/** Most file names one cover match request may name. */
export const COVER_MATCH_MAX_KEYS = 300;
/** What the admin types to confirm a bulk delete (dotted or dotless I). */
export const BULK_DELETE_CONFIRM_WORDS = ['SİL', 'SIL'] as const;

const bool = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class StoryIdsDto {
  @ApiProperty({ type: [String], description: `Story ids, at most ${BULK_MAX_STORIES}` })
  @IsArray({ message: 'storyIds bir dizi olmalıdır.' })
  @ArrayMinSize(1, { message: 'En az bir masal seçilmelidir.' })
  @ArrayMaxSize(BULK_MAX_STORIES, { message: `Tek seferde en fazla ${BULK_MAX_STORIES} masal işlenebilir.` })
  @IsString({ each: true, message: 'Masal kimliği metin olmalıdır.' })
  @MaxLength(64, { each: true, message: 'Masal kimliği geçersiz.' })
  storyIds: string[];
}

export class BulkPublishDto extends StoryIdsDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Only publish stories marked "İncelendi" (the review view sends true); the others are skipped',
  })
  @IsOptional()
  @IsBoolean({ message: 'requireReviewed true ya da false olmalıdır.' })
  requireReviewed?: boolean;
}

export class BulkDeleteDto extends StoryIdsDto {
  @ApiProperty({
    description: 'Number of stories the admin was shown in the confirmation (delete-preview). A different count is refused.',
  })
  @IsInt({ message: 'expectedCount tam sayı olmalıdır.' })
  @Min(1, { message: 'expectedCount en az 1 olmalıdır.' })
  expectedCount: number;

  @ApiProperty({ example: 'SİL', description: 'The word the admin typed to confirm' })
  @IsString({ message: 'Onay metni gereklidir.' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLocaleUpperCase('tr') : value))
  @IsIn(BULK_DELETE_CONFIRM_WORDS as unknown as string[], { message: 'Silmeyi onaylamak için SİL yazılmalıdır.' })
  confirm: string;
}

export class ReviewStoryDto {
  @ApiProperty({ description: 'true marks the story "İncelendi", false takes the mark away' })
  @IsBoolean({ message: 'reviewed true ya da false olmalıdır.' })
  reviewed: boolean;
}

export class BulkReviewDto {
  @ApiProperty({ type: [String], description: `Story ids, at most ${BULK_REVIEW_MAX_STORIES}` })
  @IsArray({ message: 'storyIds bir dizi olmalıdır.' })
  @ArrayMinSize(1, { message: 'En az bir masal seçilmelidir.' })
  @ArrayMaxSize(BULK_REVIEW_MAX_STORIES, {
    message: `Tek seferde en fazla ${BULK_REVIEW_MAX_STORIES} masal işaretlenebilir.`,
  })
  @IsString({ each: true, message: 'Masal kimliği metin olmalıdır.' })
  @MaxLength(64, { each: true, message: 'Masal kimliği geçersiz.' })
  storyIds: string[];

  @ApiProperty({ description: 'true marks the stories "İncelendi", false takes the mark away' })
  @IsBoolean({ message: 'reviewed true ya da false olmalıdır.' })
  reviewed: boolean;
}

export class CoverMatchDto {
  @ApiProperty({
    type: [String],
    example: ['little-idas-flowers', 'woodcutter-of-gura'],
    description: 'File names without extension (the batch images are named <slug>.<ext>): matched to a tale by pairKey, partOf or slug',
  })
  @IsArray({ message: 'keys bir dizi olmalıdır.' })
  @ArrayMinSize(1, { message: 'En az bir dosya adı gönderilmelidir.' })
  @ArrayMaxSize(COVER_MATCH_MAX_KEYS, { message: `Tek seferde en fazla ${COVER_MATCH_MAX_KEYS} dosya eşleştirilebilir.` })
  @IsString({ each: true, message: 'Dosya adı metin olmalıdır.' })
  @MaxLength(200, { each: true, message: 'Dosya adı en fazla 200 karakter olabilir.' })
  keys: string[];
}

/** Multipart fields of POST /admin/stories/:id/cover (next to the coverImage file). */
export class SetCoverDto {
  @ApiPropertyOptional({
    description:
      'Credit of the picture as JSON text: { illustrator, licenseName, licenseUrl, source, attribution }; a <slug>.credit.json is accepted as it is. Absent or blank: the picture needs no credit.',
  })
  @IsOptional()
  @IsString({ message: 'Kapak resmi künyesi JSON metni olmalıdır.' })
  @MaxLength(5000, { message: 'Kapak resmi künyesi en fazla 5000 karakter olabilir.' })
  coverCredit?: string;

  @ApiPropertyOptional({ default: true, description: 'Write the cover to every story of the tale (all languages and parts)' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean({ message: 'applyCoverToTale true ya da false olmalıdır.' })
  applyCoverToTale?: boolean;
}
