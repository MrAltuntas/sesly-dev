/**
 * Quota model: GET /usage parsing, the coded quota 403s and the copy shown
 * for them (src/models/Quota.ts). Fixtures are the backend wire shapes from
 * src/test-utils/contract-fixtures.ts.
 */

import i18n from '../i18n';
import { apiErrorFromResponse } from '../services/ApiError';
import {
  ISO_USAGE_RENEWS,
  backendCloneCreationLimitError,
  backendCloneCreationLimitMonthlyError,
  backendPremiumStoryError,
  backendQuotaCloneLifetimeError,
  backendQuotaCloneMonthlyError,
  backendQuotaPresetMonthlyError,
  backendUsageFree,
  backendUsageMini,
  cloneFixture,
} from '../test-utils/contract-fixtures';
import {
  QUOTA_CODES,
  QuotaBlock,
  QuotaCode,
  UsageBucket,
  blockForUsedUpBucket,
  describeQuotaBlock,
  isQuotaCode,
  narrationBucket,
  parseQuotaBlock,
  parseUsageSummary,
  remainingNarrationsLine,
  renewalLine,
} from './Quota';
import type { PlanId } from './Plans';

type Json = Record<string, any>;

/** 1 November in the device's own time zone, so getDate() is 1 everywhere. */
const NOV_1 = new Date(2026, 10, 1, 12, 0, 0);

const block = (
  code: QuotaCode,
  planId: PlanId,
  overrides: Partial<QuotaBlock> = {},
): QuotaBlock => ({
  code,
  planId,
  limit: null,
  period: null,
  renewsAt: null,
  ...overrides,
});

const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;

// ============================================================================
// parseUsageSummary
// ============================================================================

