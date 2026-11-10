import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { PasswordResetService, PASSWORD_RESET_IP_LIMIT } from './password-reset.service';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { FirebaseTokenDto } from './dto/firebase-token.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private passwordResetService: PasswordResetService,
  ) {}

  @Public()
  @Post('firebase/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify Firebase ID token',
    description: 'Handles all authentication methods (Google, Apple, Email/Password). Firebase manages auth, backend verifies token and issues JWT.',
  })
  @ApiResponse({ status: 200, description: 'Firebase token verified, user authenticated' })
  @ApiResponse({ status: 401, description: 'Invalid Firebase token' })
  @ApiResponse({
    status: 409,
    description:
      'code EMAIL_IN_USE: the email belongs to an account created with another sign-in method and the token email is not verified',
  })
  async verifyFirebaseToken(
    @Body() firebaseTokenDto: FirebaseTokenDto,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    // The app sends its UI language as Accept-Language; stored (tr / en
    // only) for server-written text such as push notifications.
    return this.authService.verifyFirebaseToken(firebaseTokenDto, acceptLanguage);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Refresh access token using refresh token' })
  @ApiResponse({ status: 200, description: 'Token successfully refreshed' })
  @ApiResponse({ status: 401, description: 'Invalid refresh token' })
  async refresh(
    @Body() refreshTokenDto: RefreshTokenDto,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.authService.refreshTokens(refreshTokenDto.refreshToken, acceptLanguage);
  }

  /**
   * Public: the refresh token in the body is the proof of session, so a
   * client whose 1 h access token already expired can still log out. No
   * Authorization header is needed (one that is sent is ignored).
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout: revoke every token of the account',
    description:
      'Body { refreshToken }. Works with an expired access token. A valid refresh token bumps the account token version, which revokes every access and refresh token issued before (all devices). Idempotent: an already revoked refresh token also returns 200.',
  })
  @ApiResponse({ status: 200, description: 'Sessions revoked (or already revoked)' })
  @ApiResponse({ status: 400, description: 'refreshToken missing' })
  @ApiResponse({ status: 401, description: 'Refresh token invalid or expired' })
  async logout(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.logout(refreshTokenDto.refreshToken);
  }

  /**
   * Password reset email in the app language (our template through Resend,
   * not Firebase's one-language email). Always 202 { accepted: true } for a
   * valid address, whether it has an account or not; 429 RATE_LIMITED per
   * IP (route limit) and per address.
   */
  @Public()
  @Post('password-reset')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: PASSWORD_RESET_IP_LIMIT.limit, ttl: PASSWORD_RESET_IP_LIMIT.ttl } })
  @ApiOperation({
    summary: 'Send a password reset email',
    description:
      'Body { email, lang? }. Language: lang, else Accept-Language, else the stored UI language, else tr. The response never says whether the address has an account. The link opens <FRONTEND_URL>/auth/action?mode=resetPassword&oobCode=...&lang=... and is valid for 1 hour.',
  })
  @ApiResponse({ status: 202, description: 'Accepted (sent when an account exists)' })
  @ApiResponse({ status: 400, description: 'email missing or not an email address' })
  @ApiResponse({ status: 429, description: 'code RATE_LIMITED: 10 per hour per IP, 3 per hour per address' })
  async requestPasswordReset(
    @Body() dto: PasswordResetRequestDto,
    @Headers('accept-language') acceptLanguage?: string,
  ) {
    return this.passwordResetService.request(dto.email, dto.lang, acceptLanguage);
  }
}
