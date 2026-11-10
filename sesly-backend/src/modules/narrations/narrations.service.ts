import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Audio, Story, StoryNarration, VoiceProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AudioService, GenerateAudioResult } from '../audio/audio.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { NarrationCharge, UsageService } from '../usage/usage.service';
import { CreateNarrationDto } from './dto/create-narration.dto';
import { GetNarrationsQueryDto } from './dto/get-narrations-query.dto';
import { PaginationHelper } from '@common/utils/pagination.helper';
import { narrationSearchIdsQuery, normalizeSearchTerm } from '@common/utils/search-fold';
import { isPremiumVoice } from '@common/utils/voice-tier';
import { describeNarrationLanguage } from '@common/utils/voice-language';
import { SubscriptionPlan } from '@common/enums/prisma.enums';
import {
  NARRATION_FAILED_MESSAGE_KEY,
  VOICE_NOT_READY_MESSAGE_KEY,
} from '@common/constants/messages.constants';
import { serverText } from '@common/i18n/server-text';
import { resolveUserUiLanguage } from '@common/i18n/user-ui-language';
import { toStoryListItem } from '../stories/story-list.mapper';
import { StoryGroupInfo, loadStoryGroupInfo } from '../stories/story-groups';
import { SettingsService } from '../settings/settings.service';
import { toPublicVoiceProfile } from '../voice-profiles/voice-profile.mapper';

/** i18n keys; HttpExceptionFilter serves them per Accept-Language. */
export const NARRATION_EXISTS_MESSAGE = 'errors.narrations.alreadyExists';
export const PREMIUM_STORY_REQUIRED_MESSAGE = 'errors.stories.premiumRequired';

type AudioProgressFields = Pick<Audio, 'status' | 'duration' | 'totalSegments' | 'readySegments'>;

type NarrationWithRelations = StoryNarration & {
  story: Story;
  voiceProfile: VoiceProfile;
  audio: AudioProgressFields | null;
};

@Injectable()
export class NarrationsService {
  private readonly logger = new Logger(NarrationsService.name);

  constructor(
    private prisma: PrismaService,
    private audioService: AudioService,
    private notificationsService: NotificationsService,
    private storageService: StorageService,
    private usageService: UsageService,
    private settings: SettingsService,
  ) { }

  // ==========================================================================
  // Mapping
  // ==========================================================================

  private progressOf(audio: AudioProgressFields | null): number {
    if (!audio || audio.totalSegments <= 0) return 0;
    return Math.round((audio.readySegments / audio.totalSegments) * 100);
  }

  /**
   * Client shape shared by POST /narrations, GET /narrations (items) and
   * GET /narrations/:id. Story is the list-item shape (no `content`),
   * voice profile is the public shape (no cloning key / consent URL).
   *
   * `voiceLanguage`, `storyLanguage`, `languageMismatch` and
   * `nativeVoiceUsed` (see NarrationLanguageInfo) tell the client whether
   * the voice and the story are of different languages. That is allowed;
   * the client warns ("Dil tipleri uyuşmuyor. Aksan kaymaları olabilir.").
   * To know BEFORE creating a narration, a client compares
   * `voiceProfile.contentLanguage` with `story.language` itself.
   */
  private async toResponse(
    n: NarrationWithRelations,
    isFavorite: boolean,
    groupInfo?: Map<string, StoryGroupInfo>,
  ) {
    const audio = n.audio;
    // Languages the tale exists in, so the library can show one row per
    // tale with its language codes. Read here for a single narration; the
    // list passes the info it loaded once for the whole page.
    const info = groupInfo ?? (await loadStoryGroupInfo(this.prisma, this.settings, [n.story]));
    return {
      id: n.id,
      userId: n.userId,
      title: n.title,
      status: n.status,
      storyId: n.storyId,
      voiceProfileId: n.voiceProfileId,
      audioId: n.audioId,
      story: await toStoryListItem(n.story, this.storageService, isFavorite, {
        availableLanguages: info.get(n.story.id)?.availableLanguages,
        sharedCoverImageUrl: info.get(n.story.id)?.sharedCoverImageUrl,
        sharedCoverCredit: info.get(n.story.id)?.sharedCoverCredit,
      }),
      voiceProfile: toPublicVoiceProfile(n.voiceProfile),
      ...describeNarrationLanguage(n.voiceProfile, n.story),
      errorMessage: n.errorMessage,
      // `totalDuration` (seconds, 0 when unknown) matches the list response;
      // `duration` (null when unknown) is kept for older clients.
      totalDuration: audio?.duration || 0,
      duration: audio?.duration ?? null,
      progress: this.progressOf(audio),
      audioStatus: audio?.status ?? null,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      completedAt: n.completedAt,
    };
  }

