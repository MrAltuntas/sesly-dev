import { Injectable, Logger } from '@nestjs/common';
import {
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
} from '@apple/app-store-server-library';
import { StorePurchaseState } from '../../../common/enums/prisma.enums';
import {
  findStoreProduct,
  StoreProduct,
} from '../../../common/constants/store-products.constants';
import { AppStoreClient } from './app-store.client';
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
import { AppleTransactionDto } from '../dto/apple-transaction.dto';
import { WebhookOutcome } from './google-play.service';

const AUTO_RENEWABLE = 'Auto-Renewable Subscription';

/** Notification types that end access at once / at the end of the period. */
const REVOKING_TYPES = new Set(['REFUND', 'REVOKE']);
const EXPIRING_TYPES = new Set(['EXPIRED', 'GRACE_PERIOD_EXPIRED']);

export interface ParsedAppleState {
  state: StorePurchaseState;
  expiresAt: Date | null;
  autoRenew: boolean;
  revokedAt: Date | null;
}

/**
 * State of one App Store subscription from its latest transaction and
 * renewal info (and the notification type, when there is one):
 *   - revocationDate, REFUND, REVOKE                       -> REVOKED
 *   - EXPIRED, GRACE_PERIOD_EXPIRED                        -> EXPIRED
 *   - expiresDate in the future                            -> ACTIVE, or CANCELED when auto-renew is off
 *   - past expiry, billing grace running (DID_FAIL_TO_RENEW GRACE_PERIOD) -> GRACE until gracePeriodExpiresDate
 *   - past expiry, in billing retry without grace          -> ON_HOLD (no access)
 *   - otherwise                                            -> EXPIRED
 */
export function parseAppleState(
  tx: JWSTransactionDecodedPayload,
  renewal: JWSRenewalInfoDecodedPayload | null,
  notificationType: string | null = null,
  now: Date = new Date(),
): ParsedAppleState {
  const expiresAt = tx.expiresDate ? new Date(tx.expiresDate) : null;
  const autoRenew = renewal ? renewal.autoRenewStatus === 1 : true;
  if (tx.revocationDate || (notificationType && REVOKING_TYPES.has(notificationType))) {
    return {
      state: 'REVOKED',
      expiresAt,
      autoRenew: false,
      revokedAt: tx.revocationDate ? new Date(tx.revocationDate) : now,
    };
  }
  if (notificationType && EXPIRING_TYPES.has(notificationType)) {
    return { state: 'EXPIRED', expiresAt, autoRenew: false, revokedAt: null };
  }
  if (expiresAt && expiresAt.getTime() > now.getTime()) {
    return { state: autoRenew ? 'ACTIVE' : 'CANCELED', expiresAt, autoRenew, revokedAt: null };
  }
  const graceEnd = renewal?.gracePeriodExpiresDate ? new Date(renewal.gracePeriodExpiresDate) : null;
  if (graceEnd && graceEnd.getTime() > now.getTime()) {
    return { state: 'GRACE', expiresAt: graceEnd, autoRenew, revokedAt: null };
  }
  if (renewal?.isInBillingRetryPeriod) {
    return { state: 'ON_HOLD', expiresAt, autoRenew, revokedAt: null };
  }
  return { state: 'EXPIRED', expiresAt, autoRenew, revokedAt: null };
}

function sameUser(a: string | null | undefined, b: string): boolean {
  return !!a && a.toLowerCase() === b.toLowerCase();
}

@Injectable()
export class AppStoreService {
  private readonly logger = new Logger(AppStoreService.name);

  constructor(
    private apple: AppStoreClient,
    private purchases: StorePurchasesService,
  ) {}

