import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminAnalyticsService } from '../services/admin-analytics.service';
import { AdminService } from '../admin.service';
import { AdminStorageService } from '../services/admin-storage.service';
import { VoiceCloneTesterService } from '../services/voice-clone-tester.service';
import { AdminJwtAuthGuard } from '../../../common/guards/admin-jwt-auth.guard';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { ActivityQueryDto } from '../dto/activity-query.dto';
import { PopularStoriesQueryDto } from '../dto/popular-stories-query.dto';
import { BroadcastDto } from '../dto/broadcast.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { SettingsService } from '../../settings/settings.service';
import { GeminiModelsService } from '../../llm-preprocessing/gemini-models.service';
import { UpdateSettingsDto } from '../dto/update-settings.dto';
import { EmailTemplatesService } from '../../email/email-templates.service';
import { EmailService } from '../../email/email.service';
import {
  EmailTemplateDraftDto,
  SaveEmailTemplateDto,
  SendTestEmailDto,
} from '../dto/email-template.dto';

@ApiTags('Admin - Ops')
@ApiBearerAuth()
@Controller('admin')
@Public() // Bypass global User JWT guard
@UseGuards(AdminJwtAuthGuard, AdminRolesGuard)
@AdminRoles('SUPER_ADMIN', 'ADMIN')
export class AdminOpsController {
  constructor(
    private readonly adminAnalyticsService: AdminAnalyticsService,
    private readonly adminService: AdminService,
    private readonly adminStorageService: AdminStorageService,
    private readonly voiceCloneTesterService: VoiceCloneTesterService,
    private readonly settingsService: SettingsService,
    private readonly geminiModelsService: GeminiModelsService,
    private readonly emailTemplatesService: EmailTemplatesService,
    private readonly emailService: EmailService,
  ) {}

  // ===== Analytics =====

  @Get('analytics/system')
  @ApiOperation({ summary: 'Get comprehensive system statistics (Admin)' })
  @ApiResponse({ status: 200, description: 'System stats retrieved' })
  async getSystemStats() {
    return this.adminAnalyticsService.getSystemStats();
  }

  @Get('analytics/activity')
  @ApiOperation({ summary: 'Get recent platform activity (Admin)' })
  @ApiResponse({ status: 200, description: 'Recent activity retrieved' })
  async getRecentActivity(@Query() queryDto: ActivityQueryDto) {
    return this.adminAnalyticsService.getRecentActivity(queryDto);
  }

  @Get('analytics/popular-stories')
  @ApiOperation({ summary: 'Get most popular stories (Admin)' })
  @ApiResponse({ status: 200, description: 'Popular stories retrieved' })
  async getPopularStories(@Query() queryDto: PopularStoriesQueryDto) {
    return this.adminAnalyticsService.getPopularStories(queryDto);
  }

  @Get('analytics/usage')
  @ApiOperation({ summary: 'Get current month usage statistics (Admin)' })
  @ApiResponse({ status: 200, description: 'Usage stats retrieved' })
  async getUsageStats() {
    return this.adminAnalyticsService.getUsageStats();
  }

  // ===== Ops =====

