import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AudioService } from './audio.service';
import { SettingsService } from '../settings/settings.service';

/** What the backend holds for the narrations of one story. */
export interface NarrationCacheSummary {
  storyId: string;
  /** Story.segmentationVersion now. */
  segmentationVersion: number;
  /** Narrations (of every user) that have stored audio. */
  narrations: number;
  readyNarrations: number;
  generatingNarrations: number;
  /** Audio rows behind those narrations plus the shared audios of the story (distinct). */
  audios: number;
  /** Shared ready-made voice audios of the story (one synthesis reused by every user). */
  sharedAudios: number;
  /** Narrations (of every user) that point at one of those shared audios. */
  sharedNarrations: number;
  /** Runtime setting tts.sharePresetAudio (new ready-made narrations reuse shared audio). */
  sharingEnabled: boolean;
  /** Audio made from older segments than the story has now (or of unknown version). */
  staleAudios: number;
  /** Stored files (merged narration files plus unmerged segment files). */
  files: number;
}

export interface NarrationCacheClearResult extends NarrationCacheSummary {
  /** Audio rows deleted (with their files). */
  removedAudios: number;
  /** Audio rows that could not be deleted (logged). */
  failedAudios: number;
}

type CachedAudio = {
  id: string;
  shared: boolean;
  status: string;
  audioUrl: string | null;
  segmentationVersion: number | null;
  segments: { audioUrl: string | null }[];
};

/**
 * The "narration cache" of a story: the generated audio of every user's
 * narration of it (Audio + AudioSegment rows and their storage objects).
 * A cloned voice narration is generated per user; a ready-made (Google)
 * voice narration uses the story's shared audio of its key (one synthesis
 * for every user, see AudioService.generateSharedAudio). Clearing deletes
 * all of it, shared audios included; every affected narration
 * turns FAILED with "Bu masalın ses dosyası kaldırıldı. Lütfen yeniden
 * oluştur." and gets a free regeneration (see AudioService.adminDeleteAudio).
 * Copies already on phones are out of reach (the app streams; it keeps no
 * offline copy, see docs/story-pipeline.md).
 */
@Injectable()
export class NarrationCacheService {
  private readonly logger = new Logger(NarrationCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audioService: AudioService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Distinct storage objects of an audio. A READY audio made of several
   * segments had its segment files removed after the merge, so only the
   * merged file is counted; otherwise the segment files are still there.
   */
  static fileCount(audio: CachedAudio): number {
    const keys = new Set<string>();
    if (audio.audioUrl) keys.add(audio.audioUrl);
    if (audio.status !== 'READY' || audio.segments.length <= 1) {
      for (const s of audio.segments) if (s.audioUrl) keys.add(s.audioUrl);
    }
    return keys.size;
  }

  async summary(storyId: string): Promise<NarrationCacheSummary> {
    const { summary } = await this.load(storyId);
    return summary;
  }

  async clear(storyId: string, reason: string): Promise<NarrationCacheClearResult> {
    const { summary, audios } = await this.load(storyId);
    let removedAudios = 0;
    let failedAudios = 0;
    for (const audio of audios) {
      try {
        await this.audioService.adminDeleteAudio(audio.id);
        removedAudios++;
      } catch (err: any) {
        failedAudios++;
        this.logger.warn(`Narration cache of story ${storyId}: audio ${audio.id} not removed: ${err?.message ?? err}`);
      }
    }
    this.logger.log(
      `AUDIT narration cache cleared story=${storyId} reason="${reason}" narrations=${summary.narrations} ` +
        `audios=${removedAudios}/${summary.audios} shared=${summary.sharedAudios} files=${summary.files}`,
    );
    return { ...summary, removedAudios, failedAudios };
  }

  private async load(storyId: string): Promise<{ summary: NarrationCacheSummary; audios: CachedAudio[] }> {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, segmentationVersion: true },
    });
    if (!story) throw new NotFoundException('Story not found');

    const audioSelect = {
      id: true,
      shared: true,
      status: true,
      audioUrl: true,
      segmentationVersion: true,
      segments: { select: { audioUrl: true } },
    } as const;
    const [narrationRows, sharedRows] = await Promise.all([
      this.prisma.storyNarration.findMany({
        where: { storyId, audioId: { not: null } },
        select: { status: true, audio: { select: audioSelect } },
      }),
      // Shared audios no narration points at any more are still cache.
      this.prisma.audio.findMany({ where: { storyId, shared: true }, select: audioSelect }),
    ]);

    const narrations = narrationRows ?? [];
    // A shared audio is behind many narrations: count it once.
    const byId = new Map<string, CachedAudio>();
    for (const n of narrations) if (n.audio) byId.set(n.audio.id, n.audio);
    for (const a of sharedRows ?? []) byId.set(a.id, a);
    const audios = [...byId.values()];
    const sharedIds = new Set(audios.filter((a) => a.shared).map((a) => a.id));

    const summary: NarrationCacheSummary = {
      storyId,
      segmentationVersion: story.segmentationVersion,
      narrations: narrations.length,
      readyNarrations: narrations.filter((n) => n.status === 'READY').length,
      generatingNarrations: narrations.filter((n) => n.status === 'GENERATING' || n.status === 'PENDING').length,
      audios: audios.length,
      sharedAudios: sharedIds.size,
      sharedNarrations: narrations.filter((n) => n.audio && sharedIds.has(n.audio.id)).length,
      sharingEnabled: this.settings.get('tts.sharePresetAudio'),
      staleAudios: audios.filter((a) => a.segmentationVersion !== story.segmentationVersion).length,
      files: audios.reduce((sum, a) => sum + NarrationCacheService.fileCount(a), 0),
    };
    return { summary, audios };
  }
}