  /**
   * POST /subscriptions/apple/validate with a StoreKit 2 signed transaction.
   *
   * Order: JWS verified against the Apple roots, bundle id and environment
   * (400 RECEIPT_INVALID, 503 when Apple's checks are unreachable) ->
   * product (400 PRODUCT_UNKNOWN) -> appAccountToken of another account
   * (409 RECEIPT_IN_USE) -> binding (409) -> latest status from the App
   * Store Server API when configured -> write.
   */
  async validate(userId: string, dto: AppleTransactionDto) {
    if (!this.apple.isConfigured()) {
      this.logger.error('Apple validation called but no Apple root certificates / environment are configured');
      throw storeNotConfigured();
    }
    let tx: JWSTransactionDecodedPayload;
    try {
      tx = await this.apple.verifyTransaction(dto.signedTransaction);
    } catch (error) {
      throw toHttpError(error);
    }

    const product = findStoreProduct('APPLE', tx.productId);
    if (!product || (tx.type && tx.type !== AUTO_RENEWABLE)) {
      await this.purchases.recordEvent(
        { platform: 'APPLE', source: 'CLIENT', type: 'VALIDATE', productId: tx.productId ?? null, userId },
        'IGNORED',
        'unknown product',
      );
      throw productUnknown(tx.productId);
    }
    if (tx.appAccountToken && !sameUser(tx.appAccountToken, userId)) {
      this.logger.warn(`App Store purchase made for another account presented by user ${userId}`);
      throw receiptInUse();
    }
    const originalTransactionId = tx.originalTransactionId;
    if (!originalTransactionId) throw receiptInvalid();

    await this.purchases.assertNotOwnedByAnotherUser(userId, 'APPLE', originalTransactionId);

    const { latest, renewal } = await this.latestState(tx);
    const latestProduct = findStoreProduct('APPLE', latest.productId) ?? product;
    const snapshot = this.snapshot(originalTransactionId, latestProduct, latest, renewal, null, latest.signedDate);

    // A restore may hand over an older transaction of the same subscription:
    // it must not pull back an expiry we already know to be later.
    const existing = await this.purchases.findPurchase('APPLE', originalTransactionId);
    let result;
    if (
      existing?.expiresAt &&
      snapshot.expiresAt &&
      snapshot.state !== 'REVOKED' &&
      snapshot.expiresAt.getTime() < new Date(existing.expiresAt).getTime()
    ) {
      result = { purchase: existing, subscription: null as any, stale: true };
    } else {
      result = await this.purchases.applySnapshot(userId, snapshot);
    }

    await this.purchases.recordEvent(
      {
        platform: 'APPLE',
        source: 'CLIENT',
        type: 'VALIDATE',
        purchaseKey: originalTransactionId,
        productId: latestProduct.productId,
        userId,
        payload: {
          transactionId: latest.transactionId ?? null,
          state: snapshot.state,
          expiresAt: snapshot.expiresAt,
          environment: latest.environment ?? null,
          stale: result.stale,
        },
      },
      'PROCESSED',
    );

    return {
      purchase: result.purchase,
      subscription: result.subscription,
      entitled: isEntitling(result.purchase),
    };
  }

  /**
   * The newest state Apple has for this subscription. Without App Store
   * Server API credentials (or when the API fails) the verified transaction
   * itself is used.
   */
  private async latestState(
    tx: JWSTransactionDecodedPayload,
  ): Promise<{ latest: JWSTransactionDecodedPayload; renewal: JWSRenewalInfoDecodedPayload | null }> {
    if (!this.apple.hasServerApi() || !tx.originalTransactionId) return { latest: tx, renewal: null };
    try {
      const status = await this.apple.getLatestStatus(tx.originalTransactionId, String(tx.environment ?? ''));
      if (!status) return { latest: tx, renewal: null };
      const latest = status.signedTransactionInfo
        ? await this.apple.verifyTransaction(status.signedTransactionInfo)
        : tx;
      const renewal = status.signedRenewalInfo
        ? await this.apple.verifyRenewalInfo(status.signedRenewalInfo)
        : null;
      return { latest, renewal };
    } catch (error: any) {
      this.logger.warn(`App Store status lookup failed, using the client transaction: ${error?.message ?? error}`);
      return { latest: tx, renewal: null };
    }
  }

