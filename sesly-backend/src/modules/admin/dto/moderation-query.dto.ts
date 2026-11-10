import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { VoiceProfileStatus } from '../../../common/enums/prisma.enums';

export class ModerationQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: VoiceProfileStatus,
    description: 'Filter by voice profile status (omit for all)',
  })
  @IsOptional()
  @IsEnum(VoiceProfileStatus)
  status?: VoiceProfileStatus;
}
