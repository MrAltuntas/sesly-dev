import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { AudioStatus } from '../../common/enums/prisma.enums';
import { AudioLibraryQueryDto } from './dto/audio-library-query.dto';
import { PaginationHelper } from '../../common/utils/pagination.helper';
import { Prisma } from '@prisma/client';
import {
  AudioPrepareJob,
  AudioSegmentJob,
  SharedJobVoice,
} from './interfaces/audio-generation-job.interface';
import { planSynthesisUnits } from './synthesis-plan';
import {
  SharedAudioParams,
  audioStoragePrefix,
  buildSharedAudioParams,
  isShareableVoice,
  sharedAudioKey,
  withSegmentationVersion,
} from './shared-audio-key';
import {
  StorySegment,
  normalizeStoredSegments,
  splitStoryForTts,
} from '../story-segmentation/story-segments';
import { StorySegmentationService } from '../story-segmentation/story-segmentation.service';
import { SettingsService } from '../settings/settings.service';
import { extractStorageKey } from '../../common/utils/storage-key';
import { isPremiumVoice } from '../../common/utils/voice-tier';
import {
  NARRATION_AUDIO_REMOVED_MESSAGE_KEY,
  NARRATION_FAILED_MESSAGE_KEY,
  STORY_FALLBACK_TITLE_KEY,
  VOICE_NOT_READY_MESSAGE_KEY,
} from '../../common/constants/messages.constants';
import { serverText } from '../../common/i18n/server-text';
import { resolveUserUiLanguages } from '../../common/i18n/user-ui-language';
import type { UiLanguage } from '../../common/i18n/ui-language';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import axios from 'axios';

// ============================================================================
// INTERFACES
// ============================================================================

export interface GenerateAudioParams {
  text: string;
  voiceProfileId: string;
  userId: string;
  title?: string;
  // Phase 2A: optional story link + per-generation Cartesia overrides.
  // When `storyId` is set, the service looks up Story.preprocessedSegments
  // (admin-edited per-segment metadata) and Story.defaultEmotion/Speed
  // (story-level defaults). Caller-provided globals win over story defaults.
  storyId?: string;
  globalEmotion?: string;
  globalSpeed?: number;
  globalVolume?: number;
  pronunciationDictId?: string;
  /**
   * The narration this audio is for. With `share` (narrations only) a
   * ready-made Google voice narration of a story uses the shared audio of
   * its key and the narration is linked here, see generateSharedAudio.
   */
  narrationId?: string;
  share?: boolean;
}

export interface GenerateAudioResult {
  audioId: string;
  /** READY: a shared audio that was already made (no TTS call). */
  status: 'GENERATING' | 'READY' | 'FAILED';
  /** True when the narration was linked to a shared audio by this call. */
  shared: boolean;
}

/** Values every segment job of one audio shares. */
interface SegmentContext {
  /** Null for a shared audio (`voice` instead). */
  voiceProfileId: string | null;
  voice?: SharedJobVoice;
  shared?: boolean;
  provider: string | null;
  globalEmotion: string | null;
  globalSpeed: number | null;
  globalVolume: number | null;
  pronunciationDictId: string | null;
  language: string | null;
}

export interface AudioMetadata {
  id: string;
  status: AudioStatus;
  title: string | null;
  duration: number | null;
  progress: number; // 0-100
  audioUrl: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

// ============================================================================
// SERVICE
// ============================================================================

// Hard timeout for the ffmpeg merge step (5 minutes). If ffmpeg hangs past this,
// the process is killed and the merge is marked as FAILED so callers don't wait forever.
const FFMPEG_MERGE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A shared audio still PENDING / GENERATING after this long without any
 * progress (updatedAt moves with every finished segment) is taken as dead
 * (worker crash) and the next request generates it again.
 */
export const SHARED_AUDIO_STALE_MS = 20 * 60 * 1000;

const OPEN_NARRATION_STATUSES = ['PENDING', 'GENERATING'] as const;

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

@Injectable()
export class AudioService implements OnModuleInit {
  private readonly logger = new Logger(AudioService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
    @InjectQueue('audio-generation') private audioGenerationQueue: Queue,
    private storySegmentation: StorySegmentationService,
    private settings: SettingsService,
  ) { }

