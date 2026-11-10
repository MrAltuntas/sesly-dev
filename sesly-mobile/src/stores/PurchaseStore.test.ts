/**
 * PurchaseStore with a mocked store library (expo-iap) and a mocked backend:
 * products and store prices, buying (Android obfuscatedAccountId, iOS
 * appAccountToken), the backend hand-over (finish only after 200 or 4xx,
 * keep on 503 and retry on foreground), cancel, Google pending purchases,
 * RECEIPT_IN_USE, restore, the startup flush of unfinished purchases, the
 * Android plan change, product load failures and no store at all.
 */

import { AppState, Linking, Platform } from 'react-native';

type Listener<T> = (value: T) => void;

const mockIap = {
  purchaseListener: null as Listener<unknown> | null,
  errorListener: null as Listener<unknown> | null,
  initConnection: jest.fn(async (): Promise<boolean> => true),
  endConnection: jest.fn(async () => true),
  fetchProducts: jest.fn(async (_request: unknown): Promise<unknown[]> => []),
  getAvailablePurchases: jest.fn(async (_options?: unknown): Promise<unknown[]> => []),
  requestPurchase: jest.fn(async (_request: unknown): Promise<unknown> => null),
  finishTransaction: jest.fn(async (_args: unknown) => undefined),
  restorePurchases: jest.fn(async () => undefined),
  deepLinkToSubscriptions: jest.fn(async (_options: unknown) => undefined),
  removePurchase: jest.fn(),
  removeError: jest.fn(),
};

jest.mock('expo-iap', () => ({
  initConnection: () => mockIap.initConnection(),
  endConnection: () => mockIap.endConnection(),
  fetchProducts: (request: unknown) => mockIap.fetchProducts(request),
  getAvailablePurchases: (options?: unknown) => mockIap.getAvailablePurchases(options),
  requestPurchase: (request: unknown) => mockIap.requestPurchase(request),
  finishTransaction: (args: unknown) => mockIap.finishTransaction(args),
  restorePurchases: () => mockIap.restorePurchases(),
  deepLinkToSubscriptions: (options: unknown) => mockIap.deepLinkToSubscriptions(options),
  purchaseUpdatedListener: (listener: Listener<unknown>) => {
    mockIap.purchaseListener = listener;
    return { remove: mockIap.removePurchase };
  },
  purchaseErrorListener: (listener: Listener<unknown>) => {
    mockIap.errorListener = listener;
    return { remove: mockIap.removeError };
  },
}));

const mockApiPost = jest.fn();
jest.mock('../services/ApiClient', () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => mockApiPost(...args) },
}));

const mockSubscription = {
  refresh: jest.fn(async () => undefined),
  managementUrl: null as string | null,
  storeProductId: null as string | null,
};
jest.mock('../hooks/useSubscription', () => ({ getSubscriptionStore: () => mockSubscription }));

jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

const mockRecordNonFatal = jest.fn();
jest.mock('../services/crashReporting', () => ({
  recordNonFatal: (...args: unknown[]) => mockRecordNonFatal(...args),
}));

import { PurchaseStore, baseOfferToken, storeSubscriptionsUrl, toStoreProduct } from './PurchaseStore';
import { resetBillingForTests } from '../services/iap/storeBilling';
import { apiErrorFromResponse } from '../services/ApiError';
import { showToast } from '../utils/toast';

const toast = showToast as unknown as Record<'error' | 'success' | 'info', jest.Mock>;

const USER = '7d1f0c1e-1111-4a5b-9c9d-123456789abc';

const originalOS = Platform.OS;

function setPlatform(os: 'android' | 'ios' | 'web') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true, writable: true });
}

/** An Android subscription product with a base plan offer and a trial offer. */
function androidProduct(id: string, price: string) {
  return {
    id,
    platform: 'android',
    type: 'subs',
    displayPrice: `${price} (trial)`,
    productStatusAndroid: 'ok',
    subscriptionOffers: [
      {
        id: 'trial',
        displayPrice: '0 TL',
        offerTokenAndroid: `${id}-trial-token`,
        pricingPhasesAndroid: { pricingPhaseList: [{}, {}] },
      },
      {
        id: `${id}-base`,
        displayPrice: price,
        offerTokenAndroid: `${id}-base-token`,
        pricingPhasesAndroid: { pricingPhaseList: [{}] },
      },
    ],
  };
}

