import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LEGAL_DOCUMENT_LANGUAGES } from '../legal-languages';

/**
 * Immutable publish snapshot. One row per publish — represents the exact
 * markdown/title that was live at that version.
 */
export class LegalDocumentVersionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  documentId: string;

  @ApiProperty({ description: 'Denormalized slug of the parent document' })
  slug: string;

  @ApiProperty({
    enum: [...LEGAL_DOCUMENT_LANGUAGES],
    description: 'Denormalized language of the parent document',
  })
  language: string;

  @ApiProperty({ description: 'Starts at 1, monotonically increasing per document (each language counts on its own)' })
  version: number;

  @ApiProperty()
  title: string;

  @ApiProperty()
  contentMd: string;

  @ApiProperty()
  publishedAt: Date;

  @ApiPropertyOptional({ nullable: true, description: 'Admin email/id that published this version' })
  publishedBy: string | null;
}
