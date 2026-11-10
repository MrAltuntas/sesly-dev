import { serverText } from '../../common/i18n/server-text';
import {
  isDeletionRetryDue,
  MAX_DELETION_ATTEMPTS,
  PENDING_UPLOAD_TTL_MS,
  PROCESSING_TIMEOUT_MS,
  STUCK_DELETION_MS,
  SWEEP_EVERY_MS,
  VoiceMaintenanceService,
} from './voice-maintenance.service';
import { createMockPrismaService, MockPrismaService } from '../../test-utils/prisma-mock';
import { VOICE_FAILURE_REASONS } from './processors/voice-training.processor';

describe('VoiceMaintenanceService (sweeper)', () => {
  const now = new Date('2026-09-27T12:00:00Z');
  let prisma: MockPrismaService;
  let notifications: any;
  let cloning: any;
  let queue: any;
  let service: VoiceMaintenanceService;

  beforeEach(() => {
    prisma = createMockPrismaService();
    notifications = { notifyVoiceFailed: jest.fn().mockResolvedValue(undefined) };
    cloning = { deleteVoiceClone: jest.fn().mockResolvedValue(undefined) };
    queue = {
      getRepeatableJobs: jest.fn().mockResolvedValue([]),
      removeRepeatableByKey: jest.fn(),
      add: jest.fn().mockResolvedValue({}),
    };
    service = new VoiceMaintenanceService(
      prisma as any,
      { getCloningProvider: jest.fn(() => cloning) } as any,
      notifications,
      queue,
    );
    prisma.voiceProfile.findMany.mockResolvedValue([]);
    prisma.voiceDeletionRequest.findMany.mockResolvedValue([]);
  });

  it('schedules one repeatable job every 10 min and drops outdated schedules', async () => {
    queue.getRepeatableJobs.mockResolvedValue([
      { name: 'sweep', every: 60_000, key: 'old' },
      { name: 'sweep', every: SWEEP_EVERY_MS, key: 'current' },
    ]);
    await service.scheduleSweep();
    expect(queue.removeRepeatableByKey).toHaveBeenCalledWith('old');
    expect(queue.removeRepeatableByKey).not.toHaveBeenCalledWith('current');
    expect(queue.add).toHaveBeenCalledWith(
      'sweep',
      {},
      expect.objectContaining({ jobId: 'voice-sweeper', repeat: { every: SWEEP_EVERY_MS } }),
    );
  });

  it('PROCESSING older than 20 min -> FAILED + notification (only when the guarded update wins)', async () => {
    prisma.voiceProfile.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1', name: 'Annem' },
      { id: 'p2', userId: 'u2', name: 'Babam' },
    ]);
    prisma.voiceProfile.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 }); // finished meanwhile

    const failed = await service.failStuckProcessing(now);

    const cutoff = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);
    expect(prisma.voiceProfile.findMany.mock.calls[0][0].where).toEqual({
      kind: 'CLONE',
      status: 'PROCESSING',
      updatedAt: { lt: cutoff },
    });
    expect(prisma.voiceProfile.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'p1', status: 'PROCESSING', updatedAt: { lt: cutoff } },
      data: { status: 'FAILED', errorReason: serverText(VOICE_FAILURE_REASONS.timeout, 'tr') },
    });
    expect(failed).toBe(1);
    expect(notifications.notifyVoiceFailed).toHaveBeenCalledTimes(1);
    expect(notifications.notifyVoiceFailed).toHaveBeenCalledWith(
      'u1',
      'Annem',
      'p1',
      'Ses hazırlanması beklenenden uzun sürdü. Lütfen sesi silip yeniden kaydet.',
    );
  });

  it('a clone that timed out on our side gets its creation back; a refund failure is only logged', async () => {
    const chargedAt = new Date(2026, 9, 3);
    prisma.voiceProfile.findMany.mockResolvedValueOnce([
      { id: 'p1', userId: 'u1', name: 'Annem' },
      { id: 'p2', userId: 'u2', name: 'Babam' },
    ]);
    prisma.voiceProfile.updateMany.mockResolvedValue({ count: 1 });
    prisma.voiceProfile.findUnique
      .mockResolvedValueOnce({ userId: 'u1', creationChargedAt: chargedAt })
      .mockRejectedValueOnce(new Error('db blip'));
    prisma.usageLimit.updateMany.mockResolvedValue({ count: 1 });
    prisma.usageLifetime.updateMany.mockResolvedValue({ count: 1 });

    const failed = await service.failStuckProcessing(now);

    expect(failed).toBe(2);
    expect(prisma.usageLimit.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', month: 10, year: 2026, clonesCreated: { gt: 0 } },
      data: { clonesCreated: { decrement: 1 } },
    });
    expect(prisma.usageLifetime.updateMany).toHaveBeenCalledTimes(1);
    expect(notifications.notifyVoiceFailed).toHaveBeenCalledTimes(2);
  });

  it('PENDING clone placeholders without upload older than 24 h are deleted (status-guarded)', async () => {
    prisma.voiceProfile.findMany.mockResolvedValueOnce([{ id: 'p1' }, { id: 'p2' }]);
    prisma.voiceProfile.deleteMany.mockResolvedValue({ count: 2 });

    const removed = await service.removeAbandonedPending(now);

    const cutoff = new Date(now.getTime() - PENDING_UPLOAD_TTL_MS);
    expect(prisma.voiceProfile.deleteMany).toHaveBeenCalledWith({
      where: {
        kind: 'CLONE',
        status: 'PENDING',
        sampleAudioUrl: null,
        createdAt: { lt: cutoff },
        id: { in: ['p1', 'p2'] },
      },
    });
    expect(removed).toBe(2);
  });

  it('nothing stale -> no delete call', async () => {
    await expect(service.removeAbandonedPending(now)).resolves.toBe(0);
    expect(prisma.voiceProfile.deleteMany).not.toHaveBeenCalled();
  });

  it('sweep runs all three passes', async () => {
    const result = await service.sweep(now);
    expect(result).toEqual({ failedStuck: 0, removedPending: 0, deletionsRetried: 0, deletionsCompleted: 0 });
    expect(prisma.voiceDeletionRequest.findMany.mock.calls[0][0].where).toEqual({
      provider: 'CARTESIA',
      attemptCount: { lt: MAX_DELETION_ATTEMPTS },
      status: { in: ['FAILED', 'IN_PROGRESS'] },
    });
  });

  describe('isDeletionRetryDue', () => {
    const ago = (ms: number) => new Date(now.getTime() - ms);

    it('FAILED rows back off exponentially from the sweep interval', () => {
      expect(isDeletionRetryDue({ status: 'FAILED', attemptCount: 1, lastAttemptedAt: ago(SWEEP_EVERY_MS - 1) }, now)).toBe(false);
      expect(isDeletionRetryDue({ status: 'FAILED', attemptCount: 1, lastAttemptedAt: ago(SWEEP_EVERY_MS) }, now)).toBe(true);
      expect(isDeletionRetryDue({ status: 'FAILED', attemptCount: 3, lastAttemptedAt: ago(SWEEP_EVERY_MS * 3) }, now)).toBe(false);
      expect(isDeletionRetryDue({ status: 'FAILED', attemptCount: 3, lastAttemptedAt: ago(SWEEP_EVERY_MS * 4) }, now)).toBe(true);
      expect(isDeletionRetryDue({ status: 'FAILED', attemptCount: 1, lastAttemptedAt: null }, now)).toBe(true);
    });

    it('bounded by MAX_DELETION_ATTEMPTS', () => {
      expect(
        isDeletionRetryDue(
          { status: 'FAILED', attemptCount: MAX_DELETION_ATTEMPTS, lastAttemptedAt: ago(10 * 24 * 3600 * 1000) },
          now,
        ),
      ).toBe(false);
    });

    it('IN_PROGRESS only when interrupted for over an hour; COMPLETED / NO_OP never', () => {
      expect(isDeletionRetryDue({ status: 'IN_PROGRESS', attemptCount: 1, lastAttemptedAt: ago(STUCK_DELETION_MS - 1) }, now)).toBe(false);
      expect(isDeletionRetryDue({ status: 'IN_PROGRESS', attemptCount: 1, lastAttemptedAt: ago(STUCK_DELETION_MS) }, now)).toBe(true);
      expect(isDeletionRetryDue({ status: 'COMPLETED', attemptCount: 1, lastAttemptedAt: ago(STUCK_DELETION_MS) }, now)).toBe(false);
      expect(isDeletionRetryDue({ status: 'NO_OP', attemptCount: 0, lastAttemptedAt: null }, now)).toBe(false);
    });
  });

  describe('retryFailedDeletions', () => {
    const row = (overrides: Record<string, unknown> = {}) => ({
      id: 'r1',
      status: 'FAILED',
      attemptCount: 1,
      lastAttemptedAt: new Date(now.getTime() - 60 * 60 * 1000),
      providerVoiceId: 'c-1',
      ...overrides,
    });

    it('claims, retries and completes; records attempts', async () => {
      prisma.voiceDeletionRequest.findMany.mockResolvedValue([row()]);
      prisma.voiceDeletionRequest.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.retryFailedDeletions(now);

      expect(prisma.voiceDeletionRequest.updateMany).toHaveBeenCalledWith({
        where: { id: 'r1', status: 'FAILED', attemptCount: 1 },
        data: { status: 'IN_PROGRESS', attemptCount: { increment: 1 }, lastAttemptedAt: now },
      });
      expect(cloning.deleteVoiceClone).toHaveBeenCalledWith('c-1');
      expect(prisma.voiceDeletionRequest.update).toHaveBeenCalledWith({
        where: { id: 'r1' },
        data: { status: 'COMPLETED', completedAt: now },
      });
      expect(result).toEqual({ retried: 1, completed: 1 });
    });

    it('failure keeps FAILED with the attempt number and last error; gives up at the cap', async () => {
      prisma.voiceDeletionRequest.findMany.mockResolvedValue([
        row(),
        row({ id: 'r2', attemptCount: MAX_DELETION_ATTEMPTS - 1, lastAttemptedAt: new Date(0) }),
      ]);
      prisma.voiceDeletionRequest.updateMany.mockResolvedValue({ count: 1 });
      cloning.deleteVoiceClone.mockRejectedValue(new Error('Cartesia 503'));

      const result = await service.retryFailedDeletions(now);

      const updates = prisma.voiceDeletionRequest.update.mock.calls.map((c: any[]) => c[0]);
      expect(updates[0]).toEqual({
        where: { id: 'r1' },
        data: { status: 'FAILED', notes: 'Attempt 2/' + MAX_DELETION_ATTEMPTS + ': Cartesia 503' },
      });
      expect(updates[1].data.notes).toContain('giving up');
      expect(result).toEqual({ retried: 2, completed: 0 });
    });

    it('skips rows that are not due or already claimed elsewhere', async () => {
      prisma.voiceDeletionRequest.findMany.mockResolvedValue([
        row({ id: 'not-due', lastAttemptedAt: now }),
        row({ id: 'raced' }),
      ]);
      prisma.voiceDeletionRequest.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.retryFailedDeletions(now);

      expect(prisma.voiceDeletionRequest.updateMany).toHaveBeenCalledTimes(1);
      expect(cloning.deleteVoiceClone).not.toHaveBeenCalled();
      expect(result).toEqual({ retried: 0, completed: 0 });
    });
  });
});
