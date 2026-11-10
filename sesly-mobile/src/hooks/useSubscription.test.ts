/**
 * SubscriptionStore (src/hooks/useSubscription.ts) unit tests.
 *
 * Payloads mirror the backend contract:
 *   GET /subscriptions/current -> the raw Prisma Subscription row
 *     (404 "Subscription not found" when the user has no row = FREE)
 *   GET /usage -> usage.service.ts getUsageSummary (contract fixtures)
 */

const mockApiGet = jest.fn();
const mockApiPost = jest.fn();
const mockGetAccessToken = jest.fn();

jest.mock('../services/ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...a: unknown[]) => mockApiGet(...a),
    post: (...a: unknown[]) => mockApiPost(...a),
    getAccessToken: (...a: unknown[]) => mockGetAccessToken(...a),
  },
}));
jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

import { renderHook } from '@testing-library/react-native';
import {
  SubscriptionStore,
  USAGE_SOON_DELAY_MS,
  USAGE_STALE_MS,
  getSubscriptionStore,
  parseCurrentSubscriptionResponse,
  useSubscription,
} from './useSubscription';
import { apiErrorFromResponse } from '../services/ApiError';
import { SubscriptionStatus, SubscriptionTier } from '../types/enums';
import { showToast } from '../utils/toast';
import { backendUsageFree, backendUsageMini, cloneFixture } from '../test-utils/contract-fixtures';

const toastInfo = showToast.info as jest.Mock;
const toastError = showToast.error as jest.Mock;
const toastSuccess = showToast.success as jest.Mock;

const NOW = new Date('2026-09-28T09:00:00.000Z');
const FUTURE_END = '2026-10-28T09:00:00.000Z';
const PAST_END = '2026-09-01T00:00:00.000Z';

/** Raw Subscription row as SubscriptionsService.getCurrentSubscription returns it. */
function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    userId: 'user-123',
    plan: 'PRO',
    status: 'ACTIVE',
    billingPeriod: 'MONTHLY',
    provider: 'GOOGLE',
    currentPeriodStart: '2026-09-28T09:00:00.000Z',
    currentPeriodEnd: FUTURE_END,
    cancelAtPeriodEnd: false,
    autoRenew: true,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    createdAt: '2026-09-28T09:00:00.000Z',
    updatedAt: '2026-09-28T09:00:00.000Z',
    ...overrides,
  };
}

/** GET /usage with the plan swapped (the rest of the MINI summary kept). */
function usageFor(plan: string, features = { backgroundPlayback: true, premiumStories: true }) {
  return { ...cloneFixture(backendUsageMini), plan, features };
}

/** Route ApiClient.get by path. A value that is an Error is thrown. */
function routeGet(routes: Record<string, unknown>) {
  mockApiGet.mockImplementation(async (path: string) => {
    if (!(path in routes)) {
      throw new Error(`unexpected GET ${path}`);
    }
    const value = routes[path];
    if (value instanceof Error) throw value;
    return value;
  });
}

