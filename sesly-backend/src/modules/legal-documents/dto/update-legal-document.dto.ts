import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateLegalDocumentDto } from './create-legal-document.dto';

/**
 * Body for `PATCH /admin/legal/:slug?language=` — edits the draft copy.
 * Slug and language identify the document and are immutable post-creation
 * (the slug lives in URLs and is cross-referenced from mobile + web), so both
 * are omitted from the update shape; the language goes in the query string.
 */
export class UpdateLegalDocumentDto extends PartialType(
  OmitType(CreateLegalDocumentDto, ['slug', 'language'] as const),
) {}
