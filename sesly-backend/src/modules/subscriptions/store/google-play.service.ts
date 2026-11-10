import { Injectable, Logger } from '@nestjs/common';
import { StorePurchaseState } from '../../../common/enums/prisma.enums';
import {
  findStoreProduct,
  StoreProduct,
} from '../../../common/constants/store-products.constants';
import { GooglePlayClient, GoogleSubscriptionV2 } from './google-play.client';
import { StorePurchasesService, StorePurchaseSnapshot } from './store-purchases.service';
import {
  productUnknown,
  receiptInUse,
  receiptInvalid,
  StoreRejectedError,
  storeNotConfigured,
  toHttpError,
} from './store-errors';
import { isEntitling } from './entitlement';
import { GooglePurchaseDto } from '../dto/google-purchase.dto';

/** subscriptionsv2 subscriptionState to our state. */
const GOOGLE_STATES: Record<string, StorePurchaseState> = {
  SUBSCRIPTION_STATE_PENDING: 'PENDING',
  SUBSCRIPTION_STATE_ACTIVE: 'ACTIVE',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'GRACE',
  SUBSCRIPTION_STATE_CANCELED: 'CANCELED',
  SUBSCRIPTION_STATE_ON_HOLD: 'ON_HOLD',
  SUBSCRIPTION_STATE_PAUSED: 'PAUSED',
  SUBSCRIPTION_STATE_EXPIRED: 'EXPIRED',
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: 'EXPIRED',
};

export interface ParsedGoogleSubscription {
  product: StoreProduct | undefined;
  productId: string | null;
  state: StorePurchaseState;
  expiresAt: Date | null;
  autoRenew: boolean;
  obfuscatedAccountId: string | null;
  linkedPurchaseToken: string | null;
  acknowledged: boolean;
  latestOrderId: string | null;
  environment: 'production' | 'test';
}

/**
 * Normalise a SubscriptionPurchaseV2. The line item of a known product with
 * the latest expiry is the one that counts (a subscription has one line item
 * per product it holds).
 */
export function parseGoogleSubscription(sub: GoogleSubscriptionV2): ParsedGoogleSubscription {
  const items = sub.lineItems ?? [];
  const time = (iso?: string) => (iso ? new Date(iso).getTime() : 0);
  const known = items.filter((item) => findStoreProduct('GOOGLE', item.productId));
  const pool = known.length > 0 ? known : items;
  const item = pool.reduce<(typeof items)[number] | undefined>(
    (best, candidate) => (!best || time(candidate.expiryTime) > time(best.expiryTime) ? candidate : best),
    undefined,
  );
  const productId = item?.productId ?? null;
  return {
    product: findStoreProduct('GOOGLE', productId),
    productId,
    state: GOOGLE_STATES[sub.subscriptionState ?? ''] ?? 'EXPIRED',
    expiresAt: item?.expiryTime ? new Date(item.expiryTime) : null,
    autoRenew: item?.autoRenewingPlan?.autoRenewEnabled === true,
    obfuscatedAccountId: sub.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    linkedPurchaseToken: sub.linkedPurchaseToken ?? null,
    acknowledged: sub.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    latestOrderId: item?.latestSuccessfulOrderId ?? sub.latestOrderId ?? null,
    environment: sub.testPurchase ? 'test' : 'production',
  };
}

/** Real-time developer notification types (subscriptionNotification.notificationType). */
export const GOOGLE_NOTIFICATION_TYPES: Record<number, string> = {
  1: 'SUBSCRIPTION_RECOVERED',
  2: 'SUBSCRIPTION_RENEWED',
  3: 'SUBSCRIPTION_CANCELED',
  4: 'SUBSCRIPTION_PURCHASED',
  5: 'SUBSCRIPTION_ON_HOLD',
  6: 'SUBSCRIPTION_IN_GRACE_PERIOD',
  7: 'SUBSCRIPTION_RESTARTED',
  8: 'SUBSCRIPTION_PRICE_CHANGE_CONFIRMED',
  9: 'SUBSCRIPTION_DEFERRED',
  10: 'SUBSCRIPTION_PAUSED',
  11: 'SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED',
  12: 'SUBSCRIPTION_REVOKED',
  13: 'SUBSCRIPTION_EXPIRED',
  17: 'SUBSCRIPTION_ITEMS_CHANGED',
  18: 'SUBSCRIPTION_CANCELLATION_SCHEDULED',
  19: 'SUBSCRIPTION_PRICE_CHANGE_UPDATED',
  20: 'SUBSCRIPTION_PENDING_PURCHASE_CANCELED',
  22: 'SUBSCRIPTION_PRICE_STEP_UP_CONSENT_UPDATED',
};

