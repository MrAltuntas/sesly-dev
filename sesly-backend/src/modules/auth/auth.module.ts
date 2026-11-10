import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { EmailModule } from '../email/email.module';
import { StorageModule } from '../storage/storage.module';
import jwtConfig from '../../config/jwt.config';
import firebaseConfig from '../../config/firebase.config';

@Module({
  imports: [
    ConfigModule.forFeature(jwtConfig),
    ConfigModule.forFeature(firebaseConfig),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get<string>('jwt.expiresIn'),
        },
      }),
      inject: [ConfigService],
    }),
    EmailModule,
    StorageModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordResetService,
    JwtStrategy,
    JwtRefreshStrategy,
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
