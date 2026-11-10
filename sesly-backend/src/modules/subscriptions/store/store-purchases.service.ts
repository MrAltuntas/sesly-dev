import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  StoreEventStatus,
  StorePlatform,
  StorePurchaseState,
} from '../../../common/enums/prisma.enums';
import { StoreProduct } from '../../../common/constants/store-products.constants';
import { receiptInUse } from './store-errors';
import { recomputeSubscription } from './entitlement';

/** One store purchase as the store reports it right now, normalised. */
export interface StorePurchaseSnapshot {
  platform: StorePlatform;
  /** APPLE originalTransactionId, GOOGLE purchaseToken */
  purchaseKey: string;
  product: StoreProduct;
  state: StorePurchaseState;
  expiresAt: Date | null;
  autoRenew: boolean;
  latestTransactionId?: string | null;
  /** GOOGLE linkedPurchaseToken: the purchase this one replaces. */
  linkedPurchaseKey?: string | null;
  environment?: string | null;
  acknowledged?: boolean;
  revokedAt?: Date | null;
  /** Store time of this state; an older snapshot never overwrites a newer one. */
  storeTimestamp?: Date | null;
}

export interface ApplyResult {
  purchase: any;
  subscription: any;
  /** True when the snapshot was older than the stored state and was not applied. */
  stale: boolean;
}

export interface StoreEventInput {
  platform: StorePlatform;
  source: 'NOTIFICATION' | 'CLIENT';
  externalId?: string | null;
  type: string;
  subtype?: string | null;
  purchaseKey?: string | null;
  productId?: string | null;
  userId?: string | null;
  payload?: Record<string, unknown> | null;
}

/** Subscription columns that identify a store purchase (unique in the DB). */
const STORE_PURCHASE_FIELDS = [
  'purchaseKey',
  'appleOriginalTransactionId',
  'appleTransactionId',
  'googlePurchaseToken',
];

/**
 * Shared write path of both stores: account binding, the store_purchases
 * row, the Subscription row (through recomputeSubscription) and the
 * store_events audit / idempotency log.
 */
@Injectable()
export class StorePurchasesService {
  private readonly logger = new Logger(StorePurchasesService.name);

  constructor(private prisma: PrismaService) {}

  async findPurchase(platform: StorePlatform, purchaseKey: string) {
    return this.prisma.storePurchase.findUnique({
      where: { platform_purchaseKey: { platform, purchaseKey } },
    });
  }

  /**
   * 409 RECEIPT_IN_USE when the purchase is already bound to another Sesly
   * account (store_purchases, or the legacy columns on another user's
   * Subscription row). The same user presenting it again is fine.
   */
  async assertNotOwnedByAnotherUser(
    userId: string,
    platform: StorePlatform,
    purchaseKey: string,
  ): Promise<void> {
    const [purchase, legacy] = await Promise.all([
      this.findPurchase(platform, purchaseKey),
      this.prisma.subscription.findFirst({
        where:
          platform === 'APPLE'
            ? { appleOriginalTransactionId: purchaseKey }
            : { googlePurchaseToken: purchaseKey },
        select: { userId: true },
      }),
    ]);
    const owner = purchase?.userId ?? legacy?.userId;
    if (owner && owner !== userId) {
      this.logger.warn(`${platform} purchase bound to user ${owner}; refused for user ${userId}`);
      throw receiptInUse();
    }
  }

  /**
   * Write the snapshot for `userId` and recompute their Subscription row.
   * The binding is enforced again here (unique platform + purchaseKey), so a
   * concurrent claim by another account still ends in RECEIPT_IN_USE.
   */
  async applySnapshot(userId: string, snapshot: StorePurchaseSnapshot): Promise<ApplyResult> {
    await this.assertNotOwnedByAnotherUser(userId, snapshot.platform, snapshot.purchaseKey);

    const existing = await this.findPurchase(snapshot.platform, snapshot.purchaseKey);
    if (
      existing?.storeUpdatedAt &&
      snapshot.storeTimestamp &&
      snapshot.storeTimestamp.getTime() < new Date(existing.storeUpdatedAt).getTime()
    ) {
      this.logger.log(`Stale ${snapshot.platform} snapshot ignored for purchase ${existing.id}`);
      const subscription = await this.prisma.subscription.findUnique({ where: { userId } });
      return { purchase: existing, subscription, stale: true };
    }

    const data = {
      productId: snapshot.product.productId,
      plan: snapshot.product.plan,
      billingPeriod: snapshot.product.period,
      state: snapshot.state,
      expiresAt: snapshot.expiresAt,
      autoRenew: snapshot.autoRenew,
      latestTransactionId: snapshot.latestTransactionId ?? existing?.latestTransactionId ?? null,
      linkedPurchaseKey: snapshot.linkedPurchaseKey ?? existing?.linkedPurchaseKey ?? null,
      environment: snapshot.environment ?? existing?.environment ?? null,
      acknowledged: snapshot.acknowledged ?? existing?.acknowledged ?? false,
      revokedAt: snapshot.revokedAt ?? existing?.revokedAt ?? null,
      storeUpdatedAt: snapshot.storeTimestamp ?? new Date(),
    };

    let purchase;
    try {
      purchase = await this.prisma.storePurchase.upsert({
        where: {
          platform_purchaseKey: { platform: snapshot.platform, purchaseKey: snapshot.purchaseKey },
        },
        create: { userId, platform: snapshot.platform, purchaseKey: snapshot.purchaseKey, ...data },
        update: data,
      });
    } catch (error) {
      if (this.isStorePurchaseUniqueViolation(error)) throw receiptInUse();
      throw error;
    }

    // Google: the new token replaces the old one (upgrade, downgrade,
    // resubscribe). The old purchase must stop granting anything.
    if (snapshot.linkedPurchaseKey) {
      await this.markReplaced(snapshot.platform, snapshot.linkedPurchaseKey, purchase.id);
    }

    let subscription;
    try {
      subscription = await recomputeSubscription(this.prisma, userId);
    } catch (error) {
      if (this.isStorePurchaseUniqueViolation(error)) throw receiptInUse();
      throw error;
    }
    return { purchase, subscription, stale: false };
  }

