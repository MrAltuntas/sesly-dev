import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Custom exception for business logic errors
 */
export class BusinessException extends HttpException {
  constructor(message: string, statusCode: HttpStatus = HttpStatus.BAD_REQUEST) {
    super(message, statusCode);
  }
}