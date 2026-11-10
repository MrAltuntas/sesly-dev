import {
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
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiParam,
} from '@nestjs/swagger';
import { AdminStoriesService, COVER_MAX_BYTES } from '../services/admin-stories.service';
import { AdminStoryReviewService } from '../services/admin-story-review.service';
import { AdminStoryImportService } from '../services/admin-story-import.service';
import { AdminStorySegmentsService } from '../services/admin-story-segments.service';
import { ImportStoriesDto } from '../dto/import-stories.dto';
import {
  BulkDeleteDto,
  BulkPublishDto,
  BulkReviewDto,
  CoverMatchDto,
  ReviewStoryDto,
  SetCoverDto,
  StoryIdsDto,
} from '../dto/story-bulk.dto';
import { AdminService } from '../admin.service';
import { CreateStoryDto } from '../dto/create-story.dto';
import { UpdateStoryDto } from '../dto/update-story.dto';
import { UpdateSegmentsDto } from '../dto/update-segments.dto';
import { AdminStoriesQueryDto, AdminStoryIdsQueryDto } from '../dto/admin-stories-query.dto';
import { LinkTranslationDto } from '../dto/link-translation.dto';
import {
  AssessAgeGroupDto,
  AssessLevelBatchDto,
  AssessLevelDto,
  StoryLlmTasksQueryDto,
  TranslateBatchDto,
  TranslateStoryDto,
  TranslationRequestsQueryDto,
} from '../dto/story-llm.dto';
import { TranslationRequestsService } from '@modules/translation-requests/translation-requests.service';
import { StoryLlmTasksService } from '@modules/story-llm/story-llm-tasks.service';
import { AdminJwtAuthGuard } from '@common/guards/admin-jwt-auth.guard';
import { AdminRolesGuard } from '@common/guards/admin-roles.guard';
import { AdminRoles } from '@common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '@common/decorators/current-admin.decorator';
import { PaginationDto } from '@common/dto/pagination.dto';
import { Public } from '@common/decorators/public.decorator';
import { AudioService } from '@modules/audio/audio.service';
import { AudioLibraryQueryDto } from '@modules/audio/dto/audio-library-query.dto';
import { CollectionsService } from '@modules/collections/collections.service';
import { CreateCollectionDto } from '@modules/collections/dto/create-collection.dto';
import { UpdateCollectionDto } from '@modules/collections/dto/update-collection.dto';
import {
  AddStoriesDto,
  ReorderStoriesDto,
} from '@modules/collections/dto/collection-stories.dto';
import { LegalDocumentsService } from '@modules/legal-documents/legal-documents.service';
import { AdminCollectionsQueryDto } from '../dto/admin-collections-query.dto';
import { ModerationQueryDto } from '../dto/moderation-query.dto';
import { RejectVoiceProfileDto } from '../dto/reject-voice-profile.dto';
import { CreateLegalDocumentDto } from '@modules/legal-documents/dto/create-legal-document.dto';
import { UpdateLegalDocumentDto } from '@modules/legal-documents/dto/update-legal-document.dto';
import {
  AdminLegalListQueryDto,
  LegalLanguageQueryDto,
} from '@modules/legal-documents/dto/legal-language-query.dto';

@ApiTags('Admin - Content')
@ApiBearerAuth()
@Controller('admin')
@Public() // Bypass global User JWT guard
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
@AdminRoles('SUPER_ADMIN', 'ADMIN', 'MODERATOR')
export class AdminContentController {
  constructor(
    private readonly adminStoriesService: AdminStoriesService,
    private readonly audioService: AudioService,
    private readonly adminService: AdminService,
    private readonly collectionsService: CollectionsService,
    private readonly legalDocumentsService: LegalDocumentsService,
    private readonly storyLlmTasksService: StoryLlmTasksService,
    private readonly translationRequestsService: TranslationRequestsService,
    private readonly storyImportService: AdminStoryImportService,
    private readonly storySegmentsService: AdminStorySegmentsService,
    private readonly storyReviewService: AdminStoryReviewService,
  ) {}