describe('parseUsageSummary', () => {
  it('reads the FREE summary: 20 a month, lifetime own voice, slots and features', () => {
    const usage = parseUsageSummary(cloneFixture(backendUsageFree));
    expect(usage).not.toBeNull();
    expect(usage?.planId).toBe('free');
    expect(usage?.buckets.presetNarrations).toEqual({
      limit: 20,
      used: 0,
      remaining: 20,
      period: 'month',
      renewsAt: new Date(ISO_USAGE_RENEWS),
    });
    expect(usage?.buckets.cloneNarrations).toEqual({
      limit: 1,
      used: 0,
      remaining: 1,
      period: 'lifetime',
      renewsAt: null,
    });
    expect(usage?.buckets.cloneCreations.remaining).toBe(0);
    expect(usage?.voiceSlots).toEqual({ preset: { used: 2, limit: 3 }, clone: { used: 1, limit: 1 } });
    expect(usage?.features).toEqual({ backgroundPlayback: false, premiumStories: false });
  });

  it('reads a null limit as unlimited with no remaining count (MINI)', () => {
    const usage = parseUsageSummary(cloneFixture(backendUsageMini));
    expect(usage?.planId).toBe('mini');
    expect(usage?.buckets.presetNarrations).toMatchObject({ limit: null, used: 12, remaining: null });
    expect(usage?.buckets.cloneNarrations).toMatchObject({ limit: 5, used: 3, remaining: 2 });
    expect(usage?.features).toEqual({ backgroundPlayback: true, premiumStories: true });
  });

  it('reads a -1 limit as unlimited too', () => {
    const json: Json = cloneFixture(backendUsageMini);
    json.buckets.cloneCreations = { limit: -1, used: 4, remaining: -1, period: 'month', renewsAt: null };
    expect(parseUsageSummary(json)?.buckets.cloneCreations).toEqual({
      limit: null,
      used: 4,
      remaining: null,
      period: 'month',
      renewsAt: null,
    });
  });

  it('works the remaining count out when it is missing, never below zero', () => {
    const json: Json = cloneFixture(backendUsageFree);
    delete json.buckets.presetNarrations.remaining;
    json.buckets.cloneNarrations = { limit: 1, used: 3, period: 'lifetime', renewsAt: null };
    const usage = parseUsageSummary(json);
    expect(usage?.buckets.presetNarrations.remaining).toBe(20);
    expect(usage?.buckets.cloneNarrations.remaining).toBe(0);
  });

  it('drops a renewal date on a lifetime bucket and an unreadable one on a monthly bucket', () => {
    const json: Json = cloneFixture(backendUsageFree);
    json.buckets.cloneNarrations.renewsAt = ISO_USAGE_RENEWS;
    json.buckets.presetNarrations.renewsAt = 'soon';
    const usage = parseUsageSummary(json);
    expect(usage?.buckets.cloneNarrations.renewsAt).toBeNull();
    expect(usage?.buckets.presetNarrations.renewsAt).toBeNull();
  });

  it.each([
    ['PRO', 'premium'],
    ['CREATOR', 'premium'],
    ['mini', 'mini'],
  ])('plan %s is shown as %s', (plan, planId) => {
    const json: Json = cloneFixture(backendUsageMini);
    json.plan = plan;
    expect(parseUsageSummary(json)?.planId).toBe(planId);
  });

  it('ignores fields a newer backend adds', () => {
    const json: Json = cloneFixture(backendUsageFree);
    json.buckets.presetNarrations.bonus = 3;
    json.buckets.extraBucket = { limit: 1 };
    json.something = true;
    expect(parseUsageSummary(json)).toEqual(parseUsageSummary(backendUsageFree));
  });

  const broken: Array<[string, (json: Json) => unknown]> = [
    ['null', () => null],
    ['an array', () => []],
    ['a string', () => 'usage'],
    ['no plan', json => ({ ...json, plan: undefined })],
    ['an unknown plan', json => ({ ...json, plan: 'GOLD' })],
    ['no buckets', json => ({ ...json, buckets: null })],
    ['a missing bucket', json => ({ ...json, buckets: { ...json.buckets, cloneCreations: undefined } })],
    ['a bucket without used', json => ({ ...json, buckets: { ...json.buckets, presetNarrations: { limit: 20, period: 'month' } } })],
    ['a negative used', json => ({ ...json, buckets: { ...json.buckets, presetNarrations: { ...json.buckets.presetNarrations, used: -1 } } })],
    ['a string limit', json => ({ ...json, buckets: { ...json.buckets, presetNarrations: { ...json.buckets.presetNarrations, limit: '20' } } })],
    ['an unknown period', json => ({ ...json, buckets: { ...json.buckets, presetNarrations: { ...json.buckets.presetNarrations, period: 'week' } } })],
    ['no voice slots', json => ({ ...json, voiceSlots: undefined })],
    ['a broken voice slot', json => ({ ...json, voiceSlots: { preset: { used: 1 }, clone: json.voiceSlots.clone } })],
    ['no features', json => ({ ...json, features: undefined })],
    ['a feature that is not a boolean', json => ({ ...json, features: { backgroundPlayback: 'yes', premiumStories: false } })],
  ];

  it.each(broken)('returns null for %s', (_name, mutate) => {
    expect(parseUsageSummary(mutate(cloneFixture(backendUsageFree) as Json))).toBeNull();
  });
});

// ============================================================================
// parseQuotaBlock
// ============================================================================

