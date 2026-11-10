import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  transcodeToWav,
  cleanupTempDir,
} from '../../voice-profiles/utils/audio-preprocessor';
import { StorageService } from '../../storage/storage.service';
import { CartesiaTTSService } from '../../tts-providers/cartesia/cartesia-tts.service';
import { AudioService } from '../../audio/audio.service';
import { TTSProvider, VoiceProfileKind } from '../../../common/enums/prisma.enums';

/**
 * Stable system user the voice-clone tester attributes its temporary
 * VoiceProfile + Audio rows to. AudioService.generateAudio() requires a real
 * userId because the production code path enforces ownership; we lazy-create
 * this user on first run so the sandbox doesn't depend on any human admin
 * having a `users` row.
 */
const TEST_USER_EMAIL = 'voice-test@sesly.local';

export interface VoiceCloneTestSegmentResult {
  index: number;
  content: string;
  emotion: string | null;
  speed: number | null;
  volume: number | null;
  status: string;
}

export interface VoiceCloneTestResult {
  jobId: string;
  storyId: string;
  storyTitle: string;
  rawUrl: string;
  processedUrl: string;
  /** Final merged narration. Null only if generation timed out. */
  finalAudioUrl: string | null;
  audioId: string;
  audioStatus: string;
  segmentCount: number;
  segments: VoiceCloneTestSegmentResult[];
  durationMs: {
    preprocess: number;
    cloneCreate: number;
    narration: number;
    total: number;
  };
}

/**
 * Admin-only voice cloning sandbox.
 *
 * Takes a raw audio sample + an existing Story id, runs the FULL production
 * narration pipeline against the cloned voice, and hands back the artifacts
 * so an admin can A/B compare in the browser:
 *
 *   1. raw          exactly what was uploaded
 *   2. processed    what Cartesia receives after our ffmpeg pipeline
 *   3. final audio  the merged story narration with per-segment emotion /
 *                   speed / volume, exactly as a real user would hear it
 *
 * Why a full story instead of a single test sentence: clone quality on a
 * one-line "hello world" is misleading because production renders 10-20
 * segments with varying emotion presets — a clone that sounds great on a
 * neutral sentence can fall apart on whispered or scared variants. Testing
 * end-to-end against an actual story is the only honest measure.
 *
 * Cleanup: the temporary VoiceProfile + the Cartesia voice id are both
 * deleted as soon as the merged audio is ready, so admin tests don't leak
 * upstream voice-quota or DB rows. The Audio + AudioSegment rows + GCS
 * artifacts are kept so the admin can replay later.
 */
