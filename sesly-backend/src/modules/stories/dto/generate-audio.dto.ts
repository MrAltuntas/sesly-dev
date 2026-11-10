import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class GenerateAudioDto {
  @ApiProperty({
    example: 'uuid-here',
    description: 'Voice profile ID to use for audio generation',
  })
  @IsUUID()
  voiceProfileId: string;
}
