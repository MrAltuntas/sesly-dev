import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { isTokenVersionCurrent, withoutTokenVersion } from '../../../common/utils/token-version';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        emailVerified: true,
        provider: true,
        tokenVersion: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // The user row is loaded on every request anyway, so a logout /
    // deactivation (tokenVersion bump) revokes access tokens immediately.
    if (!isTokenVersionCurrent(payload, user.tokenVersion)) {
      throw new UnauthorizedException('Session revoked');
    }

    // request.user keeps its public shape; the generation stays internal.
    return withoutTokenVersion(user);
  }
}
