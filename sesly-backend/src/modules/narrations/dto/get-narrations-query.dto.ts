import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '@common/dto/pagination.dto';

export class GetNarrationsQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'Search term for the narration title or the story title. Turkish-aware, accent- and case-insensitive: "yildiz", "YILDIZ" and "Yıldız" match the same narrations.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
