/**
 * In-app purchases: the store connection, the store's products and prices,
 * buying, restoring, and the hand-over of every purchase to the backend.
 *
 * Library: expo-iap (Google Play Billing 9 on Android, StoreKit 2 on iOS),
 * reached through `services/iap/storeBilling` so a build without it shows
 * "purchases are not available" instead of crashing.
 *
 * The contract (sesly-backend CLAUDE.md, "Plans, limits and in-app
 * purchases"):
 * - A purchase carries the Sesly user id: `obfuscatedAccountId` on Android,
 *   `appAccountToken` on iOS.
 * - Every purchase goes to the backend (`validatePurchase`). The store
 *   transaction is finished (acknowledged on Android) only after a 200 or a
 *   4xx; on a 503 (or no connection) it is kept and sent again on the next
 *   start and whenever the app comes back to the foreground. Google refunds
 *   a purchase nobody acknowledged within three days; the backend
 *   acknowledges on its own as well.
 * - A Google "pending" purchase (cash, slow card) is never validated or
 *   finished until it turns into a real purchase; the screen says it waits.
 *
 * Wiring: `usePurchaseBridge` (RootNavigator) starts the store with the
 * signed-in user and stops it on sign-out; the plans screen reads the state
 * and calls `buy`, `restore`, `retry` and `manageSubscriptions`.
 */

import { AppState, type AppStateStatus, Linking } from 'react-native';
import { makeAutoObservable, observable, runInAction } from 'mobx';
import type { Purchase, PurchaseError, ProductSubscription } from 'expo-iap';

import { BillingPeriod, PlanId } from '../models/Plans';
import { getSubscriptionStore } from '../hooks/useSubscription';
import { msg } from '../i18n/messages';
import { showToast } from '../utils/toast';
import { recordNonFatal } from '../services/crashReporting';
import { loadBilling, storePlatform, type BillingModule } from '../services/iap/storeBilling';
import {
  ANDROID_PACKAGE_NAME,
  allProductIds,
  isSeslyProduct,
  planChange,
  productIdFor,
  replacementModeFor,
  type PlanChange,
  type StorePlatform,
} from '../services/iap/storeProducts';
import { RECEIPT_ERROR_CODES, validatePurchase, type ValidationOutcome } from '../services/iap/validatePurchase';

/** The store connection. */
export type BillingState = 'idle' | 'connecting' | 'ready' | 'unavailable';

/** The store's products: `empty` when the store answered without ours (no Play products yet). */
export type ProductsState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

/**
 * Where a purchase started on the plans screen stands:
 * - purchasing: the store's sheet is up
 * - verifying: the backend is checking it
 * - pending: the store waits for the payment (Google pending purchase)
 * - deferred: paid, but the backend could not check it yet (kept, retried)
 * - success: the backend granted the plan
 */
export type PurchaseFlow = 'idle' | 'purchasing' | 'verifying' | 'pending' | 'deferred' | 'success';

/** A store product as the plans screen needs it. */
export interface StoreProduct {
  readonly productId: string;
  /** The store's own localised price ("₺199,99", "199,99 TL"). */
  readonly displayPrice: string;
  /** ISO 4217 currency of the storefront ("TRY", "EUR"); null when the store sent none. */
  readonly currency: string | null;
  /** Android: the offer token of the base plan, required to buy it. */
  readonly offerToken: string | null;
}

/** Where a purchase reached the store from. */
type PurchaseOrigin = 'listener' | 'flush' | 'restore';

/** Store errors that mean "the store cannot sell this here". */
const UNAVAILABLE_CODES = new Set<string>([
  'item-unavailable',
  'sku-not-found',
  'sku-offer-mismatch',
  'billing-unavailable',
  'iap-not-available',
  'feature-not-supported',
  'developer-error',
  'not-prepared',
  'init-connection',
]);