  /**
   * Configure the ffmpeg binary path once at boot. Prefers the bundled
   * `ffmpeg-static` binary so the merge step works consistently across
   * dev machines and Docker images that may not have ffmpeg on PATH.
   * Logs a warning (but does not throw) if no binary can be found, so
   * the app still boots and the failure surfaces cleanly at merge time.
   */
  onModuleInit(): void {
    try {
      const binaryPath: string | null = ffmpegStatic ?? null;
      if (binaryPath && fs.existsSync(binaryPath)) {
        ffmpeg.setFfmpegPath(binaryPath);
        this.logger.log(`FFmpeg binary configured: ${binaryPath}`);
      } else {
        this.logger.warn(
          'ffmpeg-static binary not found; falling back to system PATH. ' +
          'Audio merge will fail if ffmpeg is not installed on the host.',
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Failed to configure ffmpeg binary path: ${err?.message ?? err}`,
      );
    }
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  /**
   * Whether the caller's voice profile is a cloned voice (the narration
   * allowance it counts against). 404 when the profile is not theirs.
   */
  async isPremiumVoiceOf(userId: string, voiceProfileId: string): Promise<boolean> {
    const voiceProfile = await this.prisma.voiceProfile.findFirst({
      where: { id: voiceProfileId, userId },
    });
    if (!voiceProfile) {
      throw new NotFoundException('errors.voiceProfiles.notFound');
    }
    return isPremiumVoice(voiceProfile);
  }

  /**
   * Generate audio from text - returns audioId immediately
   * Caller stores audioId in their own table (e.g., StoryNarration.audioId)
   *
   * With `storyId` the story's stored segments (and their emotion / speed /
   * pause tags) drive generation. A story without segments is segmented on
   * this first request: that runs in the background (`prepare-audio` job,
   * Gemini may take tens of seconds), the Audio row is returned at once with
   * 0 segments and fills in when the segment jobs are queued.
   */
  async generateAudio(params: GenerateAudioParams): Promise<GenerateAudioResult> {
    const {
      text,
      voiceProfileId,
      userId,
      title,
      storyId,
      globalEmotion,
      globalSpeed,
      globalVolume,
      pronunciationDictId,
    } = params;

    this.logger.log(`Starting audio generation for user: ${userId}`);

    // Verify voice profile exists and belongs to user
    const voiceProfile = await this.prisma.voiceProfile.findFirst({
      where: { id: voiceProfileId, userId },
    });

    if (!voiceProfile) {
      throw new NotFoundException('errors.voiceProfiles.notFound');
    }

    if (voiceProfile.status !== 'READY') {
      throw new ForbiddenException({
        code: 'VOICE_NOT_READY',
        message: VOICE_NOT_READY_MESSAGE_KEY,
      });
    }

    // Pull story (if linked) for its segments + defaultEmotion/Speed.
    const story = storyId
      ? await this.prisma.story.findUnique({ where: { id: storyId } })
      : null;

    // Ready-made Google voice narrating a story: one synthesis for everybody
    // (runtime setting tts.sharePresetAudio). Cloned voices never share.
    if (
      story &&
      params.share &&
      params.narrationId &&
      isShareableVoice(voiceProfile) &&
      this.settings.get('tts.sharePresetAudio')
    ) {
      return this.generateSharedAudio(story, voiceProfile, params.narrationId);
    }

    // Resolve audio-level globals: caller param wins over story default.
    // Provider defaults (runtime settings) are applied inside the TTS
    // provider when these are still null at job-consumption time.
    const context: SegmentContext = {
      voiceProfileId,
      provider: voiceProfile.provider ?? null,
      globalEmotion: globalEmotion ?? story?.defaultEmotion ?? null,
      globalSpeed: globalSpeed ?? story?.defaultSpeed ?? null,
      globalVolume: globalVolume ?? null,
      pronunciationDictId: pronunciationDictId ?? story?.cartesiaPronunciationDictId ?? null,
      language: story?.language ?? null,
    };

    const storedSegments = story ? normalizeStoredSegments(story.preprocessedSegments) : [];
    const needsSegmentation = !!story && storedSegments.length === 0;

    // Create Audio record with global override snapshot.
    const audio = await this.prisma.audio.create({
      data: {
        userId,
        voiceProfileId,
        title,
        originalText: text,
        status: needsSegmentation ? 'GENERATING' : 'PENDING',
        totalSegments: 0,
        readySegments: 0,
        globalEmotion: context.globalEmotion,
        globalSpeed: context.globalSpeed,
        globalVolume: context.globalVolume,
        cartesiaPronunciationDictId: context.pronunciationDictId,
      },
    });

    if (story && needsSegmentation) {
      const job: AudioPrepareJob = {
        audioId: audio.id,
        storyId: story.id,
        voiceProfileId,
        globalEmotion: context.globalEmotion,
        globalSpeed: context.globalSpeed,
        globalVolume: context.globalVolume,
        pronunciationDictId: context.pronunciationDictId,
        language: context.language,
      };
      try {
        await this.audioGenerationQueue.add('prepare-audio', job);
      } catch (err) {
        await this.prisma.audio.delete({ where: { id: audio.id } }).catch(() => undefined);
        throw err;
      }
      this.logger.log(`Audio ${audio.id}: story ${story.id} has no segments yet, segmentation queued`);
      return { audioId: audio.id, status: 'GENERATING', shared: false };
    }

    // Stored segments win; a text without a story gets the free split.
    const segments = story ? storedSegments : splitStoryForTts(text);
    await this.startSegments(audio.id, segments, {
      ...context,
      segmentationVersion: story ? story.segmentationVersion : null,
    });

    return { audioId: audio.id, status: 'GENERATING', shared: false };
  }

  // ==========================================================================
  // SHARED AUDIO (ready-made voices)
  // ==========================================================================

  /**
   * Narration of a story with a ready-made Google voice through the shared
   * audio of its key (story, segmentation version, text, synthesis voice,
   * language, Google settings; see shared-audio-key.ts):
   *
   *   - no audio for the key: this request creates it (unique key, inside
   *     one transaction with the narration link) and starts the synthesis;
   *     a simultaneous first request hits the unique index and attaches;
   *   - READY: the narration is READY at once, no TTS call;
   *   - PENDING / GENERATING: the narration attaches and gets the same
   *     narration_status / push as the first one when it finishes;
   *   - FAILED (or stuck for SHARED_AUDIO_STALE_MS): the first request to
   *     claim it generates it again, once; the others attach.
   *
   * The narration is linked before any segment job is queued, and re-read
   * after linking, so a generation that finishes in between is never missed.
   */
  private async generateSharedAudio(
    story: Prisma.StoryGetPayload<object>,
    voiceProfile: { provider: string | null; kind: string | null; voiceId: string; language: string },
    narrationId: string,
  ): Promise<GenerateAudioResult> {
    const stored = normalizeStoredSegments(story.preprocessedSegments);
    const params = buildSharedAudioParams(story, voiceProfile, this.settings, stored.length > 0);
    const shareKey = sharedAudioKey(params);
    const link = {
      audioId: '',
      status: 'GENERATING' as const,
      errorMessage: null,
      completedAt: null,
      freeRegeneration: false,
    };

    // 1. First request for the key: create the audio and link the narration together.
    let created: { id: string } | null = null;
    const existing = await this.prisma.audio.findUnique({ where: { shareKey } });
    if (!existing) {
      try {
        created = await this.prisma.$transaction(async (tx) => {
          const audio = await tx.audio.create({
            data: {
              shared: true,
              shareKey,
              shareParams: params as unknown as Prisma.InputJsonValue,
              storyId: story.id,
              title: story.title,
              originalText: story.content,
              status: stored.length > 0 ? 'PENDING' : 'GENERATING',
              totalSegments: 0,
              readySegments: 0,
            },
            select: { id: true },
          });
          await tx.storyNarration.update({ where: { id: narrationId }, data: { ...link, audioId: audio.id } });
          return audio;
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        this.logger.log(`Shared audio ${shareKey.slice(0, 12)}: created by a simultaneous request, attaching`);
      }
    }

    if (created) {
      this.logger.log(`Shared audio ${created.id} created for story ${story.id} (${params.voiceId}, ${params.segmentation})`);
      await this.startSharedGeneration(created.id, story, stored, params);
      return { audioId: created.id, status: 'GENERATING', shared: true };
    }

    const audio = existing ?? (await this.prisma.audio.findUnique({ where: { shareKey } }));
    if (!audio) {
      // Created and removed (admin cache clear) between the two reads.
      throw new Error(`Shared audio ${shareKey} vanished while attaching`);
    }

    // 2. FAILED or stuck: one request claims the retry.
    if (this.isSharedRetryDue(audio) && (await this.claimSharedRetry(audio))) {
      await this.prisma.storyNarration.update({ where: { id: narrationId }, data: { ...link, audioId: audio.id } });
      this.logger.log(`Shared audio ${audio.id}: generating again after ${audio.status}`);
      await this.startSharedGeneration(audio.id, story, stored, params);
      return { audioId: audio.id, status: 'GENERATING', shared: true };
    }

    // 3. Attach to a READY or running generation.
    await this.prisma.storyNarration.update({ where: { id: narrationId }, data: { ...link, audioId: audio.id } });
    return this.settleAttachedNarration(narrationId, audio.id);
  }

  private isSharedRetryDue(audio: { status: string; updatedAt: Date }): boolean {
    if (audio.status === 'FAILED') return true;
    if (audio.status === 'READY') return false;
    return audio.updatedAt.getTime() < Date.now() - SHARED_AUDIO_STALE_MS;
  }

  /**
   * Conditional on the row being exactly as read (status and updatedAt), so
   * of several requests seeing the same FAILED audio only one regenerates.
   * The winner drops the old segment rows and files and detaches the
   * narrations that already failed with it (their users retry by creating a
   * new narration, which attaches again).
   */
  private async claimSharedRetry(audio: {
    id: string;
    status: string;
    updatedAt: Date;
    audioUrl: string | null;
  }): Promise<boolean> {
    const claimed = await this.prisma.audio.updateMany({
      where: { id: audio.id, status: audio.status as AudioStatus, updatedAt: audio.updatedAt },
      data: {
        status: 'GENERATING',
        errorMessage: null,
        audioUrl: null,
        duration: null,
        completedAt: null,
        totalSegments: 0,
        readySegments: 0,
      },
    });
    if (claimed.count !== 1) return false;

    const segments = await this.prisma.audioSegment.findMany({
      where: { audioId: audio.id },
      select: { audioUrl: true },
    });
    await this.deleteAudioFiles(audio.audioUrl, segments ?? []);
    await this.prisma.audioSegment.deleteMany({ where: { audioId: audio.id } });
    await this.prisma.storyNarration.updateMany({
      where: { audioId: audio.id, status: 'FAILED' },
      data: { audioId: null },
    });
    return true;
  }

  /**
   * Queues the synthesis of a shared audio: the segment jobs, or the
   * segmentation first when the story has none stored. A queue failure
   * fails the audio (and every narration attached to it) and is rethrown,
   * so the caller gives the requesting user's plan unit back.
   */
  private async startSharedGeneration(
    audioId: string,
    story: { id: string; language: string; segmentationVersion: number },
    stored: StorySegment[],
    params: SharedAudioParams,
  ): Promise<void> {
    const voice: SharedJobVoice = { provider: 'GOOGLE', voiceId: params.voiceId };
    try {
      if (stored.length === 0) {
        const job: AudioPrepareJob = {
          audioId,
          storyId: story.id,
          voiceProfileId: null,
          voice,
          shareParams: params,
          globalEmotion: null,
          globalSpeed: null,
          globalVolume: null,
          pronunciationDictId: null,
          language: story.language,
        };
        await this.audioGenerationQueue.add('prepare-audio', job);
        this.logger.log(`Shared audio ${audioId}: story ${story.id} has no segments yet, segmentation queued`);
        return;
      }
      await this.startSegments(audioId, stored, {
        ...this.sharedContext(voice, story.language),
        segmentationVersion: story.segmentationVersion,
      });
    } catch (err: any) {
      await this.markAudioFailed(audioId, `Shared generation could not start: ${err?.message ?? err}`);
      throw err;
    }
  }

  private sharedContext(voice: SharedJobVoice, language: string | null): SegmentContext {
    return {
      voiceProfileId: null,
      voice,
      shared: true,
      provider: 'GOOGLE',
      globalEmotion: null,
      globalSpeed: null,
      globalVolume: null,
      pronunciationDictId: null,
      language,
    };
  }

  /**
   * A narration that attached to an existing shared audio: READY at once
   * when the audio is (socket event only: the HTTP answer already says so,
   * no push), FAILED when it failed before the link landed, else GENERATING
   * (the completion of the running generation reaches it like the others).
   */
  private async settleAttachedNarration(
    narrationId: string,
    audioId: string,
  ): Promise<GenerateAudioResult> {
    const audio = await this.prisma.audio.findUnique({ where: { id: audioId }, select: { status: true } });
    if (audio?.status === 'READY') {
      const done = await this.prisma.storyNarration.updateMany({
        where: { id: narrationId, status: { in: [...OPEN_NARRATION_STATUSES] } },
        data: { status: 'READY', completedAt: new Date() },
      });
      if (done.count === 1) {
        const n = await this.prisma.storyNarration.findUnique({
          where: { id: narrationId },
          select: { userId: true, storyId: true },
        });
        if (n) {
          try {
            this.notificationsGateway.sendToUser(n.userId, 'narration_status', {
              status: 'READY',
              narrationId,
              storyId: n.storyId,
            });
          } catch (err: any) {
            this.logger.warn(`narration_status for ${narrationId} not sent: ${err?.message ?? err}`);
          }
        }
      }
      this.logger.log(`Narration ${narrationId}: shared audio ${audioId} reused (no synthesis)`);
      return { audioId, status: 'READY', shared: true };
    }
    if (audio?.status === 'FAILED') {
      await this.failNarrations(audioId, NARRATION_FAILED_MESSAGE_KEY, null, narrationId);
      return { audioId, status: 'FAILED', shared: true };
    }
    this.logger.log(`Narration ${narrationId}: attached to shared audio ${audioId} (generating)`);
    return { audioId, status: 'GENERATING', shared: true };
  }

  /**
   * Called for the audio of a narration that is discarded or replaced: an
   * owned audio is deleted with its files; a shared audio stays (other
   * narrations may use it, and it is the cache), the reference goes away
   * with the narration row.
   */
  async releaseAudio(audioId: string, userId: string): Promise<void> {
    const audio = await this.prisma.audio.findUnique({
      where: { id: audioId },
      select: { id: true, shared: true },
    });
    if (!audio) return;
    if (audio.shared) {
      this.logger.log(`Shared audio ${audioId} kept (released by user ${userId})`);
      return;
    }
    await this.deleteAudio(audioId, userId);
  }

  /** Access to an audio: its owner, or (shared audio) a user with a narration pointing at it. */
  private async canAccessAudio(
    audio: { id: string; userId: string | null; shared?: boolean | null },
    userId: string,
  ): Promise<boolean> {
    if (!audio.shared) return audio.userId === userId;
    const narration = await this.prisma.storyNarration.findFirst({
      where: { audioId: audio.id, userId },
      select: { id: true },
    });
    return !!narration;
  }

  /**
   * `prepare-audio` job: segment the story (first narration, see
   * StorySegmentationService), then queue the segment jobs. An audio
   * deleted meanwhile (narration replaced or removed) is left alone; any
   * failure marks the audio and its narration FAILED.
   */
  async prepareStoryAudio(job: AudioPrepareJob): Promise<void> {
    const exists = await this.prisma.audio.findUnique({
      where: { id: job.audioId },
      select: { id: true },
    });
    if (!exists) {
      this.logger.warn(`Audio ${job.audioId} was removed before its segmentation; skipping`);
      return;
    }

    try {
      const resolved = await this.storySegmentation.ensureSegments(job.storyId);
      if (job.voice) {
        await this.rekeySharedAudio(job, resolved.version);
        await this.startSegments(job.audioId, resolved.segments, {
          ...this.sharedContext(job.voice, job.language),
          segmentationVersion: resolved.version,
        });
        return;
      }
      const voiceProfile = job.voiceProfileId
        ? await this.prisma.voiceProfile.findUnique({
            where: { id: job.voiceProfileId },
            select: { provider: true },
          })
        : null;
      await this.startSegments(job.audioId, resolved.segments, {
        voiceProfileId: job.voiceProfileId,
        provider: voiceProfile?.provider ?? null,
        globalEmotion: job.globalEmotion,
        globalSpeed: job.globalSpeed,
        globalVolume: job.globalVolume,
        pronunciationDictId: job.pronunciationDictId,
        language: job.language,
        segmentationVersion: resolved.version,
      });
    } catch (err: any) {
      await this.markAudioFailed(job.audioId, `Segmentation failed: ${err?.message ?? err}`);
    }
  }

  /**
   * A shared audio created before the story had segments carries the
   * `lazy-v<n>` key. Once the segments are stored (version known) the key
   * moves to the one later requests compute (`v<n+1>`), so they reuse this
   * audio. Segments that were not stored (free split after a Gemini error)
   * are not reproducible: the key is dropped, the audio serves only the
   * narrations attached now. A key already taken (a request computed it in
   * the moment between the segment write and this update) keeps the lazy key.
   */
  private async rekeySharedAudio(job: AudioPrepareJob, version: number | null): Promise<void> {
    if (!job.shareParams) return;
    try {
      if (version === null) {
        await this.prisma.audio.update({ where: { id: job.audioId }, data: { shareKey: null } });
        this.logger.log(`Shared audio ${job.audioId}: unstored segments, not reusable`);
        return;
      }
      const params = withSegmentationVersion(job.shareParams, version);
      await this.prisma.audio.update({
        where: { id: job.audioId },
        data: { shareKey: sharedAudioKey(params), shareParams: params as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      this.logger.warn(`Shared audio ${job.audioId}: key for version ${version} already taken, kept the lazy key`);
    }
  }

  /**
   * Plans the TTS requests for the segments (grouped or one per segment,
   * runtime setting tts.groupSegments), stores them as AudioSegment rows,
   * sets the totals and queues one job per request.
   */
  private async startSegments(
    audioId: string,
    segments: StorySegment[],
    context: SegmentContext & { segmentationVersion: number | null },
  ): Promise<void> {
    if (segments.length === 0) {
      await this.markAudioFailed(audioId, 'No text to narrate');
      return;
    }

    const provider = String(context.provider ?? '').toUpperCase() === 'CARTESIA' ? 'cartesia' : 'google';
    const units = planSynthesisUnits(segments, {
      provider,
      grouping: this.settings.get('tts.groupSegments'),
      defaults: {
        emotion: context.globalEmotion,
        speed: context.globalSpeed,
        volume: context.globalVolume,
      },
    });
    this.logger.log(`Audio ${audioId}: ${segments.length} segments in ${units.length} ${provider} requests`);

    const rows = await Promise.all(
      units.map((unit, index) =>
        this.prisma.audioSegment.create({
          data: {
            audioId,
            index,
            content: unit.text,
            status: 'PENDING',
            emotion: unit.emotion ?? null,
            speed: unit.speed ?? null,
            volume: unit.volume ?? null,
          },
        }),
      ),
    );

    // Totals before any job can finish (completion compares against them).
    await this.prisma.audio.update({
      where: { id: audioId },
      data: {
        totalSegments: units.length,
        segmentationVersion: context.segmentationVersion,
        status: 'GENERATING',
      },
    });

    for (const [index, row] of rows.entries()) {
      const unit = units[index];
      const job: AudioSegmentJob = {
        audioId,
        segmentId: row.id,
        segmentIndex: row.index,
        content: unit.text,
        voiceProfileId: context.voiceProfileId,
        ...(context.voice ? { voice: context.voice, shared: true } : {}),
        emotion: unit.emotion ?? undefined,
        speed: unit.speed ?? undefined,
        volume: unit.volume ?? undefined,
        pronunciationDictId: context.pronunciationDictId ?? undefined,
        language: context.language ?? undefined,
        parts: unit.parts,
      };
      await this.audioGenerationQueue.add('generate-segment', job);
    }

    this.logger.log(`Audio generation queued: ${audioId} (${units.length} requests)`);
  }

  /**
   * Public preview helper for the admin segment editor: the free
   * deterministic split (the fallback of the lazy segmentation), exposed
   * without persisting anything.
   */
  splitTextIntoSegments(content: string): string[] {
    return splitStoryForTts(content).map((s) => s.text);
  }

  /**
   * Get audio metadata by ID
   */
  async getAudioById(audioId: string): Promise<AudioMetadata> {
    const audio = await this.prisma.audio.findUnique({
      where: { id: audioId },
    });

    if (!audio) {
      throw new NotFoundException('Audio not found');
    }

    const progress =
      audio.totalSegments > 0
        ? Math.round((audio.readySegments / audio.totalSegments) * 100)
        : 0;

    return {
      id: audio.id,
      status: audio.status as AudioStatus,
      title: audio.title,
      duration: audio.duration,
      progress,
      audioUrl: audio.audioUrl,
      createdAt: audio.createdAt,
      completedAt: audio.completedAt,
    };
  }

  /**
   * User-facing metadata lookup (GET /audio/:id). Same payload as
   * getAudioById but only for the owner; admin paths use getAudioById.
   */
  async getAudioByIdForUser(audioId: string, userId: string): Promise<AudioMetadata> {
    const owner = await this.prisma.audio.findUnique({
      where: { id: audioId },
      select: { id: true, userId: true, shared: true },
    });

    if (!owner) {
      throw new NotFoundException('errors.audio.notFound');
    }

    if (!(await this.canAccessAudio(owner, userId))) {
      throw new ForbiddenException('errors.audio.accessDenied');
    }

    return this.getAudioById(audioId);
  }

  /**
   * Get presigned stream URL for audio playback
   */
  async getStreamUrl(audioId: string, userId: string): Promise<string> {
    const audio = await this.prisma.audio.findUnique({
      where: { id: audioId },
    });

    if (!audio) {
      throw new NotFoundException('errors.audio.notFound');
    }

    // Owner, or (shared audio) a narration of this user points at it.
    if (!(await this.canAccessAudio(audio, userId))) {
      throw new ForbiddenException('errors.audio.accessDenied');
    }

    if (audio.status !== 'READY' || !audio.audioUrl) {
      throw new NotFoundException('errors.audio.notReady');
    }

    // Extract S3 key and generate presigned URL
    const s3Key = this.extractS3KeyFromUrl(audio.audioUrl);
    return this.storageService.generatePresignedUrl(s3Key, 3600); // 1 hour
  }

  /**
   * Delete audio - user can only delete their own
   */
  async deleteAudio(audioId: string, userId: string): Promise<{ message: string }> {
    const audio = await this.prisma.audio.findUnique({
      where: { id: audioId },
      include: { segments: true },
    });

    if (!audio) {
      throw new NotFoundException('errors.audio.notFound');
    }

    // Verify ownership
    if (audio.userId !== userId) {
      throw new ForbiddenException('errors.audio.deleteDenied');
    }

    // Delete storage files
    await this.deleteAudioFiles(audio.audioUrl, audio.segments);

    // Delete database record (cascades to segments)
    await this.prisma.audio.delete({
      where: { id: audioId },
    });

    this.logger.log(`Audio deleted by user: ${audioId}`);

    return { message: 'Audio deleted successfully' };
  }

  /**
   * Admin delete - can delete any audio
   */
  async adminDeleteAudio(audioId: string): Promise<{ message: string }> {
    const audio = await this.prisma.audio.findUnique({
      where: { id: audioId },
      include: { segments: true },
    });

    if (!audio) {
      throw new NotFoundException('Audio not found');
    }

    // Delete storage files
    await this.deleteAudioFiles(audio.audioUrl, audio.segments);

    // A narration pointing at this audio must not stay READY with no audio
    // (the FK is SetNull). Flip it to FAILED with a user-facing message so
    // the app offers a retry; POST /narrations replaces FAILED rows silently.
    // The user did not cause the removal: the regeneration is free.
    const affected = await this.prisma.storyNarration.findMany({
      where: { audioId },
      select: { id: true, userId: true, storyId: true },
    });
    // The message is stored and shown later: in each owner's UI language.
    const languages = await this.ownerLanguages(affected ?? []);
    const removedMessage = (userId: string) =>
      serverText(NARRATION_AUDIO_REMOVED_MESSAGE_KEY, languages.get(userId) ?? 'tr');
    let flippedCount = 0;
    for (const lang of new Set([...languages.values()])) {
      const ids = (affected ?? [])
        .filter((n) => (languages.get(n.userId) ?? 'tr') === lang)
        .map((n) => n.id);
      const result = await this.prisma.storyNarration.updateMany({
        where: { audioId, id: { in: ids } },
        data: {
          status: 'FAILED',
          errorMessage: serverText(NARRATION_AUDIO_REMOVED_MESSAGE_KEY, lang),
          completedAt: null,
          freeRegeneration: true,
        },
      });
      flippedCount += result?.count ?? 0;
    }
    const flipped = { count: flippedCount };
    // Socket only (no push, no notification row): an open library refreshes.
    for (const n of affected ?? []) {
      try {
        this.notificationsGateway.sendToUser(n.userId, 'narration_status', {
          status: 'FAILED',
          narrationId: n.id,
          storyId: n.storyId,
          errorMessage: removedMessage(n.userId),
        });
      } catch (err: any) {
        this.logger.warn(`narration_status for ${n.id} not sent: ${err?.message ?? err}`);
      }
    }

    // Delete database record (cascades to segments)
    await this.prisma.audio.delete({
      where: { id: audioId },
    });

    this.logger.log(
      `Audio deleted by admin: ${audioId} (narrations marked FAILED: ${flipped.count})`,
    );

    return { message: 'Audio deleted successfully by admin' };
  }

  /**
   * Get user's audio library
   */
  async getUserAudioLibrary(userId: string, queryDto: AudioLibraryQueryDto) {
    const { page = 1, limit = 20, status } = queryDto;
    const offset = PaginationHelper.calculateOffset(page, limit);

    const where: any = { userId };
    if (status) {
      where.status = status;
    }

    const [audios, total] = await Promise.all([
      this.prisma.audio.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          voiceProfile: {
            select: { id: true, name: true, profileIcon: true },
          },
        },
      }),
      this.prisma.audio.count({ where }),
    ]);

    const items = audios.map((audio) => ({
      id: audio.id,
      title: audio.title,
      status: audio.status,
      duration: audio.duration,
      progress:
        audio.totalSegments > 0
          ? Math.round((audio.readySegments / audio.totalSegments) * 100)
          : 0,
      voiceProfile: audio.voiceProfile,
      createdAt: audio.createdAt,
      completedAt: audio.completedAt,
    }));

    return PaginationHelper.createPaginatedResponse(items, total, page, limit);
  }

  /**
   * Admin: List all audio files (paginated).
   *
   * Item: { id, title, status, duration, progress, createdAt, userId,
   *         user: {id,email}|null, voiceProfile: {id,name}|null,
   *         url: presigned string|null (READY only) }
   */
  async adminListAudio(queryDto: AudioLibraryQueryDto) {
    const { page = 1, limit = 20, status } = queryDto;
    const offset = PaginationHelper.calculateOffset(page, limit);

    const where: any = {};
    if (status) {
      where.status = status;
    }

    const [audios, total] = await Promise.all([
      this.prisma.audio.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          title: true,
          status: true,
          duration: true,
          totalSegments: true,
          readySegments: true,
          audioUrl: true,
          createdAt: true,
          shared: true,
          voiceProfile: { select: { id: true, name: true } },
          _count: { select: { narrations: true } },
        },
      }),
      this.prisma.audio.count({ where }),
    ]);

    // Audio has no Prisma relation to User; batch-resolve emails. A shared
    // audio has no user.
    const userIds = [...new Set(audios.map((a) => a.userId).filter((id): id is string => !!id))];
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true },
        })
      : [];
    const usersById = new Map(users.map((u) => [u.id, u]));

    const items = await Promise.all(
      audios.map(async (audio) => ({
        id: audio.id,
        title: audio.title,
        status: audio.status,
        duration: audio.duration,
        progress:
          audio.totalSegments > 0
            ? Math.round((audio.readySegments / audio.totalSegments) * 100)
            : 0,
        createdAt: audio.createdAt,
        userId: audio.userId,
        user: audio.userId ? usersById.get(audio.userId) ?? null : null,
        voiceProfile: audio.voiceProfile ?? null,
        // Shared ready-made voice audio: one file, `narrationCount` narrations use it.
        shared: audio.shared ?? false,
        narrationCount: audio._count?.narrations ?? 0,
        url:
          audio.status === 'READY' && audio.audioUrl
            ? await this.storageService.getReadUrl(audio.audioUrl)
            : null,
      })),
    );

    return PaginationHelper.createPaginatedResponse(items, total, page, limit);
  }

  // ==========================================================================
  // INTERNAL METHODS (called by processor)
  // ==========================================================================

  /**
   * Called when a segment finishes generating
   */
  async onSegmentComplete(
    audioId: string,
    segmentIndex: number,
    audioUrl: string,
    duration: number,
  ): Promise<void> {
    this.logger.log(`Segment ${segmentIndex} complete for audio ${audioId}`);

    // Update segment record
    await this.prisma.audioSegment.updateMany({
      where: { audioId, index: segmentIndex },
      data: {
        status: 'READY',
        audioUrl,
        duration,
      },
    });

    // Update audio progress
    const audio = await this.prisma.audio.update({
      where: { id: audioId },
      data: {
        readySegments: { increment: 1 },
      },
    });

    // Check if all segments are ready
    if (audio.readySegments >= audio.totalSegments) {
      this.logger.log(`All segments ready for audio ${audioId}, starting merge`);
      await this.finalizeAudio(audioId);
    }
  }

  /**
   * Called when a segment fails
   */
  async onSegmentFailed(audioId: string, segmentIndex: number, error: string): Promise<void> {
    this.logger.error(`Segment ${segmentIndex} failed for audio ${audioId}: ${error}`);

    // Update segment record
    await this.prisma.audioSegment.updateMany({
      where: { audioId, index: segmentIndex },
      data: { status: 'FAILED' },
    });

    // Mark audio + linked narration as FAILED and notify the user
    await this.markAudioFailed(
      audioId,
      `Segment ${segmentIndex} failed: ${error}`,
    );
  }

  /**
   * Central failure path: marks Audio.status=FAILED, propagates the failure to
   * any linked StoryNarration (status + errorMessage), and emits a WebSocket
   * `narration_status` FAILED event + push notification so mobile clients stop
   * polling. Safe to call multiple times — it no-ops cleanly if the records
   * are already in the desired state.
   */
  private async markAudioFailed(
    audioId: string,
    errorMessage: string,
  ): Promise<void> {
    this.logger.error(`Marking audio ${audioId} as FAILED: ${errorMessage}`);

    const audio = await this.prisma.audio.findUnique({
      where: { id: audioId },
      select: { id: true, userId: true, title: true, status: true },
    });

    if (!audio) {
      // The audio was deleted while segments were still in flight (e.g. the
      // narration was replaced or removed). Nothing left to sync.
      this.logger.warn(`Audio ${audioId} no longer exists; skipping FAILED sync`);
      return;
    }

    // Raw pipeline error stays on the Audio row (admin view) and in logs.
    await this.prisma.audio.update({
      where: { id: audioId },
      data: {
        status: 'FAILED',
        errorMessage,
      },
    });

    // Linked narrations (one for owned audio, every attached one for a
    // shared audio) carry the user-facing message; never the raw error.
    await this.failNarrations(audioId, NARRATION_FAILED_MESSAGE_KEY, audio.title);
  }

  /**
   * Narrations of the audio that are not FAILED yet turn FAILED and get the
   * narration_status FAILED socket event + push. Each flip is conditional,
   * so a narration is told once even when several segments fail.
   */
  private async failNarrations(
    audioId: string,
    messageKey: string,
    title: string | null,
    onlyNarrationId?: string,
  ): Promise<void> {
    const narrations =
      (await this.prisma.storyNarration.findMany({
        where: { audioId, status: { not: 'FAILED' }, ...(onlyNarrationId ? { id: onlyNarrationId } : {}) },
        select: { id: true, userId: true, storyId: true, story: { select: { title: true } } },
      })) ?? [];
    // The message is stored on the row and shown later: written in the
    // owner's UI language.
    const languages = await this.ownerLanguages(narrations);

    for (const narration of narrations) {
      const lang = languages.get(narration.userId) ?? 'tr';
      const message = serverText(messageKey, lang);
      const flipped = await this.prisma.storyNarration.updateMany({
        where: { id: narration.id, status: { not: 'FAILED' } },
        data: { status: 'FAILED', errorMessage: message },
      });
      if (flipped.count !== 1) continue;

      this.logger.log(`Narration ${narration.id} synced to FAILED (audio ${audioId})`);

      // WebSocket narration_status FAILED + persisted notification (best-effort)
      try {
        await this.notificationsService.notifyNarrationFailed(
          narration.userId,
          narration.story?.title || title || serverText(STORY_FALLBACK_TITLE_KEY, lang),
          narration.id,
          narration.storyId,
          message,
        );
      } catch (notifyErr: any) {
        this.logger.warn(
          `Failed to send narration FAILED notification: ${notifyErr?.message ?? notifyErr}`,
        );
      }
    }
  }
  /** Stored UI language of each narration owner (Turkish when none). */
  private ownerLanguages(rows: Array<{ userId: string }>): Promise<Map<string, UiLanguage>> {
    return resolveUserUiLanguages(this.prisma, rows.map((row) => row.userId));
  }

  /**
   * Merge all segments into final audio file
   */
  async finalizeAudio(audioId: string): Promise<void> {
    this.logger.log(`Finalizing audio: ${audioId}`);

    const audio = await this.prisma.audio.findUnique({
      where: { id: audioId },
      include: {
        segments: {
          orderBy: { index: 'asc' },
        },
      },
    });

    if (!audio) {
      throw new Error(`Audio ${audioId} not found`);
    }

    const readySegments = audio.segments.filter((s) => s.status === 'READY' && s.audioUrl);

    if (readySegments.length === 0) {
      await this.markAudioFailed(audioId, 'No ready segments to merge');
      return;
    }

    if (readySegments.length === 1) {
      // Single segment - no merge needed
      const segment = readySegments[0];
      await this.prisma.audio.update({
        where: { id: audioId },
        data: {
          status: 'READY',
          audioUrl: segment.audioUrl,
          duration: segment.duration,
          completedAt: new Date(),
        },
      });

      // Sync linked StoryNarration status if exists
      await this.syncNarrationStatus(audioId, audio.title);

      this.logger.log(`Audio finalized (single segment): ${audioId}`);
      return;
    }

    // Multiple segments - need to merge. Any merge/upload failure must propagate
    // to BOTH Audio.status=FAILED and the linked StoryNarration.status=FAILED,
    // otherwise mobile clients poll forever.
    try {
      const mergedUrl = await this.mergeAudioFiles(
        audioStoragePrefix(audio),
        audioId,
        readySegments.map((s) => ({ audioUrl: s.audioUrl!, chunkIndex: s.index })),
      );

      // Calculate total duration
      const totalDuration = readySegments.reduce((sum, s) => sum + (s.duration || 0), 0);

      // Update audio record
      await this.prisma.audio.update({
        where: { id: audioId },
        data: {
          status: 'READY',
          audioUrl: mergedUrl,
          duration: totalDuration,
          completedAt: new Date(),
        },
      });

      // Optionally clean up segment files
      for (const segment of readySegments) {
        if (segment.audioUrl) {
          try {
            const key = this.extractS3KeyFromUrl(segment.audioUrl);
            await this.storageService.deleteFile(key);
          } catch (e) {
            this.logger.warn(`Failed to delete segment file: ${segment.audioUrl}`);
          }
        }
      }

      // Sync linked StoryNarration status if exists
      await this.syncNarrationStatus(audioId, audio.title);

      this.logger.log(`Audio finalized: ${audioId}`);
    } catch (err: any) {
      const errorMessage = `Audio merge failed: ${err?.message ?? 'unknown error'}`;
      this.logger.error(errorMessage, err?.stack);
      await this.markAudioFailed(audioId, errorMessage);
      // Do NOT rethrow: the caller (onSegmentComplete → processor) would
      // otherwise treat this as a segment failure and double-count the error.
    }
  }

  /**
   * Linked narrations that are not READY yet turn READY and get the
   * narration_status READY socket event + push (every user of a shared audio).
   */
  private async syncNarrationStatus(audioId: string, title: string | null): Promise<void> {
    const narrations =
      (await this.prisma.storyNarration.findMany({
        where: { audioId, status: { not: 'READY' } },
        select: { id: true, userId: true, storyId: true, story: { select: { title: true } } },
      })) ?? [];

    if (narrations.length === 0) {
      // Audio not linked to any narration (standalone audio)
      this.logger.log(`Audio ${audioId} has no narration to sync`);
      return;
    }

    for (const narration of narrations) {
      const done = await this.prisma.storyNarration.updateMany({
        where: { id: narration.id, status: { not: 'READY' } },
        data: { status: 'READY', completedAt: new Date() },
      });
      if (done.count !== 1) continue;

      this.logger.log(`Narration ${narration.id} synced to READY`);
      await this.notificationsService.notifyNarrationReady(
        narration.userId,
        // Empty: the notification uses "Masal" / "Story" in the user's language.
        narration.story?.title || title || '',
        narration.id,
        narration.storyId,
      );
    }
  }
  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  /**
   * Merge multiple audio chunks into a single file.
   *
   * Defensive guarantees:
   *   - Temp directory is always cleaned up (success or failure) via `finally`.
   *   - Hard 5-minute timeout on the ffmpeg process; if it hangs, the process
   *     is killed and the promise rejects with a clear error.
   *   - Missing or undownloadable segments reject early with a named error.
   *   - The ffmpeg command line is logged at info level on start.
   *   - Any error (download / ffmpeg / upload) propagates upward so the
   *     caller can mark the Audio + Narration as FAILED.
   */
  private async mergeAudioFiles(
    storagePrefix: string,
    audioId: string,
    chunks: { audioUrl: string; chunkIndex: number }[],
  ): Promise<string> {
    this.logger.log(`Merging ${chunks.length} audio files for ${audioId}`);

    if (chunks.length === 0) {
      throw new Error('No chunks to merge');
    }

    // Sort chunks by index
    const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

    // Create temp directory
    const tempDir = path.join(os.tmpdir(), `sesly-merge-${audioId}-${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    try {
      // Download all files
      const filePaths: string[] = [];

      for (const chunk of sortedChunks) {
        if (!chunk.audioUrl) {
          throw new Error(
            `Segment ${chunk.chunkIndex} is missing an audioUrl; cannot merge`,
          );
        }

        const fileName = `chunk-${chunk.chunkIndex}.mp3`;
        const filePath = path.join(tempDir, fileName);

        // Download the segment. Our own objects are read through the
        // authenticated storage client: the bucket is not public, so the
        // plain https URL answers 403. Only a URL outside our bucket goes
        // through HTTP.
        let data: Buffer;
        try {
          const key = extractStorageKey(chunk.audioUrl);
          if (key) {
            data = await this.storageService.downloadFile(key);
          } else {
            const response = await axios({
              url: chunk.audioUrl,
              method: 'GET',
              responseType: 'arraybuffer',
              timeout: 60 * 1000, // 60s per-segment download timeout
            });
            data = Buffer.from(response.data);
          }
        } catch (downloadErr: any) {
          throw new Error(
            `Failed to download segment ${chunk.chunkIndex} ` +
            `(${chunk.audioUrl}): ${downloadErr?.message ?? downloadErr}`,
          );
        }

        await fs.promises.writeFile(filePath, data);
        filePaths.push(filePath);
      }

      if (filePaths.length === 0) {
        throw new Error('No valid audio files found to merge');
      }

      // Merge files using ffmpeg
      const outputFileName = `merged-${audioId}.mp3`;
      const outputPath = path.join(tempDir, outputFileName);

      // Concat demuxer: one list file, streams copied as they are. The
      // concat filter behind fluent-ffmpeg's mergeToFile probes every input
      // with ffprobe, which the production image (ffmpeg-static) lacks, and
      // it would re-encode. Segments of one narration come from one provider
      // with the same MP3 parameters, so a stream copy is lossless.
      const listPath = path.join(tempDir, 'concat.txt');
      const listBody = filePaths
        .map((file) => `file '${file.replace(/\\/g, '/').replace(/'/g, `'\\''`)}'`)
        .join('\n');
      await fs.promises.writeFile(listPath, `${listBody}\n`);

      await new Promise<void>((resolve, reject) => {
        const command = ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions(['-c', 'copy'])
          .output(outputPath);

        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutHandle);
          fn();
        };

        // Hard timeout: kill ffmpeg and reject if it hangs
        const timeoutHandle = setTimeout(() => {
          this.logger.error(
            `FFmpeg merge for audio ${audioId} exceeded ${FFMPEG_MERGE_TIMEOUT_MS}ms, killing`,
          );
          try {
            command.kill('SIGKILL');
          } catch (killErr: any) {
            this.logger.warn(
              `Failed to kill ffmpeg process: ${killErr?.message ?? killErr}`,
            );
          }
          settle(() =>
            reject(
              new Error(
                `FFmpeg merge timed out after ${FFMPEG_MERGE_TIMEOUT_MS}ms for audio ${audioId}`,
              ),
            ),
          );
        }, FFMPEG_MERGE_TIMEOUT_MS);

        command
          .on('start', (cmdLine: string) => {
            this.logger.log(`FFmpeg merge started for ${audioId}: ${cmdLine}`);
          })
          .on('error', (err) => {
            this.logger.error(
              `FFmpeg error for audio ${audioId}: ${err.message}`,
            );
            settle(() => reject(err));
          })
          .on('end', () => {
            this.logger.log(`FFmpeg merge finished for ${audioId}`);
            settle(() => resolve());
          })
          .run();
      });

      // Upload merged file to storage
      const fileBuffer = await fs.promises.readFile(outputPath);
      const s3Key = `${storagePrefix}/full.mp3`;

      let uploadedUrl: string;
      try {
        uploadedUrl = await this.storageService.uploadFile(
          fileBuffer,
          s3Key,
          'audio/mpeg',
        );
      } catch (uploadErr: any) {
        throw new Error(
          `Failed to upload merged audio for ${audioId}: ${uploadErr?.message ?? uploadErr}`,
        );
      }

      this.logger.log(`Merged audio uploaded: ${uploadedUrl}`);

      return uploadedUrl;
    } finally {
      // Cleanup temp dir in both success and failure paths
      try {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
        this.logger.warn(`Failed to clean up temp dir ${tempDir}`);
      }
    }
  }

  private extractS3KeyFromUrl(url: string): string {
    // URL format: https://storage.googleapis.com/BUCKET_NAME/PATH (or a bare key)
    const key = extractStorageKey(url);
    if (!key) {
      throw new Error(`Not a storage URL: ${url}`);
    }
    return key;
  }

  private async deleteAudioFiles(
    mainAudioUrl: string | null,
    segments: { audioUrl: string | null }[],
  ): Promise<void> {
    // Delete main audio file
    if (mainAudioUrl) {
      try {
        const key = this.extractS3KeyFromUrl(mainAudioUrl);
        await this.storageService.deleteFile(key);
      } catch (e) {
        this.logger.warn(`Failed to delete main audio file: ${mainAudioUrl}`);
      }
    }

    // Delete segment files
    for (const segment of segments) {
      if (segment.audioUrl) {
        try {
          const key = this.extractS3KeyFromUrl(segment.audioUrl);
          await this.storageService.deleteFile(key);
        } catch (e) {
          this.logger.warn(`Failed to delete segment file: ${segment.audioUrl}`);
        }
      }
    }
  }
}
