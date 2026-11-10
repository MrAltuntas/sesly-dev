/**
 * The typed plan constant (owner decisions of 2026-10-13), the plan card
 * lines, price formatting and the filled part of a usage bar.
 */

import i18n from '../i18n';
import { SubscriptionTier } from '../types/enums';
import {
  PLANS,
  PLAN_CURRENCY,
  PLAN_ORDER,
  PlanDefinition,
  formatPlanPrice,
  planIdForTier,
  planLimitLines,
  storeNameFor,
  usageFraction,
} from './Plans';

describe('PLANS', () => {
  it('lists Ücretsiz, Mini and Premium in that order', () => {
    expect(PLAN_ORDER).toEqual(['free', 'mini', 'premium']);
    expect(Object.keys(PLANS).sort()).toEqual(['free', 'mini', 'premium']);
    expect(PLAN_ORDER.map(id => PLANS[id].id)).toEqual(PLAN_ORDER);
    expect(PLAN_CURRENCY).toBe('TRY');
  });

  it('carries the decided prices', () => {
    expect(PLANS.free.prices).toEqual({ monthly: null, yearly: null });
    expect(PLANS.mini.prices).toEqual({ monthly: 49.99, yearly: null });
    expect(PLANS.premium.prices).toEqual({ monthly: 199.99, yearly: 1499.99 });
  });

  it('carries the decided limits', () => {
    expect(PLANS.free.presetNarrations).toEqual({ amount: 20, period: 'month' });
    // One in total, for life: it never renews.
    expect(PLANS.free.clonedNarrations).toEqual({ amount: 1, period: 'lifetime' });
    expect(PLANS.mini.presetNarrations.amount).toBeNull();
    expect(PLANS.mini.clonedNarrations).toEqual({ amount: 5, period: 'month' });
    expect(PLANS.premium.presetNarrations.amount).toBeNull();
    expect(PLANS.premium.clonedNarrations).toEqual({ amount: 20, period: 'month' });
  });

  it('carries the own-voice creations: one for life on free, monthly on the paid plans', () => {
    expect(PLANS.free.cloneCreations).toEqual({ amount: 1, period: 'lifetime' });
    expect(PLANS.mini.cloneCreations).toEqual({ amount: 2, period: 'month' });
    expect(PLANS.premium.cloneCreations).toEqual({ amount: 5, period: 'month' });
  });

  it('gives background playback and premium stories to the paid plans only', () => {
    expect([PLANS.free.backgroundPlayback, PLANS.free.premiumStories]).toEqual([false, false]);
    expect([PLANS.mini.backgroundPlayback, PLANS.mini.premiumStories]).toEqual([true, true]);
    expect([PLANS.premium.backgroundPlayback, PLANS.premium.premiumStories]).toEqual([true, true]);
  });

  it('knows the Google Play products of the paid plans', () => {
    expect(PLANS.premium.productIds).toEqual({ monthly: 'pro_monthly', yearly: 'pro_yearly' });
    expect(PLANS.mini.productIds).toEqual({ monthly: 'mini_monthly', yearly: null });
    expect(PLANS.free.productIds).toEqual({ monthly: null, yearly: null });
  });

  it('names the paid plans and leaves the free plan to the translations', () => {
    expect(PLANS.free.brandName).toBeNull();
    expect(PLANS.mini.brandName).toBe('Mini');
    expect(PLANS.premium.brandName).toBe('Premium');
  });
});

describe('planIdForTier', () => {
  it('shows MINI as Mini, PRO and CREATOR as Premium and everything else as free', () => {
    expect(planIdForTier(SubscriptionTier.FREE)).toBe('free');
    expect(planIdForTier(SubscriptionTier.MINI)).toBe('mini');
    expect(planIdForTier('MINI')).toBe('mini');
    expect(planIdForTier(SubscriptionTier.PRO)).toBe('premium');
    expect(planIdForTier(SubscriptionTier.CREATOR)).toBe('premium');
    expect(planIdForTier('pro')).toBe('premium');
    expect(planIdForTier(null)).toBe('free');
    expect(planIdForTier('PLATINUM')).toBe('free');
  });
});