/** Store errors that are about the connection. */
const NETWORK_CODES = new Set<string>([
  'network-error',
  'service-error',
  'service-timeout',
  'service-disconnected',
  'remote-error',
  'connection-closed',
]);

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }
  return 'unknown';
}

/**
 * The base plan offer of an Android subscription: the offer with a single
 * pricing phase (no free trial or intro price in front of it); else the
 * first offer.
 */
export function baseOfferToken(product: ProductSubscription): string | null {
  const offers = product.subscriptionOffers ?? [];
  const withToken = offers.filter(offer => !!offer.offerTokenAndroid);
  const base =
    withToken.find(offer => (offer.pricingPhasesAndroid?.pricingPhaseList?.length ?? 1) <= 1) ??
    withToken[0];
  return base?.offerTokenAndroid ?? null;
}

function basePrice(product: ProductSubscription): string {
  const offers = product.subscriptionOffers ?? [];
  const token = baseOfferToken(product);
  const offer = token ? offers.find(item => item.offerTokenAndroid === token) : undefined;
  return offer?.displayPrice || product.displayPrice;
}

function currencyOf(product: ProductSubscription): string | null {
  const code = (product as { currency?: unknown }).currency;
  return typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : null;
}

export function toStoreProduct(product: ProductSubscription, platform: StorePlatform): StoreProduct | null {
  if (!product?.id) return null;
  const currency = currencyOf(product);
  if (product.platform === 'android' && product.productStatusAndroid && product.productStatusAndroid !== 'ok') {
    return null;
  }
  if (platform === 'android') {
    const offerToken = baseOfferToken(product);
    if (!offerToken) return null;
    return { productId: product.id, displayPrice: basePrice(product), currency, offerToken };
  }
  return { productId: product.id, displayPrice: product.displayPrice, currency, offerToken: null };
}

export class PurchaseStore {
  billing: BillingState = 'idle';
  productsState: ProductsState = 'idle';
  products: Readonly<Record<string, StoreProduct>> = {};
  flow: PurchaseFlow = 'idle';
  /** The product the current flow is about. */
  flowProductId: string | null = null;
  restoring = false;
  /** Purchases paid but not validated yet (kept for a retry). */
  keptCount = 0;

  private userId: string | null = null;
  /** Bumped by stop(): work of an older session is dropped. */
  private epoch = 0;
  private listeners: Array<{ remove: () => void }> = [];
  private appStateSub: { remove: () => void } | null = null;
  private appState: AppStateStatus = AppState.currentState;
  /** Purchase tokens being validated right now. */
  private inFlight = new Set<string>();
  /** Paid purchases the backend could not check yet, by token. */
  private kept = new Map<string, Purchase>();
  /** Tokens the backend gave a verdict on in this session (a flush skips them). */
  private settled = new Set<string>();
  /** The store's active purchases of our products (Android: the token a plan change replaces). */
  private owned: Purchase[] = [];
  private connectPromise: Promise<void> | null = null;

  constructor() {
    makeAutoObservable<
      this,
      | 'userId'
      | 'epoch'
      | 'listeners'
      | 'appStateSub'
      | 'appState'
      | 'inFlight'
      | 'kept'
      | 'settled'
      | 'owned'
      | 'connectPromise'
    >(this, {
      userId: false,
      epoch: false,
      listeners: false,
      appStateSub: false,
      appState: false,
      inFlight: false,
      kept: false,
      settled: false,
      owned: false,
      connectPromise: false,
      products: observable.ref,
    });
  }

  // ==========================================================================
  // Derived state
  // ==========================================================================

  get platform(): StorePlatform | null {
    return storePlatform();
  }

  /** The store can sell: connected and our products are known. */
  get canBuy(): boolean {
    return this.billing === 'ready' && this.productsState === 'ready';
  }

  /** A purchase is being made or checked: the buttons wait. */
  get isBusy(): boolean {
    return this.flow === 'purchasing' || this.flow === 'verifying';
  }