const ANDROID_PRODUCTS = [
  androidProduct('mini_monthly', '₺49,99'),
  androidProduct('pro_monthly', '₺199,99'),
  androidProduct('pro_yearly', '₺1.499,99'),
];

function androidPurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    productId: 'pro_yearly',
    purchaseToken: 'token-1',
    purchaseState: 'purchased',
    isAcknowledgedAndroid: false,
    obfuscatedAccountIdAndroid: USER,
    platform: 'android',
    store: 'play',
    storeId: 'play',
    quantity: 1,
    isAutoRenewing: true,
    transactionDate: 1,
    ...overrides,
  };
}

function iosPurchase(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    transactionId: 'tx-1',
    productId: 'io.sesly.pro_yearly',
    purchaseToken: 'header.payload.signature',
    purchaseState: 'purchased',
    platform: 'ios',
    store: 'apple',
    storeId: 'apple',
    quantity: 1,
    isAutoRenewing: true,
    transactionDate: 1,
    ...overrides,
  };
}

const ok = { success: true, entitled: true, isActive: true };
const backendError = (status: number, code: string | null, extra: Record<string, unknown> = {}) =>
  apiErrorFromResponse(status, { statusCode: status, message: 'x', code, ...extra });

/** Lets every queued promise of the store run. */
async function settle() {
  for (let i = 0; i < 30; i += 1) {
    await Promise.resolve();
  }
}

let store: PurchaseStore;
let appStateListener: ((state: string) => void) | null = null;

beforeEach(() => {
  setPlatform('android');
  resetBillingForTests();
  mockIap.purchaseListener = null;
  mockIap.errorListener = null;
  mockIap.initConnection.mockImplementation(async () => true);
  mockIap.fetchProducts.mockImplementation(async () => ANDROID_PRODUCTS);
  mockIap.getAvailablePurchases.mockImplementation(async () => []);
  mockIap.requestPurchase.mockImplementation(async () => null);
  mockIap.finishTransaction.mockImplementation(async () => undefined);
  mockApiPost.mockReset();
  mockApiPost.mockResolvedValue(ok);
  mockSubscription.managementUrl = null;
  mockSubscription.storeProductId = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  }) as unknown as typeof AppState.addEventListener);
  store = new PurchaseStore();
});

afterEach(() => {
  store.stop();
  setPlatform(originalOS as 'android' | 'ios');
  appStateListener = null;
});

async function startStore() {
  await store.start(USER);
  await settle();
}

async function emitPurchase(purchase: unknown) {
  mockIap.purchaseListener?.(purchase);
  await settle();
}

describe('product helpers', () => {
  it('buys the base plan offer: one pricing phase, else the first offer with a token', () => {
    const product = androidProduct('pro_monthly', '₺199,99');
    expect(baseOfferToken(product as never)).toBe('pro_monthly-base-token');
    expect(toStoreProduct(product as never, 'android')).toEqual({
      productId: 'pro_monthly',
      displayPrice: '₺199,99',
      currency: null,
      offerToken: 'pro_monthly-base-token',
    });
    expect(toStoreProduct({ ...product, currency: 'try' } as never, 'android')?.currency).toBe('TRY');
    const onlyTrial = { ...product, subscriptionOffers: [product.subscriptionOffers[0]] };
    expect(baseOfferToken(onlyTrial as never)).toBe('pro_monthly-trial-token');
    // Without an offer token (or not found) Android cannot sell it.
    expect(toStoreProduct({ ...product, subscriptionOffers: [] } as never, 'android')).toBeNull();
    expect(toStoreProduct({ ...product, productStatusAndroid: 'not-found' } as never, 'android')).toBeNull();
    expect(
      toStoreProduct({ id: 'io.sesly.mini_monthly', platform: 'ios', displayPrice: '₺49,99' } as never, 'ios'),
    ).toEqual({ productId: 'io.sesly.mini_monthly', displayPrice: '₺49,99', currency: null, offerToken: null });
  });

  it('opens the store subscription page in a browser as the last way', () => {
    expect(storeSubscriptionsUrl('ios', 'io.sesly.pro_monthly')).toBe('https://apps.apple.com/account/subscriptions');
    expect(storeSubscriptionsUrl('android', 'pro_monthly')).toBe(
      'https://play.google.com/store/account/subscriptions?sku=pro_monthly&package=com.sesly',
    );
    expect(storeSubscriptionsUrl('android', null)).toBe('https://play.google.com/store/account/subscriptions');
  });
});

