import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Global rate limiter (registered as APP_GUARD after JwtAuthGuard, so
 * `req.user` is already populated on authenticated routes).
 *
 * - Tracks by authenticated user id when available, else by client IP.
 * - Buckets are per route (the throttler key includes controller + handler),
 *   so the lenient global default (see app.module.ts) cannot be exhausted by
 *   mobile polling one endpoint every few seconds.
 * - Skips server-to-server webhooks (Apple / Google retry storms
 *   must never be rejected) and non-HTTP contexts.
 * - Admin routes are @Public at the global layer (admin guards run later),
 *   so they are tracked by IP with the same lenient default.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest();
    const path: string = (req?.originalUrl || req?.url || '').split('?')[0];
    return path === '/webhooks' || path.startsWith('/webhooks/');
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.id;
    if (userId) return `user:${userId}`;
    return `ip:${clientIp(req)}`;
  }

  protected async throwThrottlingException(): Promise<void> {
    throw new HttpException(
      {
        code: 'RATE_LIMITED',
        // i18n key, served per Accept-Language by HttpExceptionFilter.
        message: 'errors.rateLimited',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Client IP behind a proxy. Uses Express' `req.ips` when `trust proxy` is
 * configured; otherwise the LAST X-Forwarded-For entry (the one appended by
 * the nearest proxy, which a client cannot forge), then the socket address.
 */
export function clientIp(req: Record<string, any>): string {
  if (Array.isArray(req?.ips) && req.ips.length > 0) return String(req.ips[0]);
  const forwarded = req?.headers?.['x-forwarded-for'];
  const header = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  if (typeof header === 'string' && header.trim()) {
    const parts = header.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return String(req?.ip || req?.socket?.remoteAddress || 'unknown');
}
