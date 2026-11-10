import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Global user JWT guard.
 *
 * Protected routes: a valid Bearer token is required.
 *
 * `@Public()` routes use OPTIONAL auth: when a Bearer token is present and
 * valid, `request.user` is populated (so e.g. GET /stories can compute
 * `isFavorite` and premium visibility for the caller); when it is absent,
 * expired or invalid the request still proceeds anonymously. Admin routes
 * (`/admin/**`) are also `@Public()` at this layer, but carry an admin token
 * verified by their own guards, so optional user parsing is skipped there.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest();

    if (!isPublic) {
      return (await super.canActivate(context)) as boolean;
    }

    // Attach public flag so handleRequest never throws for this request.
    request.isPublic = true;

    if (!JwtAuthGuard.hasBearerToken(request) || JwtAuthGuard.isAdminPath(request)) {
      return true;
    }

    try {
      await super.canActivate(context);
    } catch {
      // Optional auth: an unusable token downgrades to an anonymous request.
      request.user = undefined;
    }
    return true;
  }

  handleRequest(err: any, user: any, _info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    if (user) {
      return user;
    }

    // Public endpoint: proceed anonymously.
    if (request.isPublic) {
      return undefined;
    }

    throw err || new UnauthorizedException();
  }

  private static hasBearerToken(request: any): boolean {
    const header: unknown = request?.headers?.authorization;
    return typeof header === 'string' && /^Bearer\s+\S+/i.test(header);
  }

  private static isAdminPath(request: any): boolean {
    const rawPath: string = request?.path ?? request?.url ?? '';
    return /^\/admin(?:\/|$)/.test(rawPath.split('?')[0]);
  }
}
