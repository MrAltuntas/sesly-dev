import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/** Prisma error codes look like P2002 / P1001 (always a string). */
const PRISMA_CODE_PATTERN = /^P\d{4}$/;

export interface MappedPrismaError {
  status: number;
  message: string;
}

/**
 * HTTP status + message for a Prisma known-request error, or null when the
 * value is not a Prisma error. Google client errors carry NUMERIC codes (GCS
 * ApiError `code: 404`, gRPC `code: 3`) and Node system errors carry
 * `ECONNREFUSED`-style strings; both are "not Prisma" here.
 *
 * Used by HttpExceptionFilter (the global catch-all registered in main.ts),
 * so an unhandled P2002 reaches the client as 409 and P2025 as 404 instead
 * of a generic 500.
 */
export function mapPrismaError(exception: unknown): MappedPrismaError | null {
  const code = (exception as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string' || !PRISMA_CODE_PATTERN.test(code)) {
    return null;
  }

  switch (code) {
    case 'P2002': {
      const target = (exception as { meta?: { target?: unknown } }).meta?.target;
      return {
        status: HttpStatus.CONFLICT,
        message: `Unique constraint failed on field: ${target}`,
      };
    }
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, message: 'Record not found' };
    case 'P2003':
      return { status: HttpStatus.BAD_REQUEST, message: 'Foreign key constraint failed' };
    default:
      return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}

/**
 * Standalone Prisma filter for scoped use (`@UseFilters`). It is NOT
 * registered globally: HttpExceptionFilter is the single global catch-all and
 * maps Prisma errors itself via mapPrismaError (two global catch-alls made
 * this one dead code, and a rethrowing catch-all must never be reachable for
 * non-Prisma errors).
 */
@Catch()
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const mapped = mapPrismaError(exception);
    // Only handle Prisma errors
    if (!mapped) {
      throw exception;
    }
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest();

    if (mapped.status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(`Unhandled Prisma error: ${exception.code}`, exception.stack);
    }

    response.status(mapped.status).json({
      statusCode: mapped.status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: mapped.message,
    });
  }
}
