import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { AdminJwtRefreshStrategy } from './strategies/admin-jwt-refresh.strategy';
import { PrismaModule } from '@prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'admin-jwt' }),
    JwtModule.register({}), // Configuration is done in strategy
  ],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtStrategy, AdminJwtRefreshStrategy],
  exports: [AdminAuthService, AdminJwtStrategy, AdminJwtRefreshStrategy, PassportModule],
})
export class AdminAuthModule {}
