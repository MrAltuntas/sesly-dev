import { parseCurrentSubscriptionResponse } from './Subscription';
import {
  SubscriptionStatus,
  SubscriptionTier,
  isPaidTier,
  parseSubscriptionStatus,
} from '../types/enums';
import { planIdForTier } from './Plans';

const NOW = new Date('2026-09-27T12:00:00.000Z');

describe('parseCurrentSubscriptionResponse', () => {
  it('reads plan/status/currentPeriodEnd from the raw Subscription row', () => {
    const parsed = parseCurrentSubscriptionResponse(
      {
        id: 'sub-1',
        userId: 'u-1',
        plan: 'PRO',
        status: 'ACTIVE',
        currentPeriodEnd: '2026-10-27T12:00:00.000Z',
      },
      NOW,
    );
    expect(parsed.tier).toBe(SubscriptionTier.PRO);
    expect(parsed.plan).toBe(SubscriptionTier.PRO);
    expect(parsed.status).toBe(SubscriptionStatus.ACTIVE);
    expect(parsed.currentPeriodEnd?.toISOString()).toBe('2026-10-27T12:00:00.000Z');
  });

  it('treats CREATOR as a paid tier', () => {
    const parsed = parseCurrentSubscriptionResponse(
      { plan: 'CREATOR', status: 'ACTIVE', currentPeriodEnd: null },
      NOW,
    );
    expect(parsed.tier).toBe(SubscriptionTier.CREATOR);
    expect(isPaidTier(parsed.tier)).toBe(true);
    expect(planIdForTier(parsed.tier)).toBe('premium');
  });

  it('keeps an active MINI row as MINI', () => {
    const parsed = parseCurrentSubscriptionResponse(
      { plan: 'MINI', status: 'ACTIVE', currentPeriodEnd: '2026-10-27T12:00:00.000Z' },
      NOW,
    );
    expect(parsed.tier).toBe(SubscriptionTier.MINI);
    expect(isPaidTier(parsed.tier)).toBe(true);
  });

  it('keeps Pro during PAST_DUE and CANCELED until the period ends', () => {
    expect(
      parseCurrentSubscriptionResponse(
        { plan: 'PRO', status: 'PAST_DUE', currentPeriodEnd: '2026-10-01T00:00:00Z' },
        NOW,
      ).tier,
    ).toBe(SubscriptionTier.PRO);
    expect(
      parseCurrentSubscriptionResponse(
        { plan: 'PRO', status: 'CANCELED', currentPeriodEnd: '2026-10-01T00:00:00Z' },
        NOW,
      ).tier,
    ).toBe(SubscriptionTier.PRO);
  });

  it('downgrades to FREE when EXPIRED or the period is over', () => {
    expect(
      parseCurrentSubscriptionResponse({ plan: 'PRO', status: 'EXPIRED' }, NOW).tier,
    ).toBe(SubscriptionTier.FREE);
    expect(
      parseCurrentSubscriptionResponse(
        { plan: 'PRO', status: 'CANCELED', currentPeriodEnd: '2026-09-01T00:00:00Z' },
        NOW,
      ).tier,
    ).toBe(SubscriptionTier.FREE);
  });

  it('downgrades an expired MINI subscription to FREE, keeping the raw plan', () => {
    const expired = parseCurrentSubscriptionResponse({ plan: 'MINI', status: 'EXPIRED' }, NOW);
    expect(expired.tier).toBe(SubscriptionTier.FREE);
    expect(expired.plan).toBe(SubscriptionTier.MINI);

    const periodOver = parseCurrentSubscriptionResponse(
      { plan: 'MINI', status: 'ACTIVE', currentPeriodEnd: '2026-09-01T00:00:00Z' },
      NOW,
    );
    expect(periodOver.tier).toBe(SubscriptionTier.FREE);
    expect(periodOver.status).toBe(SubscriptionStatus.ACTIVE);
  });

  it('defaults to FREE for FREE plans and unknown payloads', () => {
    expect(
      parseCurrentSubscriptionResponse({ plan: 'FREE', status: 'ACTIVE' }, NOW).tier,
    ).toBe(SubscriptionTier.FREE);
    expect(parseCurrentSubscriptionResponse(null, NOW).tier).toBe(
      SubscriptionTier.FREE,
    );
  });
});

describe('tier helpers', () => {
  it('parseSubscriptionStatus accepts both CANCELED spellings', () => {
    expect(parseSubscriptionStatus('CANCELED')).toBe(SubscriptionStatus.CANCELED);
    expect(parseSubscriptionStatus('CANCELLED')).toBe(SubscriptionStatus.CANCELED);
    expect(parseSubscriptionStatus('PAST_DUE')).toBe(SubscriptionStatus.PAST_DUE);
  });
});
