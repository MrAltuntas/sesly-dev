import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LegalDocumentStatus } from '../../../common/enums/prisma.enums';
import { LEGAL_DOCUMENT_LANGUAGES } from '../legal-languages';

/**
 * Full admin-facing shape of a legal document — includes draft `contentMd`,
 * publish metadata and all timestamps. Do NOT return this on public endpoints.
 */
export class LegalDocumentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Stable slug (tos | privacy | data-deletion)' })
  slug: string;

  @ApiProperty({
    enum: [...LEGAL_DOCUMENT_LANGUAGES],
    description: 'Document language. A document is identified by (slug, language).',
  })
  language: string;

  @ApiProperty()
  title: string;

  @ApiProperty({
    description:
      'Working-copy markdown. May differ from the latest published version while the draft is being edited.',
  })
  contentMd: string;

  @ApiProperty({ description: '0 when never published; otherwise the latest published version number' })
  currentVersion: number;

  @ApiProperty({ enum: LegalDocumentStatus })
  status: LegalDocumentStatus;

  @ApiPropertyOptional({ nullable: true })
  publishedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, description: 'Admin email/id that last published this document' })
  publishedBy: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/**
 * Lean shape returned by `GET /legal` and `GET /legal/:slug`.
 * Intentionally omits draft/admin metadata — only data that is actually published.
 */
export class PublicLegalDocumentDto {
  @ApiProperty()
  slug: string;

  @ApiProperty({
    enum: [...LEGAL_DOCUMENT_LANGUAGES],
    description:
      'Language of the returned text. Differs from the requested language when that one has no published version and the Turkish one is served instead.',
  })
  language: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ description: 'Published markdown content (snapshot of the latest published version)' })
  contentMd: string;

  @ApiProperty({ description: 'Version number of the snapshot being returned (per language)' })
  version: number;

  @ApiProperty()
  publishedAt: Date;
}
