import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { NarrationsService } from './narrations.service';
import { CreateNarrationDto } from './dto/create-narration.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { GetNarrationsQueryDto } from './dto/get-narrations-query.dto';

@ApiTags('Narrations')
@ApiBearerAuth()
@Controller('narrations')
export class NarrationsController {
  constructor(private readonly narrationsService: NarrationsService) { }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new narration' })
  @ApiResponse({
    status: 201,
    description:
      'Narration created. ' +
      'A voice of another language than the story is allowed. The response carries voiceLanguage, storyLanguage, ' +
      'languageMismatch (the two codes differ) and nativeVoiceUsed (a ready-made voice is replaced by the voice of ' +
      'the same name in the story locale, so the text is read natively; false for a cloned voice, which reads with ' +
      'an accent). To know beforehand, compare voiceProfile.contentLanguage with story.language.',
  })
  @ApiResponse({ status: 404, description: 'Story or voice profile not found' })
  create(
    @CurrentUser('id') userId: string,
    @Body() createNarrationDto: CreateNarrationDto,
  ) {
    return this.narrationsService.create(userId, createNarrationDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all narrations for current user (paginated)',
  })
  @ApiResponse({
    status: 200,
    description: 'PaginatedResponse<NarrationListItem>',
  })
  findAll(
    @CurrentUser('id') userId: string,
    @Query() pagination: GetNarrationsQueryDto,
  ) {
    return this.narrationsService.findAll(userId, pagination);
  }

  @Get('story/:storyId')
  @ApiOperation({ summary: 'Get all narrations for a specific story' })
  @ApiResponse({ status: 200, description: 'List of narrations for the story' })
  findByStory(
    @Param('storyId') storyId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.narrationsService.findByStory(storyId, userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific narration' })
  @ApiResponse({ status: 200, description: 'Narration details' })
  @ApiResponse({ status: 404, description: 'Narration not found' })
  findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.narrationsService.findOne(id, userId);
  }

  @Post(':id/generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate audio for a narration' })
  @ApiResponse({
    status: 200,
    description:
      'Audio generation started (or already running / done): message, status, narrationId, audioId, progress. ' +
      'A voice of another language than the story is allowed. The response carries voiceLanguage, storyLanguage, ' +
      'languageMismatch (the two codes differ) and nativeVoiceUsed (a ready-made voice is replaced by the voice of ' +
      'the same name in the story locale, so the text is read natively; false for a cloned voice, which reads with ' +
      'an accent). To know beforehand, compare voiceProfile.contentLanguage with story.language.',
  })
  @ApiResponse({ status: 400, description: 'Voice profile not ready' })
  @ApiResponse({ status: 403, description: 'Monthly limit reached or premium story' })
  @ApiResponse({ status: 404, description: 'Narration not found' })
  generateAudio(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.narrationsService.generateAudio(id, userId);
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get audio generation status for a narration' })
  @ApiResponse({ status: 200, description: 'Generation status retrieved' })
  @ApiResponse({ status: 404, description: 'Narration not found' })
  getGenerationStatus(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.narrationsService.getGenerationStatus(id, userId);
  }

  @Get(':id/stream')
  @ApiOperation({ summary: 'Stream narration audio' })
  @ApiResponse({ status: 302, description: 'Redirect to audio stream' })
  @ApiResponse({ status: 404, description: 'Narration not found or not ready' })
  async stream(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ) {
    const url = await this.narrationsService.getStreamUrl(id, userId);
    return res.redirect(url);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a narration' })
  @ApiResponse({ status: 200, description: 'Narration deleted successfully' })
  @ApiResponse({ status: 404, description: 'Narration not found' })
  remove(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.narrationsService.remove(id, userId);
  }
}
