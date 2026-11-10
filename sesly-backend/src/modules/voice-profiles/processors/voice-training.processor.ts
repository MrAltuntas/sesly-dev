import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CartesiaTTSService } from '../../tts-providers/cartesia/cartesia-tts.service';
import { PermanentVoiceCloningError } from '../../tts-providers/voice-cloning-errors';
import { NotificationsService } from '../../notifications/notifications.service';
import { TTSProvider, VoiceProfileKind } from '../../../common/enums/prisma.enums';
import {
  transcodeToWav,
  cleanupTempDir,
  AudioTooShortError,
  DEFAULT_MAX_DURATION_SEC,
} from '../utils/audio-preprocessor';
import { DEFAULT_VOICE_FAILURE_MESSAGE_KEY } from '../voice-profile.mapper';
import { serverText } from '../../../common/i18n/server-text';
import { DEFAULT_UI_LANGUAGE, UiLanguage } from '../../../common/i18n/ui-language';
import { resolveUserUiLanguage } from '../../../common/i18n/user-ui-language';
import {
  CLONE_SERVER_MIN_SECONDS,
  PENDING_VOICE_ID_PREFIX,
  cloneContentFor,
} from '../clone-config.constants';
import { findVoiceLanguage } from '../../../common/constants/voice-languages';
import {
  deleteUpstreamCloneWithAudit,
  deleteVoiceProfileStorage,
  testSampleKey as buildTestSampleKey,
} from '../voice-clone-cleanup';
import { refundCloneCreationForProfile } from '../clone-quota';
import {
  VOICE_TRAINING_ATTEMPTS,
  VOICE_TRAINING_JOB,
  VOICE_TRAINING_QUEUE,
  VoiceTrainingJob,
} from './voice-training.job';

/**
 * i18n keys of the user-facing failure reasons. The text is stored on the
 * profile (`errorReason`) and sent on the socket in the owner's UI language:
 * `serverText(key, language)`, never the key itself.
 */
export const VOICE_FAILURE_REASONS = {
  unreadable: 'messages.voiceFailure.unreadable',
  tooShort: 'messages.voiceFailure.tooShort',
  noSpeech: 'messages.voiceFailure.noSpeech',
  timeout: 'messages.voiceFailure.timeout',
  generic: DEFAULT_VOICE_FAILURE_MESSAGE_KEY,
} as const;

/**
 * Thrown when ffmpeg cannot read / convert the uploaded recording.
 * Permanent (bad input), so the job is not retried.
 */
export class AudioPreprocessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AudioPreprocessingError';
  }
}

/** Nothing reached Cartesia yet: our own rejection of the clip. */
function isPreUpstreamRejection(error: unknown): boolean {
  return error instanceof AudioPreprocessingError || error instanceof AudioTooShortError;
}

export function isPermanentTrainingError(error: unknown): boolean {
  return error instanceof PermanentVoiceCloningError || isPreUpstreamRejection(error);
}

/** Map any training error to the reason shown to the user, as text in `language`. */
export function voiceFailureReason(error: unknown, language: UiLanguage = DEFAULT_UI_LANGUAGE): string {
  return serverText(voiceFailureReasonKey(error), language);
}

/** Map any training error to the i18n key of the reason shown to the user. */
export function voiceFailureReasonKey(error: unknown): string {
  if (error instanceof AudioTooShortError) return VOICE_FAILURE_REASONS.tooShort;
  if (error instanceof AudioPreprocessingError) return VOICE_FAILURE_REASONS.unreadable;
  const raw = (error as any)?.message || '';
  if (/voice duration too short|clip.*too short|audio.*too short/i.test(raw)) {
    return VOICE_FAILURE_REASONS.tooShort;
  }
  if (/no speech detected|no valid audio/i.test(raw)) {
    return VOICE_FAILURE_REASONS.noSpeech;
  }
  return VOICE_FAILURE_REASONS.generic;
}

/** True when this run is the last attempt Bull will make for the job. */
export function isFinalAttempt(job: Pick<Job, 'attemptsMade' | 'opts'>): boolean {
  const attempts = job.opts?.attempts ?? 1;
  return (job.attemptsMade ?? 0) + 1 >= attempts;
}

type TrainingProfile = {
  id: string;
  userId: string;
  name: string;
  provider: string;
  kind: string;
  status: string;
  language: string;
  voiceId: string;
  voiceCloningKey: string | null;
  sampleAudioUrl: string | null;
  consentAudioUrl: string | null;
};

/**
 * Voice clone training (Cartesia Sonic 3.6).
 *
 * Retry policy (job options in voice-training.job.ts: 3 attempts,
 * exponential backoff): permanent errors (unreadable / too short audio,
 * Cartesia input rejections) mark the profile FAILED immediately and do NOT
 * throw, so Bull never retries them. Transient errors are re-thrown; only the
 * final attempt marks FAILED and notifies. A profile stuck in PROCESSING is
 * failed by the maintenance sweeper.
 *
 * Idempotency: the Cartesia id is persisted right after the clone call, so a
 * retry after a later failure reuses it instead of creating a second
 * upstream voice. Whenever the row turns out to be gone (or no longer
 * PROCESSING) after cloning, the upstream voice is deleted immediately.
 */