describe('connection and products', () => {
  it('connects, loads the three products with the store prices and flushes nothing', async () => {
    await startStore();
    expect(store.billing).toBe('ready');
    expect(store.productsState).toBe('ready');
    expect(store.canBuy).toBe(true);
    expect(mockIap.fetchProducts).toHaveBeenCalledWith({
      skus: ['mini_monthly', 'pro_monthly', 'pro_yearly'],
      type: 'subs',
    });
    expect(store.productFor('premium', 'yearly')).toEqual({
      productId: 'pro_yearly',
      displayPrice: '₺1.499,99',
      currency: null,
      offerToken: 'pro_yearly-base-token',
    });
    // The mocked products name no currency.
    expect(store.storeCurrency).toBeNull();
    expect(store.productFor('mini', 'monthly')?.displayPrice).toBe('₺49,99');
    expect(store.productFor('mini', 'yearly')).toBeNull();
    expect(store.productFor('free', 'monthly')).toBeNull();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('a product load failure is an error state, and retry asks again', async () => {
    mockIap.fetchProducts.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'query-product' }));
    await startStore();
    expect(store.billing).toBe('ready');
    expect(store.productsState).toBe('error');
    expect(store.canBuy).toBe(false);

    await store.retry();
    expect(store.productsState).toBe('ready');
    expect(mockIap.fetchProducts).toHaveBeenCalledTimes(2);
  });

  it('no Play products yet (the store answers without ours) is the empty state', async () => {
    mockIap.fetchProducts.mockResolvedValueOnce([
      { ...androidProduct('pro_monthly', '₺199,99'), productStatusAndroid: 'not-found' },
      androidProduct('someone_else', '₺1'),
    ]);
    await startStore();
    expect(store.productsState).toBe('empty');
    expect(store.canBuy).toBe(false);
  });

  it('a phone where the store refuses the connection is unavailable, and retry connects again', async () => {
    mockIap.initConnection.mockRejectedValueOnce(Object.assign(new Error('no billing'), { code: 'billing-unavailable' }));
    await startStore();
    expect(store.billing).toBe('unavailable');
    expect(store.productsState).toBe('idle');
    expect(mockIap.fetchProducts).not.toHaveBeenCalled();

    await store.retry();
    await settle();
    expect(store.billing).toBe('ready');
    expect(store.productsState).toBe('ready');
  });

  it('a platform without a store is unavailable without touching the library', async () => {
    setPlatform('web');
    resetBillingForTests();
    await startStore();
    expect(store.billing).toBe('unavailable');
    expect(mockIap.initConnection).not.toHaveBeenCalled();
    // Nothing to do, nothing thrown.
    await store.buy('premium', 'yearly');
    expect(mockIap.requestPurchase).not.toHaveBeenCalled();
  });

  it('stop closes the connection, removes the listeners and forgets everything', async () => {
    await startStore();
    store.stop();
    expect(mockIap.endConnection).toHaveBeenCalledTimes(1);
    expect(mockIap.removePurchase).toHaveBeenCalled();
    expect(mockIap.removeError).toHaveBeenCalled();
    expect(store.billing).toBe('idle');
    expect(store.productsState).toBe('idle');
    expect(store.productFor('premium', 'yearly')).toBeNull();
  });

  it('starting again for the same user only retries what failed', async () => {
    await startStore();
    await store.start(USER);
    await settle();
    expect(mockIap.initConnection).toHaveBeenCalledTimes(1);
    expect(mockIap.fetchProducts).toHaveBeenCalledTimes(1);
  });
});

