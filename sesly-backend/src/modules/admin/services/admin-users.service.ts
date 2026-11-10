import {
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { GrantSubscriptionDto, GrantSubscriptionPlan } from '../dto/grant-subscription.dto';
import { UsersService } from '../../users/users.service';
import { resolveEffectivePlan } from '../../../common/utils/subscription-plan';
import { bumpTokenVersion } from '../../../common/utils/token-version';
import { recomputeSubscription } from '../../subscriptions/store/entitlement';

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
  ) {}

  async getAllUsers(page: number = 1, limit: number = 20, search?: string) {
    const skip = (page - 1) * limit;

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { firstName: { contains: search, mode: 'insensitive' as const } },
            { lastName: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          provider: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          subscription: {
            select: {
              plan: true,
              status: true,
              currentPeriodEnd: true,
            },
          },
          _count: {
            select: {
              voiceProfiles: true,
              storyProgress: true,
              favoriteStories: true,
            },
          },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Admin user detail. Uses an explicit `select` so secrets on the User row
   * (passwordHash, providerId)
   * are never returned, even to admins.
   */
  async getUserById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        avatarUrl: true,
        provider: true,
        emailVerified: true,
        createdAt: true,
        updatedAt: true,
        subscription: true,
        voiceProfiles: {
          select: {
            id: true,
            name: true,
            provider: true,
            status: true,
            createdAt: true,
          },
        },
        usageLimits: {
          where: {
            month: new Date().getMonth() + 1,
            year: new Date().getFullYear(),
          },
        },
        devices: {
          select: {
            id: true,
            platform: true,
            isActive: true,
            createdAt: true,
          },
        },
        _count: {
          select: {
            storyProgress: true,
            favoriteStories: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return {
      ...user,
      // Plan the user actually gets right now (expired grants -> FREE).
      effectivePlan: resolveEffectivePlan(user.subscription),
    };
  }

  private async requireUser(userId: string): Promise<void> {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) {
      throw new NotFoundException('User not found');
    }
  }

  async deactivateUser(userId: string) {
    // Check if user exists
    await this.requireUser(userId);

    // Update subscription to expired and end any admin grant
    await this.prisma.subscription.updateMany({
      where: { userId },
      data: { status: 'EXPIRED', grantPlan: null, grantEndsAt: null },
    });

    // Deactivate all devices
    await this.prisma.userDevice.updateMany({
      where: { userId },
      data: { isActive: false },
    });

    // Revoke every backend access/refresh token (users.tokenVersion). This is
    // not a ban: a device with a live Firebase session gets a new pair from
    // POST /auth/firebase/verify, which also picks up the expired plan.
    await this.prisma.user.update({
      where: { id: userId },
      data: bumpTokenVersion(),
    });

    this.logger.log(`User deactivated: ${userId}`);

    return { message: 'User deactivated successfully' };
  }

  /**
   * Full KVKK deletion, identical to the user-initiated DELETE /users/me:
   * GCS files, provider voice clones (+ audit rows), Firebase Auth,
   * then the DB cascade. Response shape unchanged for the admin panel.
   */
  async deleteUser(userId: string) {
    await this.usersService.deleteUser(userId);

    this.logger.log(`User deleted by admin: ${userId}`);

    return { message: 'User deleted successfully' };
  }

  async grantSubscription(userId: string, dto: GrantSubscriptionDto) {
    // Verify user exists
    await this.requireUser(userId);

    // Calculate end date
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + dto.durationDays);

    const planMap = {
      [GrantSubscriptionPlan.PRO]: 'PRO',
      [GrantSubscriptionPlan.CREATOR]: 'CREATOR',
      [GrantSubscriptionPlan.MINI]: 'MINI',
    } as const;

    // The grant lives in its own columns, so no store write can shorten it;
    // the store-backed columns are then re-derived (they mirror the grant
    // while no store purchase is active).
    await this.prisma.subscription.upsert({
      where: { userId },
      create: {
        userId,
        plan: 'FREE',
        grantPlan: planMap[dto.plan],
        grantEndsAt: endDate,
        currentPeriodStart: new Date(),
      },
      update: {
        grantPlan: planMap[dto.plan],
        grantEndsAt: endDate,
      },
    });
    await recomputeSubscription(this.prisma, userId);

    this.logger.log(
      `Subscription granted: userId=${userId}, plan=${dto.plan}, duration=${dto.durationDays}d, reason=${dto.reason}`,
    );

    return { message: `${dto.plan} subscription granted until ${endDate.toISOString().split('T')[0]}` };
  }

  async getUserStats() {
    const [
      totalUsers,
      verifiedUsers,
      activeSubscriptions,
      totalStoryProgress,
      totalVoiceProfiles,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { emailVerified: true } }),
      this.prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.userStoryProgress.count(),
      this.prisma.voiceProfile.count(),
    ]);

    const subscriptionsByPlan = await this.prisma.subscription.groupBy({
      by: ['plan'],
      _count: { plan: true },
      where: { status: 'ACTIVE' },
    });

    return {
      totalUsers,
      verifiedUsers,
      unverifiedUsers: totalUsers - verifiedUsers,
      activeSubscriptions,
      subscriptionsByPlan: subscriptionsByPlan.map((s: any) => ({
        plan: s.plan,
        count: s._count.plan,
      })),
      totalStoryProgress,
      totalVoiceProfiles,
      averageVoiceProfilesPerUser: totalUsers > 0 ? Number((totalVoiceProfiles / totalUsers).toFixed(2)) : 0,
    };
  }
}
