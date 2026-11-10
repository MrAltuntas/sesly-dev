import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normaliseLanguageParam } from '../../stories/story-query.util';
import {
  LEGAL_DOCUMENT_LANGUAGES,
  LEGAL_DOCUMENT_LANGUAGE_MESSAGE,
  LegalDocumentLanguage,
} from '../legal-languages';

/**
 * Body for `POST /admin/legal` — creates a DRAFT legal document with
 * `currentVersion: 0`. A subsequent call to the publish endpoint mints v1.
 * A document is identified by (slug, language): the English Terms of Use is
 * `{ slug: 'tos', language: 'en' }` next to the Turkish `{ slug: 'tos' }`.
 */
export class CreateLegalDocumentDto {
  @ApiProperty({
    description: 'Stable url-safe slug (lowercase letters, numbers, dashes)',
    example: 'tos',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'slug must be lowercase letters, numbers, and dashes only',
  })
  slug: string;

  @ApiPropertyOptional({
    enum: [...LEGAL_DOCUMENT_LANGUAGES],
    default: 'tr',
    description: 'Document language. Absent: tr. Cannot be changed later.',
  })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn([...LEGAL_DOCUMENT_LANGUAGES], {
    message: LEGAL_DOCUMENT_LANGUAGE_MESSAGE,
  })
  language?: LegalDocumentLanguage;

  @ApiProperty({ example: 'Kullanım Şartları' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @ApiProperty({
    description: 'Markdown body of the document (draft copy until publish)',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  contentMd: string;
}