describe('buying on Android', () => {
  it('buys the base plan with the Sesly user id; a 200 finishes it and ends on success', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    expect(store.flow).toBe('purchasing');
    expect(store.isBusy).toBe(true);
    expect(mockIap.requestPurchase).toHaveBeenCalledWith({
      type: 'subs',
      request: {
        google: {
          skus: ['pro_yearly'],
          obfuscatedAccountId: USER,
          subscriptionOffers: [{ sku: 'pro_yearly', offerToken: 'pro_yearly-base-token' }],
        },
      },
    });

    await emitPurchase(androidPurchase());
    expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/google/validate', {
      purchaseToken: 'token-1',
      productId: 'pro_yearly',
      packageName: 'com.sesly',
    });
    expect(mockIap.finishTransaction).toHaveBeenCalledWith({
      purchase: expect.objectContaining({ purchaseToken: 'token-1' }),
      isConsumable: false,
    });
    expect(mockSubscription.refresh).toHaveBeenCalledTimes(1);
    expect(store.flow).toBe('success');
    expect(store.isBusy).toBe(false);

    store.dismissOutcome();
    expect(store.flow).toBe('idle');
  });

  it('a cancel in the store sheet goes back quietly', async () => {
    await startStore();
    await store.buy('mini', 'monthly');
    mockIap.errorListener?.({ code: 'user-cancelled', message: 'cancelled' });
    expect(store.flow).toBe('idle');
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(mockRecordNonFatal).not.toHaveBeenCalled();
  });

  it('a Google pending purchase waits: nothing is validated or finished until it is paid', async () => {
    await startStore();
    await store.buy('premium', 'monthly');
    await emitPurchase(androidPurchase({ productId: 'pro_monthly', purchaseState: 'pending' }));
    expect(store.flow).toBe('pending');
    expect(store.isBusy).toBe(false);
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockIap.finishTransaction).not.toHaveBeenCalled();

    // Paid later: the store sends it again.
    await emitPurchase(androidPurchase({ productId: 'pro_monthly' }));
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1);
    expect(store.flow).toBe('success');
  });

  it('a pending error code from the store also waits', async () => {
    await startStore();
    await store.buy('premium', 'monthly');
    mockIap.errorListener?.({ code: 'deferred-payment', message: 'later' });
    expect(store.flow).toBe('pending');
  });

  it('a 503 keeps the transaction and retries it when the app comes back to the foreground', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    mockApiPost.mockRejectedValueOnce(backendError(503, 'STORE_UNAVAILABLE', { retryable: true }));
    await emitPurchase(androidPurchase());

    expect(mockIap.finishTransaction).not.toHaveBeenCalled();
    expect(store.flow).toBe('deferred');
    expect(store.keptCount).toBe(1);
    // A 503 is the backend saying "later", not a failure to report.
    expect(mockRecordNonFatal).not.toHaveBeenCalled();

    // Back in the foreground: sent again, now accepted, finished.
    mockIap.getAvailablePurchases.mockResolvedValue([androidPurchase()]);
    appStateListener?.('background');
    appStateListener?.('active');
    await settle();
    expect(mockApiPost).toHaveBeenCalledTimes(2);
    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1);
    expect(store.keptCount).toBe(0);
    expect(store.flow).toBe('success');
  });

  it('no connection to the backend keeps it as well (and reports the odd status)', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    mockApiPost.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));
    await emitPurchase(androidPurchase());
    expect(mockIap.finishTransaction).not.toHaveBeenCalled();
    expect(store.flow).toBe('deferred');
    expect(mockRecordNonFatal).toHaveBeenCalledWith(expect.any(Error), 'purchase', expect.objectContaining({ status: 0 }));
  });

  it('a 4xx verdict finishes the transaction and says the purchase could not be verified', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    mockApiPost.mockRejectedValueOnce(backendError(400, 'RECEIPT_INVALID'));
    await emitPurchase(androidPurchase());

    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1);
    expect(store.flow).toBe('idle');
    expect(store.keptCount).toBe(0);
    expect(toast.error).toHaveBeenCalledWith(
      'Bu satın alım doğrulanamadı. Ücret alındıysa mağaza birkaç gün içinde iade eder.',
    );
    expect(mockRecordNonFatal).toHaveBeenCalledWith(
      expect.any(Error),
      'purchase',
      expect.objectContaining({ step: 'validate', status: 400, code: 'RECEIPT_INVALID', product: 'pro_yearly' }),
    );
  });

  it('RECEIPT_IN_USE finishes it and says the subscription belongs to another account', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    mockApiPost.mockRejectedValueOnce(backendError(409, 'RECEIPT_IN_USE'));
    await emitPurchase(androidPurchase());

    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1);
    expect(store.flow).toBe('idle');
    expect(toast.error).toHaveBeenCalledWith(
      'Bu abonelik başka bir Sesly hesabına bağlı. O hesapla giriş yapabilir ya da aboneliği mağazadan yönetebilirsin.',
    );
  });

  it('a 200 without entitlement (the store still settles it) is the pending state', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    mockApiPost.mockResolvedValueOnce({ success: true, entitled: false, isActive: false });
    await emitPurchase(androidPurchase());
    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1);
    expect(store.flow).toBe('pending');
  });

  it('a finish the store refuses (already acknowledged by the backend) still ends on success', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    mockIap.finishTransaction.mockRejectedValueOnce(Object.assign(new Error('acked'), { code: 'developer-error' }));
    await emitPurchase(androidPurchase());
    expect(store.flow).toBe('success');
  });

  it('the same purchase sent twice at once is validated once', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    mockIap.purchaseListener?.(androidPurchase());
    mockIap.purchaseListener?.(androidPurchase());
    await settle();
    expect(mockApiPost).toHaveBeenCalledTimes(1);
  });

  it('ignores purchases of products the app does not sell', async () => {
    await startStore();
    await emitPurchase(androidPurchase({ productId: 'coins_100' }));
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it.each([
    ['network-error', 'Mağazaya bağlanılamadı. İnternet bağlantını kontrol edip yeniden dene.', false],
    ['item-unavailable', 'Bu plan şu an satın alınamıyor. Biraz sonra yeniden dene.', true],
    ['purchase-error', 'Satın alma tamamlanamadı. Ücret alınmadı, yeniden deneyebilirsin.', true],
  ])('a store error %s goes back with its message', async (code, message, reported) => {
    await startStore();
    await store.buy('premium', 'yearly');
    mockIap.errorListener?.({ code, message: 'store said no' });
    expect(store.flow).toBe('idle');
    expect(toast.error).toHaveBeenCalledWith(message);
    expect(mockRecordNonFatal).toHaveBeenCalledTimes(reported ? 1 : 0);
  });

  it('a request the library rejects at once is handled like a store error', async () => {
    await startStore();
    mockIap.requestPurchase.mockRejectedValueOnce(Object.assign(new Error('not ready'), { code: 'not-prepared' }));
    await store.buy('premium', 'yearly');
    expect(store.flow).toBe('idle');
    expect(toast.error).toHaveBeenCalledWith('Bu plan şu an satın alınamıyor. Biraz sonra yeniden dene.');
  });

  it('an error outside a purchase is only logged', async () => {
    await startStore();
    mockIap.errorListener?.({ code: 'network-error', message: 'x' });
    expect(toast.error).not.toHaveBeenCalled();
    expect(store.flow).toBe('idle');
  });

  it('"already owned" restores instead', async () => {
    mockIap.getAvailablePurchases.mockResolvedValue([]);
    await startStore();
    await store.buy('premium', 'yearly');
    mockIap.getAvailablePurchases.mockResolvedValue([androidPurchase({ isAcknowledgedAndroid: true })]);
    mockIap.errorListener?.({ code: 'already-owned', message: 'owned' });
    await settle();
    expect(toast.info).toHaveBeenCalledWith('Bu aboneliğe zaten sahipsin. Satın alımların geri yükleniyor.');
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith('Aboneliğin geri yüklendi.');
  });

  it('a product the store did not load cannot be bought', async () => {
    mockIap.fetchProducts.mockResolvedValueOnce([androidProduct('mini_monthly', '₺49,99')]);
    await startStore();
    await store.buy('premium', 'yearly');
    expect(mockIap.requestPurchase).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Bu plan şu an satın alınamıyor. Biraz sonra yeniden dene.');
    expect(store.flow).toBe('idle');
  });

  it('a second buy while one runs is ignored', async () => {
    await startStore();
    await store.buy('premium', 'yearly');
    await store.buy('mini', 'monthly');
    expect(mockIap.requestPurchase).toHaveBeenCalledTimes(1);
  });
});

