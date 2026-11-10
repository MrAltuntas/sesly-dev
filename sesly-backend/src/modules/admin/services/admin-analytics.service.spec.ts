import { AdminAnalyticsService } from './admin-analytics.service';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';
import { PLAN_PRICES } from '../../../common/constants/plans.constants';

/**
 * Minimal Prisma `where` evaluator for subscription rows. Throws on any
 * operator it does not understand so a future rewrite of the where clause
 * fails loudly here instead of silently matching everything.
 */
function matchesWhere(row: Record<string, any>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as any[]).some((w) => matchesWhere(row, w));
    if (key === 'AND') return (cond as any[]).every((w) => matchesWhere(row, w));
    if (key === 'NOT') {
      const list = Array.isArray(cond) ? cond : [cond];
      return !list.some((w) => matchesWhere(row, w));
    }
    const value = row[key];
    if (cond === null || typeof cond !== 'object' || cond instanceof Date) {
      return cmp(value, cond) === 0;
    }
    return Object.entries(cond).every(([op, arg]) => {
      switch (op) {
        case 'equals':
          return cmp(value, arg) === 0;
        case 'not':
          return arg !== null && typeof arg === 'object' && !(arg instanceof Date)
            ? !matchesWhere({ v: value }, { v: arg })
            : cmp(value, arg) !== 0;
        case 'in':
          return (arg as any[]).some((a) => cmp(value, a) === 0);
        case 'notIn':
          return !(arg as any[]).some((a) => cmp(value, a) === 0);
        case 'lt':
          return value != null && cmp(value, arg) < 0;
        case 'lte':
          return value != null && cmp(value, arg) <= 0;
        case 'gt':
          return value != null && cmp(value, arg) > 0;
        case 'gte':
          return value != null && cmp(value, arg) >= 0;
        default:
          throw new Error(`matchesWhere: unsupported operator "${op}" on "${key}"`);
      }
    });
  });
}

function cmp(a: any, b: any): number {
  if (a == null && b == null) return 0;
  if (a == null || b == null) return 1;
  const av = a instanceof Date ? a.getTime() : a;
  const bv = b instanceof Date ? b.getTime() : b;
  return av === bv ? 0 : av < bv ? -1 : 1;
}

