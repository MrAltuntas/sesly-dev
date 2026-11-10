import { IsString, IsIn, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const PREVIEW_TEXT_MAX_LENGTH = 300;

/**
 * POST /voice-profiles/preview. Allowed only for a ready-made Google voice
 * or a READY voice profile owned by the caller (checked in the service).
 */
export class PreviewVoiceDto {
  @ApiProperty({ description: 'Voice ID to preview', example: 'tr-TR-Chirp3-HD-Achernar' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  voiceId: string;

  @ApiProperty({ description: 'TTS provider (case-insensitive)', enum: ['GOOGLE', 'CARTESIA'], example: 'GOOGLE' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn(['GOOGLE', 'CARTESIA'])
  provider: 'GOOGLE' | 'CARTESIA';

  @ApiPropertyOptional({
    description: `Custom preview text (max ${PREVIEW_TEXT_MAX_LENGTH} characters). Defaults to a short sample in the language of the voice.`,
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PREVIEW_TEXT_MAX_LENGTH)
  text?: string;
}
