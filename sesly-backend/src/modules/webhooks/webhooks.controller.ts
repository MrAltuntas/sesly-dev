import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  BadRequestException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { GooglePlayService, PubSubPushBody } from '../subscriptions/store/google-play.service';
import { AppStoreService } from '../subscriptions/store/app-store.service';
import {
  StoreConfigError,
  StoreRejectedError,
} from '../subscriptions/store/store-errors';

/**
 * Server-to-server store notifications. Public at the user-auth layer; each
 * endpoint authenticates the sender itself. A 2xx tells the store the message
 * is handled (also for a replay or a message we ignore on purpose); a 5xx
 * makes it deliver again later.
 */
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private googlePlay: GooglePlayService,
    private appStore: AppStoreService,
  ) {}

  @Public()
  @Post('google-play')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google Play real-time developer notifications (Pub/Sub push, OIDC authenticated)' })
  @ApiResponse({ status: 200, description: 'Handled, replayed or ignored on purpose' })
  @ApiResponse({ status: 401, description: 'Missing or invalid Pub/Sub OIDC token' })
  async handleGooglePlay(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: PubSubPushBody,
  ) {
    try {
      return await this.googlePlay.handlePush(authorization, body);
    } catch (error) {
      throw this.toHttp(error, 'google-play');
    }
  }

  @Public()
  @Post('apple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'App Store Server Notifications V2 ({ signedPayload })' })
  @ApiResponse({ status: 200, description: 'Handled, replayed or ignored on purpose' })
  @ApiResponse({ status: 400, description: 'signedPayload missing or not signed by Apple for this app' })
  async handleApple(@Body() body: { signedPayload?: unknown }) {
    try {
      return await this.appStore.handleNotification(body);
    } catch (error) {
      throw this.toHttp(error, 'apple');
    }
  }

  private toHttp(error: any, source: string) {
    if (error instanceof StoreRejectedError) {
      this.logger.warn(`Webhook ${source} rejected: ${error.message}`);
      return source === 'google-play'
        ? new UnauthorizedException('Invalid push authentication')
        : new BadRequestException('Invalid signed payload');
    }
    if (error instanceof StoreConfigError) {
      this.logger.error(`Webhook ${source} not configured: ${error.message}`);
      return new ServiceUnavailableException('Store notifications are not configured');
    }
    this.logger.error(`Webhook ${source} failed, the store will retry: ${error?.message ?? error}`);
    return new InternalServerErrorException('Notification not processed');
  }
}