  /** The storefront's currency, from the first product that names one; null before the products. */
  get storeCurrency(): string | null {
    for (const product of Object.values(this.products)) {
      if (product.currency) return product.currency;
    }
    return null;
  }

  /** The store product of a plan and period on this platform, when loaded. */
  productFor(plan: PlanId, period: BillingPeriod): StoreProduct | null {
    const platform = this.platform;
    if (!platform) return null;
    const id = productIdFor(plan, period, platform);
    return id ? this.products[id] ?? null : null;
  }

  // ==========================================================================
  // Session
  // ==========================================================================

  /**
   * Connect for a signed-in user: listeners, products, and the purchases a
   * previous run left unfinished. Calling it again for the same user only
   * retries what failed.
   */
  start(userId: string): Promise<void> {
    if (this.userId !== userId) {
      this.stop();
      this.userId = userId;
    }
    if (!this.appStateSub) {
      this.appStateSub = AppState.addEventListener('change', this.onAppStateChange);
    }
    return this.connect();
  }

  /** Sign-out: listeners off, the connection closed, everything forgotten. */
  stop(): void {
    this.epoch += 1;
    this.listeners.forEach(sub => sub.remove());
    this.listeners = [];
    this.appStateSub?.remove();
    this.appStateSub = null;
    const billing = loadBilling();
    if (billing && this.billing === 'ready') {
      billing.endConnection().catch(error => console.warn('[iap] endConnection failed:', error));
    }
    this.userId = null;
    this.inFlight.clear();
    this.kept.clear();
    this.settled.clear();
    this.owned = [];
    this.connectPromise = null;
    this.billing = 'idle';
    this.productsState = 'idle';
    this.products = {};
    this.flow = 'idle';
    this.flowProductId = null;
    this.restoring = false;
    this.keptCount = 0;
  }

  private onAppStateChange = (next: AppStateStatus): void => {
    const previous = this.appState;
    this.appState = next;
    if (next === 'active' && previous !== 'active' && this.billing === 'ready') {
      void this.flushUnfinished();
    }
  };

  private connect(): Promise<void> {
    if (this.billing === 'ready') {
      // Connected: only what failed is asked again.
      const work: Promise<void>[] = [this.flushUnfinished()];
      if (this.productsState !== 'ready' && this.productsState !== 'loading') work.push(this.loadProducts());
      return Promise.all(work).then(() => undefined);
    }
    if (this.connectPromise) return this.connectPromise;
    const run = this.openConnection().finally(() => {
      if (this.connectPromise === run) this.connectPromise = null;
    });
    this.connectPromise = run;
    return run;
  }

  private async openConnection(): Promise<void> {
    const billing = loadBilling();
    if (!billing || !this.platform) {
      runInAction(() => {
        this.billing = 'unavailable';
      });
      return;
    }
    const epoch = this.epoch;
    runInAction(() => {
      this.billing = 'connecting';
    });
    this.attachListeners(billing);
    try {
      const connected = await billing.initConnection();
      if (epoch !== this.epoch) return;
      if (connected === false) throw new Error('Store connection refused');
    } catch (error) {
      if (epoch !== this.epoch) return;
      console.warn('[iap] store connection failed:', error);
      runInAction(() => {
        this.billing = 'unavailable';
      });
      return;
    }
    runInAction(() => {
      this.billing = 'ready';
    });
    await Promise.all([this.loadProducts(), this.flushUnfinished()]);
  }

  private attachListeners(billing: BillingModule): void {
    if (this.listeners.length > 0) return;
    this.listeners.push(
      billing.purchaseUpdatedListener(purchase => {
        void this.onPurchaseUpdated(purchase);
      }),
      billing.purchaseErrorListener(error => {
        this.onPurchaseError(error);
      }),
    );
  }

  // ==========================================================================
  // Products
  // ==========================================================================