describe('parseQuotaBlock', () => {
  it('reads a FREE ready-made 403 from the ApiError: code, plan, limit, period, renewal', () => {
    const error = apiErrorFromResponse(403, cloneFixture(backendQuotaPresetMonthlyError));
    expect(parseQuotaBlock(error, 'premium')).toEqual({
      code: QUOTA_CODES.PRESET_MONTHLY,
      planId: 'free',
      limit: 20,
      period: 'month',
      renewsAt: new Date(ISO_USAGE_RENEWS),
    });
  });

  it('a lifetime own-voice 403 has no renewal date', () => {
    const error = apiErrorFromResponse(403, cloneFixture(backendQuotaCloneLifetimeError));
    expect(parseQuotaBlock(error, 'free')).toEqual({
      code: QUOTA_CODES.CLONE_LIFETIME,
      planId: 'free',
      limit: 1,
      period: 'lifetime',
      renewsAt: null,
    });
  });

  it('takes the plan from the error body over the caller fallback (MINI)', () => {
    const error = apiErrorFromResponse(403, cloneFixture(backendQuotaCloneMonthlyError));
    expect(parseQuotaBlock(error, 'free')).toMatchObject({
      code: QUOTA_CODES.CLONE_MONTHLY,
      planId: 'mini',
      limit: 5,
      period: 'month',
    });
  });

  it('reads both clone creation variants', () => {
    const lifetime = parseQuotaBlock(
      apiErrorFromResponse(403, cloneFixture(backendCloneCreationLimitError)),
      'free',
    );
    expect(lifetime).toEqual({
      code: QUOTA_CODES.CLONE_CREATION,
      planId: 'free',
      limit: 1,
      period: 'lifetime',
      renewsAt: null,
    });
    const monthly = parseQuotaBlock(
      apiErrorFromResponse(403, cloneFixture(backendCloneCreationLimitMonthlyError)),
      'free',
    );
    expect(monthly).toEqual({
      code: QUOTA_CODES.CLONE_CREATION,
      planId: 'mini',
      limit: 2,
      period: 'month',
      renewsAt: new Date(ISO_USAGE_RENEWS),
    });
  });

  it('PREMIUM_STORY carries no numbers and uses the fallback plan', () => {
    const error = apiErrorFromResponse(403, cloneFixture(backendPremiumStoryError));
    expect(parseQuotaBlock(error, 'free')).toEqual({
      code: QUOTA_CODES.PREMIUM_STORY,
      planId: 'free',
      limit: null,
      period: null,
      renewsAt: null,
    });
  });

  it('fills a body without plan or limit from the fallback plan constant', () => {
    const error = apiErrorFromResponse(403, { statusCode: 403, code: 'QUOTA_CLONE_MONTHLY' });
    expect(parseQuotaBlock(error, 'mini')).toEqual({
      code: QUOTA_CODES.CLONE_MONTHLY,
      planId: 'mini',
      limit: 5,
      period: 'month',
      renewsAt: null,
    });
    const creation = apiErrorFromResponse(403, { code: 'CLONE_CREATION_LIMIT' });
    expect(parseQuotaBlock(creation, 'free')).toMatchObject({ limit: 1, period: 'lifetime' });
  });

  it('reads a null or -1 limit on a used-up allowance as unknown, never as unlimited', () => {
    const nullLimit = apiErrorFromResponse(403, {
      ...cloneFixture(backendQuotaCloneMonthlyError),
      limit: null,
    });
    const parsed = parseQuotaBlock(nullLimit, 'free');
    expect(parsed).toMatchObject({ planId: 'mini', limit: 5 });
    // So the copy never shows a sentence with the number missing.
    expect(describeQuotaBlock(parsed as QuotaBlock).message).toContain('ayda 5 masal');

    const minusOne = apiErrorFromResponse(403, {
      ...cloneFixture(backendCloneCreationLimitMonthlyError),
      limit: -1,
    });
    expect(parseQuotaBlock(minusOne, 'free')).toMatchObject({ planId: 'mini', limit: 2 });
  });

  it('accepts a plain object of the ApiError shape', () => {
    expect(
      parseQuotaBlock({ status: 403, code: null, data: { code: 'QUOTA_PRESET_MONTHLY', limit: 20 } }, 'free'),
    ).toMatchObject({ code: QUOTA_CODES.PRESET_MONTHLY, limit: 20, period: 'month' });
  });

  it.each([
    ['a 409 with a code', apiErrorFromResponse(409, { code: 'QUOTA_PRESET_MONTHLY' })],
    ['a 403 with another code', apiErrorFromResponse(403, { code: 'CLONE_SLOT_LIMIT', limit: 1 })],
    ['a 403 without a code', apiErrorFromResponse(403, { message: 'Yasak' })],
    ['a network error', apiErrorFromResponse(undefined, null)],
    ['a plain Error', new Error('boom')],
    ['null', null],
    ['a string', 'QUOTA_PRESET_MONTHLY'],
  ])('returns null for %s', (_name, error) => {
    expect(parseQuotaBlock(error, 'free')).toBeNull();
  });

  it('isQuotaCode knows exactly the five codes', () => {
    expect(Object.values(QUOTA_CODES).every(isQuotaCode)).toBe(true);
    expect(isQuotaCode('CLONE_MONTHLY_LIMIT')).toBe(false);
    expect(isQuotaCode(undefined)).toBe(false);
  });
});