describe('planLimitLines', () => {
  const t = (key: string, options?: Record<string, unknown>) => i18n.t(`plans:${key}`, options);

  it('free: 20 a month, the one lifetime story in its One wording, and the screen-off stop', () => {
    expect(planLimitLines(PLANS.free, t)).toEqual([
      'Hazır anlatıcılarla ayda 20 masal',
      'Kendi sesinle toplam 1 masal',
      'Ekran kapanınca masal durur',
    ]);
  });

  it('mini and premium: unlimited narrators, their own-voice number and both perks', () => {
    expect(planLimitLines(PLANS.mini, t)).toEqual([
      'Hazır anlatıcılarla sınırsız masal',
      'Kendi sesinle ayda 5 masal',
      'Ekran kapalıyken dinleme',
      'Premium masallar',
    ]);
    expect(planLimitLines(PLANS.premium, t)).toEqual([
      'Hazır anlatıcılarla sınırsız masal',
      'Kendi sesinle ayda 20 masal',
      'Ekran kapalıyken dinleme',
      'Premium masallar',
    ]);
  });

  it('uses the One variant for a limit of 1 and the amount otherwise', () => {
    const t1 = jest.fn(t);
    const plan: PlanDefinition = {
      ...PLANS.mini,
      presetNarrations: { amount: 1, period: 'month' },
      clonedNarrations: { amount: 1, period: 'month' },
    };
    expect(planLimitLines(plan, t1).slice(0, 2)).toEqual([
      'Hazır anlatıcılarla ayda 1 masal',
      'Kendi sesinle ayda 1 masal',
    ]);
    expect(t1).toHaveBeenCalledWith('limits.presetMonthlyOne');
    expect(t1).toHaveBeenCalledWith('limits.clonedMonthlyOne');

    const lifetime: PlanDefinition = {
      ...PLANS.free,
      clonedNarrations: { amount: 3, period: 'lifetime' },
    };
    expect(planLimitLines(lifetime, t)[1]).toBe('Kendi sesinle toplam 3 masal');
  });

  it('reads the plans namespace in English too', async () => {
    await i18n.changeLanguage('en');
    expect(planLimitLines(PLANS.free, t)).toEqual([
      'Ready-made narrators: 20 stories a month',
      'Own voice: 1 story in total',
      'The story stops when the screen turns off',
    ]);
    expect(planLimitLines(PLANS.premium, t).slice(2)).toEqual([
      'Listening with the screen off',
      'Premium stories',
    ]);
  });
});

describe('formatPlanPrice', () => {
  it('uses a comma decimal and dot thousands in Turkish', () => {
    expect(formatPlanPrice(49.99, 'tr')).toBe('49,99 TL');
    expect(formatPlanPrice(199.99, 'tr')).toBe('199,99 TL');
    expect(formatPlanPrice(1499.99, 'tr')).toBe('1.499,99 TL');
    expect(formatPlanPrice(1234567.5, 'tr')).toBe('1.234.567,50 TL');
  });

  it('uses the ISO code, a dot decimal and comma thousands in English', () => {
    expect(formatPlanPrice(49.99, 'en')).toBe('TRY 49.99');
    expect(formatPlanPrice(1499.99, 'en')).toBe('TRY 1,499.99');
    expect(formatPlanPrice(20, 'en')).toBe('TRY 20.00');
  });

  it('treats an unknown language as Turkish', () => {
    expect(formatPlanPrice(49.99, 'de')).toBe('49,99 TL');
  });
});

describe('storeNameFor', () => {
  it('names the store by platform', () => {
    expect(storeNameFor('ios')).toBe('App Store');
    expect(storeNameFor('android')).toBe('Google Play');
  });
});

describe('usageFraction', () => {
  const meter = (used: number, limit: number | null) => ({
    used,
    limit,
    period: 'month' as const,
    renewsAt: null,
  });

  it('is used over limit, clamped to 0..1', () => {
    expect(usageFraction(meter(12, 20))).toBeCloseTo(0.6);
    expect(usageFraction(meter(1, 1))).toBe(1);
    expect(usageFraction(meter(30, 20))).toBe(1);
    expect(usageFraction(meter(-2, 20))).toBe(0);
  });

  it('has no bar for an unlimited plan and a full one for a zero limit', () => {
    expect(usageFraction(meter(7, null))).toBeNull();
    expect(usageFraction(meter(0, 0))).toBe(1);
  });
});
