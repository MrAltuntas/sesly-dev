import { SubscriptionsService, APPLE_MANAGE_SUBSCRIPTIONS_URL, toPublicPurchase } from './subscriptions.service';
import { STORE_PRODUCTS } from '../../common/constants/store-products.constants';
import { PLAN_LIMITS } from '../../common/constants/plans.constants';

const USER = 'u1';
const DAY = 86400000;
const future = () => new Date(Date.now() + 10 * DAY);

describe('SubscriptionsService', () => {
  let prisma: any;
  let appStore: { validate: jest.Mock };
  let googlePlay: { validate: jest.Mock };
  let service: SubscriptionsService;

  beforeEach(() => {
    prisma = { subscription: { findUnique: jest.fn().mockResolvedValue(null) } };
    appStore = { validate: jest.fn() };
    googlePlay = { validate: jest.fn() };
    service = new SubscriptionsService(prisma, appStore as any, googlePlay as any, { packageName: 'com.sesly' } as any);
  });

  describe('GET /subscriptions/current', () => {
    it('no row: 200 FREE (old builds parse plan / status / currentPeriodEnd)', async () => {
      const current = await service.getCurrentSubscription(USER);
      expect(current).toEqual({
        plan: 'FREE',
        planName: 'Ücretsiz',
        isPaid: false,
        grantedPlan: null,
        status: 'ACTIVE',
        source: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        willRenew: false,
        inGracePeriod: false,
        productId: null,
        billingPeriod: null,
        managementUrl: null,
        storePurchase: null,
      });
      expect(prisma.subscription.findUnique).toHaveBeenCalledWith({ where: { userId: USER }, include: { storePurchase: true } });
    });

    it('a Google subscription: resolved plan, renewal, management link, never the token', async () => {
      const end = future();
      prisma.subscription.findUnique.mockResolvedValue({
        plan: 'PRO',
        status: 'ACTIVE',
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        googlePurchaseToken: 'SECRET-TOKEN',
        googleProductId: 'pro_yearly',
        storePurchase: {
          platform: 'GOOGLE',
          purchaseKey: 'SECRET-TOKEN',
          latestTransactionId: 'GPA.SECRET',
          productId: 'pro_yearly',
          plan: 'PRO',
          billingPeriod: 'YEAR',
          state: 'ACTIVE',
          expiresAt: end,
          autoRenew: true,
        },
      });
      const current = await service.getCurrentSubscription(USER);
      expect(current).toMatchObject({
        plan: 'PRO',
        planName: 'Premium',
        isPaid: true,
        status: 'ACTIVE',
        source: 'GOOGLE',
        currentPeriodEnd: end,
        willRenew: true,
        inGracePeriod: false,
        productId: 'pro_yearly',
        billingPeriod: 'year',
        managementUrl: 'https://play.google.com/store/account/subscriptions?sku=pro_yearly&package=com.sesly',
        storePurchase: { platform: 'GOOGLE', productId: 'pro_yearly', billingPeriod: 'year', autoRenew: true },
      });
      expect(JSON.stringify(current)).not.toContain('SECRET');
    });

    it('an Apple subscription in billing grace; a cancelled one does not renew', async () => {
      prisma.subscription.findUnique.mockResolvedValue({
        plan: 'MINI',
        status: 'PAST_DUE',
        currentPeriodEnd: future(),
        cancelAtPeriodEnd: true,
        appleOriginalTransactionId: '2000',
        storePurchase: null,
      });
      expect(await service.getCurrentSubscription(USER)).toMatchObject({
        plan: 'MINI',
        source: 'APPLE',
        inGracePeriod: true,
        willRenew: false,
        managementUrl: APPLE_MANAGE_SUBSCRIPTIONS_URL,
        billingPeriod: null,
      });
    });

    it('legacy rows: Stripe, Google without a product id, admin plan on the row', async () => {
      prisma.subscription.findUnique.mockResolvedValueOnce({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: future(), stripeSubscriptionId: 'sub' });
      expect(await service.getCurrentSubscription(USER)).toMatchObject({ source: 'STRIPE', willRenew: false, managementUrl: null });
      prisma.subscription.findUnique.mockResolvedValueOnce({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: future(), googlePurchaseToken: 't' });
      expect(await service.getCurrentSubscription(USER)).toMatchObject({
        source: 'GOOGLE',
        managementUrl: 'https://play.google.com/store/account/subscriptions?package=com.sesly',
      });
      prisma.subscription.findUnique.mockResolvedValueOnce({ plan: 'CREATOR', status: 'ACTIVE', currentPeriodEnd: null });
      expect(await service.getCurrentSubscription(USER)).toMatchObject({ plan: 'CREATOR', source: 'ADMIN', currentPeriodEnd: null });
    });

    it('an admin grant wins over a lower store plan and says so', async () => {
      const grantEnd = future();
      prisma.subscription.findUnique.mockResolvedValue({
        plan: 'MINI',
        status: 'ACTIVE',
        currentPeriodEnd: future(),
        googlePurchaseToken: 't',
        grantPlan: 'PRO',
        grantEndsAt: grantEnd,
        storePurchase: { platform: 'GOOGLE', productId: 'mini_monthly', plan: 'MINI', billingPeriod: 'MONTH', state: 'ACTIVE', expiresAt: null, autoRenew: true },
      });
      expect(await service.getCurrentSubscription(USER)).toMatchObject({
        plan: 'PRO',
        source: 'ADMIN',
        grantedPlan: 'PRO',
        currentPeriodEnd: grantEnd,
        willRenew: false,
        storePurchase: { productId: 'mini_monthly' },
      });
      prisma.subscription.findUnique.mockResolvedValue({ plan: 'FREE', grantPlan: 'MINI', grantEndsAt: null });
      expect(await service.getCurrentSubscription(USER)).toMatchObject({ plan: 'MINI', currentPeriodEnd: null, storePurchase: null });
    });

    it('a lapsed subscription is FREE with status EXPIRED and the past end', async () => {
      const past = new Date(Date.now() - 5 * DAY);
      prisma.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'EXPIRED', currentPeriodEnd: past, appleOriginalTransactionId: '1' });
      expect(await service.getCurrentSubscription(USER)).toMatchObject({ plan: 'FREE', status: 'EXPIRED', currentPeriodEnd: past });
      prisma.subscription.findUnique.mockResolvedValue({ plan: 'PRO', status: 'EXPIRED' });
      expect(await service.getCurrentSubscription(USER)).toMatchObject({ plan: 'FREE', status: 'EXPIRED', currentPeriodEnd: null });
    });
  });

  it('validate endpoints wrap the store result with the current subscription view', async () => {
    const purchase = { platform: 'APPLE', productId: 'io.sesly.pro_monthly', plan: 'PRO', billingPeriod: 'MONTH', state: 'ACTIVE', expiresAt: future(), autoRenew: true, purchaseKey: 'SECRET' };
    appStore.validate.mockResolvedValue({ purchase, entitled: true });
    const apple = await service.validateAppleTransaction(USER, { signedTransaction: 'jws' } as any);
    expect(appStore.validate).toHaveBeenCalledWith(USER, { signedTransaction: 'jws' });
    expect(apple).toMatchObject({
      success: true,
      entitled: true,
      purchase: { platform: 'APPLE', billingPeriod: 'month' },
      subscription: { plan: 'FREE' },
      expiresAt: purchase.expiresAt,
      isActive: true,
    });
    expect(JSON.stringify(apple)).not.toContain('SECRET');

    googlePlay.validate.mockResolvedValue({ purchase: null, entitled: false });
    expect(await service.validateGooglePurchase(USER, { purchaseToken: 't' } as any)).toMatchObject({
      entitled: false,
      purchase: null,
      expiresAt: null,
    });
    expect(toPublicPurchase({ platform: 'GOOGLE', billingPeriod: 'MONTH' })).toMatchObject({ expiresAt: null, autoRenew: false });
  });

  describe('GET /subscriptions/plans', () => {
    it('FREE, MINI and PREMIUM (PRO) only; CREATOR stays admin-grant only', async () => {
      const { plans } = await service.getPlans();
      expect(plans.map((p) => p.id)).toEqual(['FREE', 'MINI', 'PRO']);
      expect(plans.map((p) => p.name)).toEqual(['Ücretsiz', 'Mini', 'Premium']);
    });

    it('product ids per platform come from the one product map (no premium_* / creator_* ids)', async () => {
      const { plans } = await service.getPlans();
      const [free, mini, pro] = plans;
      expect(free.products).toEqual([]);
      expect(mini).toMatchObject({ appleProductId: 'io.sesly.mini_monthly', googleProductId: 'mini_monthly', appleYearlyProductId: null, price: 49.99 });
      expect(pro).toMatchObject({
        popular: true,
        price: 199.99,
        yearlyPrice: 1499.99,
        appleProductId: 'io.sesly.pro_monthly',
        googleProductId: 'pro_monthly',
        appleYearlyProductId: 'io.sesly.pro_yearly',
        googleYearlyProductId: 'pro_yearly',
      });
      expect(pro.products).toContainEqual({ platform: 'GOOGLE', productId: 'pro_yearly', billingPeriod: 'year', referencePrice: 1499.99 });
      const listed = plans.flatMap((p) => p.products.map((x) => x.productId)).sort();
      expect(listed).toEqual(STORE_PRODUCTS.map((p) => p.productId).sort());
      expect(JSON.stringify(plans)).not.toMatch(/premium_|creator_/);
    });

    it('features and allowances follow PLAN_LIMITS and the UI text rules', async () => {
      const { plans } = await service.getPlans();
      const [free, mini, pro] = plans;
      expect(free.features).toEqual([
        'Hazır anlatıcı seslerle ayda 20 masal',
        'Kendi sesinle 1 masal (tek seferlik hak)',
        'Kendi sesinle 1 ses kaydı',
        '3 hazır anlatıcı ses',
      ]);
      expect(mini.features).toEqual([
        'Hazır anlatıcı seslerle sınırsız masal',
        'Kendi sesinle ayda 5 masal',
        'Kendi sesinle 1 ses kaydı (ayda en fazla 2 yeni kayıt)',
        '10 hazır anlatıcı ses',
        'Tüm masal kataloğu',
        'Arka planda ve kilit ekranında dinleme',
      ]);
      expect(pro.features[1]).toBe('Kendi sesinle ayda 20 masal');
      expect(pro.allowances).toEqual({
        presetNarrations: PLAN_LIMITS.PRO.presetNarrations,
        cloneNarrations: PLAN_LIMITS.PRO.cloneNarrations,
        cloneCreations: PLAN_LIMITS.PRO.cloneCreations,
      });
      expect(free.limits).toMatchObject({ storiesPerMonth: 20, premiumStoriesPerMonth: 1, cloneVoices: 1, monthlyCloneCreations: 1, cloneCreationPeriod: 'lifetime', backgroundPlayback: false });
      expect(pro.limits).toMatchObject({ storiesPerMonth: -1, premiumStoriesPerMonth: 20, backgroundPlayback: true });
      for (const text of plans.flatMap((p) => p.features)) {
        expect(text).not.toMatch(/[\u2014\u2026\u2192\u2190\u2022]|\p{Extended_Pictographic}/u);
      }
    });
  });
});
