import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@prisma/prisma.service';
import { AdminJwtPayload } from '../interfaces/admin-jwt-payload.interface';
import { isTokenVersionCurrent, withoutTokenVersion } from '@common/utils/token-version';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  private readonly logger = new Logger(AdminJwtStrategy.name);

  constructor(
    private configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.adminSecret') || configService.get<string>('jwt.secret'),
    });
    const secret = configService.get<string>('jwt.adminSecret') || configService.get<string>('jwt.secret');
    this.logger.debug(`AdminJwtStrategy initialized with secret starting with: ${secret?.substring(0, 5)}`);
  }

  async validate(payload: AdminJwtPayload) {
    this.logger.debug(`Validating admin payload: ${JSON.stringify(payload)}`);
    
    const admin = await this.prisma.admin.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        tokenVersion: true,
      },
    });

    if (!admin) {
      this.logger.warn(`Admin not found for id: ${payload.sub}`);
      throw new UnauthorizedException('Admin not found');
    }

    if (!admin.isActive) {
      this.logger.warn(`Admin account is deactivated: ${admin.email}`);
      throw new UnauthorizedException('Admin account is deactivated');
    }

    // Revoked by an admin logout (admins.tokenVersion was bumped).
    if (!isTokenVersionCurrent(payload, admin.tokenVersion)) {
      this.logger.warn(`Revoked admin token used: ${admin.email}`);
      throw new UnauthorizedException('Session revoked');
    }

    return withoutTokenVersion(admin);
  }
}