  // ===== Stories =====

  @Get('stories')
  @ApiOperation({
    summary:
      'List stories (Admin). Filters: language, status, languageLevel, category, ageGroup, origin, q, missingLanguage, imported, importBatch, reviewed, createdFrom, createdTo, sort.',
  })
  @ApiResponse({ status: 200, description: 'Stories retrieved' })
  async getAllStories(@Query() query: AdminStoriesQueryDto) {
    return this.adminStoriesService.getAllStories(query);
  }

  // Declared before stories/:id so "meta" is not read as a story id.
  @Get('stories/meta')
  @ApiOperation({
    summary: 'Content languages (all and enabled) and every story enum with Turkish labels',
  })
  @ApiResponse({ status: 200, description: 'Meta retrieved' })
  getStoriesMeta() {
    return this.adminStoriesService.getStoriesMeta();
  }

  // Declared before stories/:id so "llm-tasks" is not read as a story id.
  @Get('stories/llm-tasks')
  @ApiOperation({
    summary:
      'Background LLM tasks (translation, level assessment), newest first. Filters: storyId, status, type.',
  })
  @ApiResponse({ status: 200, description: 'PaginatedResponse of tasks' })
  async listStoryLlmTasks(@Query() query: StoryLlmTasksQueryDto) {
    return this.storyLlmTasksService.listTasks(query);
  }

  // Declared before stories/:id so "translation-requests" is not read as a story id.
  @Get('stories/translation-requests')
  @ApiOperation({
    summary:
      'Translation requests of users, aggregated by tale (translation group) and language, most requested first.',
  })
  @ApiResponse({
    status: 200,
    description:
      'PaginatedResponse of { groupKey, language, languageName, requestCount, latestRequestedAt, story, groupLanguages, existingVersion }',
  })
  async listTranslationRequests(@Query() query: TranslationRequestsQueryDto) {
    return this.translationRequestsService.listForAdmin(query);
  }

