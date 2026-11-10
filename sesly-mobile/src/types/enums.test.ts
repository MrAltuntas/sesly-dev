/**
 * Subscription tier parsing: every backend SubscriptionPlan is known (MINI
 * was parsed as FREE before), and "paid" is not the same as "Premium".
 */

import { SubscriptionTier, isPaidTier, parseSubscriptionTier } from './enums';
import { planIdForTier } from '../models/Plans';

describe('parseSubscriptionTier', () => {
  it.each([
    ['FREE', SubscriptionTier.FREE],
    ['MINI', SubscriptionTier.MINI],
    ['PRO', SubscriptionTier.PRO],
    ['CREATOR', SubscriptionTier.CREATOR],
  ] as const)('%s parses to itself', (raw, tier) => {
    expect(parseSubscriptionTier(raw)).toBe(tier);
  });

  it('tolerates case and whitespace', () => {
    expect(parseSubscriptionTier(' mini ')).toBe(SubscriptionTier.MINI);
    expect(parseSubscriptionTier('Pro')).toBe(SubscriptionTier.PRO);
  });

  it.each([null, undefined, '', 'PREMIUM', 'PLATINUM', 3, {}])('%p falls back to FREE', raw => {
    expect(parseSubscriptionTier(raw)).toBe(SubscriptionTier.FREE);
  });
});

describe('isPaidTier', () => {
  it('is true for every plan but FREE', () => {
    expect(isPaidTier(SubscriptionTier.MINI)).toBe(true);
    expect(isPaidTier('MINI')).toBe(true);
    expect(isPaidTier(SubscriptionTier.PRO)).toBe(true);
    expect(isPaidTier(SubscriptionTier.CREATOR)).toBe(true);
    expect(isPaidTier(SubscriptionTier.FREE)).toBe(false);
  });

  it('treats an unknown or missing tier as not paid', () => {
    expect(isPaidTier(null)).toBe(false);
    expect(isPaidTier(undefined)).toBe(false);
    expect(isPaidTier('GOLD')).toBe(false);
  });
});

describe('plans of the tiers', () => {
  it('Premium is PRO or CREATOR; Mini is paid but its own plan', () => {
    expect(planIdForTier(SubscriptionTier.PRO)).toBe('premium');
    expect(planIdForTier(SubscriptionTier.CREATOR)).toBe('premium');
    expect(planIdForTier(SubscriptionTier.MINI)).toBe('mini');
    expect(planIdForTier(SubscriptionTier.FREE)).toBe('free');
  });
});