  async loadProducts(): Promise<void> {
    const billing = loadBilling();
    const platform = this.platform;
    if (!billing || !platform || this.billing !== 'ready') return;
    const epoch = this.epoch;
    runInAction(() => {
      this.productsState = 'loading';
    });
    try {
      const result = await billing.fetchProducts({ skus: allProductIds(platform), type: 'subs' });
      if (epoch !== this.epoch) return;
      const next: Record<string, StoreProduct> = {};
      for (const item of (result ?? []) as ProductSubscription[]) {
        const product = toStoreProduct(item, platform);
        if (product && isSeslyProduct(product.productId)) next[product.productId] = product;
      }
      runInAction(() => {
        this.products = next;
        this.productsState = Object.keys(next).length > 0 ? 'ready' : 'empty';
      });
    } catch (error) {
      if (epoch !== this.epoch) return;
      console.warn('[iap] products could not be loaded:', error);
      runInAction(() => {
        this.productsState = 'error';
      });
    }
  }

  /** The "Yeniden dene" of the plans screen: connect again or ask for the products again. */
  retry(): Promise<void> {
    if (!this.userId) return Promise.resolve();
    if (this.billing === 'unavailable' || this.billing === 'idle') {
      runInAction(() => {
        this.billing = 'idle';
      });
      return this.connect();
    }
    return this.loadProducts();
  }

  // ==========================================================================
  // Buying
  // ==========================================================================

  /**
   * Buy a plan. On Android a user who already has one of our subscriptions
   * in this Google account replaces it (an upgrade now and prorated, a
   * downgrade at the next renewal); on iOS the App Store does the same
   * inside the subscription group. The result arrives through the purchase
   * listener.
   */
  async buy(plan: PlanId, period: BillingPeriod): Promise<void> {
    const billing = loadBilling();
    const platform = this.platform;
    const userId = this.userId;
    if (!billing || !platform || !userId || this.isBusy) return;
    const productId = productIdFor(plan, period, platform);
    const product = productId ? this.products[productId] : undefined;
    if (!productId || !product) {
      showToast.error(msg('purchases.unavailable'));
      return;
    }

    runInAction(() => {
      this.flow = 'purchasing';
      this.flowProductId = productId;
    });

    try {
      if (platform === 'android') {
        const current = await this.currentStorePurchase();
        const change: PlanChange | null = current ? planChange(current.productId, productId) : null;
        if (current && change === 'same') {
          // Already this product in this Google account: nothing to buy.
          runInAction(() => {
            this.flow = 'idle';
            this.flowProductId = null;
          });
          showToast.info(msg('purchases.alreadyOwned'));
          void this.restore({ quiet: true, syncStore: false });
          return;
        }
        await billing.requestPurchase({
          type: 'subs',
          request: {
            google: {
              skus: [productId],
              obfuscatedAccountId: userId,
              subscriptionOffers: product.offerToken ? [{ sku: productId, offerToken: product.offerToken }] : [],
              ...(current && change
                ? {
                    purchaseToken: current.purchaseToken ?? null,
                    subscriptionProductReplacementParams: {
                      oldProductId: current.productId,
                      replacementMode: replacementModeFor(change),
                    },
                  }
                : {}),
            },
          },
        });
      } else {
        await billing.requestPurchase({
          type: 'subs',
          request: { apple: { sku: productId, appAccountToken: userId } },
        });
      }
    } catch (error) {
      this.onPurchaseError(error);
    }
  }

  /** Android: this Google account's active subscription of ours, if any. */
  private async currentStorePurchase(): Promise<Purchase | null> {
    await this.refreshOwned();
    return (
      this.owned.find(
        purchase =>
          purchase.purchaseState === 'purchased' &&
          !!purchase.purchaseToken &&
          (!('obfuscatedAccountIdAndroid' in purchase) ||
            !purchase.obfuscatedAccountIdAndroid ||
            purchase.obfuscatedAccountIdAndroid === this.userId),
      ) ?? null
    );
  }

