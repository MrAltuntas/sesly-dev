import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MaxLength, IsOptional } from 'class-validator';
import { IsVoiceProfileLanguage } from './voice-language.validator';

/**
 * Legacy POST /voice-profiles: creates a PENDING clone placeholder (same as
 * POST /voice-profiles/v2 with provider CARTESIA + voiceId
 * "custom-cloning-pending"). The old `voiceCloningKey` shortcut is gone.
 */
export class CreateVoiceProfileDto {
  @ApiProperty({
    example: "Mom's Voice",
    description: 'Name of the voice profile',
  })
  @IsString()
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({
    example: 'person',
    description: 'Icon for the voice profile',
  })
  @IsOptional()
  @IsString()
  profileIcon?: string;

  @ApiPropertyOptional({
    example: 'tr',
    description: 'Language the user will speak in the recording (tr, en). Default tr.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @IsVoiceProfileLanguage()
  language?: string;
}
