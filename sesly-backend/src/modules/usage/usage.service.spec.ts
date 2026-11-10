import { renderMessage } from '../../test-utils/i18n';
import { ForbiddenException } from '@nestjs/common';
import { UsageService, QUOTA_CODES } from './usage.service';
import { createFakeUsageDb, FakeUsageDb } from '../../test-utils/fake-usage-db';

const USER = 'user-1';
const OCT_16 = new Date(2026, 9, 16, 12, 0, 0);
const NOV_1 = new Date(2026, 10, 1);

describe('UsageService (limits engine)', () => {
  let db: FakeUsageDb;
  let service: UsageService;

  const asPlan = (plan: string | null) => {
    db.subscription = plan ? { userId: USER, plan, status: 'ACTIVE', currentPeriodEnd: null } : null;
  };

  const consume = (plan: string, clone: boolean) => service.consumeNarration(USER, plan, clone);

  async function consumeTimes(plan: string, clone: boolean, times: number) {
    for (let i = 0; i < times; i++) await consume(plan, clone);
  }

  async function errorOf(promise: Promise<unknown>): Promise<any> {
    const err: any = await promise.catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    return err.getResponse();
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(OCT_16);
    db = createFakeUsageDb();
    service = new UsageService(db.prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('ready-made voice narrations', () => {
    it('FREE: 20 a month, the 21st is a coded 403 that says when it renews', async () => {
      await consumeTimes('FREE', false, 20);
      const body = await errorOf(consume('FREE', false));
      expect(body).toMatchObject({
        code: QUOTA_CODES.PRESET_MONTHLY,
        bucket: 'presetNarrations',
        tier: 'standard',
        plan: 'FREE',
        limit: 20,
        used: 20,
        period: 'month',
        renewsAt: NOV_1,
      });
      expect(renderMessage(body)).toContain('1 Kasım tarihinde yenilenir');
      expect(renderMessage(body)).toContain('Mini ya da Premium');
    });

    it('FREE: a new month starts again from zero', async () => {
      await consumeTimes('FREE', false, 20);
      jest.setSystemTime(new Date(2026, 10, 1, 0, 0, 1));
      await expect(consume('FREE', false)).resolves.toMatchObject({ month: 11, year: 2026 });
    });

    it('every paid plan is unlimited', async () => {
      for (const plan of ['MINI', 'PRO', 'CREATOR']) {
        await expect(consumeTimes(plan, false, 30)).resolves.toBeUndefined();
      }
      expect(db.prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('cloned-voice narrations do not eat the ready-made allowance', async () => {
      await consume('PRO', true);
      await consumeTimes('FREE', false, 20);
      await expect(consume('FREE', false)).rejects.toBeInstanceOf(ForbiddenException);
      expect((await service.getMonthlyCounters(USER)).standard).toBe(20);
    });
  });

  describe('cloned-voice narrations', () => {
    it('FREE: 1 in total, never renews (QUOTA_CLONE_LIFETIME), not even next month', async () => {
      await consume('FREE', true);
      let body = await errorOf(consume('FREE', true));
      expect(body).toMatchObject({
        code: QUOTA_CODES.CLONE_LIFETIME,
        bucket: 'cloneNarrations',
        tier: 'premium',
        limit: 1,
        used: 1,
        period: 'lifetime',
        renewsAt: null,
      });
      expect(renderMessage(body)).toContain('Bu hak yenilenmez');

      jest.setSystemTime(new Date(2027, 0, 5));
      body = await errorOf(consume('FREE', true));
      expect(body.code).toBe(QUOTA_CODES.CLONE_LIFETIME);
    });

    it('MINI: 5 a month (QUOTA_CLONE_MONTHLY suggests Premium), renews on the 1st', async () => {
      await consumeTimes('MINI', true, 5);
      const body = await errorOf(consume('MINI', true));
      expect(body).toMatchObject({ code: QUOTA_CODES.CLONE_MONTHLY, limit: 5, used: 5, period: 'month', renewsAt: NOV_1 });
      expect(renderMessage(body)).toContain('Premium plana');
      jest.setSystemTime(new Date(2026, 10, 2));
      await expect(consume('MINI', true)).resolves.toBeDefined();
    });

    it('PREMIUM (PRO): 20 a month, no upsell in the message', async () => {
      await consumeTimes('PRO', true, 20);
      const body = await errorOf(consume('PRO', true));
      expect(body).toMatchObject({ code: QUOTA_CODES.CLONE_MONTHLY, limit: 20 });
      expect(body.message).not.toContain('Premium plana');
    });

    it('every cloned-voice narration counts on the lifetime total, so a lapsed paid user has no free one left', async () => {
      await consumeTimes('MINI', true, 3);
      expect(db.lifetime.get(USER)?.cloneNarrations).toBe(3);
      const body = await errorOf(consume('FREE', true));
      expect(body).toMatchObject({ code: QUOTA_CODES.CLONE_LIFETIME, used: 1 });
    });

    it('concurrent requests cannot go past the limit (atomic conditional update)', async () => {
      const results = await Promise.allSettled([consume('FREE', true), consume('FREE', true), consume('FREE', true)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(db.lifetime.get(USER)?.cloneNarrations).toBe(1);
    });
  });

  describe('refundNarration (generation could not start)', () => {
    it('gives a cloned-voice narration back on the month and the lifetime counter', async () => {
      const charge = await consume('FREE', true);
      await service.refundNarration(charge);
      expect(db.lifetime.get(USER)?.cloneNarrations).toBe(0);
      expect(await service.getMonthlyCounters(USER)).toEqual({ premium: 0, standard: 0, total: 0 });
      await expect(consume('FREE', true)).resolves.toBeDefined();
    });

    it('gives a ready-made narration back, never below zero', async () => {
      const charge = await consume('FREE', false);
      await service.refundNarration(charge);
      await service.refundNarration(charge);
      expect((await service.getMonthlyCounters(USER)).total).toBe(0);
    });
  });

  describe('assertNarrationQuota (pre-check, no write)', () => {
    it('throws the same coded errors without writing', async () => {
      await consume('FREE', true);
      const body = await errorOf(service.assertNarrationQuota(USER, 'FREE', true));
      expect(body.code).toBe(QUOTA_CODES.CLONE_LIFETIME);
      await consumeTimes('FREE', false, 20);
      expect((await errorOf(service.assertNarrationQuota(USER, 'FREE', false))).code).toBe(QUOTA_CODES.PRESET_MONTHLY);
      await consumeTimes('MINI', true, 4); // 1 + 4 = 5 this month
      expect((await errorOf(service.assertNarrationQuota(USER, 'MINI', true))).code).toBe(QUOTA_CODES.CLONE_MONTHLY);
    });

    it('unlimited allowance: no counter is read; within limit: resolves', async () => {
      await service.assertNarrationQuota(USER, 'PRO', false);
      expect(db.prisma.usageLimit.findUnique).not.toHaveBeenCalled();
      await expect(service.assertNarrationQuota(USER, 'FREE', true)).resolves.toBeUndefined();
      await expect(service.assertNarrationQuota(USER, 'unknown-plan', false)).resolves.toBeUndefined();
    });
  });

  it('messages are Turkish and follow the UI text rules (no em dash, emoji, arrows, unicode ellipsis)', () => {
    const messages = [
      UsageService.quotaMessage(QUOTA_CODES.PRESET_MONTHLY, 'FREE', 20, NOV_1),
      UsageService.quotaMessage(QUOTA_CODES.CLONE_LIFETIME, 'FREE', 1, null),
      UsageService.quotaMessage(QUOTA_CODES.CLONE_MONTHLY, 'MINI', 5, NOV_1),
      UsageService.quotaMessage(QUOTA_CODES.CLONE_MONTHLY, 'PRO', 20, NOV_1),
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/[\u2014\u2026\u2192\u2190\u2022]|\p{Extended_Pictographic}/u);
    }
    expect(messages[0]).toContain('hazır anlatıcı seslerle');
    expect(messages[1]).toContain('Ücretsiz planda');
  });

  it('messages exist in English with the date written the English way', () => {
    const english = [
      UsageService.quotaMessage(QUOTA_CODES.PRESET_MONTHLY, 'FREE', 20, NOV_1, 'en'),
      UsageService.quotaMessage(QUOTA_CODES.CLONE_LIFETIME, 'FREE', 1, null, 'en'),
      UsageService.quotaMessage(QUOTA_CODES.CLONE_MONTHLY, 'MINI', 5, NOV_1, 'en'),
      UsageService.quotaMessage(QUOTA_CODES.CLONE_MONTHLY, 'PRO', 20, NOV_1, 'en'),
    ];
    expect(english[0]).toBe(
      "You have used this month's 20 stories with ready-made narrator voices. Your allowance renews on November 1. Switch to Mini or Premium for unlimited stories.",
    );
    expect(english[1]).toContain('Free plan (1)');
    expect(english[2]).toBe(
      "You have used this month's 5 stories in your own voice. Your allowance renews on November 1. Switch to Premium for more.",
    );
    expect(english[3]).toBe(
      "You have used this month's 20 stories in your own voice. Your allowance renews on November 1.",
    );
    // The Turkish text is unchanged by the move to i18n keys.
    expect(UsageService.quotaMessage(QUOTA_CODES.CLONE_MONTHLY, 'MINI', 5, NOV_1)).toBe(
      'Bu ay kendi sesinle 5 masal hakkını kullandın. Hakların 1 Kasım tarihinde yenilenir. Daha fazlası için Premium plana geçebilirsin.',
    );
  });

  describe('getUsageSummary (GET /usage)', () => {
    it('FREE: three buckets with limit, used, remaining, period and renewsAt', async () => {
      asPlan(null);
      db.presetCount = 2;
      db.cloneCount = 1;
      await consumeTimes('FREE', false, 3);
      await consume('FREE', true);
      db.lifetime.get(USER)!.clonesCreated = 1;

      const summary = await service.getUsageSummary(USER);

      expect(summary).toEqual({
        plan: 'FREE',
        planName: 'Ücretsiz',
        renewsAt: NOV_1,
        buckets: {
          presetNarrations: { limit: 20, used: 3, remaining: 17, period: 'month', renewsAt: NOV_1 },
          cloneNarrations: { limit: 1, used: 1, remaining: 0, period: 'lifetime', renewsAt: null },
          cloneCreations: { limit: 1, used: 1, remaining: 0, period: 'lifetime', renewsAt: null },
        },
        voiceSlots: { preset: { used: 2, limit: 3 }, clone: { used: 1, limit: 1 } },
        features: { backgroundPlayback: false, premiumStories: false },
      });
    });

    it('MINI: unlimited ready-made (limit and remaining null), monthly clone buckets, extra slots added', async () => {
      db.subscription = { userId: USER, plan: 'MINI', status: 'ACTIVE', currentPeriodEnd: null, extraVoiceSlots: 2 };
      await consumeTimes('MINI', false, 40);
      await consumeTimes('MINI', true, 2);

      const summary = await service.getUsageSummary(USER);

      expect(summary.plan).toBe('MINI');
      expect(summary.buckets.presetNarrations).toEqual({ limit: null, used: 40, remaining: null, period: 'month', renewsAt: NOV_1 });
      expect(summary.buckets.cloneNarrations).toEqual({ limit: 5, used: 2, remaining: 3, period: 'month', renewsAt: NOV_1 });
      expect(summary.buckets.cloneCreations).toMatchObject({ limit: 2, used: 0, period: 'month' });
      expect(summary.voiceSlots.clone.limit).toBe(3);
      expect(summary.features).toEqual({ backgroundPlayback: true, premiumStories: true });
    });

    it('used is clamped to the limit after a downgrade (PRO used 15, now MINI)', async () => {
      await consumeTimes('PRO', true, 15);
      asPlan('MINI');
      const summary = await service.getUsageSummary(USER);
      expect(summary.buckets.cloneNarrations).toMatchObject({ limit: 5, used: 5, remaining: 0 });
    });

    it('an admin grant counts (grant columns)', async () => {
      db.subscription = { userId: USER, plan: 'FREE', status: 'ACTIVE', grantPlan: 'PRO', grantEndsAt: null };
      expect((await service.getUsageSummary(USER)).plan).toBe('PRO');
      expect(await service.getEffectivePlan(USER)).toBe('PRO');
    });
  });

  describe('legacy shapes', () => {
    it('getCurrentUsage keeps its fields; -1 means unlimited', async () => {
      asPlan('PRO');
      await consumeTimes('PRO', true, 2);
      await consume('PRO', false);
      expect(await service.getCurrentUsage(USER)).toEqual({
        storiesGenerated: 2,
        limit: 20,
        remaining: 18,
        resetAt: NOV_1,
        usages: {
          standard: { generated: 1, limit: -1, remaining: -1 },
          premium: { generated: 2, limit: 20, remaining: 18 },
        },
      });
    });

    it('getLimits: FREE without a row, extra slots added', async () => {
      expect(await service.getLimits(USER)).toEqual({
        maxStories: 1,
        maxStoriesStandard: 20,
        maxStoriesPremium: 1,
        maxVoices: 4,
        maxTextToSpeech: -1,
      });
      db.subscription = { plan: 'PRO', status: 'ACTIVE', extraVoiceSlots: 5 };
      expect(await service.getLimits(USER)).toMatchObject({ maxStoriesStandard: -1, maxStoriesPremium: 20, maxVoices: 18 });
    });

    it('getMonthlyCounters: premium clamped to total, missing row is zero', async () => {
      expect(await service.getMonthlyCounters(USER)).toEqual({ premium: 0, standard: 0, total: 0 });
      db.monthly.push({ userId: USER, month: 10, year: 2026, storiesGenerated: 2, premiumStoriesGenerated: 5 });
      expect(await service.getMonthlyCounters(USER)).toEqual({ premium: 2, standard: 0, total: 2 });
    });
  });
});
