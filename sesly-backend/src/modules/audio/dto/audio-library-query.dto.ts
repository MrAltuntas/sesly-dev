import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';
import { AudioStatus } from '@common/enums/prisma.enums';

export class AudioLibraryQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: AudioStatus,
    description: 'Filter by audio generation status',
    example: 'READY',
  })
  @IsOptional()
  @IsEnum(AudioStatus, { message: 'Status must be a valid AudioStatus' })
  status?: AudioStatus;
}