@Processor(VOICE_TRAINING_QUEUE)
export class VoiceTrainingProcessor {
  private readonly logger = new Logger(VoiceTrainingProcessor.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private cartesiaTtsService: CartesiaTTSService,
    private notificationsService: NotificationsService,
  ) { }

  @Process(VOICE_TRAINING_JOB)
  async handleVoiceTraining(job: Job<VoiceTrainingJob>) {
    const { profileId } = job.data;
    this.logger.log(
      `Starting voice clone training for profile ${profileId} (attempt ${(job.attemptsMade ?? 0) + 1}/${job.opts?.attempts ?? VOICE_TRAINING_ATTEMPTS})`,
    );

    const profile = (await this.prisma.voiceProfile.findUnique({
      where: { id: profileId },
    })) as TrainingProfile | null;

    if (!profile) {
      this.logger.warn(`Voice profile ${profileId} no longer exists, skipping training`);
      return;
    }
    if (profile.status !== 'PROCESSING') {
      // Swept as timed out, or already finished by an earlier attempt.
      this.logger.warn(`Voice profile ${profileId} is ${profile.status}, skipping training`);
      return;
    }

    try {
      await this.train(job, profile);
    } catch (error: any) {
      await this.handleFailure(job, profile, error);
    }
  }

  private async train(job: Job<VoiceTrainingJob>, profile: TrainingProfile) {
    const { profileId, referenceS3Key, speechStartMs } = job.data;

    if (profile.kind !== VoiceProfileKind.CLONE || profile.provider !== TTSProvider.CARTESIA) {
      throw new PermanentVoiceCloningError(
        `Profile ${profileId} is not a Cartesia clone (kind=${profile.kind}, provider=${profile.provider})`,
      );
    }

    // A previous attempt may already have created the upstream voice.
    let voiceId = this.existingCloneId(profile);

    if (!voiceId) {
      const clip = await this.preprocess(profileId, referenceS3Key, speechStartMs ?? null);

      voiceId = await this.cartesiaTtsService.createVoiceClone(
        { buffer: clip, mimeType: 'audio/wav', filename: 'reference.wav' },
        profile.name,
        {
          // The language the user chose to speak, and the accent label
          // Cartesia files that language under (needed to add accents later).
          language: profile.language,
          accent: findVoiceLanguage(profile.language)?.cartesiaAccent,
        },
      );
      this.logger.log(`Cartesia clone created for profile ${profileId}`);

      // Persist the upstream id immediately (retry idempotency). If the row
      // is gone or was swept meanwhile, delete the new upstream voice now.
      const persisted = await this.prisma.voiceProfile.updateMany({
        where: { id: profileId, status: 'PROCESSING' },
        data: { voiceCloningKey: voiceId, voiceId },
      });
      if (persisted.count !== 1) {
        await this.discardOrphanClone(profile, voiceId);
        return;
      }
    }

    // "Listen to your voice" sample. Non-fatal: the sample endpoint falls
    // back to on-demand preview generation.
    const sampleKey = await this.generateTestSample(profile, voiceId);

    const finished = await this.prisma.voiceProfile.updateMany({
      where: { id: profileId, status: 'PROCESSING' },
      data: {
        voiceCloningKey: voiceId,
        voiceId,
        status: 'READY',
        errorReason: null,
        ...(sampleKey ? { sampleAudioUrl: sampleKey } : {}),
      },
    });
    if (finished.count !== 1) {
      await this.discardOrphanClone(profile, voiceId);
      return;
    }

    await this.notifySafely(() =>
      this.notificationsService.notifyVoiceReady(profile.userId, profile.name, profile.id),
    );
    this.logger.log(`Voice profile trained and ready: ${profileId}`);
  }

  private existingCloneId(profile: TrainingProfile): string | null {
    const key = profile.voiceCloningKey;
    if (key && !key.startsWith(PENDING_VOICE_ID_PREFIX)) return key;
    return null;
  }

  /**
   * Download the raw upload, trim leading silence / cap at 60 s, transcode to
   * WAV and keep a copy next to the raw file (`.normalized.wav`, deleted with
   * the profile) so QA can audition exactly what Cartesia received.
   */
  private async preprocess(
    profileId: string,
    referenceS3Key: string,
    speechStartMs: number | null,
  ): Promise<Buffer> {
    let rawBuffer: Buffer;
    try {
      rawBuffer = await this.storageService.downloadFile(referenceS3Key);
    } catch (error: any) {
      // Storage hiccup: transient, let Bull retry.
      throw new Error(`Could not download reference audio: ${error?.message ?? error}`);
    }

    let transcoded;
    try {
      transcoded = await transcodeToWav(rawBuffer, this.logger, profileId, {
        speechStartMs,
        maxDurationSec: DEFAULT_MAX_DURATION_SEC,
        minDurationSec: CLONE_SERVER_MIN_SECONDS,
      });
    } catch (error: any) {
      if (error instanceof AudioTooShortError) throw error;
      throw new AudioPreprocessingError(
        `Audio preprocessing failed: ${error?.message ?? error}`,
      );
    }

    try {
      await this.storageService.uploadFile(
        transcoded.buffer,
        `${referenceS3Key}.normalized.wav`,
        'audio/wav',
      );
    } catch (error: any) {
      this.logger.warn(
        `Could not store normalized wav for ${profileId}: ${error?.message ?? error}`,
      );
    } finally {
      await cleanupTempDir(transcoded.tempDir, this.logger);
    }

    return transcoded.buffer;
  }

