import {
    BadRequestException,
    Controller,
    Get,
    Post,
    Patch,
    Delete,
    Param,
    Query,
    Body,
    HttpCode,
    HttpStatus,
} from '@nestjs/common';
import {ApiTags, ApiOperation, ApiResponse, ApiBearerAuth} from '@nestjs/swagger';
import {Throttle} from '@nestjs/throttler';
import {StoriesService} from './stories.service';
import {StoryQueryDto} from './dto/story-query.dto';
import {StorySearchDto} from './dto/story-search.dto';
import {UpdateProgressDto} from './dto/update-progress.dto';
import {StoryResponseDto} from './dto/story-response.dto';
import {FavoritesQueryDto, TranslationRequestDto} from './dto/favorites-query.dto';
import {TranslationRequestsService} from '@modules/translation-requests/translation-requests.service';
import {
    CONTENT_LANGUAGE_MESSAGE,
    isContentLanguage,
} from '@common/constants/content-languages';
import {normaliseLanguageParam} from './story-query.util';
import {CurrentUser} from '@common/decorators/current-user.decorator';
import {Public} from '@common/decorators/public.decorator';

/** Window of the translation request rate limit (30 requests per user). */
const HOUR_MS = 60 * 60 * 1000;

@ApiTags('Stories')
@Controller('stories')
export class StoriesController {
    constructor(
        private storiesService: StoriesService,
        private translationRequestsService: TranslationRequestsService,
    ) {
    }

    @Get('search')
    @Public()
    @ApiOperation({summary: 'Search stories by title or content'})
    @ApiResponse({status: 200, description: 'Search results'})
    async searchStories(
        @CurrentUser('id') userId: string | undefined,
        @Query() searchDto: StorySearchDto,
    ) {
        // Optional auth: userId is set when a valid Bearer token was sent.
        return this.storiesService.searchStories(userId || undefined, searchDto.q, {
            page: searchDto.page || 1,
            limit: searchDto.limit || 20,
            language: searchDto.language,
            languageLevel: searchDto.languageLevel,
            grouped: searchDto.grouped,
            prefer: searchDto.prefer,
        });
    }

    @Get('languages')
    @Public()
    @ApiOperation({
        summary: 'Enabled content languages with published story counts and the CEFR levels present',
    })
    @ApiResponse({status: 200, description: 'Languages retrieved'})
    async getLanguages() {
        return this.storiesService.getLanguages();
    }

    @Get()
    @Public()
    @ApiOperation({summary: 'Get paginated list of stories'})
    @ApiResponse({status: 200, description: 'Stories retrieved', type: [StoryResponseDto]})
    async getStories(
        @CurrentUser('id') userId: string | undefined,
        @Query() query: StoryQueryDto,
    ) {
        // Optional auth: anonymous callers get FREE visibility and no favorites.
        return this.storiesService.getStories(userId || undefined, query);
    }

    @Get('favorites')
    @ApiBearerAuth()
    @ApiOperation({summary: 'Get user favorite stories'})
    @ApiResponse({status: 200, description: 'Favorites retrieved'})
    async getFavorites(
        @CurrentUser('id') userId: string,
        @Query() query: FavoritesQueryDto,
    ) {
        return this.storiesService.getFavorites(userId, query.page || 1, query.limit || 20, {
            grouped: query.grouped,
            prefer: query.prefer,
        });
    }

    @Get(':id')
    @ApiBearerAuth()
    @ApiOperation({summary: 'Get story by ID with chunks'})
    @ApiResponse({status: 200, description: 'Story retrieved'})
    @ApiResponse({status: 403, description: 'Premium story requires Pro subscription'})
    @ApiResponse({status: 404, description: 'Story not found'})
    async getStory(
        @CurrentUser('id') userId: string,
        @Param('id') storyId: string,
    ) {
        return this.storiesService.getStory(userId, storyId);
    }

    @Get(':id/related')
    @ApiBearerAuth()
    @ApiOperation({
        summary:
            'Stories related to this one, grouped: other language versions, other parts, more of the same category',
    })
    @ApiResponse({status: 200, description: '{ languages, parts (each with partNumber), category }: list-shaped items'})
    @ApiResponse({status: 403, description: 'Premium story for a plan without premium stories (PREMIUM_STORY)'})
    @ApiResponse({status: 404, description: 'Story not found'})
    async getRelatedStories(
        @CurrentUser('id') userId: string,
        @Param('id') storyId: string,
    ) {
        return this.storiesService.getRelatedStories(userId, storyId);
    }

    @Patch(':id/progress')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({summary: 'Update user story progress'})
    @ApiResponse({status: 200, description: 'Progress updated'})
    async updateProgress(
        @CurrentUser('id') userId: string,
        @Param('id') storyId: string,
        @Body() dto: UpdateProgressDto,
    ) {
        return this.storiesService.updateProgress(
            userId,
            storyId,
            dto.voiceProfileId,
            dto.lastChunkIndex,
            dto.completedAt,
        );
    }

    @Post(':id/translation-requests')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @Throttle({default: {limit: 30, ttl: HOUR_MS}})
    @ApiOperation({
        summary:
            'Ask for this story in another language. Idempotent; counts for the whole tale (translation group).',
    })
    @ApiResponse({status: 200, description: '{ storyId, language, requested: true, requestedLanguages }'})
    @ApiResponse({status: 400, description: 'Unknown content language'})
    @ApiResponse({status: 404, description: 'Story not found (STORY_NOT_FOUND)'})
    @ApiResponse({
        status: 409,
        description: 'The tale is already published in that language (TRANSLATION_ALREADY_AVAILABLE, with storyId)',
    })
    @ApiResponse({status: 429, description: 'More than 30 requests in an hour'})
    async requestTranslation(
        @CurrentUser('id') userId: string,
        @Param('id') storyId: string,
        @Body() dto: TranslationRequestDto,
    ) {
        return this.translationRequestsService.request(userId, storyId, dto.language);
    }

    @Delete(':id/translation-requests/:language')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({summary: 'Withdraw a translation request. Idempotent.'})
    @ApiResponse({status: 200, description: '{ storyId, language, requested: false, requestedLanguages }'})
    @ApiResponse({status: 400, description: 'Unknown content language'})
    @ApiResponse({status: 404, description: 'Story not found (STORY_NOT_FOUND)'})
    async withdrawTranslationRequest(
        @CurrentUser('id') userId: string,
        @Param('id') storyId: string,
        @Param('language') language: string,
    ) {
        const code = normaliseLanguageParam(language);
        if (!isContentLanguage(code)) {
            throw new BadRequestException(CONTENT_LANGUAGE_MESSAGE);
        }
        return this.translationRequestsService.withdraw(userId, storyId, code);
    }

    @Post(':id/favorite')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({summary: 'Add story to favorites'})
    @ApiResponse({status: 200, description: 'Story added to favorites'})
    async addToFavorites(
        @CurrentUser('id') userId: string,
        @Param('id') storyId: string,
    ) {
        return this.storiesService.addToFavorites(userId, storyId);
    }

    @Delete(':id/favorite')
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({summary: 'Remove story from favorites'})
    @ApiResponse({status: 200, description: 'Story removed from favorites'})
    @ApiResponse({status: 404, description: 'Story not in favorites'})
    async removeFromFavorites(
        @CurrentUser('id') userId: string,
        @Param('id') storyId: string,
    ) {
        return this.storiesService.removeFromFavorites(userId, storyId);
    }
}