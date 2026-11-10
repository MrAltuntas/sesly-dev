import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, Process } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { TTSProviderFactory } from '../tts-providers/tts-provider.factory';
import { NotificationsService } from '../notifications/notifications.service';
import {
  TTSProvider,
  VoiceDeletionRequestStatus,
  VoiceProfileKind,
} from '../../common/enums/prisma.enums';
import { VOICE_FAILURE_REASONS } from './processors/voice-training.processor';
import { serverText } from '../../common/i18n/server-text';
import { resolveUserUiLanguage } from '../../common/i18n/user-ui-language';
import { refundCloneCreationForProfile } from './clone-quota';

export const VOICE_MAINTENANCE_QUEUE = 'voice-maintenance';
export const VOICE_SWEEP_JOB = 'sweep';

/** How often the sweeper runs (Bull repeatable job, one schedule cluster-wide). */
export const SWEEP_EVERY_MS = 10 * 60 * 1000;
/** PROCESSING longer than this is considered dead (3 attempts + backoff take < 10 min). */
export const PROCESSING_TIMEOUT_MS = 20 * 60 * 1000;
/** A clone placeholder that never received its recording is removed after this. */
export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
/** Upstream deletion attempts in total (the first one happens at delete time). */
export const MAX_DELETION_ATTEMPTS = 6;
/** An IN_PROGRESS deletion older than this was interrupted (crash) and is retried. */
export const STUCK_DELETION_MS = 60 * 60 * 1000;
const SWEEP_BATCH = 50;

export interface DeletionRetryCandidate {
  status: string;
  attemptCount: number;
  lastAttemptedAt: Date | null;
}

/**
 * Should a voice_deletion_requests row be retried now? Exponential spacing
 * on top of the sweep interval: 10, 20, 40, 80, 160 min after the previous
 * attempt, up to MAX_DELETION_ATTEMPTS attempts in total.
 */
export function isDeletionRetryDue(row: DeletionRetryCandidate, now: Date): boolean {
  if (row.attemptCount >= MAX_DELETION_ATTEMPTS) return false;
  if (
    row.status !== VoiceDeletionRequestStatus.FAILED &&
    row.status !== VoiceDeletionRequestStatus.IN_PROGRESS
  ) {
    return false;
  }
  if (!row.lastAttemptedAt) return true;
  const since = now.getTime() - new Date(row.lastAttemptedAt).getTime();
  if (row.status === VoiceDeletionRequestStatus.IN_PROGRESS) {
    return since >= STUCK_DELETION_MS;
  }
  const wait = SWEEP_EVERY_MS * Math.pow(2, Math.max(0, row.attemptCount - 1));
  return since >= wait;
}

export interface SweepResult {
  failedStuck: number;
  removedPending: number;
  deletionsRetried: number;
  deletionsCompleted: number;
}

/**
 * Voice clone housekeeping, run every 10 minutes:
 *   1. PROCESSING clones older than 20 min -> FAILED + notification
 *   2. PENDING clone placeholders without an upload, older than 24 h -> deleted
 *   3. FAILED (or interrupted) upstream deletions -> retried with backoff,
 *      bounded by MAX_DELETION_ATTEMPTS; the row keeps attemptCount,
 *      lastAttemptedAt and the last error in `notes` for the admin audit.
 */
@Injectable()
export class VoiceMaintenanceService implements OnModuleInit {
  private readonly logger = new Logger(VoiceMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ttsProviderFactory: TTSProviderFactory,
    private readonly notificationsService: NotificationsService,
    @InjectQueue(VOICE_MAINTENANCE_QUEUE) private readonly queue: Queue,
  ) {}

  onModuleInit() {
    // Not awaited: an unreachable Redis must not block application boot.
    void this.scheduleSweep().catch((error) =>
      this.logger.error(`Could not schedule the voice sweeper: ${error?.message ?? error}`),
    );
  }

