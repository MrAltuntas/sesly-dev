import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { MaintenanceService } from '../../modules/admin/services/maintenance.service';

/**
 * Globally gates all traffic when maintenance mode is ON.
 *
 * Order: this guard is registered BEFORE `JwtAuthGuard` so that blocked
 * requests get a 503 (message in the request language, i18n key
 * errors.maintenance) instead of a 401 - mobile users without a token still
 * get the friendly "bakım altında" message.
 *
 * Allowlist (always served, even during maintenance):
 *   - `/admin/**`  — admin panel auth/ops
 *   - `/health`    — uptime probes
 *   - `/`          — root info endpoint
 *   - `/legal/**`  — ToS / Privacy surfaces (marketing web)
 *   - `/app/config` - mobile force-update gate (an outdated app must still
 *                     learn that it has to update)
 *
 * Response shape mirrors NestJS `HttpException` serialization
 * (`{ statusCode, message }`) so existing clients parse it the same way.
 */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  private readonly logger = new Logger(MaintenanceGuard.name);

  // Compiled once; each regex anchors at start-of-path so `/admin-foo`
  // does NOT match `/admin`.
  private static readonly ALLOWLIST: RegExp[] = [
    /^\/admin(?:\/|$)/,
    /^\/health(?:\/|$)/,
    /^\/legal(?:\/|$)/,
    /^\/app\/config\/?$/,
    /^\/?$/, // root
  ];

  constructor(private readonly maintenanceService: MaintenanceService) {}

  canActivate(context: ExecutionContext): boolean {
    const enabled = this.maintenanceService.getEnabledSync();
    if (!enabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      originalUrl?: string;
    }>();

    // `path` is set by Express; fall back to url/originalUrl for defense.
    const rawPath =
      request.path ?? request.url ?? request.originalUrl ?? '/';
    // Strip query string if we fell back to url/originalUrl.
    const path = rawPath.split('?')[0];

    if (MaintenanceGuard.ALLOWLIST.some((re) => re.test(path))) {
      return true;
    }

    this.logger.log(`Maintenance mode blocked request: ${path}`);
    throw new ServiceUnavailableException('errors.maintenance');
  }
}
