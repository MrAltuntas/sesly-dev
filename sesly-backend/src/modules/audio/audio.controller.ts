import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AudioService } from './audio.service';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { AudioLibraryQueryDto } from './dto/audio-library-query.dto';
import { GenerateAudioDto } from './dto/generate-audio.dto';
import { UsageService } from '../usage/usage.service';

@ApiTags('Audio')
@ApiBearerAuth()
@Controller('audio')
export class AudioController {
  constructor(
    private audioService: AudioService,
    private usageService: UsageService,
  ) { }

  /**
   * Free text to audio. Counts against the same narration allowance as a
   * story narration (ready-made or cloned voice), so it cannot be used to
   * get past the plan limits.
   */
  @Post('generate')
  @ApiOperation({ summary: 'Generate audio from text (counts as one narration)' })
  @ApiResponse({ status: 201, description: 'Audio generation started' })
  @ApiResponse({ status: 403, description: 'QUOTA_PRESET_MONTHLY / QUOTA_CLONE_LIFETIME / QUOTA_CLONE_MONTHLY' })
  async generateAudio(
    @CurrentUser('id') userId: string,
    @Body() dto: GenerateAudioDto,
  ) {
    const premiumVoice = await this.audioService.isPremiumVoiceOf(userId, dto.voiceProfileId);
    const plan = await this.usageService.getEffectivePlan(userId);
    const charge = await this.usageService.consumeNarration(userId, plan, premiumVoice);
    try {
      return await this.audioService.generateAudio({
        text: dto.text,
        voiceProfileId: dto.voiceProfileId,
        userId,
        title: dto.title,
      });
    } catch (error) {
      await this.usageService.refundNarration(charge).catch(() => undefined);
      throw error;
    }
  }

  @Get('library')
  @ApiOperation({ summary: 'Get user audio library' })
  @ApiResponse({ status: 200, description: 'Library retrieved' })
  async getLibrary(
    @CurrentUser('id') userId: string,
    @Query() queryDto: AudioLibraryQueryDto,
  ) {
    return this.audioService.getUserAudioLibrary(userId, queryDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get audio metadata (owner only)' })
  @ApiParam({ name: 'id', description: 'Audio ID' })
  @ApiResponse({ status: 200, description: 'Audio metadata' })
  @ApiResponse({ status: 403, description: 'Audio belongs to another user' })
  @ApiResponse({ status: 404, description: 'Audio not found' })
  async getAudio(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.audioService.getAudioByIdForUser(id, userId);
  }

  @Get(':id/stream')
  @ApiOperation({ summary: 'Get streaming URL for audio' })
  @ApiParam({ name: 'id', description: 'Audio ID' })
  @ApiResponse({ status: 302, description: 'Redirect to presigned URL' })
  @ApiResponse({ status: 202, description: 'Audio still generating' })
  @ApiResponse({ status: 404, description: 'Audio not found' })
  async streamAudio(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    try {
      const audio = await this.audioService.getAudioByIdForUser(id, userId);

      if (audio.status === 'READY' && audio.audioUrl) {
        // Redirect to presigned URL for streaming
        const presignedUrl = await this.audioService.getStreamUrl(id, userId);
        return res.redirect(302, presignedUrl);
      }

      if (audio.status === 'GENERATING') {
        return res.status(202).json({
          status: 'GENERATING',
          progress: audio.progress,
          message: 'Audio is still being generated',
        });
      }

      if (audio.status === 'FAILED') {
        return res.status(422).json({
          status: 'FAILED',
          message: 'Audio generation failed',
        });
      }

      return res.status(404).json({
        status: 'NOT_FOUND',
        message: 'Audio not found or not ready',
      });
    } catch (error: any) {
      return res.status(error.status || 500).json({
        message: error.message || 'Internal server error',
      });
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete audio' })
  @ApiParam({ name: 'id', description: 'Audio ID' })
  @ApiResponse({ status: 200, description: 'Audio deleted' })
  @ApiResponse({ status: 404, description: 'Audio not found' })
  @ApiResponse({ status: 403, description: 'Not authorized' })
  async deleteAudio(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.audioService.deleteAudio(id, userId);
  }
}
