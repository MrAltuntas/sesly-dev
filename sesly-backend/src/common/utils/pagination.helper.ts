import { PaginatedResponse } from '../types';

/**
 * Utility class for creating standardized paginated responses
 */
export class PaginationHelper {
  /**
   * Creates a paginated response object
   * @param data - Array of items for the current page
   * @param total - Total number of items across all pages
   * @param page - Current page number (1-indexed)
   * @param limit - Number of items per page
   * @returns Standardized paginated response
   */
  static createPaginatedResponse<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
  ): PaginatedResponse<T> {
    const totalPages = Math.ceil(total / limit);

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Calculates the offset for database queries based on page and limit
   * @param page - Current page number (1-indexed)
   * @param limit - Number of items per page
   * @returns Offset value for database skip/offset
   */
  static calculateOffset(page: number, limit: number): number {
    return (page - 1) * limit;
  }

  /**
   * Validates and normalizes pagination parameters
   * @param page - Page number (defaults to 1 if invalid)
   * @param limit - Items per page (defaults to 20 if invalid, max 100)
   * @returns Normalized pagination parameters
   */
  static normalizePaginationParams(
    page?: number,
    limit?: number,
  ): { page: number; limit: number } {
    const normalizedPage = Math.max(1, page || 1);
    const normalizedLimit = Math.min(100, Math.max(1, limit || 20));

    return {
      page: normalizedPage,
      limit: normalizedLimit,
    };
  }
}
