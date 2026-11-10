import { renderMessage } from '../../test-utils/i18n';
import {
  getNarrationLimits,
  getPlanLimits,
  isPaidPlanValue,
  NARRATION_LIMITS,
  PLAN_LIMITS,
  PLAN_NAMES,
  PLAN_PRICES,
  PLAN_RANK,
  PLAN_YEARLY_PRICES,
  toPlan,
} from './plans.constants';
import {
  findStoreProduct,
  periodLabel,
  STORE_PRODUCTS,
  storeProductsForPlan,
} from './store-products.constants';
import {
  cloneCreationLimitError,
  CLONE_VOICE_SLOTS,
  getCloneCreationAllowance,
  getCloneVoiceSlots,
  getTotalVoiceSlots,
  PRESET_VOICE_SLOTS,
  VOICE_SLOTS,
} from './voice-slots.constants';
import { formatTurkishDate } from '../utils/turkish-date';

describe('plan limits (owner decisions 2026-10-13)', () => {
  it('ready-made narrations: FREE 20 a month, every paid plan unlimited', () => {
    expect(PLAN_LIMITS.FREE.presetNarrations).toEqual({ limit: 20, period: 'month' });
    for (const plan of ['MINI', 'PRO', 'CREATOR'] as const) {
      expect(PLAN_LIMITS[plan].presetNarrations.limit).toBeNull();
    }
  });

  it('cloned-voice narrations: FREE 1 lifetime, MINI 5 a month, PREMIUM 20 a month', () => {
    expect(PLAN_LIMITS.FREE.cloneNarrations).toEqual({ limit: 1, period: 'lifetime' });
    expect(PLAN_LIMITS.MINI.cloneNarrations).toEqual({ limit: 5, period: 'month' });
    expect(PLAN_LIMITS.PRO.cloneNarrations).toEqual({ limit: 20, period: 'month' });
  });

  it('clone creations: FREE 1 lifetime with one clone slot, MINI 2 / month, PREMIUM 5 / month', () => {
    expect(PLAN_LIMITS.FREE.cloneCreations).toEqual({ limit: 1, period: 'lifetime' });
    expect(PLAN_LIMITS.FREE.cloneVoiceSlots).toBe(1);
    expect(PLAN_LIMITS.MINI.cloneCreations).toEqual({ limit: 2, period: 'month' });
    expect(PLAN_LIMITS.PRO.cloneCreations).toEqual({ limit: 5, period: 'month' });
  });

  it('lock-screen / background playback is paid only', () => {
    expect(PLAN_LIMITS.FREE.backgroundPlayback).toBe(false);
    expect(PLAN_LIMITS.MINI.backgroundPlayback).toBe(true);
    expect(PLAN_LIMITS.PRO.backgroundPlayback).toBe(true);
  });

  it('CREATOR (admin grant) has at least everything PREMIUM has; ranking FREE < MINI < PRO < CREATOR', () => {
    expect(PLAN_LIMITS.CREATOR.cloneNarrations.limit!).toBeGreaterThanOrEqual(PLAN_LIMITS.PRO.cloneNarrations.limit!);
    expect(PLAN_LIMITS.CREATOR.cloneVoiceSlots).toBeGreaterThanOrEqual(PLAN_LIMITS.PRO.cloneVoiceSlots);
    expect(PLAN_RANK.FREE < PLAN_RANK.MINI && PLAN_RANK.MINI < PLAN_RANK.PRO && PLAN_RANK.PRO < PLAN_RANK.CREATOR).toBe(true);
  });

  it('names and reference prices', () => {
    expect(PLAN_NAMES).toEqual({ FREE: 'Ücretsiz', MINI: 'Mini', PRO: 'Premium', CREATOR: 'Creator' });
    expect(PLAN_PRICES).toMatchObject({ FREE: 0, MINI: 49.99, PRO: 199.99 });
    expect(PLAN_YEARLY_PRICES.PRO).toBe(1499.99);
  });

  it('plan strings are normalised; unknown is FREE', () => {
    expect(toPlan('mini')).toBe('MINI');
    expect(toPlan(null)).toBe('FREE');
    expect(toPlan('GOLD')).toBe('FREE');
    expect(getPlanLimits(undefined)).toBe(PLAN_LIMITS.FREE);
    expect(isPaidPlanValue('pro')).toBe(true);
    expect(isPaidPlanValue('FREE')).toBe(false);
  });

  it('legacy monthly view: -1 = unlimited', () => {
    expect(NARRATION_LIMITS.FREE).toEqual({ premium: 1, standard: 20 });
    expect(NARRATION_LIMITS.MINI).toEqual({ premium: 5, standard: -1 });
    expect(getNarrationLimits('PRO')).toEqual({ premium: 20, standard: -1 });
  });
});

