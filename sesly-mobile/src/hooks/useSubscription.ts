/**
 * Subscription Hook with MobX Store
 *
 * The plan the user is on, read from the backend: GET /subscriptions/current
 * (the effective plan, where it comes from, the store product and the
 * management address) and GET /usage (allowances). Buying and restoring
 * live in `stores/PurchaseStore`, which calls `refresh()` after the backend
 * granted a purchase.
 *
 * The store makes no request on its own: RootNavigator seeds the tier from
 * the signed-in user and calls `refresh()` (GET /subscriptions/current and
 * GET /usage, once each).
 */

import {makeAutoObservable, observable, runInAction} from 'mobx';
import {useMemo} from 'react';
import ApiClient from '../services/ApiClient';
import {hasApiStatus} from '../services/ApiError';
import {
    SubscriptionStatus,
    SubscriptionTier,
    parseSubscriptionTier,
} from '../types/enums';
import {parseCurrentSubscriptionResponse, type SubscriptionSource} from '../models/Subscription';
import {PlanId, planIdForTier} from '../models/Plans';
import {UsageSummary, parseUsageSummary} from '../models/Quota';
import {showToast} from '../utils/toast';
import { msg } from '../i18n/messages';

export {parseCurrentSubscriptionResponse};

/** loadUsageSoon waits this long, so a burst of events costs one GET /usage. */
export const USAGE_SOON_DELAY_MS = 2000;

/** Usage older than this is asked for again when a screen shows it. */
export const USAGE_STALE_MS = 60 * 1000;

// ============================================================================
// Subscription Store (MobX)
// ============================================================================

class SubscriptionStore {
    // Observable state - Subscription
    currentTier: SubscriptionTier = SubscriptionTier.FREE;
    subscriptionStatus: SubscriptionStatus | null = null;
    currentPeriodEnd: Date | null = null;
    /** Where the plan comes from (APPLE, GOOGLE, ADMIN, STRIPE); null on the free plan. */
    source: SubscriptionSource | null = null;
    /** The store product of a store subscription. */
    storeProductId: string | null = null;
    /** The store's page for managing the subscription (backend). */
    managementUrl: string | null = null;
    /** The plan ends with the period (renewal turned off). */
    cancelAtPeriodEnd = false;

    // Observable state - Loading
    isLoading = false;

    // Observable state - Error
    errorMessage = '';

    // Observable state - Usage (GET /usage)
    usage: UsageSummary | null = null;
    /** Date.now() of the last usage that was read; null until then. */
    usageLoadedAt: number | null = null;
    /** The last GET /usage failed (the previous `usage` is kept). */
    usageError = false;