// ============================================================================
// renewalLine
// ============================================================================

describe('renewalLine', () => {
  it('names the day and month in the UI language', async () => {
    expect(renewalLine(NOV_1)).toBe("1 Kasım'da yenilenir.");
    expect(renewalLine(new Date(2026, 0, 15, 12))).toBe("15 Ocak'ta yenilenir.");
    await i18n.changeLanguage('en');
    expect(renewalLine(NOV_1)).toBe('Renews on 1 November.');
  });
});

// ============================================================================
// describeQuotaBlock
// ============================================================================

describe('describeQuotaBlock', () => {
  it('FREE ready-made: the limit, the renewal date and the upsell', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.PRESET_MONTHLY, 'free', { limit: 20, period: 'month', renewsAt: NOV_1 }),
    );
    expect(copy).toEqual({
      title: 'Bu ayki masal hakkın doldu',
      message:
        "Ücretsiz planda hazır anlatıcılarla ayda 20 masal dinleyebilirsin. 1 Kasım'da yenilenir. Mini ve Premium planlarda sınırsız.",
      offerPlans: true,
      offerReadyMade: false,
    });
  });

  it('FREE ready-made from the real 403 carries the date of that error', () => {
    const parsed = parseQuotaBlock(
      apiErrorFromResponse(403, cloneFixture(backendQuotaPresetMonthlyError)),
      'free',
    );
    const copy = describeQuotaBlock(parsed as QuotaBlock);
    expect(copy.message).toContain(renewalLine(new Date(ISO_USAGE_RENEWS)));
    expect(copy.message).not.toContain(backendQuotaPresetMonthlyError.message);
  });

  it('FREE own voice for life: says it does not renew, offers the plans and a ready-made narrator', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.CLONE_LIFETIME, 'free', { limit: 1, period: 'lifetime' }),
    );
    expect(copy).toEqual({
      title: 'Kendi sesinle masal hakkın doldu',
      message:
        'Ücretsiz planda kendi sesinle 1 masal dinleyebilirsin. Bu hak yenilenmez. Kendi sesinle daha fazla masal için Mini ya da Premium plana geçebilirsin.',
      offerPlans: true,
      offerReadyMade: true,
    });
    expect(copy.message).not.toMatch(/yenilenir\./);
  });

  it('uses the counted sentence above 1', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.CLONE_LIFETIME, 'free', { limit: 3, period: 'lifetime' }),
    );
    expect(copy.message.startsWith('Ücretsiz planda kendi sesinle 3 masal dinleyebilirsin.')).toBe(true);
  });

  it('MINI own voice this month: renewal, the Premium upsell, plans and ready-made offered', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.CLONE_MONTHLY, 'mini', { limit: 5, period: 'month', renewsAt: NOV_1 }),
    );
    expect(copy).toEqual({
      title: 'Bu ay kendi sesinle masal hakkın doldu',
      message: "Planında kendi sesinle ayda 5 masal var. 1 Kasım'da yenilenir. Premium planda daha fazlası var.",
      offerPlans: true,
      offerReadyMade: true,
    });
  });

  it('Premium own voice this month: no plans to offer and no upsell, ready-made only', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.CLONE_MONTHLY, 'premium', { limit: 20, period: 'month', renewsAt: NOV_1 }),
    );
    expect(copy.offerPlans).toBe(false);
    expect(copy.offerReadyMade).toBe(true);
    expect(copy.message).toBe("Planında kendi sesinle ayda 20 masal var. 1 Kasım'da yenilenir.");
  });

  it('a monthly block without a date leaves the renewal sentence out', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.CLONE_MONTHLY, 'premium', { limit: 1, period: 'month' }),
    );
    expect(copy.message).toBe('Planında kendi sesinle ayda 1 masal var.');
  });

  it('FREE creation for life: once, it does not renew, a delete does not give it back', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.CLONE_CREATION, 'free', { limit: 1, period: 'lifetime' }),
    );
    expect(copy).toEqual({
      title: 'Kendi ses hakkını kullandın',
      message:
        'Ücretsiz planda kendi sesini bir kez kaydedebilirsin. Bu hak yenilenmez, sesi silmek de yeni hak vermez. Yeni bir ses için Mini ya da Premium plana geçebilirsin.',
      offerPlans: true,
      offerReadyMade: false,
    });
    expect(copy.message).not.toMatch(/\bay\b|ayda|aylık/);
  });

  it('MINI creations this month: the limit, the date and the Premium upsell', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.CLONE_CREATION, 'mini', { limit: 2, period: 'month', renewsAt: NOV_1 }),
    );
    expect(copy.title).toBe('Bu ayki yeni ses hakkın doldu');
    expect(copy.message).toBe(
      "Planında ayda 2 yeni ses kaydı var. 1 Kasım'da yenilenir. Premium planda daha fazlası var.",
    );
    expect(copy.offerPlans).toBe(true);
    expect(copy.offerReadyMade).toBe(false);
  });

  it('one creation a month uses the One sentence; Premium has no offer', () => {
    const copy = describeQuotaBlock(
      block(QUOTA_CODES.CLONE_CREATION, 'premium', { limit: 1, period: 'month' }),
    );
    expect(copy.message).toBe('Planında ayda 1 yeni ses kaydı var.');
    expect(copy.offerPlans).toBe(false);
  });

  it('PREMIUM_STORY: one sentence naming the plans, not repeated as an upsell', () => {
    const copy = describeQuotaBlock(block(QUOTA_CODES.PREMIUM_STORY, 'free'));
    expect(copy).toEqual({
      title: 'Bu masal ücretli planlarda',
      message: 'Mini ya da Premium planla dinleyebilirsin.',
      offerPlans: true,
      offerReadyMade: false,
    });
  });

  it('uses the One variant at 1 for every counted message', () => {
    expect(
      describeQuotaBlock(block(QUOTA_CODES.PRESET_MONTHLY, 'free', { limit: 1, period: 'month' })).message,
    ).toBe('Ücretsiz planda hazır anlatıcılarla ayda 1 masal dinleyebilirsin. Mini ve Premium planlarda sınırsız.');
    expect(
      describeQuotaBlock(block(QUOTA_CODES.CLONE_MONTHLY, 'premium', { limit: 1, period: 'month' })).message,
    ).toBe('Planında kendi sesinle ayda 1 masal var.');
  });

  describe('in English', () => {
    beforeEach(async () => {
      await i18n.changeLanguage('en');
    });

    const blocks: Array<[string, QuotaBlock]> = [
      ['preset FREE', block(QUOTA_CODES.PRESET_MONTHLY, 'free', { limit: 20, period: 'month', renewsAt: NOV_1 })],
      ['clone lifetime FREE', block(QUOTA_CODES.CLONE_LIFETIME, 'free', { limit: 1, period: 'lifetime' })],
      ['clone monthly MINI', block(QUOTA_CODES.CLONE_MONTHLY, 'mini', { limit: 5, period: 'month', renewsAt: NOV_1 })],
      ['clone monthly PRO', block(QUOTA_CODES.CLONE_MONTHLY, 'premium', { limit: 20, period: 'month', renewsAt: NOV_1 })],
      ['creation lifetime FREE', block(QUOTA_CODES.CLONE_CREATION, 'free', { limit: 1, period: 'lifetime' })],
      ['creation monthly MINI', block(QUOTA_CODES.CLONE_CREATION, 'mini', { limit: 2, period: 'month', renewsAt: NOV_1 })],
      ['premium story FREE', block(QUOTA_CODES.PREMIUM_STORY, 'free')],
    ];

    it.each(blocks)('%s has no Turkish text', (_name, b) => {
      const copy = describeQuotaBlock(b);
      expect(copy.title).not.toMatch(TURKISH_LETTERS);
      expect(copy.message).not.toMatch(TURKISH_LETTERS);
      expect(copy.message).not.toMatch(/masal|yenilen|plan[ıi]/);
    });

    it('reads as English sentences', () => {
      expect(describeQuotaBlock(blocks[0][1])).toMatchObject({
        title: "You have used this month's stories",
        message:
          'The free plan includes 20 stories a month with ready-made narrators. Renews on 1 November. Unlimited on Mini and Premium.',
      });
      expect(describeQuotaBlock(blocks[1][1]).message).toBe(
        'The free plan includes 1 story in your own voice. It does not renew. Switch to Mini or Premium for more stories in your own voice.',
      );
    });
  });
});

