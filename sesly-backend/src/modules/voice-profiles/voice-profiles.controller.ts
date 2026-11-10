import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseInterceptors,
  HttpCode,
  HttpStatus,
  Query,
  UploadedFiles,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { VoiceProfilesService } from './voice-profiles.service';
import { CreateVoiceProfileDto } from './dto/create-voice-profile.dto';
import { CreateVoiceProfileV2Dto } from './dto/create-voice-profile-v2.dto';
import { PreviewVoiceDto } from './dto/preview-voice.dto';
import { UploadSamplesDto } from './dto/upload-samples.dto';
import { VoiceProfileResponseDto } from './dto/voice-profile-response.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { CLONE_UPLOAD_MAX_BYTES } from './clone-config.constants';
import { parseSpeechStartMs, validateCloneUploadFile } from './clone-upload.validation';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

@ApiTags('Voice Profiles')
@ApiBearerAuth()
@Controller('voice-profiles')
export class VoiceProfilesController {
  constructor(private voiceProfilesService: VoiceProfilesService) {}

  @Get('clone-config')
  @ApiOperation({
    summary: 'Voice clone recording script, timing and KVKK consent text, in the language the user will speak',
  })
  @ApiQuery({
    name: 'language',
    required: false,
    description:
      'Voice language the user will speak (tr, en; a locale such as en-US is accepted). Default tr. ' +
      'Script, script title, intro steps, tips, consent title, consent text and consentVersion are served in it.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Clone configuration (see CloneConfigResponse): language, locale, supportedLanguages ' +
      '[{ code, locale, nativeName, englishName }], minSeconds, targetSeconds, maxSeconds, scriptTitle, script, ' +
      'consentVersion, consentTitle, consentText, introSteps, recordingTips.',
  })
  @ApiResponse({ status: 400, description: 'VOICE_LANGUAGE_NOT_SUPPORTED (with supportedLanguages)' })
  getCloneConfig(@Query('language') language?: string | string[]) {
    return this.voiceProfilesService.getCloneConfig(language);
  }

  @Get('slots')
  @ApiOperation({ summary: 'Get voice profile slot information (preset vs clone)' })
  @ApiResponse({ status: 200, description: 'Voice slot information including plan limits and usage' })
  async getVoiceSlotInfo(@CurrentUser('id') userId: string) {
    return this.voiceProfilesService.getVoiceSlotInfo(userId);
  }