  // Declared before stories/:id routes. Creates DRAFT stories only: no LLM
  // and no TTS call. See docs/story-pipeline.md for the file format.
  @Post('stories/import')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bulk import stories as DRAFT (idempotent on language + source URL + title). dryRun validates only. Optional pre-made segments become segmentation version 1.',
  })
  @ApiResponse({
    status: 200,
    description: '{ dryRun, total, created, skipped, errors, items: [{ index, title, language, status: created | skipped | error | valid, storyId?, slug?, message?, problems? }] }',
  })
  async importStories(
    @Body() dto: ImportStoriesDto,
    @CurrentAdmin() admin?: { id?: string; email?: string },
  ) {
    return this.storyImportService.importStories(dto, admin?.email ?? admin?.id ?? null);
  }

  // ===== Review before publishing, bulk actions, covers =====
  // Declared before stories/:id so the fixed paths are not read as story ids.

  @Get('stories/review')
  @ApiOperation({
    summary:
      'Review cards of imported drafts (same filters as GET /admin/stories; defaults: imported=true, status=DRAFT, import order). Each card: text, pair, parts, labels, licence and attribution, AI translation mark, segment count and emotions, publish check, cover.',
  })
  @ApiResponse({ status: 200, description: 'PaginatedResponse of review cards (at most 200 per page)' })
  async getReviewList(@Query() query: AdminStoriesQueryDto) {
    return this.storyReviewService.reviewList(query);
  }

  @Get('stories/ids')
  @ApiOperation({
    summary:
      'Every story matching the list filters (view=review: the review list defaults), at most 1000, without texts: for "select every matching story" in the panel.',
  })
  @ApiResponse({
    status: 200,
    description: '{ total, limit, truncated, items: [{ id, title, language, status, reviewed, publishable }] }',
  })
  async listStoryIds(@Query() query: AdminStoryIdsQueryDto) {
    return this.storyReviewService.listIds(query);
  }

  @Get('stories/import-batches')
  @ApiOperation({ summary: 'Import labels (Story.importBatch) with total, draft, reviewed and published counts, newest first' })
  @ApiResponse({ status: 200, description: '{ batches: [{ batch, total, drafts, reviewed, published, firstImportedAt, lastImportedAt }] }' })
  async listImportBatches() {
    return this.storyReviewService.listImportBatches();
  }

  @Post('stories/bulk/publish')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Publish several stories. Each is checked against the publish rule (CC BY needs attribution and licence name); with requireReviewed only stories marked "İncelendi". Refused ones are reported, the rest published.',
  })
  @ApiResponse({ status: 200, description: '{ published: [{ id, title, language }], skipped: [{ storyId, title, reason, missing? }] }' })
  async bulkPublish(@Body() dto: BulkPublishDto, @CurrentAdmin() admin?: { id?: string; email?: string }) {
    return this.storyReviewService.bulkPublish(
      dto.storyIds,
      { requireReviewed: dto.requireReviewed },
      admin?.email ?? admin?.id ?? null,
    );
  }

  @Patch('stories/bulk/review')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Mark up to 1000 stories "İncelendi" (records who) or take the mark away. A story already in that state is left as it is.',
  })
  @ApiResponse({ status: 200, description: '{ reviewed, requested, changed, unchanged, missing }' })
  async bulkReview(@Body() dto: BulkReviewDto, @CurrentAdmin() admin?: { id?: string; email?: string }) {
    return this.storyReviewService.bulkSetReviewed(dto.storyIds, dto.reviewed, admin?.email ?? admin?.id ?? null);
  }

  @Post('stories/bulk/archive')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive several stories (they leave every list; old favourites and narrations still open them)' })
  @ApiResponse({ status: 200, description: '{ archived: [{ id, title, language }], skipped: [...] }' })
  async bulkArchive(@Body() dto: StoryIdsDto, @CurrentAdmin() admin?: { id?: string; email?: string }) {
    return this.storyReviewService.bulkArchive(dto.storyIds, admin?.email ?? admin?.id ?? null);
  }

  @Post('stories/bulk/delete-preview')
  @AdminRoles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'What deleting these stories removes (stories, narrations, shared audios, favourites, cover files). Writes nothing.' })
  @ApiResponse({ status: 200, description: '{ stories, missing, published, narrations, sharedAudios, favorites, playlistItems, collectionLinks, coverFiles, titles }' })
  async bulkDeletePreview(@Body() dto: StoryIdsDto) {
    return this.storyReviewService.deletePreview(dto.storyIds);
  }

  @Post('stories/bulk/delete')
  @AdminRoles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete several stories through the single story delete (covers, shared audio, narrations cleaned the same way). Needs expectedCount from the preview and confirm "SİL".',
  })
  @ApiResponse({ status: 200, description: '{ deleted, deletedIds, failed, narrations }' })
  @ApiResponse({ status: 409, description: 'BULK_DELETE_COUNT_MISMATCH: the selection changed since the preview' })
  async bulkDelete(@Body() dto: BulkDeleteDto, @CurrentAdmin() admin?: { id?: string; email?: string }) {
    return this.storyReviewService.bulkDelete(dto.storyIds, dto.expectedCount, admin?.email ?? admin?.id ?? null);
  }

  @Post('stories/covers/match')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Match image file names (<slug>.<ext>, without the extension) to tales by pairKey, partOf or slug, for the bulk cover upload preview. Writes nothing.',
  })
  @ApiResponse({ status: 200, description: '{ results: [{ key, status: matched | ambiguous | none, via, tale, candidates }] }' })
  async matchCovers(@Body() dto: CoverMatchDto) {
    return this.storyReviewService.matchCovers(dto.keys);
  }

  @Patch('stories/:id/review')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a story "İncelendi" (reviewed) or take the mark away' })
  @ApiResponse({ status: 200, description: '{ id, reviewed, reviewedAt, reviewedBy }' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async setStoryReviewed(
    @Param('id') storyId: string,
    @Body() dto: ReviewStoryDto,
    @CurrentAdmin() admin?: { id?: string; email?: string },
  ) {
    return this.storyReviewService.setReviewed(storyId, dto.reviewed, admin?.email ?? admin?.id ?? null);
  }

  @Post('stories/:id/cover')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @UseInterceptors(FileInterceptor('coverImage', { limits: { fileSize: COVER_MAX_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Upload a cover (JPEG, PNG, WebP, at most 10 MB) with its optional credit. applyCoverToTale (default true) writes it to every language and part of the tale.',
  })
  @ApiResponse({ status: 200, description: '{ storyId, coverImageUrl, coverCredit, storyIds, appliedTo }' })
  @ApiResponse({ status: 400, description: 'COVER_FILE_REQUIRED, COVER_FILE_TYPE, COVER_FILE_TOO_LARGE, COVER_CREDIT_INVALID' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async setStoryCover(
    @Param('id') storyId: string,
    @UploadedFile() coverImage: Express.Multer.File,
    @Body() dto: SetCoverDto,
  ) {
    return this.adminStoriesService.setCover(storyId, coverImage, {
      coverCredit: dto?.coverCredit,
      applyCoverToTale: dto?.applyCoverToTale,
    });
  }

  @Get('stories/:id')
  @ApiOperation({ summary: 'Get story by ID with chunks (Admin)' })
  @ApiResponse({ status: 200, description: 'Story retrieved' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async getStoryById(@Param('id') storyId: string) {
    return this.adminStoriesService.getStoryById(storyId);
  }

  @Post('stories')
  @UseInterceptors(FileInterceptor('coverImage'))
  @ApiConsumes('multipart/form-data')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create new story (Admin)' })
  @ApiResponse({ status: 201, description: 'Story created' })
  async createStory(
    @Body() createStoryDto: CreateStoryDto,
    @UploadedFile() coverImage: Express.Multer.File,
    @CurrentAdmin() admin?: { id?: string; email?: string },
  ) {
    return this.adminStoriesService.createStory(
      createStoryDto,
      coverImage,
      admin?.email ?? admin?.id ?? null,
    );
  }

  @Patch('stories/:id')
  @UseInterceptors(FileInterceptor('coverImage'))
  @ApiConsumes('multipart/form-data')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update story (Admin)' })
  @ApiResponse({ status: 200, description: 'Story updated' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async updateStory(
    @Param('id') storyId: string,
    @Body() updateStoryDto: UpdateStoryDto,
    @UploadedFile() coverImage: Express.Multer.File,
    @CurrentAdmin() admin?: { id?: string; email?: string },
  ) {
    return this.adminStoriesService.updateStory(
      storyId,
      updateStoryDto,
      coverImage,
      admin?.email ?? admin?.id ?? null,
    );
  }

  // ===== Translation groups =====

  @Post('stories/:id/link-translation')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Link two stories as translations of the same tale (one story per language in a group)',
  })
  @ApiResponse({ status: 200, description: 'Stories linked; returns the story' })
  @ApiResponse({ status: 400, description: 'Same story, same language, or the group already has that language' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async linkStoryTranslation(
    @Param('id') storyId: string,
    @Body() dto: LinkTranslationDto,
  ) {
    return this.adminStoriesService.linkTranslation(storyId, dto.otherStoryId);
  }

  @Delete('stories/:id/translation-link')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a story out of its translation group' })
  @ApiResponse({ status: 200, description: 'Story unlinked; returns the story' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async unlinkStoryTranslation(@Param('id') storyId: string) {
    return this.adminStoriesService.unlinkTranslation(storyId);
  }

  // ===== Machine translation and language level (background LLM tasks) =====

  @Post('stories/translate-batch')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Queue a machine translation for several stories. Reports which were queued and which were skipped (with the reason).',
  })
  @ApiResponse({ status: 202, description: '{ targetLanguage, queued, skipped }' })
  @ApiResponse({ status: 503, description: 'Gemini is not configured' })
  async translateStoriesBatch(
    @Body() dto: TranslateBatchDto,
    @CurrentAdmin() admin?: { id?: string },
  ) {
    return this.storyLlmTasksService.requestTranslationBatch(
      dto.storyIds,
      dto.targetLanguage,
      admin?.id ?? null,
    );
  }

  @Post('stories/level/assess-batch')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Queue a CEFR level assessment for several stories (by id, by language, or only those without a level).',
  })
  @ApiResponse({ status: 202, description: '{ matched, queued, skipped }' })
  @ApiResponse({ status: 503, description: 'Gemini is not configured' })
  async assessStoryLevelsBatch(
    @Body() dto: AssessLevelBatchDto,
    @CurrentAdmin() admin?: { id?: string },
  ) {
    return this.storyLlmTasksService.requestLevelAssessmentBatch(
      {
        storyIds: dto?.storyIds,
        language: dto?.language,
        onlyMissing: dto?.onlyMissing,
      },
      admin?.id ?? null,
    );
  }

  @Post('stories/:id/translate')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Queue a machine translation of the story. The result is a new DRAFT story in the target language.',
  })
  @ApiResponse({ status: 202, description: 'Task queued; returns the task' })
  @ApiResponse({ status: 400, description: 'Target language equals the source language, or the story is empty' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  @ApiResponse({
    status: 409,
    description: 'A sibling in that language exists (TRANSLATION_EXISTS) or a task is already active',
  })
  async translateStory(
    @Param('id') storyId: string,
    @Body() dto: TranslateStoryDto,
    @CurrentAdmin() admin?: { id?: string },
  ) {
    return this.storyLlmTasksService.requestTranslation(storyId, dto.targetLanguage, {
      replaceDraft: dto.replaceDraft,
      adminId: admin?.id ?? null,
    });
  }

  @Post('stories/:id/level/assess')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Queue a CEFR level assessment of the story. A level set by hand is kept unless force is sent.',
  })
  @ApiResponse({ status: 202, description: 'Task queued; returns the task' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  @ApiResponse({ status: 409, description: 'Level is MANUAL (LEVEL_IS_MANUAL) or a task is already active' })
  async assessStoryLevel(
    @Param('id') storyId: string,
    @Body() dto: AssessLevelDto,
    @CurrentAdmin() admin?: { id?: string },
  ) {
    return this.storyLlmTasksService.requestLevelAssessment(storyId, {
      force: dto?.force,
      adminId: admin?.id ?? null,
    });
  }

  @Post('stories/:id/age-group/assess')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Queue an age group assessment of the story. An age group chosen by hand is kept unless force is sent.',
  })
  @ApiResponse({ status: 202, description: 'Task queued; returns the task' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  @ApiResponse({
    status: 409,
    description: 'Age group is MANUAL (AGE_GROUP_IS_MANUAL) or a task is already active',
  })
  async assessStoryAgeGroup(
    @Param('id') storyId: string,
    @Body() dto: AssessAgeGroupDto,
    @CurrentAdmin() admin?: { id?: string },
  ) {
    return this.storyLlmTasksService.requestAgeGroupAssessment(storyId, {
      force: dto?.force,
      adminId: admin?.id ?? null,
    });
  }

  @Delete('stories/:id')
  @AdminRoles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete story (Admin)' })
  @ApiResponse({ status: 200, description: 'Story deleted' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async deleteStory(@Param('id') storyId: string) {
    return this.adminStoriesService.deleteStory(storyId);
  }

  // ===== Story Segment Editor (Cartesia Phase 2A) =====

  @Get('stories/:id/segment-preview')
  @ApiOperation({
    summary:
      'Preview how the story content would be split into TTS segments (does not persist).',
  })
  @ApiResponse({ status: 200, description: 'Preview returned' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async previewStorySegments(@Param('id') storyId: string) {
    return this.adminStoriesService.previewSegments(storyId);
  }

  @Get('stories/:id/segments')
  @ApiOperation({
    summary:
      'Stored segments with tags, version, source, the tag vocabulary and the narration cache summary.',
  })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async getStorySegments(@Param('id') storyId: string) {
    return this.storySegmentsService.getSegments(storyId);
  }

  @Patch('stories/:id/segments')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Replace the segments (manual edit). Bumps segmentationVersion and clears the narration cache of the story.',
  })
  @ApiResponse({ status: 200, description: 'Segments persisted; cacheCleared tells what was removed' })
  @ApiResponse({ status: 400, description: 'SEGMENTS_INVALID with problems' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  @ApiResponse({ status: 409, description: 'SEGMENTS_VERSION_CONFLICT' })
  async updateStorySegments(
    @Param('id') storyId: string,
    @Body() dto: UpdateSegmentsDto,
  ) {
    return this.storySegmentsService.saveSegments(storyId, dto.segments, dto.expectedVersion);
  }

  @Get('stories/:id/narration-cache')
  @ApiOperation({
    summary: 'How many narrations, audio rows and stored files the story has (every user).',
  })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async getNarrationCache(@Param('id') storyId: string) {
    return this.storySegmentsService.cacheSummary(storyId);
  }

  @Delete('stories/:id/narration-cache')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Delete the stored audio of every narration of the story (files and rows). Narrations turn FAILED with a free regeneration.',
  })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async clearNarrationCache(
    @Param('id') storyId: string,
    @CurrentAdmin() admin?: { id?: string; email?: string },
  ) {
    return this.storySegmentsService.clearCache(storyId, admin?.email ?? admin?.id ?? null);
  }

  @Delete('stories/:id/segments')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear the stored segments. The next narration request segments the story again (Gemini, fallback: deterministic split).',
  })
  @ApiResponse({ status: 200, description: 'preprocessedSegments cleared' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  async clearStorySegments(@Param('id') storyId: string) {
    return this.adminStoriesService.clearPreprocessedSegments(storyId);
  }

  @Post('stories/:id/segments/llm-fill')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Run Gemini preprocessing on the story content. Returns proposed segments + warnings; does NOT persist (admin reviews and PATCHes via /segments).',
  })
  @ApiResponse({ status: 200, description: 'Preprocessing succeeded' })
  @ApiResponse({ status: 404, description: 'Story not found' })
  @ApiResponse({
    status: 502,
    description: 'LLM produced unusable output (content drift, parse error, etc.)',
  })
  @ApiResponse({
    status: 503,
    description: 'Gemini API unavailable / rate-limited',
  })
  async llmFillStorySegments(@Param('id') storyId: string) {
    return this.adminStoriesService.llmFillSegments(storyId);
  }

  // ===== Audio =====

  @Get('audio')
  @ApiOperation({ summary: 'List all audio files (paginated)' })
  @ApiResponse({ status: 200, description: 'Audio files list' })
  async listAllAudio(@Query() queryDto: AudioLibraryQueryDto) {
    return this.audioService.adminListAudio(queryDto);
  }

  @Get('audio/:id')
  @ApiOperation({ summary: 'Get audio details by ID' })
  @ApiParam({ name: 'id', description: 'Audio ID' })
  @ApiResponse({ status: 200, description: 'Audio details' })
  @ApiResponse({ status: 404, description: 'Audio not found' })
  async getAudio(@Param('id') id: string) {
    return this.audioService.getAudioById(id);
  }

  @Delete('audio/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete any audio (admin)' })
  @ApiParam({ name: 'id', description: 'Audio ID' })
  @ApiResponse({ status: 200, description: 'Audio deleted' })
  @ApiResponse({ status: 404, description: 'Audio not found' })
  async deleteAudio(@Param('id') id: string) {
    return this.audioService.adminDeleteAudio(id);
  }

  // ===== Moderation =====
  // There is intentionally no "approve": cloned voices become READY only
  // when the training pipeline gets a real provider voice id. Approving a
  // profile whose voiceId is still the `pending-<ts>` placeholder produced
  // an unusable READY voice.

  @Get('moderation/voice-profiles')
  @ApiOperation({
    summary: 'List voice profiles for moderation (optionally by status), newest activity first',
  })
  @ApiResponse({ status: 200, description: 'PaginatedResponse of voice profiles' })
  async listVoiceProfilesForModeration(@Query() query: ModerationQueryDto) {
    return this.adminService.listVoiceProfilesForModeration(
      query.page || 1,
      query.limit || 20,
      query.status,
    );
  }

  @Post('moderation/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a voice (marks FAILED + notifies the user)' })
  @ApiResponse({ status: 200, description: 'Voice profile marked FAILED' })
  @ApiResponse({ status: 404, description: 'Voice profile not found' })
  async rejectVoiceProfile(
    @Param('id') id: string,
    @Body() dto: RejectVoiceProfileDto,
  ) {
    return this.adminService.rejectVoiceProfile(id, dto?.reason);
  }

  // ===== Collections =====

  @Get('collections')
  @ApiOperation({
    summary: 'List ALL collections (including inactive), paginated, optional search',
  })
  @ApiResponse({ status: 200, description: 'PaginatedResponse<Collection>' })
  async listCollections(@Query() query: AdminCollectionsQueryDto) {
    return this.collectionsService.listAdmin(
      query.page || 1,
      query.limit || 20,
      query.search,
      query.language,
    );
  }

  @Get('collections/:id/stories')
  @ApiOperation({
    summary: 'List the stories in a collection (works for inactive collections)',
  })
  @ApiResponse({ status: 200, description: 'PaginatedResponse of collection stories' })
  @ApiResponse({ status: 404, description: 'Collection not found' })
  async listCollectionStories(
    @Param('id') id: string,
    @Query() query: PaginationDto,
  ) {
    return this.collectionsService.getStoriesAdmin(
      id,
      query.page || 1,
      query.limit || 20,
    );
  }

  @Post('collections')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Create a curated collection' })
  @ApiResponse({ status: 201, description: 'Collection created' })
  @ApiResponse({ status: 409, description: 'Slug already in use' })
  async createCollection(@Body() dto: CreateCollectionDto) {
    return this.collectionsService.create(dto);
  }

  @Patch('collections/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Update a collection' })
  @ApiResponse({ status: 200, description: 'Collection updated' })
  @ApiResponse({ status: 404, description: 'Collection not found' })
  async updateCollection(
    @Param('id') id: string,
    @Body() dto: UpdateCollectionDto,
  ) {
    return this.collectionsService.update(id, dto);
  }

  @Delete('collections/:id')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a collection (cascades junction rows)' })
  @ApiResponse({ status: 200, description: 'Collection deleted' })
  @ApiResponse({ status: 404, description: 'Collection not found' })
  async deleteCollection(@Param('id') id: string) {
    return this.collectionsService.remove(id);
  }

  @Post('collections/:id/stories')
  @ApiOperation({ summary: 'Attach one or more stories to a collection' })
  @ApiResponse({ status: 201, description: 'Stories attached' })
  @ApiResponse({ status: 404, description: 'Collection or story not found' })
  async addStoriesToCollection(
    @Param('id') id: string,
    @Body() dto: AddStoriesDto,
  ) {
    return this.collectionsService.addStories(id, dto);
  }

  @Delete('collections/:id/stories/:storyId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Detach a story from a collection' })
  @ApiResponse({ status: 200, description: 'Story detached' })
  @ApiResponse({ status: 404, description: 'Relation not found' })
  async removeStoryFromCollection(
    @Param('id') id: string,
    @Param('storyId') storyId: string,
  ) {
    return this.collectionsService.removeStory(id, storyId);
  }

  @Patch('collections/:id/reorder')
  @ApiOperation({ summary: 'Reorder stories inside a collection' })
  @ApiResponse({ status: 200, description: 'New order applied' })
  @ApiResponse({
    status: 404,
    description: 'Collection or a referenced story not in it',
  })
  async reorderCollectionStories(
    @Param('id') id: string,
    @Body() dto: ReorderStoriesDto,
  ) {
    return this.collectionsService.reorder(id, dto);
  }

  // ===== Legal Documents =====
  // A document is identified by (slug, language). Every route below takes an
  // optional ?language=tr|en; absent means tr, so the calls the panel made
  // before languages existed address the Turkish documents unchanged.

  @Get('legal')
  @ApiOperation({
    summary:
      'List legal documents (drafts + published) for admin. ?language=tr|en|all (absent: tr; all: every language, slug asc, Turkish first)',
  })
  @ApiResponse({ status: 200, description: 'Legal documents retrieved' })
  @ApiResponse({ status: 400, description: 'language is not tr, en or all' })
  async listLegalDocuments(@Query() query: AdminLegalListQueryDto) {
    return this.legalDocumentsService.listAdmin(query.language);
  }

  @Get('legal/:slug')
  @ApiOperation({
    summary:
      'Get a legal document by slug and ?language=tr|en (admin view, includes draft; absent language: tr)',
  })
  @ApiParam({ name: 'slug', example: 'tos' })
  @ApiResponse({ status: 200, description: 'Legal document retrieved' })
  @ApiResponse({ status: 404, description: 'No document for this slug in this language' })
  async getLegalDocument(
    @Param('slug') slug: string,
    @Query() query: LegalLanguageQueryDto,
  ) {
    return this.legalDocumentsService.getAdminBySlug(slug, query.language);
  }

  @Get('legal/:slug/versions')
  @ApiOperation({
    summary:
      'List recent published versions of one (slug, ?language=tr|en) document, newest first (absent language: tr)',
  })
  @ApiParam({ name: 'slug', example: 'tos' })
  @ApiResponse({ status: 200, description: 'Versions retrieved (newest first)' })
  @ApiResponse({ status: 404, description: 'No document for this slug in this language' })
  async listLegalDocumentVersions(
    @Param('slug') slug: string,
    @Query() query: LegalLanguageQueryDto,
  ) {
    return this.legalDocumentsService.listVersions(slug, query.language);
  }

  @Post('legal')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary:
      'Create a new legal document as a DRAFT (unpublished until /publish). Body language tr|en, absent: tr.',
  })
  @ApiResponse({ status: 201, description: 'Legal document created' })
  @ApiResponse({ status: 409, description: 'Slug already in use for this language' })
  async createLegalDocument(@Body() dto: CreateLegalDocumentDto) {
    return this.legalDocumentsService.create(dto);
  }

  @Patch('legal/:slug')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @ApiOperation({
    summary:
      'Update the draft copy of the (slug, ?language=tr|en) document. Does not publish: the public surface keeps serving the last published version until /publish is called. language is not accepted in the body (immutable).',
  })
  @ApiParam({ name: 'slug', example: 'tos' })
  @ApiResponse({ status: 200, description: 'Draft updated' })
  @ApiResponse({ status: 404, description: 'No document for this slug in this language' })
  async updateLegalDocument(
    @Param('slug') slug: string,
    @Body() dto: UpdateLegalDocumentDto,
    @Query() query: LegalLanguageQueryDto,
  ) {
    return this.legalDocumentsService.update(slug, dto, query.language);
  }

  @Post('legal/:slug/publish')
  @AdminRoles('SUPER_ADMIN', 'ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Publish the current draft of the (slug, ?language=tr|en) document as a new immutable version. Bumps currentVersion and flips status to PUBLISHED. Other languages are not touched.',
  })
  @ApiParam({ name: 'slug', example: 'tos' })
  @ApiResponse({ status: 200, description: 'New version published' })
  @ApiResponse({ status: 404, description: 'No document for this slug in this language' })
  async publishLegalDocument(
    @Param('slug') slug: string,
    @CurrentAdmin() admin: { id?: string; email?: string } | undefined,
    @Query() query: LegalLanguageQueryDto,
  ) {
    const publishedBy = admin?.email ?? admin?.id ?? null;
    return this.legalDocumentsService.publish(slug, publishedBy, query.language);
  }
}