describe('AdminAnalyticsService', () => {
  let prisma: MockPrismaService;
  let service: AdminAnalyticsService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    service = new AdminAnalyticsService(prisma as any);
    prisma.$transaction.mockImplementation(async (ops: any[]) => Promise.all(ops));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getSystemStats', () => {
    /** Wire every count/findMany/groupBy used by getSystemStats. */
    function wireStats(opts: {
      users?: { total: number; verified: number; unverified: number };
      stories?: { total: number; premium: number };
      voiceProfiles?: number;
      audio?: { total: number; ready: number; failed: number; pending: number; generating: number };
      activePaid?: number;
      billed?: number;
      billedRows?: Array<{ plan: string; storePurchase?: { billingPeriod: string } }>;
      byProvider?: Array<{ provider: string; _count: { provider: number } }>;
      byPlan?: Array<{ plan: string; _count: { plan: number } }>;
      /** groupBy result of ACTIVE paid rows whose period ended (where has NOT). */
      lapsedByPlan?: Array<{ plan: string; _count: { plan: number } }>;
    }) {
      const users = opts.users ?? { total: 0, verified: 0, unverified: 0 };
      const stories = opts.stories ?? { total: 0, premium: 0 };
      const audio = opts.audio ?? { total: 0, ready: 0, failed: 0, pending: 0, generating: 0 };

      prisma.user.count.mockImplementation(async (args?: any) => {
        if (args?.where?.emailVerified === true) return users.verified;
        if (args?.where?.emailVerified === false) return users.unverified;
        return users.total;
      });
      prisma.story.count.mockImplementation(async (args?: any) =>
        args?.where?.isPremium === true ? stories.premium : stories.total,
      );
      prisma.voiceProfile.count.mockResolvedValue(opts.voiceProfiles ?? 0);
      prisma.audio.count.mockImplementation(async (args?: any) => {
        switch (args?.where?.status) {
          case 'READY':
            return audio.ready;
          case 'FAILED':
            return audio.failed;
          case 'PENDING':
            return audio.pending;
          case 'GENERATING':
            return audio.generating;
          default:
            return audio.total;
        }
      });
      prisma.subscription.count.mockImplementation(async (args?: any) =>
        args?.where?.OR ? opts.billed ?? 0 : opts.activePaid ?? 0,
      );
      prisma.subscription.findMany.mockResolvedValue(opts.billedRows ?? []);
      prisma.voiceProfile.groupBy.mockResolvedValue(opts.byProvider ?? []);
      prisma.subscription.groupBy.mockImplementation(async (args?: any) =>
        args?.where?.NOT ? opts.lapsedByPlan ?? [] : opts.byPlan ?? [],
      );
    }

    it('locks the response key set (dashboard contract)', async () => {
      wireStats({});

      const stats = await service.getSystemStats();

      expect(Object.keys(stats).sort()).toEqual(
        ['audio', 'stories', 'subscriptions', 'users', 'voiceProfiles'].sort(),
      );
      expect(Object.keys(stats.users).sort()).toEqual(['total', 'unverified', 'verified']);
      expect(Object.keys(stats.stories).sort()).toEqual(['free', 'premium', 'total']);
      expect(Object.keys(stats.voiceProfiles).sort()).toEqual(['byProvider', 'total']);
      expect(Object.keys(stats.audio).sort()).toEqual(
        ['failed', 'generating', 'pending', 'ready', 'successRate', 'total'].sort(),
      );
      expect(Object.keys(stats.subscriptions).sort()).toEqual(
        ['byPlan', 'currency', 'estimatedMonthlyRevenue', 'paid', 'total'].sort(),
      );
    });

    it('empty database: every number is 0 (no hardcoded baselines) and division is safe', async () => {
      wireStats({});

      const stats = await service.getSystemStats();

      const numbers: number[] = [];
      const walk = (v: any) => {
        if (typeof v === 'number') numbers.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') Object.values(v).forEach(walk);
      };
      walk(stats);
      expect(numbers.length).toBeGreaterThan(10);
      expect(numbers.every((n) => n === 0)).toBe(true);
      expect(stats.audio.successRate).toBe('0%');
      expect(stats.subscriptions.estimatedMonthlyRevenue).toBe(0);
      expect(stats.voiceProfiles.byProvider).toEqual([]);
      expect(stats.subscriptions.byPlan).toEqual([]);
    });

    it('numbers are taken verbatim from the DB counts (users/stories/audio)', async () => {
      wireStats({
        users: { total: 42, verified: 30, unverified: 12 },
        stories: { total: 17, premium: 5 },
        voiceProfiles: 9,
        audio: { total: 8, ready: 6, failed: 1, pending: 0, generating: 1 },
        byProvider: [
          { provider: 'GOOGLE', _count: { provider: 6 } },
          { provider: 'CARTESIA', _count: { provider: 3 } },
        ],
        byPlan: [
          { plan: 'PRO', _count: { plan: 4 } },
          { plan: 'FREE', _count: { plan: 11 } },
        ],
      });

      const stats = await service.getSystemStats();

      expect(stats.users).toEqual({ total: 42, verified: 30, unverified: 12 });
      expect(stats.stories).toEqual({ total: 17, premium: 5, free: 12 });
      expect(stats.voiceProfiles).toEqual({
        total: 9,
        byProvider: [
          { provider: 'GOOGLE', count: 6 },
          { provider: 'CARTESIA', count: 3 },
        ],
      });
      expect(stats.audio).toEqual({
        total: 8,
        ready: 6,
        pending: 0,
        generating: 1,
        failed: 1,
        successRate: '75.00%',
      });
      expect(stats.subscriptions.byPlan).toEqual([
        { plan: 'PRO', count: 4 },
        { plan: 'FREE', count: 11 },
      ]);
      expect(prisma.subscription.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['plan'], where: { status: 'ACTIVE' } }),
      );
    });

    it('revenue: only billed (store-backed) ACTIVE paid subscriptions, priced from PLAN_PRICES', async () => {
      wireStats({
        activePaid: 5, // 3 billed + 2 admin grants
        billed: 3,
        billedRows: [{ plan: 'PRO' }, { plan: 'MINI' }, { plan: 'PRO', storePurchase: { billingPeriod: 'YEAR' } }],
      });

      const stats = await service.getSystemStats();

      expect(stats.subscriptions.total).toBe(5);
      expect(stats.subscriptions.paid).toBe(3);
      expect(stats.subscriptions.estimatedMonthlyRevenue).toBe(
        // A yearly purchase counts a twelfth of the yearly price.
        Math.round((PLAN_PRICES.PRO + PLAN_PRICES.MINI + 1499.99 / 12) * 100) / 100,
      );
      expect(stats.subscriptions.currency).toBe('TRY');

      // The revenue query is restricted to store-billed rows.
      const revenueWhere = prisma.subscription.findMany.mock.calls[0][0].where;
      expect(revenueWhere).toEqual({
        status: 'ACTIVE',
        plan: { not: 'FREE' },
        OR: [
          { stripeSubscriptionId: { not: null } },
          { appleTransactionId: { not: null } },
          { appleOriginalTransactionId: { not: null } },
          { googlePurchaseToken: { not: null } },
        ],
      });
    });

    it('revenue where: admin grants, FREE rows and non-ACTIVE rows bring no money in', async () => {
      wireStats({});
      await service.getSystemStats();
      const revenueWhere = prisma.subscription.findMany.mock.calls[0][0].where;

      const base = {
        stripeSubscriptionId: null,
        appleTransactionId: null,
        googlePurchaseToken: null,
      };
      const grant = { ...base, plan: 'PRO', status: 'ACTIVE' };
      const stripePro = { ...base, plan: 'PRO', status: 'ACTIVE', stripeSubscriptionId: 'sub_1' };
      const appleCreator = { ...base, plan: 'CREATOR', status: 'ACTIVE', appleTransactionId: 't' };
      const googlePro = { ...base, plan: 'PRO', status: 'ACTIVE', googlePurchaseToken: 'g' };
      const pastDue = { ...stripePro, status: 'PAST_DUE' };
      const expired = { ...appleCreator, status: 'EXPIRED' };
      const freeWithStripe = { ...stripePro, plan: 'FREE' };

      expect(matchesWhere(grant, revenueWhere)).toBe(false);
      expect(matchesWhere(pastDue, revenueWhere)).toBe(false);
      expect(matchesWhere(expired, revenueWhere)).toBe(false);
      expect(matchesWhere(freeWithStripe, revenueWhere)).toBe(false);
      expect(matchesWhere(stripePro, revenueWhere)).toBe(true);
      expect(matchesWhere(appleCreator, revenueWhere)).toBe(true);
      expect(matchesWhere(googlePro, revenueWhere)).toBe(true);
    });

    it('revenue: unknown / FREE plan rows add 0 and the sum is rounded to 2 decimals', async () => {
      wireStats({
        billedRows: [{ plan: 'PRO' }, { plan: 'PRO' }, { plan: 'PRO' }, { plan: 'LEGACY' }, { plan: 'FREE' }],
      });

      const stats = await service.getSystemStats();

      // 3 * 199.99 = 599.97 exactly after rounding
      expect(stats.subscriptions.estimatedMonthlyRevenue).toBe(599.97);
    });

    it('active-paid count excludes FREE rows and non-ACTIVE rows', async () => {
      wireStats({});
      await service.getSystemStats();

      const paidWhere = prisma.subscription.count.mock.calls
        .map((c: any[]) => c[0]?.where)
        .find((w: any) => w && !w.OR);
      // (Was an exact toEqual; the where now also carries the period filter.)
      expect(paidWhere).toMatchObject({ status: 'ACTIVE', plan: { not: 'FREE' } });
      expect(matchesWhere({ plan: 'FREE', status: 'ACTIVE' }, paidWhere)).toBe(false);
      expect(matchesWhere({ plan: 'PRO', status: 'EXPIRED' }, paidWhere)).toBe(false);
      expect(matchesWhere({ plan: 'PRO', status: 'ACTIVE' }, paidWhere)).toBe(true);
    });

    // Fixed (was BUG): an ended admin grant (ACTIVE, currentPeriodEnd in the
    // past, no store id) was counted in `subscriptions.total` and `byPlan`
    // although resolveEffectivePlan() says the user is FREE.
    it('active-paid count must not include admin grants whose period already ended', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-01T12:00:00Z'));
      wireStats({});
      await service.getSystemStats();

      const paidWhere = prisma.subscription.count.mock.calls
        .map((c: any[]) => c[0]?.where)
        .find((w: any) => w && !w.OR);
      const expiredGrant = {
        plan: 'PRO',
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
        stripeSubscriptionId: null,
        appleTransactionId: null,
        googlePurchaseToken: null,
      };
      expect(matchesWhere(expiredGrant, paidWhere)).toBe(false);

      // Same rule as resolveEffectivePlan for everything else.
      const base = { ...expiredGrant };
      expect(matchesWhere({ ...base, currentPeriodEnd: null }, paidWhere)).toBe(true);
      expect(matchesWhere({ ...base, currentPeriodEnd: new Date('2026-07-01T00:00:00Z') }, paidWhere)).toBe(true);
      // Store-billed, ended 12 h ago: still inside the 24 h renewal grace.
      const storeInGrace = { ...base, appleTransactionId: 't', currentPeriodEnd: new Date('2026-06-01T00:00:00Z') };
      expect(matchesWhere(storeInGrace, paidWhere)).toBe(true);
      const storePastGrace = { ...base, appleTransactionId: 't', currentPeriodEnd: new Date('2026-05-30T00:00:00Z') };
      expect(matchesWhere(storePastGrace, paidWhere)).toBe(false);
    });

    it('byPlan counts ended paid grants as FREE, not under their stored plan', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-01T12:00:00Z'));
      wireStats({
        byPlan: [
          { plan: 'PRO', _count: { plan: 4 } },
          { plan: 'CREATOR', _count: { plan: 1 } },
          { plan: 'FREE', _count: { plan: 10 } },
        ],
        lapsedByPlan: [
          { plan: 'PRO', _count: { plan: 1 } },
          { plan: 'CREATOR', _count: { plan: 1 } },
        ],
      });

      const stats = await service.getSystemStats();

      expect(stats.subscriptions.byPlan).toEqual([
        { plan: 'PRO', count: 3 },
        { plan: 'FREE', count: 12 },
      ]);
      const lapsedWhere = prisma.subscription.groupBy.mock.calls
        .map((c: any[]) => c[0].where)
        .find((w: any) => w.NOT);
      const endedGrant = {
        plan: 'PRO',
        status: 'ACTIVE',
        currentPeriodEnd: new Date('2026-01-01T00:00:00Z'),
        stripeSubscriptionId: null,
        appleTransactionId: null,
        googlePurchaseToken: null,
      };
      expect(matchesWhere(endedGrant, lapsedWhere)).toBe(true);
      expect(matchesWhere({ ...endedGrant, currentPeriodEnd: null }, lapsedWhere)).toBe(false);
      expect(matchesWhere({ ...endedGrant, plan: 'FREE' }, lapsedWhere)).toBe(false);
    });

    it('byPlan adds a FREE bucket when only lapsed grants exist', async () => {
      wireStats({
        byPlan: [{ plan: 'PRO', _count: { plan: 2 } }],
        lapsedByPlan: [{ plan: 'PRO', _count: { plan: 2 } }],
      });

      const stats = await service.getSystemStats();

      expect(stats.subscriptions.byPlan).toEqual([{ plan: 'FREE', count: 2 }]);
    });
  });

  describe('getUsageStats', () => {
    it('month window: [1st of this month, 1st of next month), FAILED excluded', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 2, 15, 12, 0, 0)); // 15 Mar 2026 local
      prisma.storyNarration.findMany.mockResolvedValue([]);

      const usage = await service.getUsageStats();

      const where = prisma.storyNarration.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toEqual(new Date(2026, 2, 1));
      expect(where.createdAt.lt).toEqual(new Date(2026, 3, 1));
      expect(where.status).toEqual({ not: 'FAILED' });
      expect(usage.currentMonth).toBe(3);
      expect(usage.currentYear).toBe(2026);
    });

    it('December rolls the window over to January of the next year', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 11, 31, 23, 59, 0));
      prisma.storyNarration.findMany.mockResolvedValue([]);

      const usage = await service.getUsageStats();

      const where = prisma.storyNarration.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toEqual(new Date(2026, 11, 1));
      expect(where.createdAt.lt).toEqual(new Date(2027, 0, 1));
      expect(usage).toMatchObject({ currentMonth: 12, currentYear: 2026 });
    });

    it('no narrations: zeros everywhere, averageStoriesPerUser is 0 (no division by zero)', async () => {
      prisma.storyNarration.findMany.mockResolvedValue([]);

      const usage = await service.getUsageStats();

      expect(usage).toMatchObject({
        totalStoriesGenerated: 0,
        activeUsers: 0,
        averageStoriesPerUser: 0,
        premiumNarrations: 0,
        standardNarrations: 0,
      });
      expect(Number.isFinite(usage.averageStoriesPerUser)).toBe(true);
      expect(Object.keys(usage).sort()).toEqual(
        [
          'activeUsers',
          'averageStoriesPerUser',
          'currentMonth',
          'currentYear',
          'premiumNarrations',
          'standardNarrations',
          'totalStoriesGenerated',
        ].sort(),
      );
    });

    it('distinct users, average rounded to 2 decimals, only cloned voices count as premium', async () => {
      prisma.storyNarration.findMany.mockResolvedValue([
        { userId: 'a', voiceProfile: { provider: 'GOOGLE', voiceId: 'tr-TR-Standard-A', voiceCloningKey: null } },
        { userId: 'a', voiceProfile: { provider: 'GOOGLE', voiceId: 'tr-TR-Chirp3-HD-Aoede', voiceCloningKey: null } },
        { userId: 'b', voiceProfile: null },
        { userId: 'c', voiceProfile: { provider: 'CARTESIA', kind: 'CLONE', voiceId: 'x', voiceCloningKey: null } },
      ]);

      const usage = await service.getUsageStats();

      expect(usage.totalStoriesGenerated).toBe(4);
      expect(usage.activeUsers).toBe(3);
      expect(usage.averageStoriesPerUser).toBe(1.33);
      expect(usage.premiumNarrations).toBe(1);
      expect(usage.standardNarrations).toBe(3);
      expect(prisma.storyNarration.findMany.mock.calls[0][0].select.voiceProfile.select).toMatchObject({
        kind: true,
        provider: true,
      });
    });
  });

  describe('getRecentActivity', () => {
    it('paginates each feed independently with the requested page/limit', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);
      prisma.user.count.mockResolvedValue(11);
      prisma.story.findMany.mockResolvedValue([{ id: 's1' }]);
      prisma.story.count.mockResolvedValue(3);
      prisma.voiceProfile.findMany.mockResolvedValue([]);
      prisma.voiceProfile.count.mockResolvedValue(0);

      const res = await service.getRecentActivity({ page: 2, limit: 5 } as any);

      expect(prisma.user.findMany.mock.calls[0][0]).toMatchObject({
        skip: 5,
        take: 5,
        orderBy: { createdAt: 'desc' },
      });
      expect(res.recentUsers).toEqual({ data: [{ id: 'u1' }], total: 11, page: 2, limit: 5, totalPages: 3 });
      expect(res.recentStories).toEqual({ data: [{ id: 's1' }], total: 3, page: 2, limit: 5, totalPages: 1 });
      expect(res.recentVoiceProfiles).toEqual({ data: [], total: 0, page: 2, limit: 5, totalPages: 0 });
    });

    it('defaults to page 1 / limit 50 and never selects user secrets', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);
      prisma.story.findMany.mockResolvedValue([]);
      prisma.story.count.mockResolvedValue(0);
      prisma.voiceProfile.findMany.mockResolvedValue([]);
      prisma.voiceProfile.count.mockResolvedValue(0);

      await service.getRecentActivity({} as any);

      const userArgs = prisma.user.findMany.mock.calls[0][0];
      expect(userArgs).toMatchObject({ skip: 0, take: 50 });
      expect(Object.keys(userArgs.select).sort()).toEqual(
        ['createdAt', 'email', 'firstName', 'id', 'lastName'].sort(),
      );
      const vpArgs = prisma.voiceProfile.findMany.mock.calls[0][0];
      expect(vpArgs.select.user).toEqual({
        select: { email: true, firstName: true, lastName: true },
      });
      expect(JSON.stringify(prisma.user.findMany.mock.calls)).not.toMatch(/password|token/i);
    });
  });

  describe('getPopularStories', () => {
    it('maps _count into listens/favorites and weights favorites x2', async () => {
      prisma.story.findMany.mockResolvedValue([
        {
          id: 's1',
          title: 'Keloglan',
          category: 'TURKISH_CLASSICS',
          ageGroup: 'THREE_TO_SIX',
          isPremium: false,
          content: 'should not leak',
          _count: { userProgress: 10, favoritedBy: 3 },
        },
      ]);
      prisma.story.count.mockResolvedValue(21);

      const res = await service.getPopularStories({} as any);

      expect(prisma.story.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 10 });
      expect(res).toMatchObject({ total: 21, page: 1, limit: 10, totalPages: 3 });
      expect(res.data).toEqual([
        {
          id: 's1',
          title: 'Keloglan',
          category: 'TURKISH_CLASSICS',
          ageGroup: 'THREE_TO_SIX',
          isPremium: false,
          listens: 10,
          favorites: 3,
          popularity: 16,
        },
      ]);
    });

    it('orders by listens then favorites', async () => {
      prisma.story.findMany.mockResolvedValue([]);
      prisma.story.count.mockResolvedValue(0);

      await service.getPopularStories({ page: 3, limit: 4 } as any);

      const args = prisma.story.findMany.mock.calls[0][0];
      expect(args.skip).toBe(8);
      expect(args.take).toBe(4);
      expect(args.orderBy).toEqual([
        { userProgress: { _count: 'desc' } },
        { favoritedBy: { _count: 'desc' } },
      ]);
    });
  });
});