  /**
   * Register the repeatable sweep job. Bull dedupes repeatable jobs by
   * (name, jobId, interval), so every instance calling this ends up with a
   * single cluster-wide schedule; schedules with an outdated interval are
   * removed first.
   */
  async scheduleSweep(): Promise<void> {
    const existing = await this.queue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === VOICE_SWEEP_JOB && Number(job.every) !== SWEEP_EVERY_MS) {
        await this.queue.removeRepeatableByKey(job.key);
      }
    }
    await this.queue.add(
      VOICE_SWEEP_JOB,
      {},
      {
        jobId: 'voice-sweeper',
        repeat: { every: SWEEP_EVERY_MS },
        removeOnComplete: true,
        removeOnFail: 20,
      },
    );
    this.logger.log(`Voice sweeper scheduled every ${SWEEP_EVERY_MS / 60000} min`);
  }

  async sweep(now: Date = new Date()): Promise<SweepResult> {
    const failedStuck = await this.failStuckProcessing(now);
    const removedPending = await this.removeAbandonedPending(now);
    const { retried, completed } = await this.retryFailedDeletions(now);

    const result: SweepResult = {
      failedStuck,
      removedPending,
      deletionsRetried: retried,
      deletionsCompleted: completed,
    };
    if (failedStuck || removedPending || retried) {
      this.logger.log(`Voice sweep: ${JSON.stringify(result)}`);
    }
    return result;
  }

  async failStuckProcessing(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - PROCESSING_TIMEOUT_MS);
    const stuck = await this.prisma.voiceProfile.findMany({
      where: { kind: VoiceProfileKind.CLONE, status: 'PROCESSING', updatedAt: { lt: cutoff } },
      select: { id: true, userId: true, name: true },
      take: SWEEP_BATCH,
    });

    let failed = 0;
    for (const profile of stuck) {
      // Stored and shown later: in the owner's UI language.
      const reason = serverText(
        VOICE_FAILURE_REASONS.timeout,
        await resolveUserUiLanguage(this.prisma, profile.userId),
      );
      const marked = await this.prisma.voiceProfile.updateMany({
        where: { id: profile.id, status: 'PROCESSING', updatedAt: { lt: cutoff } },
        data: { status: 'FAILED', errorReason: reason },
      });
      if (marked.count !== 1) continue;
      failed++;
      this.logger.warn(`Voice profile ${profile.id} stuck in PROCESSING, marked FAILED`);
      // Timed out on our side: the creation is given back (once per profile).
      await refundCloneCreationForProfile(this.prisma, profile.id).catch((error: any) =>
        this.logger.warn(`Clone creation refund failed for ${profile.id}: ${error?.message ?? error}`),
      );
      try {
        await this.notificationsService.notifyVoiceFailed(
          profile.userId,
          profile.name,
          profile.id,
          reason,
        );
      } catch (error: any) {
        this.logger.warn(`Timeout notification failed for ${profile.id}: ${error?.message ?? error}`);
      }
    }
    return failed;
  }

  async removeAbandonedPending(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - PENDING_UPLOAD_TTL_MS);
    const where = {
      kind: VoiceProfileKind.CLONE,
      status: 'PENDING' as const,
      sampleAudioUrl: null,
      createdAt: { lt: cutoff },
    };
    const stale = await this.prisma.voiceProfile.findMany({
      where,
      select: { id: true },
      take: SWEEP_BATCH,
    });
    if (stale.length === 0) return 0;

    // PENDING clones never reached Cartesia (the voiceId is a placeholder)
    // and never stored a file, so the row is all there is to delete. The
    // status condition keeps an upload that just claimed the row safe.
    const { count } = await this.prisma.voiceProfile.deleteMany({
      where: { ...where, id: { in: stale.map((p) => p.id) } },
    });
    return count;
  }

  async retryFailedDeletions(now: Date): Promise<{ retried: number; completed: number }> {
    const candidates = await this.prisma.voiceDeletionRequest.findMany({
      where: {
        provider: TTSProvider.CARTESIA,
        attemptCount: { lt: MAX_DELETION_ATTEMPTS },
        status: {
          in: [VoiceDeletionRequestStatus.FAILED, VoiceDeletionRequestStatus.IN_PROGRESS],
        },
      },
      orderBy: { requestedAt: 'asc' },
      take: SWEEP_BATCH,
    });

    let retried = 0;
    let completed = 0;
    for (const row of candidates) {
      if (!isDeletionRetryDue(row, now) || !row.providerVoiceId) continue;

      // Claim the row so two sweeps (or instances) never retry it twice.
      const claimed = await this.prisma.voiceDeletionRequest.updateMany({
        where: { id: row.id, status: row.status, attemptCount: row.attemptCount },
        data: {
          status: VoiceDeletionRequestStatus.IN_PROGRESS,
          attemptCount: { increment: 1 },
          lastAttemptedAt: now,
        },
      });
      if (claimed.count !== 1) continue;
      retried++;

      const attempt = row.attemptCount + 1;
      try {
        await this.ttsProviderFactory
          .getCloningProvider(TTSProvider.CARTESIA)
          .deleteVoiceClone(row.providerVoiceId);
        await this.prisma.voiceDeletionRequest.update({
          where: { id: row.id },
          data: { status: VoiceDeletionRequestStatus.COMPLETED, completedAt: now },
        });
        completed++;
      } catch (error: any) {
        const message = (error?.message ?? String(error)).slice(0, 400);
        const exhausted = attempt >= MAX_DELETION_ATTEMPTS;
        await this.prisma.voiceDeletionRequest.update({
          where: { id: row.id },
          data: {
            status: VoiceDeletionRequestStatus.FAILED,
            notes: `Attempt ${attempt}/${MAX_DELETION_ATTEMPTS}${exhausted ? ' (giving up, needs manual deletion)' : ''}: ${message}`,
          },
        });
        if (exhausted) {
          this.logger.error(
            `Upstream voice deletion ${row.id} (${row.providerVoiceId}) failed ${attempt} times; needs manual follow-up`,
          );
        }
      }
    }
    return { retried, completed };
  }
}

/** Bull consumer for the repeatable sweep job. */
@Processor(VOICE_MAINTENANCE_QUEUE)
export class VoiceMaintenanceProcessor {
  constructor(private readonly maintenance: VoiceMaintenanceService) {}

  @Process(VOICE_SWEEP_JOB)
  async handleSweep() {
    return this.maintenance.sweep();
  }
}
