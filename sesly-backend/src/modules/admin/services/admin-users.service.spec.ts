import { NotFoundException } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { GrantSubscriptionPlan } from '../dto/grant-subscription.dto';
import { createMockPrismaService, MockPrismaService } from '../../../test-utils/prisma-mock';

const SECRET_FIELDS = [
  'passwordHash',
  'password',
  'emailVerificationToken',
  'passwordResetToken',
  'providerId',
  'fcmToken',
  'refreshToken',
];

describe('AdminUsersService', () => {
  let prisma: MockPrismaService;
  let usersService: { deleteUser: jest.Mock };
  let service: AdminUsersService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    usersService = { deleteUser: jest.fn().mockResolvedValue({ message: 'ok' }) };
    service = new AdminUsersService(prisma as any, usersService as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getAllUsers', () => {
    it('returns the pagination envelope and uses skip/take from page/limit', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]);
      prisma.user.count.mockResolvedValue(45);

      const res = await service.getAllUsers(3, 20);

      expect(res).toEqual({ data: [{ id: 'u1' }, { id: 'u2' }], total: 45, page: 3, limit: 20, totalPages: 3 });
      const args = prisma.user.findMany.mock.calls[0][0];
      expect(args).toMatchObject({ skip: 40, take: 20, orderBy: { createdAt: 'desc' }, where: {} });
      expect(prisma.user.count).toHaveBeenCalledWith({ where: {} });
    });

    it('search: case-insensitive OR over email / firstName / lastName, same where for count', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      const res = await service.getAllUsers(1, 10, 'ali');

      const expectedWhere = {
        OR: [
          { email: { contains: 'ali', mode: 'insensitive' } },
          { firstName: { contains: 'ali', mode: 'insensitive' } },
          { lastName: { contains: 'ali', mode: 'insensitive' } },
        ],
      };
      expect(prisma.user.findMany.mock.calls[0][0].where).toEqual(expectedWhere);
      expect(prisma.user.count).toHaveBeenCalledWith({ where: expectedWhere });
      expect(res).toEqual({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    });

    it('never selects secret columns', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      prisma.user.count.mockResolvedValue(0);

      await service.getAllUsers();

      const select = prisma.user.findMany.mock.calls[0][0].select;
      for (const f of SECRET_FIELDS) expect(select).not.toHaveProperty(f);
      expect(select.subscription).toEqual({
        select: { plan: true, status: true, currentPeriodEnd: true },
      });
    });
  });

  describe('getUserById', () => {
    it('missing user -> NotFoundException', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.getUserById('nope')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('explicit select without secrets; usage limits scoped to the current month', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 6, 20, 10, 0, 0)); // July 2026 local
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', subscription: null });

      await service.getUserById('u1');

      const args = prisma.user.findUnique.mock.calls[0][0];
      expect(args.where).toEqual({ id: 'u1' });
      expect(args.include).toBeUndefined();
      for (const f of SECRET_FIELDS) expect(args.select).not.toHaveProperty(f);
      expect(args.select.usageLimits).toEqual({ where: { month: 7, year: 2026 } });
      expect(args.select.devices.select).not.toHaveProperty('fcmToken');
    });

    it.each([
      ['no subscription', null, 'FREE'],
      ['active PRO grant in the future', { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date('2027-01-01') }, 'PRO'],
      ['PRO grant that already ended', { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date('2026-01-01') }, 'FREE'],
      ['EXPIRED CREATOR', { plan: 'CREATOR', status: 'EXPIRED', currentPeriodEnd: null }, 'FREE'],
    ])('effectivePlan: %s', async (_label, subscription, expected) => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.c', subscription });

      const user = await service.getUserById('u1');

      expect(user.effectivePlan).toBe(expected);
      expect(user).toMatchObject({ id: 'u1', email: 'a@b.c' });
    });
  });

  describe('deactivateUser', () => {
    it('missing user -> 404 and nothing is written', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.deactivateUser('ghost')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.subscription.updateMany).not.toHaveBeenCalled();
      expect(prisma.userDevice.updateMany).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('revokes every backend token of that user (tokenVersion bump)', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

      await service.deactivateUser('u1');

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { tokenVersion: { increment: 1 } },
      });
    });

    it('expires the subscription and deactivates every device of that user only', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });

      const res = await service.deactivateUser('u1');

      expect(prisma.subscription.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { status: 'EXPIRED', grantPlan: null, grantEndsAt: null },
      });
      expect(prisma.userDevice.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        data: { isActive: false },
      });
      expect(res).toEqual({ message: 'User deactivated successfully' });
    });
  });

  describe('deleteUser', () => {
    it('delegates the full KVKK cleanup to UsersService.deleteUser', async () => {
      const res = await service.deleteUser('u1');

      expect(usersService.deleteUser).toHaveBeenCalledWith('u1');
      expect(res).toEqual({ message: 'User deleted successfully' });
      // No shortcut DB delete that would skip GCS / provider / Stripe cleanup.
      expect(prisma.user.delete).not.toHaveBeenCalled();
      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    });

    it('missing user -> the 404 from UsersService propagates', async () => {
      usersService.deleteUser.mockRejectedValue(new NotFoundException('Kullanıcı bulunamadı.'));

      await expect(service.deleteUser('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('grantSubscription', () => {
    it('missing user -> 404, no upsert', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.grantSubscription('ghost', { plan: GrantSubscriptionPlan.PRO, durationDays: 30, reason: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('writes the grant columns (never the store columns directly) and re-derives the row', async () => {
      const now = new Date(2026, 0, 10, 12, 0, 0);
      jest.useFakeTimers().setSystemTime(now);
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.subscription.upsert.mockResolvedValue({});
      const expectedEnd = new Date(2026, 1, 9, 12, 0, 0);
      prisma.subscription.findUnique.mockResolvedValue({ userId: 'u1', plan: 'FREE', grantPlan: 'CREATOR', grantEndsAt: expectedEnd });
      prisma.storePurchase.findMany.mockResolvedValue([]);

      const res = await service.grantSubscription('u1', {
        plan: GrantSubscriptionPlan.CREATOR,
        durationDays: 30,
        reason: 'support',
      });

      const args = prisma.subscription.upsert.mock.calls[0][0];
      expect(args.where).toEqual({ userId: 'u1' });
      expect(args.create).toEqual({
        userId: 'u1',
        plan: 'FREE',
        grantPlan: 'CREATOR',
        grantEndsAt: expectedEnd,
        currentPeriodStart: now,
      });
      expect(args.update).toEqual({ grantPlan: 'CREATOR', grantEndsAt: expectedEnd });
      expect(prisma.subscription.upsert.mock.calls[1][0].update).toMatchObject({
        plan: 'CREATOR',
        status: 'ACTIVE',
        currentPeriodEnd: expectedEnd,
      });
      expect(res.message).toMatch(/^CREATOR subscription granted until \d{4}-\d{2}-\d{2}$/);
      expect(res.message).toContain(expectedEnd.toISOString().split('T')[0]);
    });

    it('a grant survives a running store subscription and wins while it is the better plan', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.subscription.upsert.mockResolvedValue({});
      const grantEnd = new Date('2026-09-29T12:00:00Z');
      prisma.subscription.findUnique.mockResolvedValue({ userId: 'u1', plan: 'MINI', status: 'ACTIVE', grantPlan: 'PRO', grantEndsAt: grantEnd });
      prisma.storePurchase.findMany.mockResolvedValue([
        { id: 'p1', userId: 'u1', platform: 'GOOGLE', purchaseKey: 'tok', productId: 'mini_monthly', plan: 'MINI', state: 'ACTIVE', expiresAt: new Date('2026-10-20T00:00:00Z'), autoRenew: true },
      ]);

      await service.grantSubscription('u1', { plan: GrantSubscriptionPlan.PRO, durationDays: 1, reason: 'x' });

      // The row keeps the store purchase; the grant stays in its own columns.
      const row = prisma.subscription.upsert.mock.calls[1][0].update;
      expect(row).toMatchObject({ plan: 'MINI', storePurchaseId: 'p1', googlePurchaseToken: 'tok' });
      const { resolveEffectivePlan } = await import('../../../common/utils/subscription-plan');
      const merged = { ...row, grantPlan: 'PRO', grantEndsAt: grantEnd };
      expect(resolveEffectivePlan(merged)).toBe('PRO');
      // ...and the store plan comes back once the grant is over.
      expect(resolveEffectivePlan(merged, new Date('2026-10-01T12:00:00Z'))).toBe('MINI');
      jest.useRealTimers();
    });
  });

  describe('getUserStats', () => {
    it('zero users: average voice profiles per user is 0 (no NaN)', async () => {
      prisma.user.count.mockResolvedValue(0);
      prisma.subscription.count.mockResolvedValue(0);
      prisma.userStoryProgress.count.mockResolvedValue(0);
      prisma.voiceProfile.count.mockResolvedValue(0);
      prisma.subscription.groupBy.mockResolvedValue([]);

      const stats = await service.getUserStats();

      expect(stats).toEqual({
        totalUsers: 0,
        verifiedUsers: 0,
        unverifiedUsers: 0,
        activeSubscriptions: 0,
        subscriptionsByPlan: [],
        totalStoryProgress: 0,
        totalVoiceProfiles: 0,
        averageVoiceProfilesPerUser: 0,
      });
    });

    it('computes derived numbers from real counts', async () => {
      prisma.user.count.mockImplementation(async (args?: any) => (args?.where?.emailVerified ? 2 : 3));
      prisma.subscription.count.mockResolvedValue(1);
      prisma.userStoryProgress.count.mockResolvedValue(12);
      prisma.voiceProfile.count.mockResolvedValue(4);
      prisma.subscription.groupBy.mockResolvedValue([{ plan: 'PRO', _count: { plan: 1 } }]);

      const stats = await service.getUserStats();

      expect(stats).toMatchObject({
        totalUsers: 3,
        verifiedUsers: 2,
        unverifiedUsers: 1,
        activeSubscriptions: 1,
        subscriptionsByPlan: [{ plan: 'PRO', count: 1 }],
        totalStoryProgress: 12,
        totalVoiceProfiles: 4,
        averageVoiceProfilesPerUser: 1.33,
      });
      expect(prisma.subscription.count).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
    });
  });
});
