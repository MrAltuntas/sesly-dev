import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionPlan } from '../../common/enums/prisma.enums';
import {
  Allowance,
  getNarrationLimits,
  getPlanLimits,
  PLAN_CURRENCY,
  PLAN_NAMES,
  PLAN_PRICES,
  PLAN_YEARLY_PRICES,
} from '../../common/constants/plans.constants';
import {
  periodLabel,
  storeProductsForPlan,
} from '../../common/constants/store-products.constants';
import { getTotalVoiceSlots } from '../../common/constants/voice-slots.constants';
import { resolveEffectiveSource } from '../../common/utils/subscription-plan';
import { AppleTransactionDto } from './dto/apple-transaction.dto';
import { GooglePurchaseDto } from './dto/google-purchase.dto';
import { AppStoreService } from './store/app-store.service';
import { GooglePlayService } from './store/google-play.service';
import { GooglePlayClient } from './store/google-play.client';

export {
  RECEIPT_IN_USE_CODE,
  RECEIPT_IN_USE_MESSAGE,
  RECEIPT_INVALID_CODE,
  RECEIPT_INVALID_MESSAGE,
} from './store/store-errors';

export const APPLE_MANAGE_SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions';

/** Plans in the public list (CREATOR is admin-grant only). */
const PUBLIC_PLANS: SubscriptionPlan[] = ['FREE', 'MINI', 'PRO'];

