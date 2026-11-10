import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Enhanced RolesGuard with JWT integration
 * Extends AuthGuard('jwt') to provide both authentication and authorization
 * Properly distinguishes between authentication failures and authorization failures
 */
@Injectable()
export class RolesGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // Run JWT authentication from AuthGuard('jwt')
    try {
      const jwtResult = await super.canActivate(context);
      if (!jwtResult) {
        throw new UnauthorizedException('Authentication failed');
      }
    } catch (error) {
      // If JWT validation fails, throw UnauthorizedException (401)
      throw new UnauthorizedException(
        error.message || 'Authentication failed. Invalid or missing token.',
      );
    }

    // Get authenticated user from request
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Authentication failed. No user found.');
    }

    // Check role-based authorization
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no roles are required, allow access (user is authenticated)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Check if user has at least one of the required roles
    const hasRole = requiredRoles.some((role) => user.roles?.includes(role));

    if (!hasRole) {
      // If user is authenticated but lacks required role, throw ForbiddenException (403)
      throw new ForbiddenException(
        'Insufficient permissions. You do not have the required role to access this resource.',
      );
    }

    return true;
  }
}