  private async refreshOwned(): Promise<Purchase[]> {
    const billing = loadBilling();
    if (!billing || this.billing !== 'ready') return [];
    try {
      const purchases = await billing.getAvailablePurchases(
        this.platform === 'ios' ? { onlyIncludeActiveItemsIOS: true } : undefined,
      );
      this.owned = (purchases ?? []).filter(purchase => isSeslyProduct(purchase.productId));
    } catch (error) {
      console.warn('[iap] available purchases could not be read:', error);
    }
    return this.owned;
  }

  private async onPurchaseUpdated(purchase: Purchase): Promise<void> {
    if (!purchase || !isSeslyProduct(purchase.productId)) return;
    if (purchase.purchaseState === 'pending') {
      // Paid later (cash, slow card): nothing to check or finish yet; the
      // store sends the purchase again once it is paid.
      if (this.flow === 'purchasing' || this.flowProductId === purchase.productId) {
        runInAction(() => {
          this.flow = 'pending';
          this.flowProductId = purchase.productId;
        });
      }
      return;
    }
    await this.processPurchase(purchase, 'listener');
  }

  private onPurchaseError(error: PurchaseError | unknown): void {
    const code = errorCode(error);
    const inFlow = this.flow === 'purchasing';
    if (!inFlow) {
      // Not about a purchase the user is making now (a replay, a restore).
      console.warn('[iap] store error outside a purchase:', code);
      return;
    }
    const productId = this.flowProductId;
    const back = () =>
      runInAction(() => {
        this.flow = 'idle';
        this.flowProductId = null;
      });

    if (code === 'user-cancelled') {
      back();
      return;
    }
    if (code === 'pending' || code === 'deferred-payment') {
      runInAction(() => {
        this.flow = 'pending';
      });
      return;
    }
    back();
    if (code === 'already-owned' || code === 'duplicate-purchase') {
      showToast.info(msg('purchases.alreadyOwned'));
      void this.restore({ quiet: true, syncStore: false });
      return;
    }
    if (NETWORK_CODES.has(code)) {
      showToast.error(msg('purchases.storeNetwork'));
      return;
    }
    if (UNAVAILABLE_CODES.has(code)) {
      showToast.error(msg('purchases.unavailable'));
      recordNonFatal(error, 'purchase', { step: 'request', code, product: productId });
      return;
    }
    showToast.error(msg('purchases.failed'));
    recordNonFatal(error, 'purchase', { step: 'request', code, product: productId });
  }

  // ==========================================================================
  // Validation and finishing
  // ==========================================================================