/** A GET that stays pending until `release` is called. */
function deferredGet() {
  let release: (value: unknown) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const promise = new Promise((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release: (v: unknown) => release(v), fail: (e: unknown) => fail(e) };
}

const callsTo = (path: string) => mockApiGet.mock.calls.filter(([p]) => p === path).length;

async function flush() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

beforeEach(() => {
  jest.setSystemTime(NOW);
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockApiGet.mockReset();
  mockApiPost.mockReset().mockResolvedValue(undefined);
  mockGetAccessToken.mockReset().mockResolvedValue('jwt-access-token');
});

// ============================================================================
// Defaults + plan getters
// ============================================================================

describe('SubscriptionStore defaults and getters', () => {
  it('starts on the free plan with no usage and IAP disabled', () => {
    const store = new SubscriptionStore();
    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.subscriptionStatus).toBeNull();
    expect(store.currentPeriodEnd).toBeNull();
    expect(store.planId).toBe('free');
    expect(store.isPaid).toBe(false);
    expect(store.canPlayInBackground).toBe(false);
    expect(store.hasPremiumStories).toBe(false);
    expect(store.isPremiumPlan).toBe(false);
    expect(store.usage).toBeNull();
    expect(store.usageLoadedAt).toBeNull();
    expect(store.usageError).toBe(false);
    expect(store.source).toBeNull();
    expect(store.storeProductId).toBeNull();
    expect(store.managementUrl).toBeNull();
    expect(store.hasStoreSubscription).toBe(false);
  });

  it.each([
    [SubscriptionTier.FREE, 'free', false, false],
    [SubscriptionTier.MINI, 'mini', true, false],
    [SubscriptionTier.PRO, 'premium', true, true],
    [SubscriptionTier.CREATOR, 'premium', true, true],
  ] as const)(
    'tier %s without usage -> plan %s, paid %s, premium %s',
    (tier, planId, paid, premium) => {
      const store = new SubscriptionStore();
      store.setTierFromUser(tier);
      expect(store.planId).toBe(planId);
      expect(store.isPaid).toBe(paid);
      expect(store.canPlayInBackground).toBe(paid);
      expect(store.hasPremiumStories).toBe(paid);
      expect(store.isPremiumPlan).toBe(premium);
    },
  );

  it('the old Pro getters are gone: every check names what it is about', () => {
    const store = new SubscriptionStore();
    expect('isPro' in store).toBe(false);
    expect('isFree' in store).toBe(false);
  });

  it('a MINI user is paid and may play in the background, but is not Premium', async () => {
    routeGet({ '/usage': cloneFixture(backendUsageMini) });
    const store = new SubscriptionStore();
    store.setTierFromUser('MINI');

    await store.loadUsage();

    expect(store.planId).toBe('mini');
    expect(store.isPaid).toBe(true);
    expect(store.canPlayInBackground).toBe(true);
    expect(store.hasPremiumStories).toBe(true);
    expect(store.isPremiumPlan).toBe(false);
  });

  it('the usage plan and features win over the tier', async () => {
    // A stale tier (the user payload) and a fresh /usage disagree: /usage wins.
    routeGet({ '/usage': usageFor('PRO', { backgroundPlayback: false, premiumStories: true }) });
    const store = new SubscriptionStore();
    store.setTierFromUser('FREE');

    await store.loadUsage();

    expect(store.planId).toBe('premium');
    expect(store.isPremiumPlan).toBe(true);
    expect(store.canPlayInBackground).toBe(false);
    expect(store.hasPremiumStories).toBe(true);
  });
});

// ============================================================================
// setTierFromUser / reset
// ============================================================================

describe('SubscriptionStore.setTierFromUser', () => {
  it('parses the /users/me subscriptionTier string (case/whitespace tolerant)', () => {
    const store = new SubscriptionStore();
    store.setTierFromUser(' pro ');
    expect(store.currentTier).toBe(SubscriptionTier.PRO);
    store.setTierFromUser('mini');
    expect(store.currentTier).toBe(SubscriptionTier.MINI);
  });

  it.each([null, undefined, '', 'PLATINUM', 'PREMIUM'])('unknown tier %p falls back to FREE', raw => {
    const store = new SubscriptionStore();
    store.setTierFromUser('CREATOR');
    store.setTierFromUser(raw as string | null | undefined);
    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.isPaid).toBe(false);
  });
});

