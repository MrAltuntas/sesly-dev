import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Query DTO for recent activity endpoint
 * Extends base pagination with default limit of 50
 */
export class ActivityQueryDto extends PaginationDto {
  // Uses default pagination from PaginationDto (page, limit)
  // Default limit can be overridden to 50 in the service/controller
}