  @Get('available-voices')
  @ApiOperation({ summary: 'Ready-made narrator voices (Google Chirp 3 HD, static catalogue)' })
  @ApiResponse({
    status: 200,
    description:
      'Without provider: { google: Voice[], cartesia: [] }. With provider: { provider, voices }. ' +
      'Voice: id, name, language, languageCode, contentLanguage, gender, description, provider, isPremium (always false).',
  })
  @ApiQuery({ name: 'provider', required: false, description: 'Filter by provider (google or cartesia). Cartesia is clone-only and always empty.' })
  @ApiQuery({
    name: 'language',
    required: false,
    description:
      'Content language code (tr, en, de, fr, es, it, nl, pt, ar), or several separated by commas. ' +
      'Default: the default content language. A language without ready-made voices returns none.',
  })
  async getAvailableVoices(
    @Query('provider') provider?: string,
    @Query('language') language?: string | string[],
  ) {
    return this.voiceProfilesService.getAvailableVoices(provider, language);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: MINUTE_MS } })
  @ApiOperation({ summary: 'Preview a ready-made voice or one of your READY voices' })
  @ApiResponse({ status: 200, description: 'Voice preview audio URL' })
  @ApiResponse({ status: 403, description: 'PREVIEW_NOT_ALLOWED' })
  async previewVoice(@CurrentUser('id') userId: string, @Body() dto: PreviewVoiceDto) {
    return this.voiceProfilesService.previewVoice(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all voice profiles for current user (each with its contentLanguage)' })
  @ApiQuery({
    name: 'language',
    required: false,
    description:
      'Keep only the voices of this content language (tr, en, ...), or several separated by commas. ' +
      'Absent: every voice.',
  })
  @ApiResponse({ status: 200, type: [VoiceProfileResponseDto] })
  async getVoiceProfiles(
    @CurrentUser('id') userId: string,
    @Query('language') language?: string | string[],
  ) {
    return this.voiceProfilesService.getVoiceProfiles(userId, language);
  }

  @Post('v2')
  @Throttle({ default: { limit: 30, ttl: HOUR_MS } })
  @ApiOperation({ summary: 'Create a preset (GOOGLE) or start a clone (CARTESIA + custom-cloning-pending)' })
  @ApiResponse({ status: 201, description: 'Voice profile created' })
  @ApiResponse({ status: 400, description: 'VOICE_LANGUAGE_NOT_SUPPORTED | CLONE_ONLY_PROVIDER | VOICE_NOT_FOUND' })
  @ApiResponse({ status: 403, description: 'PRESET_SLOT_LIMIT | CLONE_SLOT_LIMIT | CLONE_MONTHLY_LIMIT' })
  async createVoiceProfileV2(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateVoiceProfileV2Dto,
  ) {
    return this.voiceProfilesService.createVoiceProfileV2(userId, dto);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: HOUR_MS } })
  @ApiOperation({ summary: 'Legacy: start a clone (same as v2 with provider CARTESIA)' })
  @ApiResponse({ status: 201, description: 'Clone placeholder created, upload the recording next' })
  @ApiResponse({ status: 403, description: 'CLONE_SLOT_LIMIT | CLONE_MONTHLY_LIMIT' })
  async createVoiceProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateVoiceProfileDto,
  ) {
    return this.voiceProfilesService.createVoiceProfile(userId, dto);
  }

  @Post(':id/upload-samples')
  @Throttle({ default: { limit: 5, ttl: HOUR_MS } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'consentAudio', maxCount: 1 },
        { name: 'referenceAudio', maxCount: 1 },
      ],
      // Hard memory cap slightly above the validated 20 MB so oversize files
      // still get the Turkish AUDIO_TOO_LARGE error from the validator.
      { limits: { fileSize: CLONE_UPLOAD_MAX_BYTES + 1024 * 1024, files: 2, fields: 10 } },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload the clone recording (+ consent version) and start cloning' })
  @ApiResponse({ status: 201, description: 'Recording accepted, voice training started' })
  @ApiResponse({ status: 400, description: 'AUDIO_REQUIRED | INVALID_AUDIO_TYPE | CONSENT_REQUIRED | NOT_A_CLONE_PROFILE' })
  @ApiResponse({ status: 403, description: 'CLONE_SLOT_LIMIT | CLONE_MONTHLY_LIMIT' })
  @ApiResponse({ status: 409, description: 'VOICE_ALREADY_UPLOADED' })
  @ApiResponse({ status: 413, description: 'AUDIO_TOO_LARGE' })
  async uploadVoiceSamples(
    @CurrentUser('id') userId: string,
    @Param('id') profileId: string,
    @UploadedFiles() files: { consentAudio?: Express.Multer.File[]; referenceAudio?: Express.Multer.File[] } | undefined,
    @Body() body: UploadSamplesDto,
  ) {
    const referenceAudio = files?.referenceAudio?.[0];
    const consentAudio = files?.consentAudio?.[0];

    validateCloneUploadFile(referenceAudio);
    if (consentAudio) {
      validateCloneUploadFile(consentAudio);
    }

    return this.voiceProfilesService.uploadVoiceSamples(userId, profileId, {
      referenceAudio: referenceAudio as Express.Multer.File,
      consentAudio,
      consentVersion: body?.consentVersion ?? null,
      speechStartMs: parseSpeechStartMs(body?.speechStartMs),
    });
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get voice profile status' })
  @ApiResponse({ status: 200, description: 'Voice profile status and details' })
  async getStatus(
    @CurrentUser('id') userId: string,
    @Param('id') profileId: string,
  ) {
    return this.voiceProfilesService.getVoiceProfileStatus(userId, profileId);
  }

  @Get(':id/sample')
  @ApiOperation({ summary: 'Get voice profile sample audio URL' })
  @ApiResponse({ status: 200, description: 'Voice sample audio URL for preview/playback' })
  @ApiResponse({ status: 404, description: 'Voice profile not found' })
  async getSample(
    @CurrentUser('id') userId: string,
    @Param('id') profileId: string,
  ) {
    return this.voiceProfilesService.getVoiceProfileSample(userId, profileId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete voice profile (raw recording, model and upstream clone)' })
  @ApiResponse({ status: 200, description: 'Voice profile deleted successfully' })
  async deleteProfile(
    @CurrentUser('id') userId: string,
    @Param('id') profileId: string,
  ) {
    return this.voiceProfilesService.deleteVoiceProfile(userId, profileId);
  }
}