describe('SubscriptionStore.reset', () => {
  it('returns to FREE and forgets the usage', async () => {
    routeGet({
      '/subscriptions/current': subscriptionRow(),
      '/usage': usageFor('PRO'),
    });
    const store = new SubscriptionStore();
    await store.refresh();
    expect(store.planId).toBe('premium');
    store.usageError = true;

    store.reset();

    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.subscriptionStatus).toBeNull();
    expect(store.currentPeriodEnd).toBeNull();
    expect(store.usage).toBeNull();
    expect(store.usageLoadedAt).toBeNull();
    expect(store.usageError).toBe(false);
    expect(store.planId).toBe('free');
  });

  it('drops responses that land after a sign-out', async () => {
    const current = deferredGet();
    const usage = deferredGet();
    mockApiGet.mockImplementation((path: string) =>
      path === '/usage' ? usage.promise : current.promise,
    );
    const store = new SubscriptionStore();
    const pending = store.refresh();

    store.reset();
    current.release(subscriptionRow());
    usage.release(usageFor('PRO'));
    await pending;

    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.usage).toBeNull();
    expect(store.planId).toBe('free');
  });

  it('a request after the reset does not share the one from before it', async () => {
    const before = deferredGet();
    mockApiGet.mockReturnValueOnce(before.promise);
    const store = new SubscriptionStore();
    const first = store.loadUsage();

    store.reset();
    mockApiGet.mockResolvedValueOnce(cloneFixture(backendUsageFree));
    await store.loadUsage();
    before.release(usageFor('PRO'));
    await first;

    expect(callsTo('/usage')).toBe(2);
    expect(store.planId).toBe('free');
  });

  it('cancels a pending loadUsageSoon', async () => {
    routeGet({ '/usage': cloneFixture(backendUsageFree) });
    const store = new SubscriptionStore();
    store.loadUsageSoon();

    store.reset();
    jest.advanceTimersByTime(USAGE_SOON_DELAY_MS * 2);
    await flush();

    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

// ============================================================================
// loadCurrentSubscription
// ============================================================================

describe('SubscriptionStore.loadCurrentSubscription', () => {
  it('ACTIVE PRO row -> Premium with status and period end', async () => {
    routeGet({ '/subscriptions/current': subscriptionRow() });
    const store = new SubscriptionStore();

    await store.loadCurrentSubscription();

    expect(mockApiGet).toHaveBeenCalledWith('/subscriptions/current');
    expect(store.currentTier).toBe(SubscriptionTier.PRO);
    expect(store.planId).toBe('premium');
    expect(store.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(store.currentPeriodEnd?.toISOString()).toBe(FUTURE_END);
    expect(store.isLoading).toBe(false);
    expect(store.errorMessage).toBe('');
  });

  it('CREATOR is shown as Premium', async () => {
    routeGet({ '/subscriptions/current': subscriptionRow({ plan: 'CREATOR' }) });
    const store = new SubscriptionStore();

    await store.loadCurrentSubscription();

    expect(store.currentTier).toBe(SubscriptionTier.CREATOR);
    expect(store.planId).toBe('premium');
    expect(store.isPremiumPlan).toBe(true);
  });

  it('an ACTIVE MINI row is Mini, and an expired one is FREE', async () => {
    routeGet({ '/subscriptions/current': subscriptionRow({ plan: 'MINI' }) });
    const store = new SubscriptionStore();
    await store.loadCurrentSubscription();
    expect(store.currentTier).toBe(SubscriptionTier.MINI);
    expect(store.canPlayInBackground).toBe(true);

    routeGet({ '/subscriptions/current': subscriptionRow({ plan: 'MINI', status: 'EXPIRED' }) });
    await store.loadCurrentSubscription();
    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.canPlayInBackground).toBe(false);
  });

  it.each([
    ['CANCELED', SubscriptionStatus.CANCELED],
    ['CANCELLED', SubscriptionStatus.CANCELED],
    ['PAST_DUE', SubscriptionStatus.PAST_DUE],
  ])('%s with a future period end keeps the plan', async (status, parsedStatus) => {
    routeGet({
      '/subscriptions/current': subscriptionRow({ status, cancelAtPeriodEnd: true }),
    });
    const store = new SubscriptionStore();

    await store.loadCurrentSubscription();

    expect(store.isPaid).toBe(true);
    expect(store.subscriptionStatus).toBe(parsedStatus);
  });

  it('EXPIRED row -> FREE, status kept for the UI', async () => {
    routeGet({ '/subscriptions/current': subscriptionRow({ status: 'EXPIRED' }) });
    const store = new SubscriptionStore();
    store.setTierFromUser('PRO');

    await store.loadCurrentSubscription();

    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.isPaid).toBe(false);
    expect(store.subscriptionStatus).toBe(SubscriptionStatus.EXPIRED);
  });

  it('a paid row whose period already ended is FREE even if still ACTIVE', async () => {
    routeGet({
      '/subscriptions/current': subscriptionRow({ status: 'ACTIVE', currentPeriodEnd: PAST_END }),
    });
    const store = new SubscriptionStore();

    await store.loadCurrentSubscription();

    expect(store.isPaid).toBe(false);
    expect(store.currentPeriodEnd?.toISOString()).toBe(new Date(PAST_END).toISOString());
  });

  it('a FREE plan row stays FREE', async () => {
    routeGet({
      '/subscriptions/current': subscriptionRow({ plan: 'FREE', currentPeriodEnd: null }),
    });
    const store = new SubscriptionStore();

    await store.loadCurrentSubscription();

    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(store.currentPeriodEnd).toBeNull();
  });

  it('legacy { tier, expiresAt } payload is still understood', async () => {
    routeGet({ '/subscriptions/current': { tier: 'pro', expiresAt: FUTURE_END } });
    const store = new SubscriptionStore();

    await store.loadCurrentSubscription();

    expect(store.currentTier).toBe(SubscriptionTier.PRO);
    expect(store.isPremiumPlan).toBe(true);
    // Missing status defaults to ACTIVE.
    expect(store.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(store.currentPeriodEnd?.toISOString()).toBe(FUTURE_END);
  });

  it('an unparseable period end is treated as open-ended', async () => {
    routeGet({
      '/subscriptions/current': subscriptionRow({ currentPeriodEnd: 'not-a-date' }),
    });
    const store = new SubscriptionStore();

    await store.loadCurrentSubscription();

    expect(store.isPaid).toBe(true);
    expect(store.currentPeriodEnd).toBeNull();
  });

  it('a garbage body falls back to FREE without throwing', async () => {
    routeGet({ '/subscriptions/current': null });
    const store = new SubscriptionStore();
    store.setTierFromUser('PRO');

    await store.loadCurrentSubscription();

    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.errorMessage).toBe('');
  });

  it('404 (no subscription row) means FREE without an error message', async () => {
    routeGet({
      '/subscriptions/current': apiErrorFromResponse(404, {
        success: false,
        statusCode: 404,
        message: 'Subscription not found',
      }),
    });
    const store = new SubscriptionStore();
    store.setTierFromUser('PRO');
    store.subscriptionStatus = SubscriptionStatus.ACTIVE;
    store.currentPeriodEnd = new Date(FUTURE_END);

    await store.loadCurrentSubscription();

    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.subscriptionStatus).toBeNull();
    expect(store.currentPeriodEnd).toBeNull();
    expect(store.errorMessage).toBe('');
    expect(store.isLoading).toBe(false);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('other failures keep the previous tier and set an error message', async () => {
    routeGet({
      '/subscriptions/current': apiErrorFromResponse(500, { message: 'Internal server error' }),
    });
    const store = new SubscriptionStore();
    store.setTierFromUser('PRO');

    await store.loadCurrentSubscription();

    expect(store.currentTier).toBe(SubscriptionTier.PRO);
    expect(store.errorMessage).toBe('Abonelik bilgisi yüklenemedi');
    expect(store.isLoading).toBe(false);
  });

  it('a network error also keeps the previous state', async () => {
    routeGet({ '/subscriptions/current': apiErrorFromResponse(undefined, null) });
    const store = new SubscriptionStore();

    await store.loadCurrentSubscription();

    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.errorMessage).toBe('Abonelik bilgisi yüklenemedi');
  });

  it('clears a previous error and flags isLoading while in flight', async () => {
    const pendingGet = deferredGet();
    mockApiGet.mockReturnValue(pendingGet.promise);
    const store = new SubscriptionStore();
    store.errorMessage = 'old error';

    const pending = store.loadCurrentSubscription();
    expect(store.isLoading).toBe(true);
    expect(store.errorMessage).toBe('');

    pendingGet.release(subscriptionRow());
    await pending;
    expect(store.isLoading).toBe(false);
  });

  it('re-exports the pure parser used by the store', () => {
    expect(parseCurrentSubscriptionResponse(subscriptionRow(), NOW).tier).toBe(
      SubscriptionTier.PRO,
    );
  });
});

// ============================================================================
// loadUsage (GET /usage)
// ============================================================================

describe('SubscriptionStore.loadUsage', () => {
  it('parses GET /usage into the summary and stamps the time', async () => {
    routeGet({ '/usage': cloneFixture(backendUsageFree) });
    const store = new SubscriptionStore();

    await store.loadUsage();

    expect(mockApiGet).toHaveBeenCalledWith('/usage');
    expect(store.usage?.planId).toBe('free');
    expect(store.usage?.buckets.presetNarrations).toMatchObject({ limit: 20, used: 0, remaining: 20 });
    expect(store.usage?.buckets.cloneNarrations).toMatchObject({ limit: 1, period: 'lifetime' });
    expect(store.usageLoadedAt).toBe(NOW.getTime());
    expect(store.usageError).toBe(false);
  });

  it('a failure keeps the previous usage and sets usageError, without a toast', async () => {
    routeGet({ '/usage': cloneFixture(backendUsageMini) });
    const store = new SubscriptionStore();
    await store.loadUsage();
    const before = store.usage;

    routeGet({ '/usage': apiErrorFromResponse(500, {}) });
    await store.loadUsage();

    expect(store.usage).toBe(before);
    expect(store.usageError).toBe(true);
    expect(store.usageLoadedAt).toBe(NOW.getTime());
    expect(toastError).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalled();
  });

  it('an unreadable body counts as a failure and keeps the previous usage', async () => {
    routeGet({ '/usage': cloneFixture(backendUsageFree) });
    const store = new SubscriptionStore();
    await store.loadUsage();

    routeGet({ '/usage': { plan: 'FREE', buckets: {} } });
    await store.loadUsage();

    expect(store.usage?.planId).toBe('free');
    expect(store.usageError).toBe(true);
  });

  it('a later success clears usageError', async () => {
    routeGet({ '/usage': apiErrorFromResponse(undefined, null) });
    const store = new SubscriptionStore();
    await store.loadUsage();
    expect(store.usageError).toBe(true);

    routeGet({ '/usage': cloneFixture(backendUsageFree) });
    await store.loadUsage();
    expect(store.usageError).toBe(false);
  });

  it('401 stays silent: no log, no error flag', async () => {
    routeGet({ '/usage': apiErrorFromResponse(401, { message: 'expired' }) });
    const store = new SubscriptionStore();

    await store.loadUsage();

    expect(store.usageError).toBe(false);
    expect(store.usage).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('is single-flight: callers during a request share it', async () => {
    const pendingGet = deferredGet();
    mockApiGet.mockReturnValue(pendingGet.promise);
    const store = new SubscriptionStore();

    const a = store.loadUsage();
    const b = store.loadUsage();
    expect(b).toBe(a);
    pendingGet.release(cloneFixture(backendUsageFree));
    await Promise.all([a, b]);

    expect(callsTo('/usage')).toBe(1);

    mockApiGet.mockResolvedValue(cloneFixture(backendUsageMini));
    await store.loadUsage();
    expect(callsTo('/usage')).toBe(2);
    expect(store.planId).toBe('mini');
  });

  it('a failed request does not block the next one', async () => {
    mockApiGet.mockRejectedValueOnce(apiErrorFromResponse(503, {}));
    const store = new SubscriptionStore();
    await store.loadUsage();

    mockApiGet.mockResolvedValueOnce(cloneFixture(backendUsageFree));
    await store.loadUsage();

    expect(callsTo('/usage')).toBe(2);
    expect(store.usage?.planId).toBe('free');
  });
});

describe('SubscriptionStore.loadUsageSoon', () => {
  it('waits USAGE_SOON_DELAY_MS and folds a burst into one request', async () => {
    routeGet({ '/usage': cloneFixture(backendUsageFree) });
    const store = new SubscriptionStore();

    store.loadUsageSoon();
    jest.advanceTimersByTime(USAGE_SOON_DELAY_MS - 500);
    store.loadUsageSoon();
    jest.advanceTimersByTime(USAGE_SOON_DELAY_MS - 1);
    expect(mockApiGet).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    await flush();

    expect(callsTo('/usage')).toBe(1);
    expect(store.usage?.planId).toBe('free');
  });

  it('cleanup cancels a pending one', async () => {
    routeGet({ '/usage': cloneFixture(backendUsageFree) });
    const store = new SubscriptionStore();
    store.loadUsageSoon();

    await store.cleanup();
    jest.advanceTimersByTime(USAGE_SOON_DELAY_MS * 2);
    await flush();

    expect(mockApiGet).not.toHaveBeenCalled();
    expect(store.usage).toBeNull();
  });
});

describe('SubscriptionStore staleness', () => {
  it('loadUsageIfStale asks only without usage or after USAGE_STALE_MS', async () => {
    routeGet({ '/usage': cloneFixture(backendUsageFree) });
    const store = new SubscriptionStore();
    expect(store.isUsageStale()).toBe(true);

    await store.loadUsageIfStale();
    expect(callsTo('/usage')).toBe(1);

    jest.setSystemTime(NOW.getTime() + USAGE_STALE_MS);
    await store.loadUsageIfStale();
    expect(callsTo('/usage')).toBe(1);

    jest.setSystemTime(NOW.getTime() + USAGE_STALE_MS + 1);
    expect(store.isUsageStale()).toBe(true);
    await store.loadUsageIfStale();
    expect(callsTo('/usage')).toBe(2);
  });
});

// ============================================================================
// refresh / launch
// ============================================================================

describe('SubscriptionStore.refresh', () => {
  it('reloads both endpoints every time', async () => {
    routeGet({
      '/subscriptions/current': subscriptionRow(),
      '/usage': usageFor('PRO'),
    });
    const store = new SubscriptionStore();

    await store.refresh();
    routeGet({
      '/subscriptions/current': subscriptionRow({ status: 'EXPIRED' }),
      '/usage': cloneFixture(backendUsageFree),
    });
    await store.refresh();

    expect(callsTo('/subscriptions/current')).toBe(2);
    expect(callsTo('/usage')).toBe(2);
    expect(store.currentTier).toBe(SubscriptionTier.FREE);
    expect(store.planId).toBe('free');
  });

  it('one endpoint failing does not stop the other', async () => {
    routeGet({
      '/subscriptions/current': apiErrorFromResponse(500, {}),
      '/usage': cloneFixture(backendUsageMini),
    });
    const store = new SubscriptionStore();

    await store.refresh();

    expect(store.errorMessage).toBe('Abonelik bilgisi yüklenemedi');
    expect(store.planId).toBe('mini');
  });

  it('cleanup resolves without a request in the free-only build', async () => {
    await expect(new SubscriptionStore().cleanup()).resolves.toBeUndefined();
    expect(mockApiGet).not.toHaveBeenCalled();
  });
});

describe('launch with a token', () => {
  it('requests /subscriptions/current and /usage once each', async () => {
    getSubscriptionStore().reset();
    routeGet({
      '/subscriptions/current': subscriptionRow({ plan: 'MINI' }),
      '/usage': cloneFixture(backendUsageMini),
    });

    // The first screens mount the hook before the navigator signs in.
    const first = renderHook(() => useSubscription());
    const second = renderHook(() => useSubscription());
    await flush();
    expect(second.result.current).toBe(first.result.current);
    expect(mockApiGet).not.toHaveBeenCalled();

    // RootNavigator: seed from the user, then one refresh; a screen asking
    // for usage while it is in flight shares the request.
    const store = first.result.current;
    store.setTierFromUser('MINI');
    const launch = store.refresh();
    void store.loadUsage();
    await launch;

    expect(callsTo('/subscriptions/current')).toBe(1);
    expect(callsTo('/usage')).toBe(1);
    expect(mockApiGet).toHaveBeenCalledTimes(2);
    expect(store.canPlayInBackground).toBe(true);

    first.unmount();
    second.unmount();
    store.reset();
  });
});

// ============================================================================
// Store subscription fields (GET /subscriptions/current)
// ============================================================================

describe('SubscriptionStore store subscription fields', () => {
  it('reads where the plan comes from, the store product and the management address', async () => {
    routeGet({
      '/subscriptions/current': subscriptionRow({
        plan: 'PRO',
        source: 'GOOGLE',
        productId: 'pro_monthly',
        managementUrl: 'https://play.google.com/store/account/subscriptions?sku=pro_monthly&package=com.sesly',
        willRenew: false,
      }),
    });
    const store = new SubscriptionStore();
    await store.loadCurrentSubscription();

    expect(store.source).toBe('GOOGLE');
    expect(store.storeProductId).toBe('pro_monthly');
    expect(store.managementUrl).toContain('play.google.com');
    expect(store.cancelAtPeriodEnd).toBe(true);
    expect(store.hasStoreSubscription).toBe(true);

    // An admin grant is a paid plan without a store subscription.
    routeGet({ '/subscriptions/current': subscriptionRow({ plan: 'PRO', source: 'ADMIN' }) });
    await store.loadCurrentSubscription();
    expect(store.source).toBe('ADMIN');
    expect(store.hasStoreSubscription).toBe(false);

    store.reset();
    expect(store.source).toBeNull();
    expect(store.storeProductId).toBeNull();
    expect(store.managementUrl).toBeNull();
    expect(store.cancelAtPeriodEnd).toBe(false);
  });

  it('a 404 (no row) clears the store fields', async () => {
    routeGet({ '/subscriptions/current': subscriptionRow({ plan: 'PRO', source: 'APPLE', productId: 'io.sesly.pro_yearly' }) });
    const store = new SubscriptionStore();
    await store.loadCurrentSubscription();
    expect(store.source).toBe('APPLE');

    routeGet({ '/subscriptions/current': apiErrorFromResponse(404, { statusCode: 404, message: 'Subscription not found' }) });
    await store.loadCurrentSubscription();
    expect(store.source).toBeNull();
    expect(store.storeProductId).toBeNull();
    expect(store.hasStoreSubscription).toBe(false);
  });
});

// ============================================================================
// cancel / reactivate
// ============================================================================

describe('SubscriptionStore.cancelSubscription', () => {
  it('posts cancel, toasts, and reloads the subscription', async () => {
    routeGet({
      '/subscriptions/current': subscriptionRow({ status: 'CANCELED', cancelAtPeriodEnd: true }),
    });
    const store = new SubscriptionStore();

    await store.cancelSubscription();

    expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/cancel');
    expect(toastInfo).toHaveBeenCalledWith(
      'Aboneliğin dönem sonunda iptal edilecek',
      'İptal Edildi',
    );
    expect(mockApiGet).toHaveBeenCalledWith('/subscriptions/current');
    // Canceled keeps the plan until the period ends.
    expect(store.isPaid).toBe(true);
    expect(store.subscriptionStatus).toBe(SubscriptionStatus.CANCELED);
    expect(store.isLoading).toBe(false);
  });

  it('shows the cancel error in the UI language and does not reload', async () => {
    mockApiPost.mockRejectedValue(apiErrorFromResponse(400, { message: 'Aktif abonelik yok' }));
    const store = new SubscriptionStore();

    await store.cancelSubscription();
    expect(toastError).toHaveBeenCalledWith('Abonelik iptal edilemedi');
    expect(toastInfo).not.toHaveBeenCalled();
    expect(mockApiGet).not.toHaveBeenCalled();
    expect(store.isLoading).toBe(false);

    const i18n = (await import('../i18n')).default;
    await i18n.changeLanguage('en');
    await store.cancelSubscription();
    expect(toastError).toHaveBeenLastCalledWith('Could not cancel your plan');
  });
});

describe('SubscriptionStore.reactivateSubscription', () => {
  it('posts reactivate, toasts success, and reloads the subscription', async () => {
    routeGet({ '/subscriptions/current': subscriptionRow() });
    const store = new SubscriptionStore();

    await store.reactivateSubscription();

    expect(mockApiPost).toHaveBeenCalledWith('/subscriptions/reactivate');
    expect(toastSuccess).toHaveBeenCalledWith('Aboneliğin yeniden aktif edildi');
    expect(store.subscriptionStatus).toBe(SubscriptionStatus.ACTIVE);
    expect(store.isLoading).toBe(false);
  });

  it('shows the reactivate error in the UI language', async () => {
    mockApiPost.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = new SubscriptionStore();

    await store.reactivateSubscription();
    expect(toastError).toHaveBeenCalledWith('Abonelik aktif edilemedi');
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(store.isLoading).toBe(false);

    const i18n = (await import('../i18n')).default;
    await i18n.changeLanguage('en');
    await store.reactivateSubscription();
    expect(toastError).toHaveBeenLastCalledWith('Could not reactivate your plan');
  });
});

// ============================================================================
// Module singleton: useSubscription + getSubscriptionStore
// ============================================================================

describe('useSubscription / getSubscriptionStore', () => {
  it('getSubscriptionStore creates the singleton lazily without any request', () => {
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('./useSubscription') as typeof import('./useSubscription');
      const a = mod.getSubscriptionStore();
      const b = mod.getSubscriptionStore();
      expect(a).toBe(b);
      expect(mockApiGet).not.toHaveBeenCalled();
    });
  });

  it('useSubscription returns the store shared with getSubscriptionStore and requests nothing', async () => {
    getSubscriptionStore().reset();
    const first = renderHook(() => useSubscription());
    const second = renderHook(() => useSubscription());
    await flush();

    expect(second.result.current).toBe(first.result.current);
    expect(getSubscriptionStore()).toBe(first.result.current);
    expect(mockApiGet).not.toHaveBeenCalled();
    expect(mockGetAccessToken).not.toHaveBeenCalled();

    first.unmount();
    second.unmount();
  });
});