  /**
   * Send a paid purchase to the backend and finish it after a verdict.
   * Returns the outcome, or null when it was skipped (no token, already in
   * flight, another session).
   */
  private async processPurchase(purchase: Purchase, origin: PurchaseOrigin): Promise<ValidationOutcome | null> {
    const billing = loadBilling();
    const platform = this.platform;
    const token = purchase.purchaseToken;
    if (!billing || !platform || !token) return null;
    if (this.inFlight.has(token)) return null;
    // A flush may list a purchase the store has not marked finished yet.
    if (origin === 'flush' && this.settled.has(token)) return null;
    const epoch = this.epoch;
    const isFlowPurchase = origin === 'listener' && this.flowProductId === purchase.productId && this.flow !== 'idle';
    const wasKept = this.kept.has(token);
    this.inFlight.add(token);
    if (isFlowPurchase) {
      runInAction(() => {
        this.flow = 'verifying';
      });
    }
    try {
      const outcome = await validatePurchase({ productId: purchase.productId, purchaseToken: token }, platform);
      if (epoch !== this.epoch) return null;

      if (outcome.kind === 'retry') {
        this.kept.set(token, purchase);
        runInAction(() => {
          this.keptCount = this.kept.size;
          if (isFlowPurchase) this.flow = 'deferred';
        });
        if (outcome.status !== 503) {
          recordNonFatal(new Error('Purchase validation postponed'), 'purchase', {
            step: 'validate',
            status: outcome.status,
            code: outcome.code,
            product: purchase.productId,
          });
        }
        return outcome;
      }

      // A verdict (200 or 4xx): the store transaction is finished either way.
      this.kept.delete(token);
      this.settled.add(token);
      runInAction(() => {
        this.keptCount = this.kept.size;
      });
      await this.finish(billing, purchase);

      if (outcome.kind === 'ok') {
        await getSubscriptionStore().refresh();
        if (epoch !== this.epoch) return outcome;
        runInAction(() => {
          if (isFlowPurchase) {
            this.flow = outcome.entitled ? 'success' : 'pending';
          } else if (this.flow === 'deferred' && this.flowProductId === purchase.productId) {
            this.flow = outcome.entitled ? 'success' : 'pending';
          }
        });
        if (!isFlowPurchase && wasKept && outcome.entitled) {
          showToast.success(msg('purchases.completedLater'));
        }
        return outcome;
      }

      // Rejected.
      runInAction(() => {
        if (isFlowPurchase || (this.flow === 'deferred' && this.flowProductId === purchase.productId)) {
          this.flow = 'idle';
          this.flowProductId = null;
        }
      });
      recordNonFatal(new Error('Purchase rejected by the backend'), 'purchase', {
        step: 'validate',
        status: outcome.status,
        code: outcome.code,
        product: purchase.productId,
        origin,
      });
      if (origin !== 'restore') {
        showToast.error(
          outcome.code === RECEIPT_ERROR_CODES.IN_USE ? msg('purchases.receiptInUse') : msg('purchases.receiptInvalid'),
        );
      }
      return outcome;
    } finally {
      this.inFlight.delete(token);
    }
  }

  private async finish(billing: BillingModule, purchase: Purchase): Promise<void> {
    try {
      await billing.finishTransaction({ purchase, isConsumable: false });
    } catch (error) {
      // Android: the backend may have acknowledged it already. Nothing the
      // user can do; the backend acknowledges on its own as well.
      console.warn('[iap] finishTransaction failed:', errorCode(error));
    }
  }

  /**
   * The purchases a previous run (or a 503) left unfinished: at start and on
   * every return to the foreground. Android lists them (unacknowledged
   * purchases of this Google account); on iOS StoreKit sends unfinished
   * transactions to the listener by itself, so only the kept ones are sent.
   */
  async flushUnfinished(): Promise<void> {
    if (this.billing !== 'ready') return;
    const kept = [...this.kept.values()];
    for (const purchase of kept) {
      await this.processPurchase(purchase, 'flush');
    }
    if (this.platform !== 'android') return;
    const owned = await this.refreshOwned();
    for (const purchase of owned) {
      if (purchase.purchaseState !== 'purchased') continue;
      if (!('isAcknowledgedAndroid' in purchase) || purchase.isAcknowledgedAndroid !== false) continue;
      // Bought for another Sesly account on this phone: that account's
      // session sends it.
      const account = 'obfuscatedAccountIdAndroid' in purchase ? purchase.obfuscatedAccountIdAndroid : null;
      if (account && account !== this.userId) continue;
      await this.processPurchase(purchase, 'flush');
    }
  }

  // ==========================================================================
  // Restore and manage
  // ==========================================================================