  private readonly relationsInclude = {
    story: true,
    voiceProfile: true,
    audio: {
      select: { status: true, duration: true, totalSegments: true, readySegments: true },
    },
  } as const;

  // ==========================================================================
  // Entitlements
  // ==========================================================================

  /** User-facing narration failure text in the user's stored UI language. */
  private async failedMessageFor(userId: string): Promise<string> {
    return serverText(
      NARRATION_FAILED_MESSAGE_KEY,
      await resolveUserUiLanguage(this.prisma, userId),
    );
  }

  private assertStoryAccess(story: Pick<Story, 'isPremium'>, plan: SubscriptionPlan) {
    if (story.isPremium && plan === SubscriptionPlan.FREE) {
      throw new ForbiddenException({
        code: 'PREMIUM_STORY',
        message: PREMIUM_STORY_REQUIRED_MESSAGE,
      });
    }
  }

  /**
   * Remove a narration row plus its generated audio (DB + GCS; a shared
   * audio of a ready-made voice stays for the other narrations). Used when a
   * FAILED/PENDING row is silently replaced, on `replace: true`, and when a
   * quota/entitlement failure would otherwise leave a zombie PENDING row.
   */
  private async discardNarration(
    narration: Pick<StoryNarration, 'id' | 'audioId'>,
    userId: string,
  ): Promise<void> {
    if (narration.audioId) {
      try {
        await this.audioService.releaseAudio(narration.audioId, userId);
      } catch (err) {
        this.logger.warn(
          `Failed to release audio ${narration.audioId} while discarding narration ${narration.id}`,
          err,
        );
      }
    }
    await this.prisma.storyNarration.deleteMany({ where: { id: narration.id } });
  }

  // ==========================================================================
  // CRUD
  // ==========================================================================

  async create(userId: string, createNarrationDto: CreateNarrationDto) {
    const { storyId, voiceProfileId, title, replace } = createNarrationDto;

    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    // A draft does not exist for clients (archived stories stay narratable:
    // old favourites and libraries point at them).
    if (!story || story.status === 'DRAFT') {
      throw new NotFoundException('errors.stories.notFound');
    }

    const voiceProfile = await this.prisma.voiceProfile.findUnique({
      where: { id: voiceProfileId },
    });

    if (!voiceProfile) {
      throw new NotFoundException('errors.voiceProfiles.notFound');
    }

    if (voiceProfile.userId !== userId) {
      throw new BadRequestException('errors.voiceProfiles.notOwned');
    }

    // A voice of another language than the story MAY narrate it (the old
    // 400 VOICE_LANGUAGE_MISMATCH is gone). The response says so through
    // `languageMismatch` / `nativeVoiceUsed`.

    // Schema enforces UNIQUE(userId, storyId, voiceProfileId).
    //   - READY / GENERATING  -> 409 NARRATION_EXISTS (unless replace: true)
    //   - FAILED / PENDING    -> silently replaced (they are retries, not
    //                            results the user would want to keep)
    const existing = await this.prisma.storyNarration.findUnique({
      where: {
        userId_storyId_voiceProfileId: { userId, storyId, voiceProfileId },
      },
      select: { id: true, status: true, audioId: true, freeRegeneration: true },
    });

    if (existing) {
      const isResult = existing.status === 'READY' || existing.status === 'GENERATING';
      if (isResult && !replace) {
        throw new ConflictException({
          code: 'NARRATION_EXISTS',
          existingNarrationId: existing.id,
          status: existing.status,
          message: NARRATION_EXISTS_MESSAGE,
        });
      }
    }

    // An admin removed the audio of the row being replaced: the new row
    // keeps the free regeneration (no quota check, no unit taken).
    const freeRegeneration =
      !!existing?.freeRegeneration && existing.status !== 'READY' && existing.status !== 'GENERATING';

    // Entitlement + quota are checked BEFORE inserting, so a 403 never
    // leaves a PENDING row behind that would block the story.
    const plan = await this.usageService.getEffectivePlan(userId);
    this.assertStoryAccess(story, plan);
    if (!freeRegeneration) {
      await this.usageService.assertNarrationQuota(userId, plan, isPremiumVoice(voiceProfile));
    }

    if (existing) {
      this.logger.log(
        `Replacing existing ${existing.status} narration ${existing.id} for user ${userId} (audioId=${existing.audioId ?? 'none'})`,
      );
      await this.discardNarration(existing, userId);
    }

    const narration = await this.prisma.storyNarration.create({
      data: {
        storyId,
        voiceProfileId,
        userId,
        title: title || `${story.title} - ${voiceProfile.name}`,
        status: 'PENDING',
        freeRegeneration,
      },
      include: this.relationsInclude,
    });

    const favorite = await this.prisma.favoriteStory.findUnique({
      where: { userId_storyId: { userId, storyId } },
      select: { id: true },
    });

    this.logger.log(
      `Created narration ${narration.id} for user ${userId}${existing ? ' (replaced previous)' : ''}`,
    );
    return this.toResponse(narration, !!favorite);
  }