  private async generateTestSample(
    profile: TrainingProfile,
    voiceId: string,
  ): Promise<string | null> {
    try {
      const audioBuffer = await this.cartesiaTtsService.textToSpeech(
        // A sentence in the language of the voice itself.
        cloneContentFor(profile.language).testSampleText,
        voiceId,
        { language: profile.language },
      );
      if (!audioBuffer || audioBuffer.length === 0) {
        this.logger.warn(`Empty test sample for profile ${profile.id}`);
        return null;
      }
      const key = buildTestSampleKey(profile.userId, profile.id);
      await this.storageService.uploadFile(audioBuffer, key, 'audio/mpeg');
      return key;
    } catch (error: any) {
      this.logger.warn(
        `Failed to generate test sample for profile ${profile.id}: ${error?.message ?? error}`,
      );
      return null;
    }
  }

  /**
   * The profile was deleted (or swept to FAILED) while Cartesia was cloning:
   * remove the brand-new upstream voice and anything we wrote after the
   * user's deletion, so nothing outlives the user's request.
   */
  private async discardOrphanClone(profile: TrainingProfile, voiceId: string) {
    this.logger.warn(
      `Profile ${profile.id} was deleted or is no longer PROCESSING; deleting the new upstream clone`,
    );
    const stillThere = await this.prisma.voiceProfile.findUnique({
      where: { id: profile.id },
      select: { id: true },
    });

    await deleteUpstreamCloneWithAudit(
      this.prisma,
      () => this.cartesiaTtsService,
      this.logger,
      {
        ...profile,
        kind: VoiceProfileKind.CLONE,
        voiceId,
        voiceCloningKey: voiceId,
      },
    );

    if (stillThere) {
      // Swept to FAILED: keep the row (user sees the failure) but drop the
      // upstream id we just deleted.
      await this.prisma.voiceProfile.updateMany({
        where: { id: profile.id, voiceCloningKey: voiceId },
        data: { voiceCloningKey: null, voiceId: `${PENDING_VOICE_ID_PREFIX}${profile.id}` },
      });
    } else {
      await deleteVoiceProfileStorage(this.storageService, this.logger, profile);
    }
  }

  private async handleFailure(
    job: Job<VoiceTrainingJob>,
    profile: TrainingProfile,
    error: any,
  ) {
    const permanent = isPermanentTrainingError(error);
    const finalAttempt = permanent || isFinalAttempt(job);

    this.logger.error(
      `Voice training failed for profile ${profile.id} (permanent=${permanent}, final=${finalAttempt})`,
      error?.stack,
    );

    if (!finalAttempt) {
      // Transient: stay PROCESSING and let Bull retry with backoff.
      throw error;
    }

    // The raw provider / ffmpeg text is only logged, never stored or sent.
    // Stored and shown later: written in the owner's UI language.
    const errorReason = voiceFailureReason(
      error,
      await resolveUserUiLanguage(this.prisma, profile.userId),
    );
    const marked = await this.prisma.voiceProfile.updateMany({
      where: { id: profile.id, status: 'PROCESSING' },
      data: { status: 'FAILED', errorReason },
    });

    if (marked.count === 1) {
      // The training produced no voice (our rejection of the clip before
      // Cartesia, a provider rejection, or retries used up): give the
      // creation back, once, so a failed training never burns the plan
      // allowance. A clone that became READY is never refunded, deleted or not.
      await refundCloneCreationForProfile(this.prisma, profile.id).catch((refundError) =>
        this.logger.warn(`Clone creation refund failed for ${profile.id}: ${refundError?.message ?? refundError}`),
      );
      await this.notifySafely(() =>
        this.notificationsService.notifyVoiceFailed(
          profile.userId,
          profile.name,
          profile.id,
          errorReason,
        ),
      );
    }

    if (permanent) {
      this.logger.warn(`Permanent failure for profile ${profile.id}, not retrying: ${errorReason}`);
      return;
    }
    // Final transient attempt: rethrow so Bull records the failed job.
    throw error;
  }

  private async notifySafely(send: () => Promise<unknown>) {
    try {
      await send();
    } catch (error: any) {
      this.logger.warn(`Voice notification failed: ${error?.message ?? error}`);
    }
  }
}