  /**
   * "Satın alımları geri yükle": every active subscription of ours in this
   * store account goes to the backend again. `quiet` keeps it to the
   * success message (after an "already owned").
   */
  async restore(options: { quiet?: boolean; syncStore?: boolean } = {}): Promise<void> {
    const billing = loadBilling();
    if (billing && !this.restoring && (this.billing === 'unavailable' || this.billing === 'idle')) {
      // The plans screen shows "restore" even while the store is not
      // connected (App Review needs it there): try to connect once first.
      await this.retry();
    }
    if (!billing || this.billing !== 'ready' || this.restoring) {
      if (!options.quiet && (!billing || this.billing !== 'ready')) {
        showToast.error(msg('purchases.unavailable'));
      }
      return;
    }
    const epoch = this.epoch;
    runInAction(() => {
      this.restoring = true;
    });
    try {
      if (this.platform === 'ios' && options.syncStore !== false) {
        // Syncs with the App Store (may ask for the Apple ID password), so
        // only when the user asked for it.
        await billing.restorePurchases();
      }
      const owned = (await this.refreshOwned()).filter(purchase => purchase.purchaseState === 'purchased');
      if (epoch !== this.epoch) return;
      if (owned.length === 0) {
        if (!options.quiet) showToast.info(msg('purchases.nothingToRestore'));
        return;
      }
      const outcomes: ValidationOutcome[] = [];
      for (const purchase of owned) {
        const outcome = await this.processPurchase(purchase, 'restore');
        if (outcome) outcomes.push(outcome);
      }
      if (epoch !== this.epoch) return;
      if (outcomes.some(outcome => outcome.kind === 'ok' && outcome.entitled)) {
        showToast.success(msg('purchases.restored'));
      } else if (outcomes.some(outcome => outcome.kind === 'retry')) {
        showToast.info(msg('purchases.restoreLater'));
      } else if (outcomes.some(outcome => outcome.kind === 'rejected' && outcome.code === RECEIPT_ERROR_CODES.IN_USE)) {
        showToast.error(msg('purchases.receiptInUse'));
      } else if (!options.quiet) {
        showToast.info(msg('purchases.nothingToRestore'));
      }
    } catch (error) {
      if (epoch !== this.epoch) return;
      const code = errorCode(error);
      if (code !== 'user-cancelled') {
        showToast.error(msg('purchases.restoreFailed'));
        recordNonFatal(error, 'purchase', { step: 'restore', code });
      }
    } finally {
      if (epoch === this.epoch) {
        runInAction(() => {
          this.restoring = false;
        });
      }
    }
  }

  /**
   * "Aboneliği yönet": the address the backend gives (GET
   * /subscriptions/current managementUrl), else the store's own page for
   * the subscription.
   */
  async manageSubscriptions(): Promise<void> {
    const subscription = getSubscriptionStore();
    const url = subscription.managementUrl;
    try {
      if (url) {
        await Linking.openURL(url);
        return;
      }
      const billing = loadBilling();
      if (billing) {
        await billing.deepLinkToSubscriptions({
          skuAndroid: subscription.storeProductId ?? undefined,
          packageNameAndroid: ANDROID_PACKAGE_NAME,
        });
        return;
      }
      await Linking.openURL(storeSubscriptionsUrl(this.platform, subscription.storeProductId));
    } catch (error) {
      console.warn('[iap] subscription management could not open:', error);
      try {
        await Linking.openURL(storeSubscriptionsUrl(this.platform, subscription.storeProductId));
      } catch {
        showToast.error(msg('purchases.manageFailed'));
      }
    }
  }

  /** "Tamam" on the success state, or leaving the plans screen. */
  dismissOutcome(): void {
    if (this.isBusy) return;
    this.flow = 'idle';
    this.flowProductId = null;
  }
}

/** The store's subscription page in a browser, when the library cannot open it. */
export function storeSubscriptionsUrl(platform: StorePlatform | null, productId: string | null): string {
  if (platform === 'ios') return 'https://apps.apple.com/account/subscriptions';
  const base = 'https://play.google.com/store/account/subscriptions';
  return productId ? `${base}?sku=${encodeURIComponent(productId)}&package=${ANDROID_PACKAGE_NAME}` : base;
}

let instance: PurchaseStore | null = null;

export function getPurchaseStore(): PurchaseStore {
  if (!instance) instance = new PurchaseStore();
  return instance;
}

/** Test-only: a fresh store on next use. */
export function resetPurchaseStoreForTests(): void {
  instance?.stop();
  instance = null;
}
