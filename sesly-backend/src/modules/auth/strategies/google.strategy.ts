import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(private configService: ConfigService) {
    const clientID =
      configService.get<string>('google.clientId') ||
      configService.get<string>('GOOGLE_CLIENT_ID') ||
      'dummy-client-id'; // Fallback to prevent crash

    const clientSecret =
      configService.get<string>('google.clientSecret') ||
      configService.get<string>('GOOGLE_CLIENT_SECRET') ||
      'dummy-secret';

    const callbackURL =
      configService.get<string>('GOOGLE_CALLBACK_URL') ||
      'http://localhost:3000/auth/google/callback';

    super({
      clientID,
      clientSecret,
      callbackURL,
      scope: ['email', 'profile'],
    });

    if (clientID === 'dummy-client-id') {
      this.logger.warn(
        'Google OAuth not configured. Set GOOGLE_CLIENT_ID in .env or use /auth/google/token for mobile auth.',
      );
    } else {
      this.logger.log('Google OAuth strategy initialized');
    }
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { emails, name, id } = profile;

    const user = {
      providerId: id,
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      provider: 'GOOGLE',
    };

    done(null, user);
  }
}
