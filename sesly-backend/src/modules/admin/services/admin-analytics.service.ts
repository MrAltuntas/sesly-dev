import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActivityQueryDto } from '../dto/activity-query.dto';
import { PopularStoriesQueryDto } from '../dto/popular-stories-query.dto';
import { PaginationHelper } from '../../../common/utils/pagination.helper';
import {
  PLAN_CURRENCY,
  PLAN_PRICES,
  PLAN_YEARLY_PRICES,
} from '../../../common/constants/plans.constants';
import { isPremiumVoice } from '../../../common/utils/voice-tier';
import { paidPeriodActiveWhere } from '../../../common/utils/subscription-plan';

/** ACTIVE rows on a paid plan, regardless of the period end. */
const ACTIVE_PAID_PLAN_WHERE = {
  status: 'ACTIVE' as const,
  plan: { not: 'FREE' as const },
};

/**
 * ACTIVE subscriptions on a paid plan whose period has not run out (admin
 * grants included). Admin grants only set currentPeriodEnd and nothing flips
 * them back, so an ended grant would otherwise count as paying forever;
 * mirrors resolveEffectivePlan.
 */
function activePaidWhere(now: Date) {
  return {
    ...ACTIVE_PAID_PLAN_WHERE,
    AND: [paidPeriodActiveWhere(now)],
  };
}

/** ACTIVE paid rows whose period has run out: effectively FREE users. */
function lapsedPaidWhere(now: Date) {
  return {
    ...ACTIVE_PAID_PLAN_WHERE,
    NOT: paidPeriodActiveWhere(now),
  };
}

/**
 * ...billed through a store (Apple / Google, legacy Stripe rows). Store rows
 * are kept current by the store notifications (status flips to EXPIRED), so
 * no period filter here.
 */
