import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class UserListQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Search by email, first name, or last name',
    example: 'john@example.com',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