/** Safe public subset of a store purchase (never the token or transaction ids). */
export function toPublicPurchase(purchase: any) {
  if (!purchase) return null;
  return {
    platform: purchase.platform,
    productId: purchase.productId,
    plan: purchase.plan,
    billingPeriod: periodLabel(purchase.billingPeriod),
    state: purchase.state,
    expiresAt: purchase.expiresAt ?? null,
    autoRenew: !!purchase.autoRenew,
  };
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private prisma: PrismaService,
    private appStore: AppStoreService,
    private googlePlay: GooglePlayService,
    private playClient: GooglePlayClient,
  ) {}

  /**
   * GET /subscriptions/current: the server-resolved plan and a safe subset.
   * Always 200 (a user without a row is FREE). `plan`, `status` and
   * `currentPeriodEnd` keep the names app builds in the field parse.
   */
  async getCurrentSubscription(userId: string, now: Date = new Date()) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
      include: { storePurchase: true },
    });
    return this.toCurrentView(subscription, now);
  }

  toCurrentView(subscription: any, now: Date = new Date()) {
    const { plan, source } = resolveEffectiveSource(subscription, now);
    const purchase = subscription?.storePurchase ?? null;
    const base = {
      plan,
      planName: PLAN_NAMES[plan],
      isPaid: plan !== 'FREE',
      grantedPlan: null as string | null,
    };

    if (source === 'GRANT') {
      return {
        ...base,
        status: 'ACTIVE',
        source: 'ADMIN',
        currentPeriodEnd: subscription.grantEndsAt ?? null,
        cancelAtPeriodEnd: false,
        willRenew: false,
        inGracePeriod: false,
        productId: null,
        billingPeriod: null,
        managementUrl: null,
        grantedPlan: plan,
        // The store subscription, if any, keeps running underneath the grant.
        storePurchase: toPublicPurchase(purchase),
      };
    }

    if (source === 'STORE') {
      const platform: string | null =
        purchase?.platform ??
        (subscription.appleOriginalTransactionId || subscription.appleTransactionId
          ? 'APPLE'
          : subscription.googlePurchaseToken
            ? 'GOOGLE'
            : subscription.stripeSubscriptionId
              ? 'STRIPE'
              : 'ADMIN');
      const productId = purchase?.productId ?? subscription.googleProductId ?? null;
      const cancelAtPeriodEnd = !!subscription.cancelAtPeriodEnd;
      const store = platform === 'APPLE' || platform === 'GOOGLE';
      return {
        ...base,
        status: subscription.status,
        source: platform,
        currentPeriodEnd: subscription.currentPeriodEnd ?? null,
        cancelAtPeriodEnd,
        willRenew: store && !cancelAtPeriodEnd,
        inGracePeriod: subscription.status === 'PAST_DUE' || purchase?.state === 'GRACE',
        productId,
        billingPeriod: purchase ? periodLabel(purchase.billingPeriod) : null,
        managementUrl: this.managementUrl(platform, productId),
        storePurchase: toPublicPurchase(purchase),
      };
    }

    // FREE. A lapsed subscription says so (status EXPIRED, the past end).
    const lapsed = !!subscription && subscription.plan !== 'FREE';
    return {
      ...base,
      status: lapsed ? 'EXPIRED' : 'ACTIVE',
      source: null,
      currentPeriodEnd: lapsed ? (subscription.currentPeriodEnd ?? null) : null,
      cancelAtPeriodEnd: false,
      willRenew: false,
      inGracePeriod: false,
      productId: null,
      billingPeriod: null,
      managementUrl: null,
      storePurchase: toPublicPurchase(purchase),
    };
  }

  private managementUrl(platform: string | null, productId: string | null): string | null {
    if (platform === 'APPLE') return APPLE_MANAGE_SUBSCRIPTIONS_URL;
    if (platform === 'GOOGLE') {
      const pkg = encodeURIComponent(this.playClient.packageName);
      return productId
        ? `https://play.google.com/store/account/subscriptions?sku=${encodeURIComponent(productId)}&package=${pkg}`
        : `https://play.google.com/store/account/subscriptions?package=${pkg}`;
    }
    return null;
  }

  private async validationResponse(userId: string, result: { purchase: any; entitled: boolean }) {
    const subscription = await this.getCurrentSubscription(userId);
    return {
      success: true,
      entitled: result.entitled,
      purchase: toPublicPurchase(result.purchase),
      subscription,
      // Names of the old Apple validation answer.
      expiresAt: result.purchase?.expiresAt ?? null,
      isActive: result.entitled,
    };
  }

  async validateAppleTransaction(userId: string, dto: AppleTransactionDto) {
    return this.validationResponse(userId, await this.appStore.validate(userId, dto));
  }

  async validateGooglePurchase(userId: string, dto: GooglePurchaseDto) {
    return this.validationResponse(userId, await this.googlePlay.validate(userId, dto));
  }

  // -------------------------------------------------------------------------
  // Plan list
  // -------------------------------------------------------------------------

  private allowanceText(allowance: Allowance, what: string): string {
    if (allowance.limit === null) return `${what} sınırsız masal`;
    if (allowance.period === 'lifetime') return `${what} ${allowance.limit} masal (tek seferlik hak)`;
    return `${what} ayda ${allowance.limit} masal`;
  }

  private features(plan: SubscriptionPlan): string[] {
    const limits = getPlanLimits(plan);
    const creations =
      limits.cloneCreations.period === 'lifetime'
        ? ''
        : ` (ayda en fazla ${limits.cloneCreations.limit} yeni kayıt)`;
    const features = [
      this.allowanceText(limits.presetNarrations, 'Hazır anlatıcı seslerle'),
      this.allowanceText(limits.cloneNarrations, 'Kendi sesinle'),
      `Kendi sesinle ${limits.cloneVoiceSlots} ses kaydı${creations}`,
      `${limits.presetVoiceSlots} hazır anlatıcı ses`,
    ];
    if (limits.premiumStories) features.push('Tüm masal kataloğu');
    if (limits.backgroundPlayback) features.push('Arka planda ve kilit ekranında dinleme');
    return features;
  }

  /**
   * GET /subscriptions/plans (public). Every number comes from PLAN_LIMITS
   * and every product id from STORE_PRODUCTS, so the copy cannot drift from
   * what the backend enforces. Prices are reference list prices; the app
   * shows the price the store returns.
   */
  async getPlans() {
    return {
      plans: PUBLIC_PLANS.map((plan) => {
        const limits = getPlanLimits(plan);
        const legacy = getNarrationLimits(plan);
        const products = storeProductsForPlan(plan).map((product) => ({
          platform: product.platform,
          productId: product.productId,
          billingPeriod: periodLabel(product.period),
          referencePrice: product.period === 'YEAR' ? (PLAN_YEARLY_PRICES[plan] ?? null) : PLAN_PRICES[plan],
        }));
        const monthly = (platform: string) =>
          products.find((p) => p.platform === platform && p.billingPeriod === 'month')?.productId ?? null;
        const yearly = (platform: string) =>
          products.find((p) => p.platform === platform && p.billingPeriod === 'year')?.productId ?? null;
        return {
          id: plan,
          name: PLAN_NAMES[plan],
          price: PLAN_PRICES[plan],
          yearlyPrice: PLAN_YEARLY_PRICES[plan] ?? null,
          currency: PLAN_CURRENCY,
          billingPeriod: 'monthly',
          ...(plan === 'PRO' ? { popular: true } : {}),
          // Monthly ids under the names older clients read.
          appleProductId: monthly('APPLE'),
          googleProductId: monthly('GOOGLE'),
          appleYearlyProductId: yearly('APPLE'),
          googleYearlyProductId: yearly('GOOGLE'),
          products,
          features: this.features(plan),
          allowances: {
            presetNarrations: limits.presetNarrations,
            cloneNarrations: limits.cloneNarrations,
            cloneCreations: limits.cloneCreations,
          },
          limits: {
            storiesPerMonth: legacy.standard,
            premiumStoriesPerMonth: legacy.premium,
            textToSpeechPerMonth: -1,
            voiceProfiles: getTotalVoiceSlots(plan),
            presetVoices: limits.presetVoiceSlots,
            cloneVoices: limits.cloneVoiceSlots,
            monthlyCloneCreations: limits.cloneCreations.limit ?? -1,
            cloneCreationPeriod: limits.cloneCreations.period,
            backgroundPlayback: limits.backgroundPlayback,
            premiumStories: limits.premiumStories,
            providers: ['GOOGLE', 'CARTESIA'],
          },
        };
      }),
    };
  }
}