const ACTIVE_BILLED_WHERE = {
  ...ACTIVE_PAID_PLAN_WHERE,
  OR: [
    { stripeSubscriptionId: { not: null } },
    { appleTransactionId: { not: null } },
    { appleOriginalTransactionId: { not: null } },
    { googlePurchaseToken: { not: null } },
  ],
};

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);

  constructor(private prisma: PrismaService) { }

  async getSystemStats() {
    const [
      totalUsers,
      totalStories,
      totalVoiceProfiles,
      totalAudioFiles,
      activePaidSubscriptions,
      billedSubscriptions,
      totalRevenue,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.story.count(),
      this.prisma.voiceProfile.count(),
      this.prisma.audio.count(),
      this.prisma.subscription.count({ where: activePaidWhere(new Date()) }),
      this.prisma.subscription.count({ where: ACTIVE_BILLED_WHERE }),
      this.calculateTotalRevenue(),
    ]);

    const premiumStories = await this.prisma.story.count({
      where: { isPremium: true },
    });

    const readyAudioFiles = await this.prisma.audio.count({
      where: { status: 'READY' },
    });

    const failedAudioFiles = await this.prisma.audio.count({
      where: { status: 'FAILED' },
    });

    return {
      users: {
        total: totalUsers,
        verified: await this.prisma.user.count({ where: { emailVerified: true } }),
        unverified: await this.prisma.user.count({ where: { emailVerified: false } }),
      },
      stories: {
        total: totalStories,
        premium: premiumStories,
        free: totalStories - premiumStories,
      },
      voiceProfiles: {
        total: totalVoiceProfiles,
        byProvider: await this.getVoiceProfilesByProvider(),
      },
      audio: {
        total: totalAudioFiles,
        ready: readyAudioFiles,
        pending: await this.prisma.audio.count({ where: { status: 'PENDING' } }),
        generating: await this.prisma.audio.count({ where: { status: 'GENERATING' } }),
        failed: failedAudioFiles,
        successRate: totalAudioFiles > 0 ? ((readyAudioFiles / totalAudioFiles) * 100).toFixed(2) + '%' : '0%',
      },
      subscriptions: {
        // ACTIVE paid-plan subscriptions whose period has not ended (FREE rows
        // and ended admin grants excluded).
        total: activePaidSubscriptions,
        // ...of which billed through Apple / Google (not admin grants).
        paid: billedSubscriptions,
        byPlan: await this.getSubscriptionsByPlan(),
        // Paid (billed) subscriptions only, same prices as the public plan list.
        estimatedMonthlyRevenue: totalRevenue,
        currency: PLAN_CURRENCY,
      },
    };
  }

  async getRecentActivity(queryDto: ActivityQueryDto) {
    const { page = 1, limit = 50 } = queryDto;
    const offset = PaginationHelper.calculateOffset(page, limit);

    const [
      [recentUsers, totalUsers],
      [recentStories, totalStories],
      [recentVoiceProfiles, totalVoiceProfiles],
    ] = await Promise.all([
      this.prisma.$transaction([
        this.prisma.user.findMany({
          skip: offset,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            createdAt: true,
          },
        }),
        this.prisma.user.count(),
      ]),
      this.prisma.$transaction([
        this.prisma.story.findMany({
          skip: offset,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            title: true,
            category: true,
            isPremium: true,
            createdAt: true,
          },
        }),
        this.prisma.story.count(),
      ]),
      this.prisma.$transaction([
        this.prisma.voiceProfile.findMany({
          skip: offset,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            provider: true,
            status: true,
            createdAt: true,
            user: {
              select: {
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
        this.prisma.voiceProfile.count(),
      ]),
    ]);

    return {
      recentUsers: PaginationHelper.createPaginatedResponse(
        recentUsers,
        totalUsers,
        page,
        limit,
      ),
      recentStories: PaginationHelper.createPaginatedResponse(
        recentStories,
        totalStories,
        page,
        limit,
      ),
      recentVoiceProfiles: PaginationHelper.createPaginatedResponse(
        recentVoiceProfiles,
        totalVoiceProfiles,
        page,
        limit,
      ),
    };
  }

  async getPopularStories(queryDto: PopularStoriesQueryDto) {
    const { page = 1, limit = 10 } = queryDto;
    const offset = PaginationHelper.calculateOffset(page, limit);

    const [stories, total] = await this.prisma.$transaction([
      this.prisma.story.findMany({
        skip: offset,
        take: limit,
        include: {
          _count: {
            select: {
              userProgress: true,
              favoritedBy: true,
            },
          },
        },
        orderBy: [
          { userProgress: { _count: 'desc' } },
          { favoritedBy: { _count: 'desc' } },
        ],
      }),
      this.prisma.story.count(),
    ]);

    const formattedStories = stories.map((story: any) => ({
      id: story.id,
      title: story.title,
      category: story.category,
      ageGroup: story.ageGroup,
      isPremium: story.isPremium,
      listens: story._count.userProgress,
      favorites: story._count.favoritedBy,
      popularity: story._count.userProgress + story._count.favoritedBy * 2, // Favorites weighted higher
    }));

    return PaginationHelper.createPaginatedResponse(
      formattedStories,
      total,
      page,
      limit,
    );
  }

  /**
   * Current-month narration usage across ALL plans, computed from
   * StoryNarration rows created this month (FAILED excluded).
   */
  async getUsageStats() {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
    const startOfNextMonth = new Date(currentYear, currentMonth, 1);

    const narrations = await this.prisma.storyNarration.findMany({
      where: {
        createdAt: { gte: startOfMonth, lt: startOfNextMonth },
        status: { not: 'FAILED' },
      },
      select: {
        userId: true,
        voiceProfile: {
          select: { provider: true, kind: true, voiceId: true, voiceCloningKey: true },
        },
      },
    });

    const totalStoriesGenerated = narrations.length;
    const activeUsers = new Set(narrations.map((n) => n.userId)).size;
    const premiumNarrations = narrations.filter(
      (n) => n.voiceProfile && isPremiumVoice(n.voiceProfile),
    ).length;

    return {
      currentMonth,
      currentYear,
      totalStoriesGenerated,
      activeUsers,
      averageStoriesPerUser:
        activeUsers > 0 ? Math.round((totalStoriesGenerated / activeUsers) * 100) / 100 : 0,
      premiumNarrations,
      standardNarrations: totalStoriesGenerated - premiumNarrations,
    };
  }

  /**
   * Estimated monthly revenue from BILLED subscriptions only (admin grants
   * bring no money in), rounded to 2 decimals. Reference list prices (the
   * store price may differ); a yearly purchase counts a twelfth of its price.
   */
  private async calculateTotalRevenue(): Promise<number> {
    const subscriptions = await this.prisma.subscription.findMany({
      where: ACTIVE_BILLED_WHERE,
      select: { plan: true, storePurchase: { select: { billingPeriod: true } } },
    });

    const total = subscriptions.reduce((sum: number, sub: any) => {
      const plan = sub.plan as keyof typeof PLAN_PRICES;
      const yearly = PLAN_YEARLY_PRICES[plan];
      if (sub.storePurchase?.billingPeriod === 'YEAR' && yearly) {
        return sum + yearly / 12;
      }
      return sum + (PLAN_PRICES[plan] ?? 0);
    }, 0);
    return Math.round(total * 100) / 100;
  }

  private async getVoiceProfilesByProvider() {
    const profiles = await this.prisma.voiceProfile.groupBy({
      by: ['provider'],
      _count: { provider: true },
    });

    return profiles.map((p: any) => ({
      provider: p.provider,
      count: p._count.provider,
    }));
  }

  /**
   * ACTIVE rows per EFFECTIVE plan: a paid row whose period has run out (an
   * ended admin grant) is counted as FREE, not under its stored plan.
   */
  private async getSubscriptionsByPlan() {
    const now = new Date();
    const [subscriptions, lapsed] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['plan'],
        _count: { plan: true },
        where: { status: 'ACTIVE' },
      }),
      this.prisma.subscription.groupBy({
        by: ['plan'],
        _count: { plan: true },
        where: lapsedPaidWhere(now),
      }),
    ]);

    const lapsedByPlan = new Map<string, number>(
      (lapsed as any[]).map((s) => [s.plan, s._count.plan]),
    );
    const lapsedTotal = [...lapsedByPlan.values()].reduce((a, b) => a + b, 0);

    const counts = (subscriptions as any[]).map((s) => ({
      plan: s.plan as string,
      count: s._count.plan - (lapsedByPlan.get(s.plan) ?? 0),
    }));
    if (lapsedTotal > 0) {
      const free = counts.find((c) => c.plan === 'FREE');
      if (free) free.count += lapsedTotal;
      else counts.push({ plan: 'FREE', count: lapsedTotal });
    }

    return counts.filter((c) => c.count > 0);
  }
}
