import { applyDecorators } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

/**
 * Swagger decorator for pagination query parameters
 */
export function ApiPagination() {
  return applyDecorators(
    ApiQuery({
      name: 'page',
      required: false,
      type: Number,
      description: 'Page number',
      example: 1,
    }),
    ApiQuery({
      name: 'limit',
      required: false,
      type: Number,
      description: 'Number of items per page',
      example: 10,
    }),
  );
}