describe('store product map', () => {
  it('exactly the six owner-approved product ids', () => {
    expect(STORE_PRODUCTS.map((p) => `${p.platform}:${p.productId}:${p.plan}:${p.period}`).sort()).toEqual([
      'APPLE:io.sesly.mini_monthly:MINI:MONTH',
      'APPLE:io.sesly.pro_monthly:PRO:MONTH',
      'APPLE:io.sesly.pro_yearly:PRO:YEAR',
      'GOOGLE:mini_monthly:MINI:MONTH',
      'GOOGLE:pro_monthly:PRO:MONTH',
      'GOOGLE:pro_yearly:PRO:YEAR',
    ]);
  });

  it('lookups are exact per platform; unknown or other-platform ids are undefined', () => {
    expect(findStoreProduct('GOOGLE', 'pro_yearly')).toMatchObject({ plan: 'PRO', period: 'YEAR' });
    expect(findStoreProduct('APPLE', 'pro_yearly')).toBeUndefined();
    expect(findStoreProduct('GOOGLE', 'premium_monthly')).toBeUndefined();
    expect(findStoreProduct('APPLE', 'io.sesly.creator_monthly')).toBeUndefined();
    expect(findStoreProduct('GOOGLE', null)).toBeUndefined();
    expect(storeProductsForPlan('CREATOR')).toEqual([]);
    expect(storeProductsForPlan('MINI')).toHaveLength(2);
    expect(periodLabel('YEAR')).toBe('year');
    expect(periodLabel('MONTH')).toBe('month');
  });
});

describe('voice slots derived from PLAN_LIMITS', () => {
  it('slots and totals', () => {
    expect(PRESET_VOICE_SLOTS).toEqual({ FREE: 3, MINI: 10, PRO: 10, CREATOR: 20 });
    expect(CLONE_VOICE_SLOTS).toEqual({ FREE: 1, MINI: 1, PRO: 3, CREATOR: 5 });
    expect(VOICE_SLOTS.PRO).toBe(13);
    expect(getCloneVoiceSlots('MINI', 2)).toBe(3);
    expect(getCloneVoiceSlots('FREE')).toBe(1);
    expect(getTotalVoiceSlots('FREE')).toBe(4);
    expect(getCloneCreationAllowance('nope')).toEqual({ limit: 1, period: 'lifetime' });
  });

  it('creation limit messages say what renews when, with Turkish dates and no forbidden characters', () => {
    const month = renderMessage(cloneCreationLimitError({ limit: 2, period: 'month' }, new Date(2026, 10, 1)));
    expect(month).toContain('1 Kasım tarihinde yenilenir');
    expect(renderMessage(cloneCreationLimitError({ limit: 2, period: 'month' }, null))).not.toContain('yenilenir.');
    const lifetime = renderMessage(cloneCreationLimitError({ limit: 1, period: 'lifetime' }, null));
    expect(lifetime).toContain('Bu hak yenilenmez');
    const monthEn = renderMessage(
      cloneCreationLimitError({ limit: 2, period: 'month' }, new Date(2026, 10, 1)),
      'en',
    );
    expect(monthEn).toContain('renew on November 1');
    const lifetimeEn = renderMessage(cloneCreationLimitError({ limit: 1, period: 'lifetime' }, null), 'en');
    expect(lifetimeEn).toContain('Free plan (1)');
    for (const text of [month, lifetime, monthEn, lifetimeEn]) {
      expect(text).not.toMatch(/[\u2014\u2026\u2192\u2190\u2022]|\p{Extended_Pictographic}/u);
    }
  });

  it('formatTurkishDate', () => {
    expect(formatTurkishDate(new Date(2026, 0, 1))).toBe('1 Ocak');
    expect(formatTurkishDate(new Date(2026, 7, 31))).toBe('31 Ağustos');
    expect(formatTurkishDate(new Date(2026, 11, 1))).toBe('1 Aralık');
  });
});
