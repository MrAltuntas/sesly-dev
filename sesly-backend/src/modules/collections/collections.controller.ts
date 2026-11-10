import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiParam,
} from '@nestjs/swagger';
import { CollectionsService } from './collections.service';
import { CollectionResponseDto } from './dto/collection-response.dto';
import {
  CollectionLanguageQueryDto,
  CollectionStoriesQueryDto,
} from './dto/collection-query.dto';
import { Public } from '@common/decorators/public.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';

@ApiTags('Collections')
@Controller('collections')
export class CollectionsController {
  constructor(private readonly collectionsService: CollectionsService) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List all active collections',
    description:
      'Returns curated collections surfaced on the mobile "Koleksiyonlar" screen. Sorted by sortOrder ascending.',
  })
  @ApiResponse({ status: 200, type: [CollectionResponseDto] })
  async list(@Query() query: CollectionLanguageQueryDto) {
    return this.collectionsService.list(query.language);
  }

  @Get(':slug')
  @Public()
  @ApiOperation({ summary: 'Get a collection by its slug' })
  @ApiParam({ name: 'slug', example: 'sleep' })
  @ApiResponse({ status: 200, type: CollectionResponseDto })
  @ApiResponse({ status: 404, description: 'Collection not found' })
  async getBySlug(
    @Param('slug') slug: string,
    @Query() query: CollectionLanguageQueryDto,
  ) {
    return this.collectionsService.getBySlug(slug, query.language);
  }

  @Get(':slug/stories')
  @Public()
  @ApiOperation({
    summary: 'Get paginated stories that belong to a collection',
    description:
      'Ordered by the curator-set `position` field. Used by CollectionDetailScreen.',
  })
  @ApiParam({ name: 'slug', example: 'sleep' })
  @ApiResponse({ status: 200, description: 'Paginated stories list' })
  @ApiResponse({ status: 404, description: 'Collection not found' })
  async getStories(
    @Param('slug') slug: string,
    @Query() pagination: CollectionStoriesQueryDto,
    @CurrentUser('id') userId?: string,
  ) {
    // Optional auth: isFavorite is computed when a valid Bearer token is sent.
    return this.collectionsService.getStories(
      slug,
      pagination.page || 1,
      pagination.limit || 20,
      userId || undefined,
      pagination.language,
    );
  }
}