  private snapshot(
    originalTransactionId: string,
    product: StoreProduct,
    tx: JWSTransactionDecodedPayload,
    renewal: JWSRenewalInfoDecodedPayload | null,
    notificationType: string | null,
    signedDate: number | undefined,
  ): StorePurchaseSnapshot {
    const parsed = parseAppleState(tx, renewal, notificationType);
    return {
      platform: 'APPLE',
      purchaseKey: originalTransactionId,
      product,
      state: parsed.state,
      expiresAt: parsed.expiresAt,
      autoRenew: parsed.autoRenew,
      latestTransactionId: tx.transactionId ?? null,
      environment: tx.environment ? String(tx.environment) : null,
      acknowledged: true,
      revokedAt: parsed.revokedAt,
      storeTimestamp: signedDate ? new Date(signedDate) : null,
    };
  }

  /**
   * POST /webhooks/apple (App Store Server Notifications V2). Verified and
   * decoded with the Apple roots, idempotent on notificationUUID. Mapped:
   * SUBSCRIBED, DID_RENEW, DID_CHANGE_RENEWAL_STATUS, DID_CHANGE_RENEWAL_PREF,
   * OFFER_REDEEMED, RENEWAL_EXTENDED, REFUND_REVERSED (state from the signed
   * transaction + renewal info), DID_FAIL_TO_RENEW (GRACE with subtype
   * GRACE_PERIOD, else ON_HOLD), EXPIRED / GRACE_PERIOD_EXPIRED (EXPIRED),
   * REFUND / REVOKE (REVOKED). Others are recorded and ignored.
   *
   * Throws StoreRejectedError (400) for data that does not verify and
   * StoreTransientError (500, Apple retries) when verification could not run.
   */
  async handleNotification(body: { signedPayload?: unknown }): Promise<WebhookOutcome> {
    if (typeof body?.signedPayload !== 'string' || body.signedPayload.length === 0) {
      throw new StoreRejectedError('Missing signedPayload');
    }
    const decoded = await this.apple.verifyNotification(body.signedPayload);
    const type = String(decoded.notificationType ?? 'UNKNOWN');
    const subtype = decoded.subtype ? String(decoded.subtype) : null;
    const data = decoded.data;
    const tx = data?.signedTransactionInfo ? await this.apple.verifyTransaction(data.signedTransactionInfo) : null;
    const renewal = data?.signedRenewalInfo ? await this.apple.verifyRenewalInfo(data.signedRenewalInfo) : null;

    const claim = await this.purchases.claimNotification({
      platform: 'APPLE',
      source: 'NOTIFICATION',
      externalId: decoded.notificationUUID ?? null,
      type,
      subtype,
      purchaseKey: tx?.originalTransactionId ?? null,
      productId: tx?.productId ?? null,
      payload: {
        environment: data?.environment ?? null,
        signedDate: decoded.signedDate ?? null,
        transactionId: tx?.transactionId ?? null,
        expiresDate: tx?.expiresDate ?? null,
        revocationDate: tx?.revocationDate ?? null,
        autoRenewStatus: renewal?.autoRenewStatus ?? null,
        gracePeriodExpiresDate: renewal?.gracePeriodExpiresDate ?? null,
      },
    });
    if (claim.duplicate) return { received: true, status: 'duplicate' };

    try {
      const outcome = await this.processNotification(type, tx, renewal, decoded.signedDate);
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
    type: string,
    tx: JWSTransactionDecodedPayload | null,
    renewal: JWSRenewalInfoDecodedPayload | null,
    signedDate: number | undefined,
  ): Promise<{ status: 'processed' | 'ignored'; note?: string; userId?: string | null }> {
    if (type === 'TEST') return { status: 'ignored', note: 'test notification' };
    if (!tx?.originalTransactionId) return { status: 'ignored', note: 'no transaction' };
    const product = findStoreProduct('APPLE', tx.productId);
    if (!product) return { status: 'ignored', note: 'unknown product' };

    const existing = await this.purchases.findPurchase('APPLE', tx.originalTransactionId);
    const userId = existing?.userId ?? (await this.purchases.existingUserId(tx.appAccountToken));
    if (!userId) return { status: 'ignored', note: 'no account for this purchase yet' };

    const snapshot = this.snapshot(tx.originalTransactionId, product, tx, renewal, type, signedDate);
    const result = await this.purchases.applySnapshot(userId, snapshot);
    return result.stale
      ? { status: 'ignored', note: 'older than the stored state', userId }
      : { status: 'processed', userId };
  }
}
