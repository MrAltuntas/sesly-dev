import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { normaliseLanguageParam } from '../../stories/story-query.util';
import {
  ADMIN_LEGAL_LIST_LANGUAGE_MESSAGE,
  ALL_LEGAL_DOCUMENT_LANGUAGES,
  LEGAL_DOCUMENT_LANGUAGES,
  LEGAL_DOCUMENT_LANGUAGE_MESSAGE,
  LegalDocumentLanguage,
} from '../legal-languages';

/**
 * `?language=` of the public reads (`GET /legal`, `GET /legal/:slug`) and of
 * the admin routes that address one document (`GET|PATCH /admin/legal/:slug`,
 * `GET /admin/legal/:slug/versions`, `POST /admin/legal/:slug/publish`).
 * Absent means Turkish, so clients that send nothing keep their old behaviour.
 * Case and a region suffix are ignored (`EN`, `en-US` are read as `en`).
 */
export class LegalLanguageQueryDto {
  @ApiPropertyOptional({
    enum: [...LEGAL_DOCUMENT_LANGUAGES],
    default: 'tr',
    description: 'Document language. Absent: tr.',
  })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn([...LEGAL_DOCUMENT_LANGUAGES], {
    message: LEGAL_DOCUMENT_LANGUAGE_MESSAGE,
  })
  language?: LegalDocumentLanguage;
}

/** `?language=` of `GET /admin/legal`: one language, or `all`. Absent: tr. */
export class AdminLegalListQueryDto {
  @ApiPropertyOptional({
    enum: [...LEGAL_DOCUMENT_LANGUAGES, ALL_LEGAL_DOCUMENT_LANGUAGES],
    default: 'tr',
    description:
      'tr or en: the documents of that language. all: every language (slug asc, Turkish first). Absent: tr.',
  })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn([...LEGAL_DOCUMENT_LANGUAGES, ALL_LEGAL_DOCUMENT_LANGUAGES], {
    message: ADMIN_LEGAL_LIST_LANGUAGE_MESSAGE,
  })
  language?: LegalDocumentLanguage | typeof ALL_LEGAL_DOCUMENT_LANGUAGES;
}
