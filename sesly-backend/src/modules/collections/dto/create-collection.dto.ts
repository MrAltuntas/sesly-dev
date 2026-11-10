import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { CollectionTone } from '../../../common/enums/prisma.enums';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
} from '../../../common/constants/content-languages';

export class CreateCollectionDto {
  @ApiProperty({ description: 'Stable url-safe slug (lowercase letters, numbers, dashes)', example: 'sleep' })
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase letters, numbers, and dashes only',
  })
  slug: string;

  @ApiPropertyOptional({
    description: 'Content language of the collection. The slug is unique per language.',
    enum: CONTENT_LANGUAGE_CODES,
    default: 'tr',
  })
  @IsOptional()
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language?: string;

  @ApiProperty({ example: 'Uyku Vakti' })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title: string;

  @ApiPropertyOptional({ example: 'Sakin, yumuşak masallar' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string;

  @ApiProperty({ enum: CollectionTone })
  @IsEnum(CollectionTone)
  tone: CollectionTone;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  coverImageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