    /** Bumped by reset(): a response that lands after it is dropped. */
    private epoch = 0;
    private usagePromise: Promise<void> | null = null;
    private usageSoonTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        makeAutoObservable<this, 'epoch' | 'usagePromise' | 'usageSoonTimer'>(this, {
            epoch: false,
            usagePromise: false,
            usageSoonTimer: false,
            usage: observable.ref,
        });
    }

    // ==========================================================================
    // Computed Getters
    // ==========================================================================

    /** The plan the user is on: GET /usage when it answered, else the tier. */
    get planId(): PlanId {
        return this.usage?.planId ?? planIdForTier(this.currentTier);
    }

    /** Any paid plan (Mini, Premium). */
    get isPaid(): boolean {
        return this.planId !== 'free';
    }

    /** Background playback and lock-screen controls. */
    get canPlayInBackground(): boolean {
        return this.usage?.features.backgroundPlayback ?? this.isPaid;
    }

    /** Stories flagged premium can be played. */
    get hasPremiumStories(): boolean {
        return this.usage?.features.premiumStories ?? this.isPaid;
    }

    /** Premium (or Creator): no bigger plan to offer. */
    get isPremiumPlan(): boolean {
        return this.planId === 'premium';
    }

    /** True when there is no usage yet or it is older than `maxAgeMs`. */
    isUsageStale(maxAgeMs: number = USAGE_STALE_MS): boolean {
        return this.usageLoadedAt === null || Date.now() - this.usageLoadedAt > maxAgeMs;
    }

    /**
     * Seed the tier from the user payload (GET /users/me subscriptionTier)
     * so gating is right before /subscriptions/current has answered.
     */
    setTierFromUser(tier: SubscriptionTier | string | null | undefined): void {
        this.currentTier = parseSubscriptionTier(tier);
    }

    /** Sign-out: back to FREE, usage forgotten, late responses dropped. */
    reset(): void {
        this.epoch += 1;
        this.currentTier = SubscriptionTier.FREE;
        this.subscriptionStatus = null;
        this.currentPeriodEnd = null;
        this.clearStoreFields();
        this.errorMessage = '';
        this.usage = null;
        this.usageLoadedAt = null;
        this.usageError = false;
        this.usagePromise = null;
        this.cancelUsageSoon();
    }

    async cleanup(): Promise<void> {
        this.cancelUsageSoon();
    }

    /** A plan bought in the App Store or Google Play (not an admin grant). */
    get hasStoreSubscription(): boolean {
        return this.isPaid && (this.source === 'APPLE' || this.source === 'GOOGLE');
    }

    private clearStoreFields(): void {
        this.source = null;
        this.storeProductId = null;
        this.managementUrl = null;
        this.cancelAtPeriodEnd = false;
    }

    // ==========================================================================
    // Load Current Subscription
    // ==========================================================================

    async loadCurrentSubscription(): Promise<void> {
        const epoch = this.epoch;
        try {
            runInAction(() => {
                this.isLoading = true;
                this.errorMessage = '';
            });

            const response = await ApiClient.get<unknown>('/subscriptions/current');
            if (epoch !== this.epoch) return;
            const parsed = parseCurrentSubscriptionResponse(response);

            runInAction(() => {
                this.currentTier = parsed.tier;
                this.subscriptionStatus = parsed.status;
                this.currentPeriodEnd = parsed.currentPeriodEnd;
                this.source = parsed.source;
                this.storeProductId = parsed.productId;
                this.managementUrl = parsed.managementUrl;
                this.cancelAtPeriodEnd = parsed.cancelAtPeriodEnd;
            });
        } catch (error) {
            if (epoch !== this.epoch) return;
            // No subscription row yet means the user is on the free plan.
            if (hasApiStatus(error, 404)) {
                runInAction(() => {
                    this.currentTier = SubscriptionTier.FREE;
                    this.subscriptionStatus = null;
                    this.currentPeriodEnd = null;
                    this.clearStoreFields();
                });
                return;
            }
            // 401 = no/expired session; the session-expiry flow handles it.
            if (hasApiStatus(error, 401)) return;
            console.error('Subscription load failed:', error);
            runInAction(() => {
                this.errorMessage = msg('subscription.loadFailed');
            });
        } finally {
            runInAction(() => {
                this.isLoading = false;
            });
        }
    }

    // ==========================================================================
    // Load Usage (GET /usage)
    // ==========================================================================

    /**
     * Read the allowances of the user's plan. One request at a time: a call
     * while one is in flight shares it. 401 stays silent (the session flow
     * handles it); any other failure, or a body that cannot be read, keeps
     * the previous `usage` and sets `usageError`.
     */
    loadUsage(): Promise<void> {
        if (this.usagePromise) return this.usagePromise;
        const run: Promise<void> = this.fetchUsage(this.epoch).finally(() => {
            if (this.usagePromise === run) this.usagePromise = null;
        });
        this.usagePromise = run;
        return run;
    }

    private async fetchUsage(epoch: number): Promise<void> {
        try {
            const response = await ApiClient.get<unknown>('/usage');
            if (epoch !== this.epoch) return;
            const parsed = parseUsageSummary(response);
            if (!parsed) {
                console.warn('Usage response could not be read');
                runInAction(() => {
                    this.usageError = true;
                });
                return;
            }
            runInAction(() => {
                this.usage = parsed;
                this.usageLoadedAt = Date.now();
                this.usageError = false;
            });
        } catch (error) {
            if (epoch !== this.epoch) return;
            if (hasApiStatus(error, 401)) return;
            console.error('Usage load failed:', error);
            runInAction(() => {
                this.usageError = true;
            });
        }
    }

    /**
     * loadUsage after USAGE_SOON_DELAY_MS, restarted by every call: after a
     * narration starts, a quota 403 or a voice creation, when the backend
     * counter has just moved.
     */
    loadUsageSoon(): void {
        this.cancelUsageSoon();
        this.usageSoonTimer = setTimeout(() => {
            this.usageSoonTimer = null;
            void this.loadUsage();
        }, USAGE_SOON_DELAY_MS);
    }

    /** loadUsage when the usage is missing or older than `maxAgeMs` (a screen comes into view). */
    loadUsageIfStale(maxAgeMs: number = USAGE_STALE_MS): Promise<void> {
        return this.isUsageStale(maxAgeMs) ? this.loadUsage() : Promise.resolve();
    }

    private cancelUsageSoon(): void {
        if (this.usageSoonTimer) {
            clearTimeout(this.usageSoonTimer);
            this.usageSoonTimer = null;
        }
    }

    // ==========================================================================
    // Cancel / Reactivate
    // ==========================================================================

    async cancelSubscription(): Promise<void> {
        try {
            runInAction(() => {
                this.isLoading = true;
            });
            await ApiClient.post('/subscriptions/cancel');
            showToast.info(msg('subscription.cancelScheduled'), msg('subscription.cancelledTitle'));
            await this.loadCurrentSubscription();
        } catch (error) {
            console.error('Subscription cancel failed:', error);
            showToast.error(msg('subscription.cancelFailed'));
        } finally {
            runInAction(() => {
                this.isLoading = false;
            });
        }
    }

    async reactivateSubscription(): Promise<void> {
        try {
            runInAction(() => {
                this.isLoading = true;
            });
            await ApiClient.post('/subscriptions/reactivate');
            showToast.success(msg('subscription.reactivated'));
            await this.loadCurrentSubscription();
        } catch (error) {
            console.error('Subscription reactivate failed:', error);
            showToast.error(msg('subscription.reactivateFailed'));
        } finally {
            runInAction(() => {
                this.isLoading = false;
            });
        }
    }

    // ==========================================================================
    // Refresh
    // ==========================================================================

    async refresh(): Promise<void> {
        await Promise.all([this.loadCurrentSubscription(), this.loadUsage()]);
    }
}

// ============================================================================
// Hook Export (Singleton Pattern)
// ============================================================================

let subscriptionStoreInstance: SubscriptionStore | null = null;

export function getSubscriptionStore(): SubscriptionStore {
    if (!subscriptionStoreInstance) {
        subscriptionStoreInstance = new SubscriptionStore();
    }
    return subscriptionStoreInstance;
}

export function useSubscription(): SubscriptionStore {
    return useMemo(getSubscriptionStore, []);
}

// Export for testing or direct access
export {SubscriptionStore};