describe('plan changes on Android', () => {
  it('an upgrade replaces the old purchase now, with time proration', async () => {
    await startStore();
    mockIap.getAvailablePurchases.mockResolvedValue([
      androidPurchase({ productId: 'pro_monthly', purchaseToken: 'old-token', isAcknowledgedAndroid: true }),
    ]);
    await store.buy('premium', 'yearly');
    expect(mockIap.requestPurchase).toHaveBeenCalledWith({
      type: 'subs',
      request: {
        google: expect.objectContaining({
          skus: ['pro_yearly'],
          obfuscatedAccountId: USER,
          purchaseToken: 'old-token',
          subscriptionProductReplacementParams: { oldProductId: 'pro_monthly', replacementMode: 'with-time-proration' },
        }),
      },
    });
  });

  it('a downgrade waits for the renewal (deferred)', async () => {
    await startStore();
    mockIap.getAvailablePurchases.mockResolvedValue([
      androidPurchase({ productId: 'pro_yearly', purchaseToken: 'old-token', isAcknowledgedAndroid: true }),
    ]);
    await store.buy('mini', 'monthly');
    const request = mockIap.requestPurchase.mock.calls[0][0] as { request: { google: Record<string, unknown> } };
    expect(request.request.google.subscriptionProductReplacementParams).toEqual({
      oldProductId: 'pro_yearly',
      replacementMode: 'deferred',
    });
  });

  it('the product the account already has is not bought again', async () => {
    await startStore();
    mockIap.getAvailablePurchases.mockResolvedValue([
      androidPurchase({ productId: 'pro_yearly', isAcknowledgedAndroid: true }),
    ]);
    await store.buy('premium', 'yearly');
    await settle();
    expect(mockIap.requestPurchase).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith('Bu aboneliğe zaten sahipsin. Satın alımların geri yükleniyor.');
    expect(store.flow).toBe('idle');
  });

  it("another Sesly account's subscription on this phone is not replaced", async () => {
    await startStore();
    mockIap.getAvailablePurchases.mockResolvedValue([
      androidPurchase({ productId: 'pro_monthly', obfuscatedAccountIdAndroid: 'someone-else', isAcknowledgedAndroid: true }),
    ]);
    await store.buy('premium', 'yearly');
    const request = mockIap.requestPurchase.mock.calls[0][0] as { request: { google: Record<string, unknown> } };
    expect(request.request.google.purchaseToken).toBeUndefined();
    expect(request.request.google.subscriptionProductReplacementParams).toBeUndefined();
  });
});