export interface PubSubPushBody {
  message?: { data?: string; messageId?: string; message_id?: string; publishTime?: string };
  subscription?: string;
}

export type WebhookOutcome = { received: true; status: 'processed' | 'ignored' | 'duplicate'; note?: string };

@Injectable()
export class GooglePlayService {
  private readonly logger = new Logger(GooglePlayService.name);

  constructor(
    private play: GooglePlayClient,
    private purchases: StorePurchasesService,
  ) {}

  /**
   * POST /subscriptions/google/validate. The token is re-read from Google
   * (the client's word is never trusted), then bound to the caller.
   *
   * Order: package (400 RECEIPT_INVALID) -> declared product (400
   * PRODUCT_UNKNOWN) -> binding (409 RECEIPT_IN_USE) -> subscriptionsv2.get
   * (400 / 503) -> product from Google (400 PRODUCT_UNKNOWN) -> obfuscated
   * account id (409) -> write -> acknowledge when pending.
   */
  async validate(userId: string, dto: GooglePurchaseDto) {
    if (dto.packageName && dto.packageName !== this.play.packageName) {
      this.logger.warn(`Play purchase for package ${dto.packageName} refused for user ${userId}`);
      throw receiptInvalid();
    }
    if (dto.productId && !findStoreProduct('GOOGLE', dto.productId)) {
      throw productUnknown(dto.productId);
    }
    if (!this.play.isConfigured()) {
      this.logger.error('Google Play validation called but GOOGLE_PLAY_SERVICE_ACCOUNT_PATH is not set');
      throw storeNotConfigured();
    }
    await this.purchases.assertNotOwnedByAnotherUser(userId, 'GOOGLE', dto.purchaseToken);

    let sub: GoogleSubscriptionV2;
    try {
      sub = await this.play.getSubscription(dto.purchaseToken);
    } catch (error) {
      throw toHttpError(error);
    }
    const parsed = parseGoogleSubscription(sub);
    if (!parsed.product) {
      await this.purchases.recordEvent(
        { platform: 'GOOGLE', source: 'CLIENT', type: 'VALIDATE', productId: parsed.productId, userId },
        'IGNORED',
        'unknown product',
      );
      throw productUnknown(parsed.productId);
    }
    if (parsed.obfuscatedAccountId && parsed.obfuscatedAccountId !== userId) {
      this.logger.warn(`Play purchase made for another account presented by user ${userId}`);
      throw receiptInUse();
    }

    const result = await this.purchases.applySnapshot(userId, this.snapshot(dto.purchaseToken, parsed));
    await this.acknowledgeIfPending(result.purchase, parsed);
    await this.purchases.recordEvent(
      {
        platform: 'GOOGLE',
        source: 'CLIENT',
        type: 'VALIDATE',
        purchaseKey: dto.purchaseToken,
        productId: parsed.productId,
        userId,
        payload: { state: parsed.state, expiresAt: parsed.expiresAt, environment: parsed.environment },
      },
      'PROCESSED',
    );

    return {
      purchase: result.purchase,
      subscription: result.subscription,
      entitled: isEntitling(result.purchase),
    };
  }

  private snapshot(purchaseToken: string, parsed: ParsedGoogleSubscription): StorePurchaseSnapshot {
    return {
      platform: 'GOOGLE',
      purchaseKey: purchaseToken,
      product: parsed.product as StoreProduct,
      state: parsed.state,
      expiresAt: parsed.expiresAt,
      autoRenew: parsed.autoRenew,
      latestTransactionId: parsed.latestOrderId,
      linkedPurchaseKey: parsed.linkedPurchaseToken,
      environment: parsed.environment,
      acknowledged: parsed.acknowledged,
    };
  }

  /**
   * An unacknowledged subscription is refunded by Google after three days.
   * The app acknowledges too (finishTransaction); a failure here is logged
   * and retried on the next notification or validation.
   */
  private async acknowledgeIfPending(purchase: any, parsed: ParsedGoogleSubscription): Promise<void> {
    if (parsed.acknowledged || !parsed.product) return;
    if (parsed.state !== 'ACTIVE' && parsed.state !== 'GRACE' && parsed.state !== 'CANCELED') return;
    try {
      await this.play.acknowledge(parsed.product.productId, purchase.purchaseKey);
      await this.purchases.markAcknowledged(purchase.id);
    } catch (error: any) {
      this.logger.warn(`Play acknowledge failed for purchase ${purchase.id}: ${error?.message ?? error}`);
    }
  }