@Injectable()
export class VoiceCloneTesterService {
  private readonly logger = new Logger(VoiceCloneTesterService.name);
  // Presigned URLs valid 7 days — same as the audition-URL convention used
  // in the production voice-training pipeline.
  private static readonly URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
  private static readonly NARRATION_TIMEOUT_MS = 5 * 60 * 1000;
  private static readonly NARRATION_POLL_MS = 1500;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly cartesia: CartesiaTTSService,
    private readonly audioService: AudioService,
  ) {}

  async runStoryTest(
    file: Express.Multer.File,
    storyId: string,
    options?: { skipPreprocessing?: boolean },
  ): Promise<VoiceCloneTestResult> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(
        'Audio file is required and must not be empty.',
      );
    }
    if (!storyId) {
      throw new BadRequestException('Story id is required.');
    }

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });
    if (!story) {
      throw new NotFoundException(`Story not found: ${storyId}`);
    }

    const skipPreprocessing = options?.skipPreprocessing === true;
    const jobId = randomUUID();
    const startedAt = Date.now();

    const rawExt =
      (file.originalname.split('.').pop() ?? 'bin').toLowerCase();
    const rawKey = `voice-clone-tests/${jobId}/raw.${rawExt}`;
    const processedKey = `voice-clone-tests/${jobId}/processed.wav`;

    this.logger.log(
      `[voice-clone-test ${jobId}] Story="${story.title}" file=${file.originalname} (${file.buffer.length} bytes${skipPreprocessing ? ', SKIP preprocessing' : ''})`,
    );

    // 1. Park the raw clip first so a preprocessing failure still leaves
    //    something downloadable.
    await this.storage.uploadFile(
      file.buffer,
      rawKey,
      file.mimetype || 'application/octet-stream',
    );

    // 2. Always transcode to WAV: Cartesia rejects m4a (clone formats are
    //    flac/mp3/ogg/wav/webm). "skipPreprocessing" now means "no trimming":
    //    no duration cap, just the container / sample-rate conversion, so the
    //    admin can still isolate whether the 60 s cap matters.
    const preprocessStart = Date.now();
    const transcoded = await transcodeToWav(
      file.buffer,
      this.logger,
      jobId,
      skipPreprocessing ? { maxDurationSec: null } : {},
    );
    const preprocessMs = Date.now() - preprocessStart;
    try {
      await this.storage.uploadFile(transcoded.buffer, processedKey, 'audio/wav');
    } finally {
      await cleanupTempDir(transcoded.tempDir, this.logger);
    }
    // Hand Cartesia the bytes directly (no presigned URL round trip).
    const cartesiaSource = {
      buffer: transcoded.buffer,
      mimeType: 'audio/wav',
      filename: 'reference.wav',
    };

    const cloneStart = Date.now();
    const cartesiaVoiceId = await this.cartesia.createVoiceClone(
      cartesiaSource,
      `admin-test-${jobId.slice(0, 8)}`,
    );
    const cloneMs = Date.now() - cloneStart;
    this.logger.log(
      `[voice-clone-test ${jobId}] Cartesia voice id: ${cartesiaVoiceId}`,
    );

    // 4. Make a temporary VoiceProfile so the production audio pipeline
    //    accepts it. Attribution to a stable system test user keeps the
    //    DB tidy across runs.
    const testUser = await this.ensureTestUser();
    const voiceProfile = await this.prisma.voiceProfile.create({
      data: {
        userId: testUser.id,
        name: `voice-test ${jobId.slice(0, 8)}`,
        provider: TTSProvider.CARTESIA,
        kind: VoiceProfileKind.CLONE,
        voiceId: cartesiaVoiceId,
        voiceCloningKey: cartesiaVoiceId,
        language: 'tr-TR',
        status: 'READY',
      },
    });

    // 5. Kick off the real narration pipeline — Bull queue, segment fan-out,
    //    per-segment emotion/speed/volume, ffmpeg merge, the works.
    let audioId: string | null = null;
    const narrationStart = Date.now();
    try {
      const result = await this.audioService.generateAudio({
        text: story.content,
        voiceProfileId: voiceProfile.id,
        userId: testUser.id,
        title: `voice-test ${story.title}`,
        storyId: story.id,
      });
      audioId = result.audioId;

      const finalAudio = await this.waitForAudio(audioId);
      const narrationMs = Date.now() - narrationStart;
      const totalMs = Date.now() - startedAt;

      const segments = await this.prisma.audioSegment.findMany({
        where: { audioId },
        orderBy: { index: 'asc' },
      });

      const finalAudioUrl =
        finalAudio.status === 'READY' && finalAudio.audioUrl
          ? await this.storage.generatePresignedUrl(
              this.extractStorageKey(finalAudio.audioUrl),
              VoiceCloneTesterService.URL_EXPIRY_SECONDS,
            )
          : null;

      const [rawUrl, processedUrl] = await Promise.all([
        this.storage.generatePresignedUrl(
          rawKey,
          VoiceCloneTesterService.URL_EXPIRY_SECONDS,
        ),
        this.storage.generatePresignedUrl(
          processedKey,
          VoiceCloneTesterService.URL_EXPIRY_SECONDS,
        ),
      ]);

      this.logger.log(
        `[voice-clone-test ${jobId}] Done in ${totalMs}ms (preprocess=${preprocessMs}ms clone=${cloneMs}ms narration=${narrationMs}ms, ${segments.length} segments, status=${finalAudio.status})`,
      );

      return {
        jobId,
        storyId: story.id,
        storyTitle: story.title,
        rawUrl,
        processedUrl,
        finalAudioUrl,
        audioId,
        audioStatus: finalAudio.status,
        segmentCount: segments.length,
        segments: segments.map((s) => ({
          index: s.index,
          content: s.content,
          emotion: s.emotion,
          speed: s.speed,
          volume: s.volume,
          status: s.status,
        })),
        durationMs: {
          preprocess: preprocessMs,
          cloneCreate: cloneMs,
          narration: narrationMs,
          total: totalMs,
        },
      };
    } finally {
      // 6. Drop the temp VoiceProfile and the upstream voice id whatever
      //    happened above — even on timeout we don't want them lingering.
      await this.bestEffortDeleteVoiceProfile(voiceProfile.id);
      await this.bestEffortDeleteClone(cartesiaVoiceId);
    }
  }

  /**
   * Lazily create the system test user. Idempotent — re-running the test
   * a hundred times still leaves exactly one row.
   */
  private async ensureTestUser(): Promise<{ id: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { email: TEST_USER_EMAIL },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.user.create({
      data: {
        email: TEST_USER_EMAIL,
        firstName: 'Voice',
        lastName: 'Test',
        emailVerified: true,
      },
      select: { id: true },
    });
  }

  /**
   * Poll Audio.status until READY/FAILED or the narration timeout fires.
   * Returns whatever state we ended on — caller decides how to surface it.
   */
  private async waitForAudio(audioId: string): Promise<{
    status: string;
    audioUrl: string | null;
  }> {
    const deadline =
      Date.now() + VoiceCloneTesterService.NARRATION_TIMEOUT_MS;
    let lastStatus = '';
    while (Date.now() < deadline) {
      const audio = await this.prisma.audio.findUnique({
        where: { id: audioId },
        select: { status: true, audioUrl: true },
      });
      if (!audio) {
        throw new Error(`Audio row vanished during polling: ${audioId}`);
      }
      if (audio.status !== lastStatus) {
        this.logger.log(
          `[voice-clone-test] audio ${audioId} → ${audio.status}`,
        );
        lastStatus = audio.status;
      }
      if (audio.status === 'READY' || audio.status === 'FAILED') {
        return { status: audio.status, audioUrl: audio.audioUrl };
      }
      await new Promise((r) =>
        setTimeout(r, VoiceCloneTesterService.NARRATION_POLL_MS),
      );
    }
    // Timed out — return the last known state so the admin gets segment
    // breadcrumbs even on a stalled run.
    const audio = await this.prisma.audio.findUnique({
      where: { id: audioId },
      select: { status: true, audioUrl: true },
    });
    return {
      status: audio?.status ?? 'UNKNOWN',
      audioUrl: audio?.audioUrl ?? null,
    };
  }

  /**
   * Audio.audioUrl can be either a full GCS URL or a bare key depending on
   * which code path produced it; presign expects a key.
   */
  private extractStorageKey(audioUrl: string): string {
    if (audioUrl.startsWith('http')) {
      try {
        const url = new URL(audioUrl);
        // Strip the leading slash and bucket prefix if present.
        return url.pathname.replace(/^\/+/, '').replace(/^[^/]+\//, '');
      } catch {
        return audioUrl;
      }
    }
    return audioUrl;
  }

  private async bestEffortDeleteVoiceProfile(profileId: string): Promise<void> {
    try {
      await this.prisma.voiceProfile.delete({ where: { id: profileId } });
    } catch (err: any) {
      this.logger.warn(
        `Failed to delete temp voice profile ${profileId}: ${err?.message ?? err}`,
      );
    }
  }

  private async bestEffortDeleteClone(voiceId: string): Promise<void> {
    try {
      await this.cartesia.deleteVoiceClone(voiceId);
    } catch (err: any) {
      this.logger.warn(
        `Failed to delete test voice clone ${voiceId}: ${err?.message ?? err}`,
      );
    }
  }
}
