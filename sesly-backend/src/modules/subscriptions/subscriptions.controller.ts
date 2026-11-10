import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service';
import { AppleTransactionDto } from './dto/apple-transaction.dto';
import { GooglePurchaseDto } from './dto/google-purchase.dto';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { UsageService } from '../usage/usage.service';
import { PrismaService } from '@prisma/prisma.service';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private subscriptionsService: SubscriptionsService,
    private usageService: UsageService,
    private prisma: PrismaService,
  ) {}

  @Get('plans')
  @Public()
  @ApiOperation({ summary: 'Plans (FREE, MINI, PRO = Premium) with store product ids, features and allowances' })
  @ApiResponse({ status: 200 })
  async getPlans() {
    return this.subscriptionsService.getPlans();
  }

  @Get('current')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Server-resolved plan of the current user (always 200; no row means FREE)',
    description: 'Safe subset only: no store tokens or transaction ids.',
  })
  @ApiResponse({ status: 200 })
  async getCurrentSubscription(@CurrentUser('id') userId: string) {
    return this.subscriptionsService.getCurrentSubscription(userId);
  }

  @Get('usage')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Legacy usage numbers ({ storiesThisMonth, voiceProfiles }); prefer GET /usage' })
  @ApiResponse({ status: 200 })
  async getUsage(@CurrentUser('id') userId: string) {
    const [counters, voiceProfileCount] = await Promise.all([
      this.usageService.getMonthlyCounters(userId),
      this.prisma.voiceProfile.count({ where: { userId } }),
    ]);

    return {
      // Same number as before: cloned-voice narrations this month.
      storiesThisMonth: counters.premium,
      voiceProfiles: voiceProfileCount,
    };
  }

  // ============================================
  // MOBILE IN-APP PURCHASE ENDPOINTS
  // ============================================

  @Post('apple/validate')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate an App Store purchase (StoreKit 2 signed transaction)',
    description:
      'Finish the transaction after a 200 or a 4xx; keep it unfinished and retry on 503 (STORE_UNAVAILABLE / STORE_NOT_CONFIGURED).',
  })
  @ApiResponse({ status: 200, description: '{ success, entitled, purchase, subscription }' })
  @ApiResponse({ status: 400, description: 'RECEIPT_INVALID or PRODUCT_UNKNOWN' })
  @ApiResponse({ status: 409, description: 'RECEIPT_IN_USE: bound to another Sesly account' })
  @ApiResponse({ status: 503, description: 'STORE_UNAVAILABLE / STORE_NOT_CONFIGURED (retry later)' })
  async validateAppleTransaction(
    @CurrentUser('id') userId: string,
    @Body() dto: AppleTransactionDto,
  ) {
    return this.subscriptionsService.validateAppleTransaction(userId, dto);
  }

  @Post('google/validate')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate a Google Play subscription purchase token',
    description:
      'Re-read from the Play Developer API, bound to the caller and acknowledged when pending. Same error contract as the Apple endpoint.',
  })
  @ApiResponse({ status: 200, description: '{ success, entitled, purchase, subscription }' })
  @ApiResponse({ status: 400, description: 'RECEIPT_INVALID or PRODUCT_UNKNOWN' })
  @ApiResponse({ status: 409, description: 'RECEIPT_IN_USE: bound to another Sesly account' })
  @ApiResponse({ status: 503, description: 'STORE_UNAVAILABLE / STORE_NOT_CONFIGURED (retry later)' })
  async validateGooglePurchase(
    @CurrentUser('id') userId: string,
    @Body() dto: GooglePurchaseDto,
  ) {
    return this.subscriptionsService.validateGooglePurchase(userId, dto);
  }
}