  async findAll(userId: string, paginationDto: GetNarrationsQueryDto = {}) {
    const { page, limit, search } = paginationDto;
    const { page: normPage, limit: normLimit } = PaginationHelper.normalizePaginationParams(
      page,
      limit,
    );
    const skip = PaginationHelper.calculateOffset(normPage, normLimit);

    const where: any = { userId };

    // Turkish-aware match on the narration title and the story title:
    // "yildiz", "YILDIZ" and "Yıldız" find the same rows (see search-fold.ts).
    const term = normalizeSearchTerm(search);
    if (term) {
      const matches = await this.prisma.$queryRaw<{ id: string }[]>(
        narrationSearchIdsQuery(userId, term),
      );
      if (matches.length === 0) {
        return PaginationHelper.createPaginatedResponse([], 0, normPage, normLimit);
      }
      where.id = { in: matches.map((m) => m.id) };
    }

    // total count + paginated rows in parallel — narration tables grow fast
    // once a user starts generating, so the cost difference matters.
    const [total, narrations] = await Promise.all([
      this.prisma.storyNarration.count({ where }),
      this.prisma.storyNarration.findMany({
        where,
        include: this.relationsInclude,
        orderBy: { updatedAt: 'desc' },
        skip,
        take: normLimit,
      }),
    ]);

    // Batch-fetch favorite story IDs only for the rows on this page.
    const storyIds = [...new Set(narrations.map((n) => n.storyId))];
    const favoriteStoryIds = await this.prisma.favoriteStory
      .findMany({
        where: { userId, storyId: { in: storyIds } },
        select: { storyId: true },
      })
      .then((favs) => new Set(favs.map((f) => f.storyId)));

    const groupInfo = await loadStoryGroupInfo(
      this.prisma,
      this.settings,
      narrations.map((n) => n.story),
    );
    const items = await Promise.all(
      narrations.map((n) => this.toResponse(n, favoriteStoryIds.has(n.storyId), groupInfo)),
    );

    return PaginationHelper.createPaginatedResponse(items, total, normPage, normLimit);
  }

  /**
   * Ownership-checked lookup without relations (cheap).
   */
  private async getOwnedNarration(id: string, userId: string): Promise<StoryNarration> {
    const narration = await this.prisma.storyNarration.findUnique({ where: { id } });

    if (!narration) {
      throw new NotFoundException('errors.narrations.notFound');
    }

    if (narration.userId !== userId) {
      throw new BadRequestException('errors.narrations.notOwned');
    }

    return narration;
  }

