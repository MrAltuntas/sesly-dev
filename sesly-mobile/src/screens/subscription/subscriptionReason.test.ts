/**
 * The reason a plan CTA opens the plans screen with (ux-22).
 */

import i18n from '../../i18n';
import { QUOTA_CODES } from '../../models/Quota';
import { SUBSCRIPTION_REASONS, parseSubscriptionReason, reasonForQuota } from './subscriptionReason';

describe('subscription reasons', () => {
  it('a quota block opens the plans with the reason it is about', () => {
    expect(reasonForQuota(QUOTA_CODES.PRESET_MONTHLY)).toBe('quota');
    expect(reasonForQuota(QUOTA_CODES.CLONE_MONTHLY)).toBe('quota');
    expect(reasonForQuota(QUOTA_CODES.CLONE_LIFETIME)).toBe('quota');
    expect(reasonForQuota(QUOTA_CODES.CLONE_CREATION)).toBe('voices');
    expect(reasonForQuota(QUOTA_CODES.PREMIUM_STORY)).toBe('premiumStory');
  });

  it('reads only the known reasons from route params', () => {
    for (const reason of SUBSCRIPTION_REASONS) expect(parseSubscriptionReason(reason)).toBe(reason);
    expect(parseSubscriptionReason(undefined)).toBeNull();
    expect(parseSubscriptionReason(null)).toBeNull();
    expect(parseSubscriptionReason('QUOTA')).toBeNull();
    expect(parseSubscriptionReason(3)).toBeNull();
  });

  it('every reason has its line in both languages, never the same words', () => {
    for (const reason of SUBSCRIPTION_REASONS) {
      const tr = i18n.getFixedT('tr', 'plans')(`reason.${reason}`);
      const en = i18n.getFixedT('en', 'plans')(`reason.${reason}`);
      expect(tr).not.toBe(`reason.${reason}`);
      expect(en).not.toBe(`reason.${reason}`);
      expect(en).not.toBe(tr);
    }
  });
});
