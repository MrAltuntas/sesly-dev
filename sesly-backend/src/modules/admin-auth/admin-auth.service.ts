import {
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminAuthResponse, AdminJwtPayload } from './interfaces/admin-jwt-payload.interface';
import { bumpTokenVersion } from '@common/utils/token-version';

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) { }

  async login(loginDto: AdminLoginDto): Promise<AdminAuthResponse> {
    const { email, password } = loginDto;

    this.logger.debug(`Login attempt for email: ${email}`);

    // Find admin
    const admin = await this.prisma.admin.findUnique({
      where: { email },
    });

    if (!admin) {
      this.logger.warn(`Admin not found: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.debug(`Admin found: ${admin.email}, isActive: ${admin.isActive}`);

    // Check if admin is active
    if (!admin.isActive) {
      this.logger.warn(`Admin account is deactivated: ${email}`);
      throw new UnauthorizedException('Admin account is deactivated');
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, admin.passwordHash);
    this.logger.debug(`Password validation result: ${isPasswordValid}`);

    if (!isPasswordValid) {
      this.logger.warn(`Invalid password for admin: ${email}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    // Update last login timestamp
    await this.prisma.admin.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    this.logger.log(`Admin logged in: ${admin.email} (${admin.role})`);

    // Generate tokens
    const tokens = await this.generateTokens(admin.id, admin.email, admin.role, admin.tokenVersion);

    return {
      ...tokens,
      admin: {
        id: admin.id,
        email: admin.email,
        firstName: admin.firstName,
        lastName: admin.lastName,
        role: admin.role
      },
    };
  }

  async refreshTokens(adminId: string): Promise<{ accessToken: string; refreshToken: string }> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    if (!admin.isActive) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    return this.generateTokens(admin.id, admin.email, admin.role, admin.tokenVersion);
  }

  /**
   * Bumps admins.tokenVersion: every admin access and refresh token issued
   * before (all browsers) stops working. The panel calls this with its access
   * token; an expired one is refreshed by the panel's 401 interceptor first.
   */
  async logout(adminId: string): Promise<{ message: string }> {
    await this.prisma.admin.updateMany({
      where: { id: adminId },
      data: bumpTokenVersion(),
    });
    this.logger.log(`Admin logged out, sessions revoked: ${adminId}`);
    return { message: 'Logged out successfully' };
  }

  private async generateTokens(
    adminId: string,
    email: string,
    role: any,
    tokenVersion: number | null | undefined,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: AdminJwtPayload = { sub: adminId, email, role, tv: tokenVersion ?? 0 };

    const adminSecret = this.configService.get<string>('jwt.adminSecret') || this.configService.get<string>('jwt.secret');
    const adminRefreshSecret = this.configService.get<string>('jwt.adminRefreshSecret') || this.configService.get<string>('jwt.refreshSecret');

    this.logger.debug(`Generating tokens with secret starting with: ${adminSecret?.substring(0, 5)}`);

    const accessToken = this.jwtService.sign(payload, {
      secret: adminSecret,
      expiresIn: '1h', // Shorter expiry for admin tokens
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: adminRefreshSecret,
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }
}
