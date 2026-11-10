import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Query DTO for popular stories endpoint
 * Extends base pagination with default limit of 10
 */
export class PopularStoriesQueryDto extends PaginationDto {
  // Uses default pagination from PaginationDto (page, limit)
  // Default limit can be overridden to 10 in the service/controller
}
