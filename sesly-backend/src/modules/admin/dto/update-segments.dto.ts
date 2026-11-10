import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PAUSE_AFTER_MAX_MS,
  SEGMENTS_MAX_COUNT,
  SEGMENT_MAX_CHARS,
} from '../../story-segmentation/story-segments';
import {
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_SPEED_MAX,
  SONIC3_SPEED_MIN,
  SONIC3_VOLUME_MAX,
  SONIC3_VOLUME_MIN,
} from '../../tts-providers/cartesia/cartesia-emotions.constants';

export class StorySegmentInput {
  @ApiProperty({ description: 'Segment text — what the TTS will read aloud' })
  @IsString()
  @MaxLength(SEGMENT_MAX_CHARS, { message: `Segment metni en fazla ${SEGMENT_MAX_CHARS} karakter olabilir.` })
  text: string;

  @ApiProperty({
    required: false,
    description: 'Optional emotion override for this segment',
    enum: SONIC3_EXTENDED_EMOTIONS as unknown as string[],
  })
  @IsOptional()
  @IsString()
  @IsIn(SONIC3_EXTENDED_EMOTIONS as unknown as string[])
  emotion?: string;

  @ApiProperty({ required: false, example: 0.85 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(SONIC3_SPEED_MIN)
  @Max(SONIC3_SPEED_MAX)
  speed?: number;

  @ApiProperty({ required: false, example: 1.0 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(SONIC3_VOLUME_MIN)
  @Max(SONIC3_VOLUME_MAX)
  volume?: number;

  @ApiProperty({ required: false, example: 600, description: 'Silence after the segment (ms)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(PAUSE_AFTER_MAX_MS)
  pauseAfterMs?: number;
}

export class UpdateSegmentsDto {
  @ApiProperty({
    type: [StorySegmentInput],
    description: 'Ordered list of segments. Replaces preprocessedSegments wholesale.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SEGMENTS_MAX_COUNT)
  @ValidateNested({ each: true })
  @Type(() => StorySegmentInput)
  segments: StorySegmentInput[];

  @ApiProperty({
    required: false,
    description: 'segmentationVersion the editor loaded; 409 SEGMENTS_VERSION_CONFLICT when it changed meanwhile',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion?: number;
}
