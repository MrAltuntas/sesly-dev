import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly isDebugEnabled: boolean;

  constructor(private configService: ConfigService) {
    const logLevel = this.configService.get<string>('LOG_LEVEL', 'log');
    this.isDebugEnabled = logLevel === 'debug' || logLevel === 'verbose';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const { method, originalUrl, body, user } = request;
    // Get real IP behind Cloudflare/proxy
    const ip = (request.headers['cf-connecting-ip'] ||
                request.headers['x-forwarded-for'] ||
                request.headers['x-real-ip'] ||
                request.ip) as string;
    const startTime = Date.now();

    // Log incoming request
    const userInfo = user ? `User: ${(user as any).id}` : 'Anonymous';
    if (this.isDebugEnabled) {
      this.logger.debug(
        `[Incoming] ${method} ${originalUrl} - IP: ${ip} - ${userInfo} - Body: ${JSON.stringify(body)}`,
      );
    } else {
      this.logger.log(`[Incoming] ${method} ${originalUrl} - IP: ${ip} - ${userInfo}`);
    }

    return next.handle().pipe(
      tap({
        next: (data) => {
          const { statusCode } = response;
          const responseTime = Date.now() - startTime;

          if (this.isDebugEnabled) {
            this.logger.debug(
              `[Outgoing] ${method} ${originalUrl} - Status: ${statusCode} - ${responseTime}ms - Response: ${JSON.stringify(data)}`,
            );
          } else {
            this.logger.log(
              `[Outgoing] ${method} ${originalUrl} - Status: ${statusCode} - ${responseTime}ms - IP: ${ip}`,
            );
          }
        },
        error: (error) => {
          const statusCode = error?.status || 500;
          const responseTime = Date.now() - startTime;

          this.logger.error(
            `[Error] ${method} ${originalUrl} - Status: ${statusCode} - ${responseTime}ms - IP: ${ip} - Error: ${error?.message}`,
          );
        },
      }),
    );
  }
}
