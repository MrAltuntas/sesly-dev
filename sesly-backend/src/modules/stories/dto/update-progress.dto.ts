import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsInt, Min, IsOptional, IsDateString } from 'class-validator';

export class UpdateProgressDto {
  @ApiProperty({
    example: 'uuid-here',
    description: 'Voice profile ID',
  })
  @IsUUID()
  voiceProfileId: string;

  @ApiProperty({
    example: 3,
    description: 'Last chunk index the user listened to',
  })
  @IsInt()
  @Min(0)
  lastChunkIndex: number;

  @ApiProperty({
    example: '2025-01-01T00:00:00.000Z',
    description: 'Completion timestamp (optional)',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  completedAt?: string;
}
