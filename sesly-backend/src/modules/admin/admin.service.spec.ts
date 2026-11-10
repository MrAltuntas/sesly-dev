import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService, DEFAULT_REJECT_REASON } from './admin.service';
import { BroadcastSegment } from './dto/broadcast.dto';
import { AdminSubscriptionPlan } from './dto/grant-access.dto';
import { PromoCodeType } from './dto/create-promocode.dto';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { resolveEffectivePlan } from '../../common/utils/subscription-plan';

/**
 * Minimal Prisma `where` evaluator (scalar filters + to-one relation `is` /
 * `isNot`). Unknown operators throw so a rewritten where clause fails loudly.
 */
function matchesWhere(row: Record<string, any> | null | undefined, where: Record<string, any>): boolean {
  if (!row) return false;
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
    return Object.entries(cond).every(([op, arg]: [string, any]) => {
      switch (op) {
        case 'is':
          return arg === null ? value == null : value != null && matchesWhere(value, arg);
        case 'isNot':
          return arg === null ? value != null : value == null || !matchesWhere(value, arg);
        case 'equals':
          return cmp(value, arg) === 0;
        case 'not':
          return cmp(value, arg) !== 0;
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

describe('AdminService', () => {
  let prisma: MockPrismaService;
  let notifications: { notifyVoiceFailed: jest.Mock; sendBroadcast: jest.Mock };
  let maintenance: { setEnabled: jest.Mock; getEnabled: jest.Mock };
  let storage: { getReadUrl: jest.Mock };
  let service: AdminService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    notifications = {
      notifyVoiceFailed: jest.fn().mockResolvedValue(undefined),
      sendBroadcast: jest.fn().mockResolvedValue({ count: 0, pushSent: false, pushDelivered: 0 }),
    };
    maintenance = {
      setEnabled: jest.fn(async (v: boolean) => v),
      getEnabled: jest.fn().mockResolvedValue(false),
    };
    storage = { getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)) };
    service = new AdminService(
      prisma as any,
      notifications as any,
      maintenance as any,
      storage as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  describe('promo codes', () => {
    it('duplicate code -> BadRequest, nothing created', async () => {
      prisma.promoCode.findUnique.mockResolvedValue({ id: 'p', code: 'YAZ' });

      await expect(
        service.createPromoCode({ code: 'YAZ', type: PromoCodeType.PERCENTAGE, value: 10 }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.promoCode.create).not.toHaveBeenCalled();
    });

    it('creates the code with exactly the DTO fields', async () => {
      prisma.promoCode.findUnique.mockResolvedValue(null);
      prisma.promoCode.create.mockImplementation(async ({ data }: any) => ({ id: 'p1', ...data }));
      const dto = { code: 'KIS', type: PromoCodeType.FIXED_AMOUNT, value: 50, maxUses: 3 };

      const res = await service.createPromoCode(dto);

      expect(prisma.promoCode.findUnique).toHaveBeenCalledWith({ where: { code: 'KIS' } });
      expect(prisma.promoCode.create).toHaveBeenCalledWith({ data: dto });
      expect(res).toMatchObject({ id: 'p1', code: 'KIS' });
    });

    it('lists newest first', async () => {
      prisma.promoCode.findMany.mockResolvedValue([]);
      await service.getPromoCodes();
      expect(prisma.promoCode.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
    });
  });

  // ---------------------------------------------------------------------------
  describe('grantAccess (by email)', () => {
    it('unknown email -> 404, no upsert', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.grantAccess({
          userEmail: 'x@y.z',
          plan: AdminSubscriptionPlan.PRO,
          durationDays: 7,
          reason: 'r',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.subscription.upsert).not.toHaveBeenCalled();
    });

    it('writes the grant columns only, then mirrors the grant on the row when no store purchase runs', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 8, 28, 9, 0, 0));
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
      const end = new Date(2026, 9, 5, 9, 0, 0);
      prisma.subscription.upsert.mockResolvedValue({ id: 's1' });
      prisma.subscription.findUnique.mockResolvedValue({ userId: 'u1', plan: 'FREE', grantPlan: 'CREATOR', grantEndsAt: end });
      prisma.storePurchase.findMany.mockResolvedValue([]);

      await service.grantAccess({
        userEmail: 'a@b.c',
        plan: AdminSubscriptionPlan.CREATOR,
        durationDays: 7,
        reason: 'r',
      });

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.c' } });
      expect(prisma.subscription.upsert.mock.calls[0][0]).toEqual({
        where: { userId: 'u1' },
        create: { userId: 'u1', plan: 'FREE', grantPlan: 'CREATOR', grantEndsAt: end },
        update: { grantPlan: 'CREATOR', grantEndsAt: end },
      });
      // Second upsert: the row columns follow the grant (no store purchase).
      expect(prisma.subscription.upsert.mock.calls[1][0].update).toMatchObject({
        plan: 'CREATOR',
        status: 'ACTIVE',
        currentPeriodEnd: end,
        cancelAtPeriodEnd: false,
        storePurchaseId: null,
      });
      jest.useRealTimers();
    });

    it('MINI can be granted too', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.c' });
      prisma.subscription.upsert.mockResolvedValue({ id: 's1' });
      prisma.subscription.findUnique.mockResolvedValue(null);
      prisma.storePurchase.findMany.mockResolvedValue([]);
      await service.grantAccess({ userEmail: 'a@b.c', plan: AdminSubscriptionPlan.MINI, durationDays: 1, reason: 'r' });
      expect(prisma.subscription.upsert.mock.calls[0][0].update.grantPlan).toBe('MINI');
    });
  });

  // ---------------------------------------------------------------------------
  describe('moderation', () => {
    it('normalizes page/limit (page>=1, limit<=100) and filters by status only when given', async () => {
      prisma.voiceProfile.findMany.mockResolvedValue([]);
      prisma.voiceProfile.count.mockResolvedValue(0);

      const page = await service.listVoiceProfilesForModeration(0, 1000);

      const args = prisma.voiceProfile.findMany.mock.calls[0][0];
      expect(args.where).toEqual({});
      expect(args.skip).toBe(0);
      expect(args.take).toBe(100);
      expect(prisma.voiceProfile.count).toHaveBeenCalledWith({ where: {} });
      expect(page).toEqual({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 });
    });

    it('never selects secrets or the upstream cloning key', async () => {
      prisma.voiceProfile.findMany.mockResolvedValue([]);
      prisma.voiceProfile.count.mockResolvedValue(0);

      await service.listVoiceProfilesForModeration(2, 10, 'PROCESSING' as any);

      const args = prisma.voiceProfile.findMany.mock.calls[0][0];
      expect(args.skip).toBe(10);
      expect(args.where).toEqual({ status: 'PROCESSING' });
      expect(args.select).not.toHaveProperty('voiceCloningKey');
      expect(args.select).not.toHaveProperty('voiceId');
    });

    it('row without sample -> sampleUrl null, missing errorReason -> errorMessage null', async () => {
      prisma.voiceProfile.findMany.mockResolvedValue([
        {
          id: 'vp',
          name: 'Baba',
          provider: 'GOOGLE',
          status: 'READY',
          errorReason: undefined,
          sampleAudioUrl: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: 'u', email: 'e', firstName: null, lastName: null },
        },
      ]);
      prisma.voiceProfile.count.mockResolvedValue(1);

      const page = await service.listVoiceProfilesForModeration(1, 20);

      expect(page.data[0]).toMatchObject({ errorMessage: null, sampleUrl: null });
    });

    it('reject: unknown profile -> 404, nothing updated, nobody notified', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue(null);

      await expect(service.rejectVoiceProfile('ghost', 'x')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.voiceProfile.update).not.toHaveBeenCalled();
      expect(notifications.notifyVoiceFailed).not.toHaveBeenCalled();
    });

    it('reject: custom reason is trimmed, stored and sent to the owner', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue({ id: 'vp1', userId: 'owner', name: 'Anne' });
      prisma.voiceProfile.update.mockImplementation(async ({ data }: any) => ({
        id: 'vp1',
        name: 'Anne',
        provider: 'CARTESIA',
        status: data.status,
        errorReason: data.errorReason,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));

      const res = await service.rejectVoiceProfile('vp1', '  Arka plan cok gurultulu.  ');

      expect(prisma.voiceProfile.update.mock.calls[0][0]).toMatchObject({
        where: { id: 'vp1' },
        data: { status: 'FAILED', errorReason: 'Arka plan cok gurultulu.' },
      });
      expect(notifications.notifyVoiceFailed).toHaveBeenCalledWith(
        'owner',
        'Anne',
        'vp1',
        'Arka plan cok gurultulu.',
      );
      expect(res).toMatchObject({ id: 'vp1', status: 'FAILED', errorMessage: 'Arka plan cok gurultulu.' });
      expect(Object.keys(res).sort()).toEqual(
        ['createdAt', 'errorMessage', 'id', 'name', 'provider', 'status', 'updatedAt'].sort(),
      );
    });

    it('reject: whitespace-only reason falls back to the default Turkish copy', async () => {
      prisma.voiceProfile.findUnique.mockResolvedValue({ id: 'vp1', userId: 'owner', name: 'Anne' });
      prisma.voiceProfile.update.mockResolvedValue({ id: 'vp1', errorReason: DEFAULT_REJECT_REASON });

      await service.rejectVoiceProfile('vp1', '   ');

      expect(prisma.voiceProfile.update.mock.calls[0][0].data.errorReason).toBe(DEFAULT_REJECT_REASON);
      expect(notifications.notifyVoiceFailed.mock.calls[0][3]).toBe(DEFAULT_REJECT_REASON);
    });

    it('reject: the profile is marked FAILED before the user is notified', async () => {
      const order: string[] = [];
      prisma.voiceProfile.findUnique.mockResolvedValue({ id: 'vp1', userId: 'owner', name: 'Anne' });
      prisma.voiceProfile.update.mockImplementation(async () => {
        order.push('update');
        return { id: 'vp1' };
      });
      notifications.notifyVoiceFailed.mockImplementation(async () => {
        order.push('notify');
      });

      await service.rejectVoiceProfile('vp1');

      expect(order).toEqual(['update', 'notify']);
    });
  });

  // ---------------------------------------------------------------------------
  describe('broadcast', () => {
    const futureEnd = new Date('2099-01-01T00:00:00Z');
    const users = {
      noSub: { id: 'noSub', subscription: null },
      freeRow: { id: 'freeRow', subscription: { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null } },
      pro: { id: 'pro', subscription: { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: futureEnd } },
      creator: { id: 'creator', subscription: { plan: 'CREATOR', status: 'ACTIVE', currentPeriodEnd: futureEnd } },
    };

    async function whereFor(segment: BroadcastSegment) {
      prisma.user.findMany.mockResolvedValue([]);
      await service.broadcast({ title: 't', body: 'b', segment });
      return prisma.user.findMany.mock.calls.at(-1)![0].where;
    }

    it('returns exactly what NotificationsService reports (no re-counting)', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
      const outcome = { count: 3, pushSent: true, pushDelivered: 1 };
      notifications.sendBroadcast.mockResolvedValue(outcome);

      const res = await service.broadcast({ title: 'T', body: 'B', segment: BroadcastSegment.PREMIUM });

      expect(res).toBe(outcome);
      expect(notifications.sendBroadcast).toHaveBeenCalledTimes(1);
      expect(notifications.sendBroadcast).toHaveBeenCalledWith(['a', 'b', 'c'], { title: 'T', body: 'B' });
      expect(prisma.user.findMany.mock.calls[0][0].select).toEqual({ id: true });
    });

    it('empty segment: still delegates with [] and returns the zero outcome', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      notifications.sendBroadcast.mockResolvedValue({ count: 0, pushSent: false, pushDelivered: 0 });

      const res = await service.broadcast({ title: 'T', body: 'B', segment: BroadcastSegment.FREE });

      expect(notifications.sendBroadcast).toHaveBeenCalledWith([], { title: 'T', body: 'B' });
      expect(res).toEqual({ count: 0, pushSent: false, pushDelivered: 0 });
    });

    it('ALL: no filter', async () => {
      expect(await whereFor(BroadcastSegment.ALL)).toEqual({});
    });

    it('PREMIUM: ACTIVE PRO/CREATOR only', async () => {
      const where = await whereFor(BroadcastSegment.PREMIUM);

      expect(matchesWhere(users.pro, where)).toBe(true);
      expect(matchesWhere(users.creator, where)).toBe(true);
      expect(matchesWhere(users.noSub, where)).toBe(false);
      expect(matchesWhere(users.freeRow, where)).toBe(false);
      expect(matchesWhere({ id: 'pd', subscription: { plan: 'PRO', status: 'PAST_DUE' } }, where)).toBe(false);
    });

    it('FREE: users with a FREE row or no subscription row at all', async () => {
      const where = await whereFor(BroadcastSegment.FREE);

      expect(matchesWhere(users.noSub, where)).toBe(true);
      expect(matchesWhere(users.freeRow, where)).toBe(true);
      expect(matchesWhere(users.pro, where)).toBe(false);
      expect(matchesWhere(users.creator, where)).toBe(false);
    });

    it('PREMIUM and FREE never overlap', async () => {
      const premium = await whereFor(BroadcastSegment.PREMIUM);
      const free = await whereFor(BroadcastSegment.FREE);

      for (const u of Object.values(users)) {
        expect(matchesWhere(u, premium) && matchesWhere(u, free)).toBe(false);
      }
    });

    // Fixed (was BUG): segments looked at the stored plan + status only. A lapsed
    // store subscriber / admin-deactivated user (EXPIRED) was in NEITHER segment,
    // and an ended admin grant kept getting PREMIUM-only messages.
    it('FREE / PREMIUM follow the effective plan (lapsed subscribers are FREE)', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      const lapsedApple = {
        id: 'lapsed',
        subscription: { plan: 'PRO', status: 'EXPIRED', currentPeriodEnd: new Date('2026-08-01'), appleTransactionId: 't' },
      };
      const endedGrant = {
        id: 'grant',
        subscription: { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: new Date('2026-05-01') },
      };
      expect(resolveEffectivePlan(lapsedApple.subscription)).toBe('FREE');
      expect(resolveEffectivePlan(endedGrant.subscription)).toBe('FREE');

      const free = await whereFor(BroadcastSegment.FREE);
      const premium = await whereFor(BroadcastSegment.PREMIUM);

      expect(matchesWhere(lapsedApple, free)).toBe(true);
      expect(matchesWhere(endedGrant, free)).toBe(true);
      expect(matchesWhere(endedGrant, premium)).toBe(false);
    });

    it('store-billed PRO inside the 24 h renewal grace stays PREMIUM; open-ended grants are PREMIUM', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-09-28T12:00:00Z'));
      const inGrace = {
        id: 'grace',
        subscription: {
          plan: 'PRO',
          status: 'ACTIVE',
          currentPeriodEnd: new Date('2026-09-28T02:00:00Z'),
          stripeSubscriptionId: 'sub_1',
        },
      };
      const openEnded = { id: 'open', subscription: { plan: 'CREATOR', status: 'ACTIVE', currentPeriodEnd: null } };
      expect(resolveEffectivePlan(inGrace.subscription)).toBe('PRO');

      const premium = await whereFor(BroadcastSegment.PREMIUM);
      const free = await whereFor(BroadcastSegment.FREE);

      for (const u of [inGrace, openEnded]) {
        expect(matchesWhere(u, premium)).toBe(true);
        expect(matchesWhere(u, free)).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  describe('maintenance mode', () => {
    it('set: persists through MaintenanceService and echoes the stored value', async () => {
      maintenance.setEnabled.mockResolvedValue(true);

      await expect(service.setMaintenanceMode(true)).resolves.toEqual({ enabled: true });
      expect(maintenance.setEnabled).toHaveBeenCalledWith(true);
    });

    it('get: reads MaintenanceService', async () => {
      maintenance.getEnabled.mockResolvedValue(true);
      await expect(service.getMaintenanceMode()).resolves.toEqual({ enabled: true });
    });
  });

  // ---------------------------------------------------------------------------
});