  /** The purchase stops granting (refund / void) and the owner's row follows. */
  async revoke(platform: StorePlatform, purchaseKey: string, at: Date = new Date()): Promise<any | null> {
    const existing = await this.findPurchase(platform, purchaseKey);
    if (!existing) return null;
    const purchase = await this.prisma.storePurchase.update({
      where: { id: existing.id },
      data: { state: 'REVOKED', revokedAt: at, autoRenew: false, storeUpdatedAt: at },
    });
    await recomputeSubscription(this.prisma, existing.userId);
    return purchase;
  }

  async markAcknowledged(purchaseId: string): Promise<void> {
    await this.prisma.storePurchase.update({
      where: { id: purchaseId },
      data: { acknowledged: true },
    });
  }

  private async markReplaced(platform: StorePlatform, oldKey: string, newPurchaseId: string) {
    const old = await this.findPurchase(platform, oldKey);
    if (!old || old.id === newPurchaseId) return;
    await this.prisma.storePurchase.update({
      where: { id: old.id },
      data: { state: 'REPLACED', autoRenew: false },
    });
    // The old token may belong to another account (the same store account
    // used on two Sesly accounts): its row must lose the entitlement too.
    await recomputeSubscription(this.prisma, old.userId);
  }

  private isStorePurchaseUniqueViolation(error: unknown): boolean {
    const known = error as { code?: unknown; meta?: { target?: unknown } } | null;
    if (known?.code !== 'P2002') return false;
    const target = known.meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    return fields.some((field) => STORE_PURCHASE_FIELDS.some((name) => field.includes(name)));
  }

  // -------------------------------------------------------------------------
  // store_events
  // -------------------------------------------------------------------------

  /**
   * Record an incoming server notification once. A replay of an id that was
   * already handled (PROCESSED / IGNORED) returns duplicate = true and must
   * not be processed again; a FAILED or unfinished one may be retried.
   */
  async claimNotification(input: StoreEventInput): Promise<{ eventId: string; duplicate: boolean }> {
    try {
      const event = await this.prisma.storeEvent.create({ data: this.eventData(input) });
      return { eventId: event.id, duplicate: false };
    } catch (error: any) {
      if (error?.code !== 'P2002' || !input.externalId) throw error;
      const existing = await this.prisma.storeEvent.findUnique({
        where: { platform_externalId: { platform: input.platform, externalId: input.externalId } },
      });
      if (!existing) throw error;
      const done = existing.status === 'PROCESSED' || existing.status === 'IGNORED';
      return { eventId: existing.id, duplicate: done };
    }
  }

  async recordEvent(input: StoreEventInput, status: StoreEventStatus, note?: string): Promise<void> {
    try {
      await this.prisma.storeEvent.create({
        data: { ...this.eventData(input), status, note: note ?? null, processedAt: new Date() },
      });
    } catch (error: any) {
      // Audit only: never fail a purchase because the log write failed.
      this.logger.warn(`Store event not recorded: ${error?.message ?? error}`);
    }
  }

  async finishEvent(
    eventId: string,
    status: StoreEventStatus,
    update: { note?: string; userId?: string | null; purchaseKey?: string | null; productId?: string | null } = {},
  ): Promise<void> {
    await this.prisma.storeEvent.update({
      where: { id: eventId },
      data: {
        status,
        note: update.note ?? null,
        ...(update.userId !== undefined ? { userId: update.userId } : {}),
        ...(update.purchaseKey !== undefined ? { purchaseKey: update.purchaseKey } : {}),
        ...(update.productId !== undefined ? { productId: update.productId } : {}),
        processedAt: new Date(),
      },
    });
  }

  private eventData(input: StoreEventInput) {
    return {
      platform: input.platform,
      source: input.source,
      externalId: input.externalId ?? null,
      type: input.type,
      subtype: input.subtype ?? null,
      purchaseKey: input.purchaseKey ?? null,
      productId: input.productId ?? null,
      userId: input.userId ?? null,
      payload: (input.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    };
  }

  /** A user id from a store field (appAccountToken / obfuscated id) that really exists. */
  async existingUserId(candidate: string | null | undefined): Promise<string | null> {
    if (!candidate || !/^[0-9a-f-]{36}$/i.test(candidate)) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: candidate.toLowerCase() },
      select: { id: true },
    });
    return user?.id ?? null;
  }
}
