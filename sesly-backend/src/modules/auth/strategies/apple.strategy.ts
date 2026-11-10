import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { ConfigService } from '@nestjs/config';
import appleSignin from 'apple-signin-auth';

@Injectable()
export class AppleStrategy extends PassportStrategy(Strategy, 'apple') {
  private readonly logger = new Logger(AppleStrategy.name);

  constructor(private configService: ConfigService) {
    super();

    const clientId =
      configService.get<string>('APPLE_CLIENT_ID') ||
      'io.sesly.app';

    if (clientId === 'io.sesly.app') {
      this.logger.warn(
        'Apple Sign-In not fully configured. Set APPLE_CLIENT_ID in .env or use /auth/apple/token for mobile auth.',
      );
    } else {
      this.logger.log('Apple Sign-In strategy initialized');
    }
  }

  async validate(req: any): Promise<any> {
    const { id_token } = req.body;

    if (!id_token) {
      throw new Error('No id_token provided');
    }

    try {
      const clientId = this.configService.get<string>('APPLE_CLIENT_ID') || 'io.sesly.app';

      const appleIdTokenClaims = await appleSignin.verifyIdToken(id_token, {
        audience: clientId,
        nonce: 'nonce',
      });

      const user = {
        providerId: appleIdTokenClaims.sub,
        email: appleIdTokenClaims.email,
        // Apple sends the claim as the string "true" or the boolean true.
        emailVerified: String(appleIdTokenClaims.email_verified) === 'true',
        provider: 'APPLE',
      };

      return user;
    } catch (error) {
      throw new Error(`Apple Sign-In verification failed: ${error}`);
    }
  }
}
