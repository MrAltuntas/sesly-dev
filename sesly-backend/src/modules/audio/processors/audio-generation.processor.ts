import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { TTSProviderFactory } from '../../tts-providers/tts-provider.factory';
import { AudioService } from '../audio.service';
import { AudioPrepareJob, AudioSegmentJob } from '../interfaces/audio-generation-job.interface';
import { forwardRef, Inject } from '@nestjs/common';
import { resolveSynthesisVoiceId } from '../../../common/utils/voice-language';
import { audioStoragePrefix } from '../shared-audio-key';

@Processor('audio-generation')
export class AudioGenerationProcessor {
  private readonly logger = new Logger(AudioGenerationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private ttsProviderFactory: TTSProviderFactory,
    @Inject(forwardRef(() => AudioService)) private audioService: AudioService,
  ) { }

  /** First narration of a story without segments: segment, then queue the segments. */
  @Process('prepare-audio')
  async handlePrepare(job: Job<AudioPrepareJob>) {
    this.logger.log(`Preparing audio ${job.data.audioId} (story ${job.data.storyId})`);
    await this.audioService.prepareStoryAudio(job.data);
  }

  @Process('generate-segment')
  async handleSegmentGeneration(job: Job<AudioSegmentJob>) {
    const {
      audioId,
      segmentId,
      segmentIndex,
      content,
      emotion,
      speed,
      volume,
      pronunciationDictId,
      language,
      parts,
    } = job.data;

    this.logger.log(`Processing segment ${segmentIndex} for audio ${audioId}`);

    try {
      // Update segment status to GENERATING
      await this.prisma.audioSegment.update({
        where: { id: segmentId },
        data: { status: 'GENERATING' },
      });

      const { provider, voiceId, fallbackLanguage } = await this.resolveVoice(job.data);

      // Per-segment Cartesia generation overrides. Providers that don't
      // understand these (Google, MiniMax) silently drop them.
      const audioBuffer = await provider.textToSpeech(content, voiceId, {
        emotion,
        speed,
        volume,
        pronunciationDictId,
        language: language ?? fallbackLanguage,
        parts,
      });

      // Upload to storage
      const s3Key = `${audioStoragePrefix({ id: audioId, shared: job.data.shared })}/segments/${segmentIndex}.mp3`;
      const audioUrl = await this.storageService.uploadFile(
        audioBuffer,
        s3Key,
        'audio/mpeg',
      );

      // Estimate duration (~150 words per minute, ~2 chars per word)
      const estimatedDuration = Math.ceil((content.length / 2 / 150) * 60);

      this.logger.log(`Segment ${segmentIndex} generated: ${audioUrl}`);

      // Notify service of completion
      await this.audioService.onSegmentComplete(
        audioId,
        segmentIndex,
        audioUrl,
        estimatedDuration,
      );
    } catch (error: any) {
      this.logger.error(
        `Segment ${segmentIndex} generation failed for audio ${audioId}`,
        error.message,
      );

      // Notify service of failure
      await this.audioService.onSegmentFailed(
        audioId,
        segmentIndex,
        error.message,
      );

      throw error;
    }
  }

  /**
   * Provider and voice of a job. A shared audio (ready-made Google voice)
   * carries its resolved voice id; an owned audio reads its voice profile.
   */
  private async resolveVoice(job: AudioSegmentJob) {
    if (job.voice) {
      this.logger.log(`Generating shared audio with GOOGLE provider, voice: ${job.voice.voiceId}`);
      return {
        provider: this.ttsProviderFactory.getProvider('google'),
        voiceId: job.voice.voiceId,
        fallbackLanguage: undefined as string | undefined,
      };
    }

    const voiceProfile = job.voiceProfileId
      ? await this.prisma.voiceProfile.findUnique({ where: { id: job.voiceProfileId } })
      : null;
    if (!voiceProfile) {
      throw new Error('Voice profile not found');
    }

    const provider = this.ttsProviderFactory.getProvider(voiceProfile.provider?.toLowerCase());
    if (!voiceProfile.voiceId) {
      throw new Error('Voice ID not found in profile');
    }

    // A ready-made voice reading a story of another language is swapped
    // for the voice of the same name in the story's locale (a Google voice
    // id is bound to its locale). Clones always keep their own id.
    const voiceId = resolveSynthesisVoiceId(voiceProfile, job.language);
    this.logger.log(
      `Generating audio with ${voiceProfile.provider} provider, voice: ${voiceId}` +
        (voiceId === voiceProfile.voiceId ? '' : ` (profile voice ${voiceProfile.voiceId}, story language ${job.language})`),
    );
    return { provider, voiceId, fallbackLanguage: voiceProfile.language as string | undefined };
  }
}