  /**
   * POST /webhooks/google-play (Pub/Sub push). Authenticated by the push
   * OIDC token, idempotent on the Pub/Sub message id. The notification only
   * names the token, so the subscription is always re-read from Google.
   *
   * Throws StoreRejectedError (401) for a bad token, StoreConfigError when
   * push auth is not configured, StoreTransientError when Google could not
   * be reached (non-2xx makes Pub/Sub redeliver).
   */
  async handlePush(authorization: string | undefined, body: PubSubPushBody): Promise<WebhookOutcome> {
    await this.play.verifyPushToken(authorization);

    const messageId = body?.message?.messageId ?? body?.message?.message_id;
    let notification: any;
    try {
      notification = JSON.parse(Buffer.from(body?.message?.data ?? '', 'base64').toString('utf8'));
    } catch {
      notification = null;
    }
    if (!messageId || !notification || typeof notification !== 'object') {
      this.logger.warn('Play push without a message id or a readable payload ignored');
      return { received: true, status: 'ignored', note: 'unreadable message' };
    }

    const subNote = notification.subscriptionNotification;
    const voided = notification.voidedPurchaseNotification;
    const type = subNote
      ? GOOGLE_NOTIFICATION_TYPES[Number(subNote.notificationType)] ?? `SUBSCRIPTION_${subNote.notificationType}`
      : voided
        ? 'VOIDED_PURCHASE'
        : notification.testNotification
          ? 'TEST'
          : notification.oneTimeProductNotification
            ? 'ONE_TIME_PRODUCT'
            : 'UNKNOWN';
    const purchaseToken: string | null = subNote?.purchaseToken ?? voided?.purchaseToken ?? null;

    const claim = await this.purchases.claimNotification({
      platform: 'GOOGLE',
      source: 'NOTIFICATION',
      externalId: messageId,
      type,
      purchaseKey: purchaseToken,
      productId: subNote?.subscriptionId ?? null,
      payload: {
        notificationType: subNote?.notificationType ?? null,
        eventTimeMillis: notification.eventTimeMillis ?? null,
        packageName: notification.packageName ?? null,
        refundType: voided?.refundType ?? null,
        productType: voided?.productType ?? null,
      },
    });
    if (claim.duplicate) {
      return { received: true, status: 'duplicate' };
    }

    try {
      const outcome = await this.processNotification(notification, type, purchaseToken);
      await this.purchases.finishEvent(claim.eventId, outcome.status === 'processed' ? 'PROCESSED' : 'IGNORED', {
        note: outcome.note,
        userId: outcome.userId,
      });
      return { received: true, status: outcome.status, note: outcome.note };
    } catch (error: any) {
      await this.purchases
        .finishEvent(claim.eventId, 'FAILED', { note: String(error?.message ?? error).slice(0, 300) })
        .catch(() => undefined);
      throw error;
    }
  }

  private async processNotification(
    notification: any,
    type: string,
    purchaseToken: string | null,
  ): Promise<{ status: 'processed' | 'ignored'; note?: string; userId?: string | null }> {
    if (notification.packageName && notification.packageName !== this.play.packageName) {
      return { status: 'ignored', note: 'other package' };
    }
    if (type === 'TEST') return { status: 'ignored', note: 'test notification' };
    if (!purchaseToken) return { status: 'ignored', note: 'no purchase token' };

    if (type === 'VOIDED_PURCHASE') {
      const revoked = await this.purchases.revoke('GOOGLE', purchaseToken);
      return revoked
        ? { status: 'processed', userId: revoked.userId }
        : { status: 'ignored', note: 'unknown purchase' };
    }

    let sub: GoogleSubscriptionV2;
    try {
      sub = await this.play.getSubscription(purchaseToken);
    } catch (error) {
      if (error instanceof StoreRejectedError) return { status: 'ignored', note: 'token rejected by Google' };
      throw error;
    }
    const parsed = parseGoogleSubscription(sub);
    if (!parsed.product) return { status: 'ignored', note: 'unknown product' };

    const existing = await this.purchases.findPurchase('GOOGLE', purchaseToken);
    const userId = existing?.userId ?? (await this.purchases.existingUserId(parsed.obfuscatedAccountId));
    if (!userId) {
      // The app has not validated it yet; the validation will bind it.
      return { status: 'ignored', note: 'no account for this purchase yet' };
    }

    const result = await this.purchases.applySnapshot(userId, this.snapshot(purchaseToken, parsed));
    await this.acknowledgeIfPending(result.purchase, parsed);
    return { status: 'processed', userId };
  }
}

