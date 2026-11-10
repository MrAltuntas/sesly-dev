import { PartialType, ApiProperty } from '@nestjs/swagger';
import { CreateStoryDto } from './create-story.dto';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import {
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_SPEED_MAX,
  SONIC3_SPEED_MIN,
} from '../../tts-providers/cartesia/cartesia-emotions.constants';

export class UpdateStoryDto extends PartialType(CreateStoryDto) {
  @ApiProperty({ example: 15, description: 'Estimated duration in minutes', required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  estimatedDuration?: number;

  @ApiProperty({ example: false, description: 'Is premium story', required: false })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  isPremium?: boolean;

  @ApiProperty({ required: false, enum: SONIC3_EXTENDED_EMOTIONS as unknown as string[] })
  @IsOptional()
  @IsString()
  @IsIn(SONIC3_EXTENDED_EMOTIONS as unknown as string[])
  defaultEmotion?: string;

  @ApiProperty({ required: false, example: 0.85 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(SONIC3_SPEED_MIN)
  @Max(SONIC3_SPEED_MAX)
  defaultSpeed?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cartesiaPronunciationDictId?: string;
}