  async findOne(id: string, userId: string) {
    const narration = await this.prisma.storyNarration.findUnique({
      where: { id },
      include: this.relationsInclude,
    });

    if (!narration) {
      throw new NotFoundException('errors.narrations.notFound');
    }

    if (narration.userId !== userId) {
      throw new BadRequestException('errors.narrations.notOwned');
    }

    const favorite = await this.prisma.favoriteStory.findUnique({
      where: { userId_storyId: { userId, storyId: narration.storyId } },
      select: { id: true },
    });

    return this.toResponse(narration, !!favorite);
  }

  async remove(id: string, userId: string) {
    const narration = await this.getOwnedNarration(id, userId);

    await this.discardNarration(narration, userId);

    this.logger.log(`Deleted narration ${id} for user ${userId}`);
    return { message: 'Narration deleted successfully' };
  }

  // ==========================================================================
  // Generation
  // ==========================================================================

  /**
   * Generate audio for a narration - uses new AudioService API
   */
  async generateAudio(narrationId: string, userId: string) {
    const narration = await this.prisma.storyNarration.findUnique({
      where: { id: narrationId },
      include: {
        story: true,
        voiceProfile: true,
        audio: { select: { id: true, status: true, totalSegments: true, readySegments: true } },
      },
    });

    if (!narration) {
      throw new NotFoundException('errors.narrations.notFound');
    }

    if (narration.userId !== userId) {
      throw new BadRequestException('errors.narrations.notOwned');
    }

    // Same four language fields as the narration itself, on every answer of
    // this endpoint, so the client can warn right after starting.
    // (Absent only when the row has lost its voice profile, which the
    // VOICE_NOT_READY check below answers.)
    const languageInfo = narration.voiceProfile
      ? describeNarrationLanguage(narration.voiceProfile, narration.story)
      : {};

    const existingAudio = narration.audio;
    if (existingAudio?.status === 'READY') {
      return {
        message: 'Audio already generated',
        status: 'READY',
        narrationId,
        audioId: existingAudio.id,
        ...languageInfo,
      };
    }

    if (existingAudio?.status === 'GENERATING') {
      return {
        message: 'Audio generation already in progress',
        status: 'GENERATING',
        narrationId,
        audioId: existingAudio.id,
        progress: this.progressOf({ ...existingAudio, duration: null }),
        ...languageInfo,
      };
    }

    const voiceProfile = narration.voiceProfile;
    if (!voiceProfile || voiceProfile.status !== 'READY') {
      throw new BadRequestException({
        code: 'VOICE_NOT_READY',
        message: VOICE_NOT_READY_MESSAGE_KEY,
      });
    }

    const story = narration.story;
    const premiumVoice = isPremiumVoice(voiceProfile);
    const plan = await this.usageService.getEffectivePlan(userId);

    // The allowance is taken atomically here (append-only, never refunded
    // once generation has started), so concurrent requests cannot go past
    // the plan limit.
    // A regeneration after an admin removed the audio takes no unit.
    let charge: NarrationCharge | null = null;
    try {
      this.assertStoryAccess(story, plan);
      if (!narration.freeRegeneration) {
        charge = await this.usageService.consumeNarration(userId, plan, premiumVoice);
      }
    } catch (err) {
      // Do not leave a zombie PENDING narration blocking this story.
      if (narration.status === 'PENDING' && !narration.audioId) {
        await this.prisma.storyNarration.deleteMany({ where: { id: narration.id } });
        this.logger.log(`Deleted PENDING narration ${narration.id} after entitlement/quota failure`);
      }
      throw err;
    }

    // Retrying a FAILED/PENDING generation: drop the stale audio first so it
    // does not linger as an orphan once the narration points at the new one
    // (a shared audio stays: the shared path regenerates it in place).
    if (existingAudio) {
      try {
        await this.audioService.releaseAudio(existingAudio.id, userId);
      } catch (err) {
        this.logger.warn(`Failed to delete stale audio ${existingAudio.id}`, err);
      }
    }

    // Use AudioService to generate audio. Passing storyId lets the audio
    // pipeline pick up Story.preprocessedSegments + defaultEmotion/Speed.
    // share: a ready-made voice uses the shared audio of the story (one
    // synthesis for every user); the unit above is taken all the same.
    let result: GenerateAudioResult;
    try {
      result = await this.audioService.generateAudio({
        text: story.content,
        voiceProfileId: narration.voiceProfileId,
        userId,
        title: narration.title || story.title,
        storyId: story.id,
        narrationId,
        share: true,
      });
    } catch (err) {
      // Nothing was started: the unit taken above goes back.
      if (charge) {
        await this.usageService
          .refundNarration(charge)
          .catch((refundError) => this.logger.warn(`Narration quota refund failed for ${userId}`, refundError));
      }
      throw err;
    }

    const { audioId } = result;
    // A shared audio links the narration itself (before any job can finish).
    if (!result.shared) {
      await this.prisma.storyNarration.update({
        where: { id: narrationId },
        data: {
          audioId,
          status: 'GENERATING',
          errorMessage: null,
          freeRegeneration: false,
        },
      });
    }

    this.logger.log(
      `Audio generation for narration ${narrationId}: audioId ${audioId}, ${result.status}${result.shared ? ' (shared)' : ''}`,
    );

    if (result.status === 'READY') {
      return { message: 'Audio ready', status: 'READY', narrationId, audioId, ...languageInfo };
    }
    if (result.status === 'FAILED') {
      return {
        message: 'Audio generation failed',
        status: 'FAILED',
        narrationId,
        audioId,
        errorMessage: await this.failedMessageFor(userId),
        ...languageInfo,
      };
    }
    return {
      message: 'Audio generation started',
      status: 'GENERATING',
      narrationId,
      audioId,
      ...languageInfo,
    };
  }

