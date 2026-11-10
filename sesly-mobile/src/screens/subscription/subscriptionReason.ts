/**
 * Why the plans screen was opened (ux-22): the plan CTA passes a reason and
 * the screen says it in one line above the cards. Kept out of the screen
 * module, so a CTA elsewhere imports it without loading the lazy screen.
 *
 *   navigateSingleton(nav, 'Subscription', { reason: reasonForQuota(block.code) });
 */

import type { RootStackParamList } from '../../navigation/RootNavigator';
import { QUOTA_CODES, type QuotaCode } from '../../models/Quota';

export type SubscriptionReason = NonNullable<NonNullable<RootStackParamList['Subscription']>['reason']>;

export const SUBSCRIPTION_REASONS: readonly SubscriptionReason[] = ['quota', 'voices', 'premiumStory', 'background'];

/** The reason a quota block opens the plans with. */
export function reasonForQuota(code: QuotaCode): SubscriptionReason {
  switch (code) {
    case QUOTA_CODES.PREMIUM_STORY:
      return 'premiumStory';
    case QUOTA_CODES.CLONE_CREATION:
      return 'voices';
    default:
      return 'quota';
  }
}

/** A reason from route params; anything unknown is no reason. */
export function parseSubscriptionReason(value: unknown): SubscriptionReason | null {
  return SUBSCRIPTION_REASONS.includes(value as SubscriptionReason) ? (value as SubscriptionReason) : null;
}
