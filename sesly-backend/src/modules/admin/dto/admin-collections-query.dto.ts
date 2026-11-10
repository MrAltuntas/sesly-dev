import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
} from '../../../common/constants/content-languages';

export class AdminCollectionsQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by title, slug or subtitle (case-insensitive)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ description: 'Only collections of this content language', enum: CONTENT_LANGUAGE_CODES })
  @IsOptional()
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language?: string;
}