// ============================================================================
// Pre-check helpers (story detail)
// ============================================================================

describe('blockForUsedUpBucket', () => {
  const bucket = (overrides: Partial<UsageBucket>): UsageBucket => ({
    limit: 20,
    used: 20,
    remaining: 0,
    period: 'month',
    renewsAt: NOV_1,
    ...overrides,
  });

  it('maps a used-up bucket to the code the backend would answer with', () => {
    expect(blockForUsedUpBucket('preset', bucket({}), 'free')).toEqual({
      code: QUOTA_CODES.PRESET_MONTHLY,
      planId: 'free',
      limit: 20,
      period: 'month',
      renewsAt: NOV_1,
    });
    expect(
      blockForUsedUpBucket('clone', bucket({ limit: 1, used: 1, period: 'lifetime', renewsAt: null }), 'free')
        ?.code,
    ).toBe(QUOTA_CODES.CLONE_LIFETIME);
    expect(blockForUsedUpBucket('clone', bucket({ limit: 5, used: 5 }), 'mini')?.code).toBe(
      QUOTA_CODES.CLONE_MONTHLY,
    );
  });

  it('is null while something is left or the bucket is unlimited', () => {
    expect(blockForUsedUpBucket('preset', bucket({ used: 19, remaining: 1 }), 'free')).toBeNull();
    expect(
      blockForUsedUpBucket('preset', bucket({ limit: null, remaining: null, used: 50 }), 'mini'),
    ).toBeNull();
  });

  it('picks the bucket of the voice from the summary', () => {
    const usage = parseUsageSummary(backendUsageMini)!;
    expect(narrationBucket(usage, 'clone')).toBe(usage.buckets.cloneNarrations);
    expect(narrationBucket(usage, 'preset')).toBe(usage.buckets.presetNarrations);
  });
});

