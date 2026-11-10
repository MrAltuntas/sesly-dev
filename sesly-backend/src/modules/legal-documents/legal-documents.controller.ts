import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LegalDocumentsService } from './legal-documents.service';
import { PublicLegalDocumentDto } from './dto/legal-document-response.dto';
import { LegalLanguageQueryDto } from './dto/legal-language-query.dto';
import { Public } from '@common/decorators/public.decorator';

@ApiTags('Legal')
@Controller('legal')
export class LegalDocumentsController {
  constructor(
    private readonly legalDocumentsService: LegalDocumentsService,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List all published legal documents',
    description:
      'Returns the latest published version of every legal document, one entry per slug. With ?language=en a slug whose English document is not published is returned in Turkish; `language` on each entry is the language of the returned text. Unpublished drafts are omitted entirely.',
  })
  @ApiResponse({ status: 200, type: [PublicLegalDocumentDto] })
  @ApiResponse({ status: 400, description: 'language is not tr or en' })
  async list(
    @Query() query: LegalLanguageQueryDto,
  ): Promise<PublicLegalDocumentDto[]> {
    return this.legalDocumentsService.listPublic(query.language);
  }

  @Get(':slug')
  @Public()
  @ApiOperation({
    summary: 'Get the latest published version of a legal document by slug',
    description:
      'Optional ?language=tr|en (absent: tr). When the requested language has no published version the published Turkish one is returned; `language` in the response says which language was served.',
  })
  @ApiParam({
    name: 'slug',
    example: 'tos',
    description: 'tos | privacy | data-deletion',
  })
  @ApiResponse({ status: 200, type: PublicLegalDocumentDto })
  @ApiResponse({ status: 400, description: 'language is not tr or en' })
  @ApiResponse({
    status: 404,
    description: 'Slug unknown or never published (in the requested language nor in Turkish)',
  })
  async getBySlug(
    @Param('slug') slug: string,
    @Query() query: LegalLanguageQueryDto,
  ): Promise<PublicLegalDocumentDto> {
    return this.legalDocumentsService.getPublicBySlug(slug, query.language);
  }
}