  @Post('ops/voice-clone-test')
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Run a full voice-clone-then-narrate test (raw → preprocessed → clone → real story narration)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: {
          type: 'string',
          format: 'binary',
          description: 'Reference audio clip (m4a / wav / mp3 / etc.)',
        },
        storyId: {
          type: 'string',
          format: 'uuid',
          description:
            'ID of the existing Story to narrate with the freshly cloned voice. Goes through the same segment fan-out + per-segment emotion pipeline a real user would hit.',
        },
      },
      required: ['audio', 'storyId'],
    },
  })
  @ApiResponse({
    status: 201,
    description:
      'Test complete. Returns presigned URLs for raw, preprocessed and the merged story narration, plus per-segment metadata.',
  })
  async voiceCloneTest(
    @UploadedFile() file: Express.Multer.File,
    @Body('storyId') storyId: string,
    @Body('skipPreprocessing') skipPreprocessing?: string | boolean,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Field "audio" with the reference clip is required.',
      );
    }
    if (!storyId || typeof storyId !== 'string') {
      throw new BadRequestException(
        'Field "storyId" with an existing story id is required.',
      );
    }
    // Multipart bodies serialize booleans as strings — accept either form.
    const skip =
      skipPreprocessing === true || skipPreprocessing === 'true';
    return this.voiceCloneTesterService.runStoryTest(file, storyId, {
      skipPreprocessing: skip,
    });
  }

  @Post('ops/data/broadcast')
  @ApiOperation({ summary: 'Send Push Notification to segments' })
  async broadcast(@Body() dto: BroadcastDto) {
    return this.adminService.broadcast(dto);
  }

  @Post('ops/system/maintenance')
  @ApiOperation({ summary: 'Toggle maintenance mode' })
  async setMaintenanceMode(@Body('enabled') enabled: boolean) {
    return this.adminService.setMaintenanceMode(enabled);
  }

  @Get('ops/system/maintenance')
  @ApiOperation({ summary: 'Get maintenance mode status' })
  async getMaintenanceMode() {
    return this.adminService.getMaintenanceMode();
  }

  // ===== Storage =====

  @Get('storage/stats')
  @ApiOperation({
    summary: 'Aggregate GCS bucket stats grouped by type (audio, image, voiceSample, other)',
  })
  @ApiResponse({ status: 200, description: 'Storage stats retrieved' })
  async getStorageStats() {
    return this.adminStorageService.getStats();
  }

  @Get('storage/orphans')
  @ApiOperation({
    summary: 'List GCS objects not referenced from any DB row (paginated)',
  })
  @ApiResponse({ status: 200, description: 'Orphaned files retrieved' })
  async listStorageOrphans(@Query() paginationDto: PaginationDto) {
    return this.adminStorageService.listOrphans(
      paginationDto.page || 1,
      paginationDto.limit || 20,
    );
  }

  @Delete('storage/orphans/:key')
  @AdminRoles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a single orphaned GCS object (re-checks orphan status before deletion)',
  })
  @ApiParam({
    name: 'key',
    description: 'URL-encoded GCS object path',
  })
  @ApiResponse({ status: 200, description: 'Orphan deleted' })
  @ApiResponse({ status: 404, description: 'Object not found' })
  @ApiResponse({
    status: 409,
    description: 'Object is now referenced by a DB record; refusing to delete',
  })
  async deleteStorageOrphan(@Param('key') key: string) {
    // Express already URL-decodes route params (send the key with / as %2F).
    // Decoding again would corrupt keys that contain a literal "%".
    return this.adminStorageService.deleteOrphan(key);
  }

  // ===== Runtime settings =====
  // Reads are open to SUPER_ADMIN and ADMIN (class-level roles). Writes are
  // SUPER_ADMIN only: these values change production behaviour for everyone.

  @Get('settings')
  @ApiOperation({
    summary: 'Runtime settings registry grouped, with effective value, source and reset fallback',
  })
  @ApiResponse({ status: 200, description: 'Settings retrieved' })
  getSettings() {
    return this.settingsService.describe();
  }

  @Get('settings/options/gemini-models')
  @ApiOperation({
    summary:
      'Gemini model ids the configured key can use for text generation (live, cached 10 minutes). Always 200: on failure models is empty and reason says why.',
  })
  @ApiResponse({ status: 200, description: 'Model list or an empty list with a reason' })
  async getGeminiModelOptions() {
    return this.geminiModelsService.listTextModels();
  }

  @Patch('settings')
  @AdminRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Override runtime settings (validated against the registry, all or nothing)' })
  @ApiResponse({ status: 200, description: 'Settings saved; returns the same shape as GET /admin/settings' })
  @ApiResponse({ status: 400, description: 'Unknown key or value out of range (Turkish message naming the key)' })
  async updateSettings(@Body() dto: UpdateSettingsDto, @CurrentAdmin('id') adminId: string) {
    return this.settingsService.update(dto.values, adminId ?? null);
  }

  @Delete('settings/:key')
  @AdminRoles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove the panel override of one setting (falls back to env, then code default)' })
  @ApiParam({ name: 'key', description: 'Setting key, e.g. llm.gemini.model' })
  @ApiResponse({ status: 200, description: 'Override removed; returns the setting as it is now' })
  @ApiResponse({ status: 404, description: 'Unknown setting key' })
  async resetSetting(@Param('key') key: string, @CurrentAdmin('id') adminId: string) {
    return this.settingsService.reset(key, adminId ?? null);
  }

  // ===== Email templates =====
  // Texts of the service emails per kind (welcome, password_reset) and
  // language (tr, en). The layout is code; the panel edits text fields only.
  // Reads and previews: SUPER_ADMIN and ADMIN. Writes and test emails:
  // SUPER_ADMIN only, like the runtime settings.

  @Get('email-templates')
  @ApiOperation({
    summary: 'Email template editor data: kinds, languages, field rules, placeholders and every template (effective text and code default)',
  })
  @ApiResponse({ status: 200, description: 'Templates retrieved' })
  getEmailTemplates() {
    return this.emailTemplatesService.describe();
  }

  @Get('email-templates/:kind/:language')
  @ApiOperation({ summary: 'One template: effective text (panel or default), default text, source' })
  @ApiParam({ name: 'kind', enum: ['welcome', 'password_reset'] })
  @ApiParam({ name: 'language', enum: ['tr', 'en'] })
  @ApiResponse({ status: 400, description: 'Unknown kind or language' })
  getEmailTemplate(@Param('kind') kind: string, @Param('language') language: string) {
    return this.emailTemplatesService.getOne(kind, language);
  }

  @Put('email-templates/:kind/:language')
  @AdminRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Save the text of one template (whole text; a missing optional field is saved empty)' })
  @ApiParam({ name: 'kind', enum: ['welcome', 'password_reset'] })
  @ApiParam({ name: 'language', enum: ['tr', 'en'] })
  @ApiResponse({ status: 200, description: 'Saved; returns the template as GET does' })
  @ApiResponse({
    status: 400,
    description: 'code EMAIL_TEMPLATE_INVALID with problems[] (Turkish): required field, length, placeholder, text rules',
  })
  saveEmailTemplate(
    @Param('kind') kind: string,
    @Param('language') language: string,
    @Body() dto: SaveEmailTemplateDto,
    @CurrentAdmin('id') adminId: string,
  ) {
    return this.emailTemplatesService.save(kind, language, dto, adminId ?? null);
  }

  @Delete('email-templates/:kind/:language')
  @AdminRoles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset one template to the code default (removes the panel text)' })
  @ApiResponse({ status: 200, description: 'Reset; returns the template as GET does' })
  resetEmailTemplate(
    @Param('kind') kind: string,
    @Param('language') language: string,
    @CurrentAdmin('id') adminId: string,
  ) {
    return this.emailTemplatesService.reset(kind, language, adminId ?? null);
  }

  @Post('email-templates/:kind/:language/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Render a preview with sample values. Body fields (optional) replace the saved text, so unsaved edits can be previewed.',
  })
  @ApiResponse({ status: 200, description: '{ kind, language, subject, html, text, problems[] }' })
  previewEmailTemplate(
    @Param('kind') kind: string,
    @Param('language') language: string,
    @Body() dto: EmailTemplateDraftDto,
  ) {
    return this.emailTemplatesService.preview(kind, language, dto);
  }

  @Post('email-templates/:kind/:language/test')
  @AdminRoles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Send a test email (subject prefixed [Test], sample name and link) to the given address. Body fields other than to replace the saved text.',
  })
  @ApiResponse({ status: 200, description: '{ sent: true, to, subject }' })
  @ApiResponse({ status: 400, description: 'Invalid address or EMAIL_TEMPLATE_INVALID' })
  @ApiResponse({ status: 503, description: 'Resend not configured or rejected the email' })
  sendTestEmail(
    @Param('kind') kind: string,
    @Param('language') language: string,
    @Body() dto: SendTestEmailDto,
  ) {
    const { to, ...draft } = dto;
    return this.emailService.sendTemplateTest(kind, language, to, draft);
  }
}
