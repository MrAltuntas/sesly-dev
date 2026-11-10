import { IsBoolean, IsString, IsUUID, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNarrationDto {
  @ApiProperty({
    description: 'ID of the story to narrate',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsUUID()
  @IsNotEmpty()
  storyId: string;

  @ApiProperty({
    description: 'ID of the voice profile to use',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @IsUUID()
  @IsNotEmpty()
  voiceProfileId: string;

  @ApiPropertyOptional({
    description: 'Optional title for the narration',
    example: 'Bedtime Story - My Custom Voice',
  })
  @IsString()
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({
    description:
      'When true, drop any existing narration for this (story, voice) pair (cascading its audio) before creating the fresh one. Default false.',
    example: false,
  })
  @IsBoolean()
  @IsOptional()
  replace?: boolean;
}