describe('the startup flush', () => {
  it("sends this account's unfinished purchases at start and finishes them; skips the rest", async () => {
    mockIap.getAvailablePurchases.mockResolvedValue([
      androidPurchase({ purchaseToken: 'mine' }),
      androidPurchase({ purchaseToken: 'other-account', obfuscatedAccountIdAndroid: 'someone-else' }),
      androidPurchase({ purchaseToken: 'acknowledged', isAcknowledgedAndroid: true }),
      androidPurchase({ purchaseToken: 'waiting', purchaseState: 'pending' }),
      androidPurchase({ purchaseToken: 'no-account', obfuscatedAccountIdAndroid: null }),
    ]);
    await startStore();
    const tokens = mockApiPost.mock.calls.map(call => (call[1] as { purchaseToken: string }).purchaseToken);
    expect(tokens).toEqual(['mine', 'no-account']);
    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(2);
    expect(mockSubscription.refresh).toHaveBeenCalledTimes(2);
    // Not a purchase on screen: no flow, no message.
    expect(store.flow).toBe('idle');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('one still refused with a 503 stays unfinished, and a later foreground completes it with a message', async () => {
    mockIap.getAvailablePurchases.mockResolvedValue([androidPurchase()]);
    mockApiPost.mockRejectedValueOnce(backendError(503, 'STORE_NOT_CONFIGURED', { retryable: true }));
    await startStore();
    expect(mockIap.finishTransaction).not.toHaveBeenCalled();
    expect(store.keptCount).toBe(1);

    appStateListener?.('background');
    appStateListener?.('active');
    await settle();
    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1);
    expect(store.keptCount).toBe(0);
    expect(toast.success).toHaveBeenCalledWith('Satın alımın doğrulandı, planın açıldı.');
  });
});

describe('restore', () => {
  it('sends every active subscription again and says it is restored', async () => {
    await startStore();
    mockIap.getAvailablePurchases.mockResolvedValue([androidPurchase({ isAcknowledgedAndroid: true })]);
    await store.restore();
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockSubscription.refresh).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Aboneliğin geri yüklendi.');
    expect(store.restoring).toBe(false);
    // Android does not run the App Store sync.
    expect(mockIap.restorePurchases).not.toHaveBeenCalled();
  });

  it('nothing to restore says so', async () => {
    await startStore();
    await store.restore();
    expect(toast.info).toHaveBeenCalledWith('Bu mağaza hesabında geri yüklenecek bir abonelik bulunamadı.');
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it('a subscription of another Sesly account says so', async () => {
    await startStore();
    mockIap.getAvailablePurchases.mockResolvedValue([androidPurchase({ isAcknowledgedAndroid: true })]);
    mockApiPost.mockRejectedValueOnce(backendError(409, 'RECEIPT_IN_USE'));
    await store.restore();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      'Bu abonelik başka bir Sesly hesabına bağlı. O hesapla giriş yapabilir ya da aboneliği mağazadan yönetebilirsin.',
    );
  });

  it('a backend that cannot check now keeps it and says it finishes later', async () => {
    await startStore();
    mockIap.getAvailablePurchases.mockResolvedValue([androidPurchase({ isAcknowledgedAndroid: true })]);
    mockApiPost.mockRejectedValueOnce(backendError(503, 'STORE_UNAVAILABLE', { retryable: true }));
    await store.restore();
    expect(toast.info).toHaveBeenCalledWith(
      'Satın alımın bulundu. Doğrulama şu an yapılamıyor, bağlantı düzelince kendiliğinden tamamlanacak.',
    );
    expect(store.keptCount).toBe(1);
  });

  it('a store failure says it could not restore', async () => {
    setPlatform('ios');
    resetBillingForTests();
    mockIap.fetchProducts.mockResolvedValue([]);
    await startStore();
    mockIap.restorePurchases.mockRejectedValueOnce(Object.assign(new Error('sync'), { code: 'sync-error' }));
    await store.restore();
    expect(toast.error).toHaveBeenCalledWith('Satın alımlar şu an geri yüklenemedi. Biraz sonra yeniden dene.');
    expect(store.restoring).toBe(false);
  });

  it('without a store connection it connects once more, then says purchases are unavailable', async () => {
    mockIap.initConnection.mockResolvedValue(false);
    await startStore();
    expect(store.billing).toBe('unavailable');
    const attempts = mockIap.initConnection.mock.calls.length;
    await store.restore();
    expect(mockIap.initConnection.mock.calls.length).toBe(attempts + 1);
    expect(toast.error).toHaveBeenCalledWith('Bu plan şu an satın alınamıyor. Biraz sonra yeniden dene.');
  });

  it('a store that connects on the second try restores', async () => {
    setPlatform('ios');
    resetBillingForTests();
    mockIap.fetchProducts.mockResolvedValue([]);
    mockIap.initConnection.mockResolvedValueOnce(false);
    await startStore();
    expect(store.billing).toBe('unavailable');
    await store.restore();
    expect(store.billing).toBe('ready');
    expect(mockIap.restorePurchases).toHaveBeenCalledTimes(1);
  });

  it('an automatic restore on iOS never syncs with the App Store (no password prompt)', async () => {
    setPlatform('ios');
    resetBillingForTests();
    mockIap.fetchProducts.mockResolvedValue([]);
    await startStore();
    await store.restore({ quiet: true, syncStore: false });
    expect(mockIap.restorePurchases).not.toHaveBeenCalled();
    expect(mockIap.getAvailablePurchases).toHaveBeenCalled();
  });
});

describe('iOS', () => {
  beforeEach(() => {
    setPlatform('ios');
    resetBillingForTests();
    mockIap.fetchProducts.mockImplementation(async () => [
      { id: 'io.sesly.mini_monthly', platform: 'ios', type: 'subs', displayPrice: '₺49,99' },
      { id: 'io.sesly.pro_monthly', platform: 'ios', type: 'subs', displayPrice: '₺199,99' },
      { id: 'io.sesly.pro_yearly', platform: 'ios', type: 'subs', displayPrice: '₺1.499,99' },
    ]);
  });

  it('asks for the App Store ids, buys with appAccountToken and sends the signed transaction', async () => {
    await startStore();
    expect(mockIap.fetchProducts).toHaveBeenCalledWith({
      skus: ['io.sesly.mini_monthly', 'io.sesly.pro_monthly', 'io.sesly.pro_yearly'],
      type: 'subs',
    });
    // iOS replays unfinished transactions itself: no list at start.
    expect(mockIap.getAvailablePurchases).not.toHaveBeenCalled();

    await store.buy('premium', 'yearly');
    expect(mockIap.requestPurchase).toHaveBeenCalledWith({
      type: 'subs',
      request: { apple: { sku: 'io.sesly.pro_yearly', appAccountToken: USER } },
    });
    await emitPurchase(iosPurchase());
    expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/apple/validate', {
      signedTransaction: 'header.payload.signature',
    });
    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1);
    expect(store.flow).toBe('success');
  });

  it('restore syncs with the App Store first', async () => {
    await startStore();
    mockIap.getAvailablePurchases.mockResolvedValue([iosPurchase()]);
    await store.restore();
    expect(mockIap.restorePurchases).toHaveBeenCalledTimes(1);
    expect(mockIap.getAvailablePurchases).toHaveBeenCalledWith({ onlyIncludeActiveItemsIOS: true });
    expect(toast.success).toHaveBeenCalledWith('Aboneliğin geri yüklendi.');
  });

  it('a kept transaction is sent again on the next foreground', async () => {
    await startStore();
    mockApiPost.mockRejectedValueOnce(backendError(503, 'STORE_UNAVAILABLE', { retryable: true }));
    await emitPurchase(iosPurchase());
    expect(store.keptCount).toBe(1);
    expect(mockIap.finishTransaction).not.toHaveBeenCalled();

    appStateListener?.('background');
    appStateListener?.('active');
    await settle();
    expect(mockApiPost).toHaveBeenCalledTimes(2);
    expect(mockIap.finishTransaction).toHaveBeenCalledTimes(1);
  });
});

