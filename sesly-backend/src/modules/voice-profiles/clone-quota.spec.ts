import {
  buildVoiceSlotInfo,
  getCloneCreationUsage,
  refundCloneCreation,
  refundCloneCreationForProfile,
  tryConsumeCloneCreation,
} from './clone-quota';
import { ensureLifetimeRow, ensureMonthlyRow, currentUsagePeriod } from '../usage/usage-counters';
import { getCloneCreationAllowance } from '../../common/constants/voice-slots.constants';
import { createFakeUsageDb, FakeUsageDb } from '../../test-utils/fake-usage-db';

const USER = 'u1';
const OCT = new Date(2026, 9, 16, 12);
const NOV = new Date(2026, 10, 3, 12);

describe('clone creation allowance (counts creations, not clone rows)', () => {
  let db: FakeUsageDb;

  beforeEach(() => {
    db = createFakeUsageDb();
  });

  it('FREE: one creation in total; deleting the clone and a new month change nothing', async () => {
    const free = getCloneCreationAllowance('FREE');
    expect(free).toEqual({ limit: 1, period: 'lifetime' });

    expect(await tryConsumeCloneCreation(db.prisma, USER, free, OCT)).toEqual(OCT);
    // The clone row is deleted: no counter is touched by a delete.
    expect(await tryConsumeCloneCreation(db.prisma, USER, free, OCT)).toBeNull();
    expect(await tryConsumeCloneCreation(db.prisma, USER, free, NOV)).toBeNull();
    expect(await getCloneCreationUsage(db.prisma, USER, OCT)).toEqual({ monthly: 1, lifetime: 1 });
  });

  it('paid plans: monthly allowance (MINI 2, PREMIUM 5), renews next month, lifetime keeps counting', async () => {
    const mini = getCloneCreationAllowance('MINI');
    expect(mini).toEqual({ limit: 2, period: 'month' });
    expect(getCloneCreationAllowance('PRO')).toEqual({ limit: 5, period: 'month' });

    expect(await tryConsumeCloneCreation(db.prisma, USER, mini, OCT)).not.toBeNull();
    expect(await tryConsumeCloneCreation(db.prisma, USER, mini, OCT)).not.toBeNull();
    expect(await tryConsumeCloneCreation(db.prisma, USER, mini, OCT)).toBeNull();
    expect(await tryConsumeCloneCreation(db.prisma, USER, mini, NOV)).not.toBeNull();

    expect(await getCloneCreationUsage(db.prisma, USER, NOV)).toEqual({ monthly: 1, lifetime: 3 });
    // The former MINI user on FREE has no free creation left.
    expect(await tryConsumeCloneCreation(db.prisma, USER, getCloneCreationAllowance('FREE'), NOV)).toBeNull();
  });

  it('an unlimited allowance always succeeds and still counts', async () => {
    expect(await tryConsumeCloneCreation(db.prisma, USER, { limit: null, period: 'month' }, OCT)).toEqual(OCT);
    expect(await getCloneCreationUsage(db.prisma, USER, OCT)).toEqual({ monthly: 1, lifetime: 1 });
  });

  it('concurrent uploads cannot overshoot the allowance', async () => {
    const free = getCloneCreationAllowance('FREE');
    const results = await Promise.all([1, 2, 3].map(() => tryConsumeCloneCreation(db.prisma, USER, free, OCT)));
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('refund goes to the month of the charge and to the lifetime counter, never below zero', async () => {
    const mini = getCloneCreationAllowance('MINI');
    await tryConsumeCloneCreation(db.prisma, USER, mini, OCT);
    await tryConsumeCloneCreation(db.prisma, USER, mini, NOV);
    await refundCloneCreation(db.prisma, USER, OCT);
    expect(await getCloneCreationUsage(db.prisma, USER, OCT)).toEqual({ monthly: 0, lifetime: 1 });
    expect(await getCloneCreationUsage(db.prisma, USER, NOV)).toEqual({ monthly: 1, lifetime: 1 });
    await refundCloneCreation(db.prisma, USER, OCT);
    expect(await getCloneCreationUsage(db.prisma, USER, OCT)).toEqual({ monthly: 0, lifetime: 0 });
  });

  it('refundCloneCreationForProfile: once per profile; no marker means no refund', async () => {
    const free = getCloneCreationAllowance('FREE');
    const chargedAt = await tryConsumeCloneCreation(db.prisma, USER, free, OCT);
    db.profiles.set('vp-1', { id: 'vp-1', userId: USER, creationChargedAt: chargedAt });
    db.profiles.set('vp-2', { id: 'vp-2', userId: USER, creationChargedAt: null });

    expect(await refundCloneCreationForProfile(db.prisma, 'vp-1')).toBe(true);
    expect(await refundCloneCreationForProfile(db.prisma, 'vp-1')).toBe(false);
    expect(await refundCloneCreationForProfile(db.prisma, 'vp-2')).toBe(false);
    expect(await refundCloneCreationForProfile(db.prisma, 'missing')).toBe(false);
    expect(await getCloneCreationUsage(db.prisma, USER, OCT)).toEqual({ monthly: 0, lifetime: 0 });

    // A concurrent refund that lost the marker race gives nothing back.
    db.profiles.set('vp-3', { id: 'vp-3', userId: USER, creationChargedAt: OCT });
    db.prisma.voiceProfile.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await refundCloneCreationForProfile(db.prisma, 'vp-3')).toBe(false);
  });

  it('first-row races (P2002) are tolerated; other errors are not', async () => {
    const period = currentUsagePeriod(OCT);
    db.prisma.usageLimit.upsert.mockRejectedValueOnce({ code: 'P2002' });
    await expect(ensureMonthlyRow(db.prisma, USER, period)).resolves.toBeUndefined();
    db.prisma.usageLifetime.upsert.mockRejectedValueOnce({ code: 'P2002' });
    await expect(ensureLifetimeRow(db.prisma, USER)).resolves.toBeUndefined();
    db.prisma.usageLimit.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(ensureMonthlyRow(db.prisma, USER, period)).rejects.toThrow('db down');
  });

  it('currentUsagePeriod: December rolls over into January', () => {
    expect(currentUsagePeriod(new Date(2026, 11, 31, 23, 59))).toEqual({
      month: 12,
      year: 2026,
      resetAt: new Date(2027, 0, 1),
    });
    expect(currentUsagePeriod().month).toBeGreaterThanOrEqual(1);
  });

  describe('buildVoiceSlotInfo', () => {
    it('FREE exposes the lifetime numbers under the legacy monthly names', () => {
      const info = buildVoiceSlotInfo({
        plan: 'FREE',
        extraSlots: 0,
        presetUsed: 1,
        cloneUsed: 0,
        creations: { monthly: 0, lifetime: 1 },
        now: OCT,
      });
      expect(info.clone).toEqual({
        used: 0,
        limit: 1,
        canCreate: false,
        monthlyCreated: 1,
        monthlyLimit: 1,
        creations: { used: 1, limit: 1, period: 'lifetime', renewsAt: null, canCreate: false },
      });
      expect(info.canCreate).toBe(true); // a preset can still be added
    });

    it('a paid plan renews its creations on the 1st; extra slots count', () => {
      const info = buildVoiceSlotInfo({
        plan: 'PRO',
        extraSlots: -3,
        presetUsed: 0,
        cloneUsed: 2,
        creations: { monthly: 4, lifetime: 9 },
        now: OCT,
      });
      expect(info.extraSlots).toBe(0);
      expect(info.clone.creations).toEqual({
        used: 4,
        limit: 5,
        period: 'month',
        renewsAt: new Date(2026, 10, 1),
        canCreate: true,
      });
      expect(info.clone.canCreate).toBe(true);
    });
  });
});