  async findByStory(storyId: string, userId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, language: true },
    });

    if (!story) {
      throw new NotFoundException('errors.stories.notFound');
    }

    const [narrations, favorite] = await Promise.all([
      this.prisma.storyNarration.findMany({
        where: { storyId, userId },
        include: {
          voiceProfile: true,
          audio: {
            select: { status: true, duration: true, totalSegments: true, readySegments: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.favoriteStory.findUnique({
        where: { userId_storyId: { userId, storyId } },
        select: { id: true },
      }),
    ]);

    const isFavorite = !!favorite;

    return narrations.map((n) => ({
      id: n.id,
      title: n.title,
      status: n.status,
      audioId: n.audioId,
      voiceProfileId: n.voiceProfileId,
      voiceProfile: toPublicVoiceProfile(n.voiceProfile),
      ...describeNarrationLanguage(n.voiceProfile, story),
      isFavorite,
      errorMessage: n.errorMessage,
      totalDuration: n.audio?.duration || 0,
      duration: n.audio?.duration ?? null,
      progress: this.progressOf(n.audio),
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    }));
  }

  /**
   * Lightweight status endpoint for mobile polling.
   * Returns only the narration's own status/progress/duration/errorMessage fields
   * without loading story, voiceProfile, or segment relations. Designed to be
   * cheap enough for aggressive client-side polling.
   */
  async getGenerationStatus(id: string, userId: string) {
    const narration = await this.prisma.storyNarration.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        status: true,
        errorMessage: true,
        updatedAt: true,
        audioId: true,
        audio: {
          select: {
            status: true,
            duration: true,
            totalSegments: true,
            readySegments: true,
          },
        },
      },
    });

    if (!narration) {
      throw new NotFoundException('errors.narrations.notFound');
    }

    if (narration.userId !== userId) {
      throw new ForbiddenException('errors.narrations.notOwned');
    }

    const audio = narration.audio;

    // Raw pipeline errors (Audio.errorMessage) are admin-only; clients get
    // the user-facing narration message.
    const errorMessage =
      narration.errorMessage ??
      (narration.status === 'FAILED' ? await this.failedMessageFor(userId) : null);

    return {
      id: narration.id,
      status: narration.status,
      progress: this.progressOf(audio),
      duration: audio?.duration ?? null,
      errorMessage,
      updatedAt: narration.updatedAt,
    };
  }

  /**
   * Get stream URL for narration audio
   */
  async getStreamUrl(id: string, userId: string): Promise<string> {
    const narration = await this.getOwnedNarration(id, userId);

    if (!narration.audioId) {
      throw new NotFoundException('errors.audio.notReady');
    }

    return this.audioService.getStreamUrl(narration.audioId, userId);
  }
}
