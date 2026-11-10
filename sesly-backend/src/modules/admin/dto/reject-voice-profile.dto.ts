import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectVoiceProfileDto {
  @ApiPropertyOptional({
    description:
      'User-facing reason (Turkish). Stored as the profile error message and shown in the app. Defaults to a generic quality message.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