describe('remainingNarrationsLine', () => {
  const bucket = (remaining: number | null, overrides: Partial<UsageBucket> = {}): UsageBucket => ({
    limit: remaining === null ? null : 20,
    used: 0,
    remaining,
    period: 'month',
    renewsAt: NOV_1,
    ...overrides,
  });

  it('shows from 3 left down, with the One sentence at 1', () => {
    expect(remainingNarrationsLine('preset', bucket(4))).toBeNull();
    expect(remainingNarrationsLine('preset', bucket(3))).toBe('Bu ay 3 masal hakkın kaldı');
    expect(remainingNarrationsLine('preset', bucket(1))).toBe('Bu ay 1 masal hakkın kaldı');
    expect(remainingNarrationsLine('clone', bucket(2))).toBe('Bu ay kendi sesinle 2 masal hakkın kaldı');
    expect(remainingNarrationsLine('clone', bucket(1))).toBe('Bu ay kendi sesinle 1 masal hakkın kaldı');
  });

  it('a lifetime own-voice bucket says it does not renew', () => {
    const lifetime = bucket(1, { limit: 1, period: 'lifetime', renewsAt: null });
    expect(remainingNarrationsLine('clone', lifetime)).toBe('Kendi sesinle 1 masal hakkın var, yenilenmez.');
  });

  it('is hidden for an unlimited bucket', () => {
    expect(remainingNarrationsLine('preset', bucket(null))).toBeNull();
  });

  it('follows the UI language', async () => {
    await i18n.changeLanguage('en');
    expect(remainingNarrationsLine('preset', bucket(2))).toBe('2 stories left this month');
    expect(remainingNarrationsLine('clone', bucket(1))).toBe('1 own-voice story left this month');
  });
});
