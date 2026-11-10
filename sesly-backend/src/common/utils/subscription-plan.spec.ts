import {
  STORE_RENEWAL_GRACE_MS,
  hasStoreBilling,
  higherPlan,
  isPaidPlan,
  resolveEffectivePlan,
  resolveEffectiveSource,
  resolveGrantPlan,
  resolveRowPlan,
} from './subscription-plan';

// Core scenarios are covered in entitlements.spec.ts; this file locks the edges.
describe('subscription-plan', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  const ms = (offset: number) => new Date(now.getTime() + offset);

  it('grace window is 24 hours', () => {
    expect(STORE_RENEWAL_GRACE_MS).toBe(86_400_000);
  });

  describe('hasStoreBilling', () => {
    it.each([
      [{ plan: 'PRO', stripeSubscriptionId: 'sub_1' }, true],
      [{ plan: 'PRO', appleTransactionId: 'tx' }, true],
      [{ plan: 'PRO', googlePurchaseToken: 'tok' }, true],
      [{ plan: 'PRO' }, false],
      [{ plan: 'PRO', stripeSubscriptionId: '', appleTransactionId: null }, false],
    ])('%j -> %s', (sub, expected) => {
      expect(hasStoreBilling(sub)).toBe(expected);
    });
  });

  describe('resolveEffectivePlan', () => {
    it.each([
      [undefined, 'FREE'],
      [{ plan: 'FREE' }, 'FREE'],
      [{ plan: '' }, 'FREE'],
      [{ plan: 'ENTERPRISE' }, 'FREE'],
      [{ plan: 'pro' }, 'PRO'],
      [{ plan: 'creator', status: 'ACTIVE' }, 'CREATOR'],
      [{ plan: 'PRO', status: 'CANCELLED' }, 'PRO'],
      [{ plan: 'PRO', status: 'PAST_DUE' }, 'PRO'],
      [{ plan: 'CREATOR', status: 'EXPIRED' }, 'FREE'],
    ])('%j -> %s', (sub, expected) => {
      expect(resolveEffectivePlan(sub, now)).toBe(expected);
    });

    it('accepts an ISO string period end', () => {
      expect(resolveEffectivePlan({ plan: 'PRO', currentPeriodEnd: ms(60_000).toISOString() }, now)).toBe('PRO');
      expect(resolveEffectivePlan({ plan: 'PRO', currentPeriodEnd: ms(-60_000).toISOString() }, now)).toBe('FREE');
    });

    it('ignores an unparseable period end (keeps the plan)', () => {
      expect(resolveEffectivePlan({ plan: 'PRO', currentPeriodEnd: 'not-a-date' }, now)).toBe('PRO');
    });

    it('ignores a null period end', () => {
      expect(resolveEffectivePlan({ plan: 'CREATOR', currentPeriodEnd: null }, now)).toBe('CREATOR');
    });

    it('period end exactly now is still active (strict "<" comparison)', () => {
      expect(resolveEffectivePlan({ plan: 'PRO', currentPeriodEnd: now }, now)).toBe('PRO');
    });

    it('store grace boundary: exactly 24h after period end is active, 1 ms later is FREE', () => {
      const sub = { plan: 'PRO', googlePurchaseToken: 'tok' };
      expect(
        resolveEffectivePlan({ ...sub, currentPeriodEnd: ms(-STORE_RENEWAL_GRACE_MS) }, now),
      ).toBe('PRO');
      expect(
        resolveEffectivePlan({ ...sub, currentPeriodEnd: ms(-STORE_RENEWAL_GRACE_MS - 1) }, now),
      ).toBe('FREE');
    });

    it('Stripe-billed subscriptions also get the grace window', () => {
      expect(
        resolveEffectivePlan(
          { plan: 'CREATOR', stripeSubscriptionId: 'sub_1', currentPeriodEnd: ms(-3_600_000) },
          now,
        ),
      ).toBe('CREATOR');
    });

    it('admin grants (no store ids) have no grace', () => {
      expect(resolveEffectivePlan({ plan: 'PRO', currentPeriodEnd: ms(-1) }, now)).toBe('FREE');
    });

    it('EXPIRED wins even inside the period', () => {
      expect(
        resolveEffectivePlan({ plan: 'PRO', status: 'EXPIRED', currentPeriodEnd: ms(86_400_000) }, now),
      ).toBe('FREE');
    });

    it('defaults "now" to the current time', () => {
      const future = new Date(Date.now() + 86_400_000);
      const past = new Date(Date.now() - 86_400_000);
      expect(resolveEffectivePlan({ plan: 'PRO', currentPeriodEnd: future })).toBe('PRO');
      expect(resolveEffectivePlan({ plan: 'PRO', currentPeriodEnd: past })).toBe('FREE');
    });
  });

  describe('admin grant vs store columns (precedence)', () => {
    it('the better of grant and store wins; an ended grant leaves the store plan', () => {
      const sub = { plan: 'MINI', status: 'ACTIVE', currentPeriodEnd: ms(10 * 86400000), googlePurchaseToken: 't', grantPlan: 'PRO', grantEndsAt: ms(86400000) };
      expect(resolveEffectiveSource(sub, now)).toEqual({ plan: 'PRO', source: 'GRANT' });
      expect(resolveEffectiveSource(sub, ms(2 * 86400000))).toEqual({ plan: 'MINI', source: 'STORE' });
      expect(resolveEffectivePlan({ ...sub, grantPlan: 'MINI' }, now)).toBe('MINI');
      expect(resolveEffectiveSource({ ...sub, plan: 'FREE' }, ms(2 * 86400000))).toEqual({ plan: 'FREE', source: 'NONE' });
      expect(resolveEffectiveSource(null)).toEqual({ plan: 'FREE', source: 'NONE' });
    });

    it('a store EXPIRED status does not end a running grant; an open-ended grant never ends', () => {
      expect(resolveEffectivePlan({ plan: 'PRO', status: 'EXPIRED', grantPlan: 'CREATOR', grantEndsAt: null }, now)).toBe('CREATOR');
      expect(resolveGrantPlan({ plan: 'FREE', grantPlan: 'MINI', grantEndsAt: 'not a date' }, now)).toBe('MINI');
      expect(resolveGrantPlan({ plan: 'FREE', grantPlan: 'bogus' }, now)).toBe('FREE');
      expect(resolveGrantPlan({ plan: 'FREE' })).toBe('FREE');
      expect(resolveRowPlan({ plan: 'mini', status: 'ACTIVE' })).toBe('MINI');
      expect(higherPlan('PRO', 'MINI')).toBe('PRO');
      expect(higherPlan('MINI', 'CREATOR')).toBe('CREATOR');
    });

    it('an Apple row with only the original transaction id still gets the store grace', () => {
      expect(hasStoreBilling({ plan: 'PRO', appleOriginalTransactionId: '1' })).toBe(true);
    });
  });

  describe('isPaidPlan', () => {
    it.each([
      ['PRO', true],
      ['CREATOR', true],
      ['MINI', true],
      ['FREE', false],
      ['pro', false],
      [null, false],
      [undefined, false],
    ])('%p -> %s', (plan, expected) => {
      expect(isPaidPlan(plan)).toBe(expected);
    });
  });
});