describe('manage subscriptions', () => {
  it("opens the backend's management address when there is one", async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    mockSubscription.managementUrl = 'https://play.google.com/store/account/subscriptions?sku=pro_monthly&package=com.sesly';
    await store.manageSubscriptions();
    expect(openURL).toHaveBeenCalledWith(mockSubscription.managementUrl);
    expect(mockIap.deepLinkToSubscriptions).not.toHaveBeenCalled();
  });

  it("otherwise the store's own subscription page for the product", async () => {
    mockSubscription.storeProductId = 'pro_monthly';
    await store.manageSubscriptions();
    expect(mockIap.deepLinkToSubscriptions).toHaveBeenCalledWith({
      skuAndroid: 'pro_monthly',
      packageNameAndroid: 'com.sesly',
    });
  });

  it('falls back to the page in a browser, and says so when even that fails', async () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValueOnce(true);
    mockIap.deepLinkToSubscriptions.mockRejectedValueOnce(new Error('no activity'));
    await store.manageSubscriptions();
    expect(openURL).toHaveBeenCalledWith('https://play.google.com/store/account/subscriptions');

    openURL.mockRejectedValue(new Error('no browser'));
    mockIap.deepLinkToSubscriptions.mockRejectedValueOnce(new Error('no activity'));
    await store.manageSubscriptions();
    expect(toast.error).toHaveBeenCalledWith('Abonelik sayfası açılamadı.');
  });
});
