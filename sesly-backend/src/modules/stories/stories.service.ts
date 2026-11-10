import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { loadStoryPart } from './story-parts';
import { loadStoryTranslationSource } from './story-translation-source';
import { PrismaService } from '@prisma/prisma.service';
import { StoryQueryDto } from './dto/story-query.dto';
import { PaginationHelper } from '@common/utils/pagination.helper';
import { normalizeSearchTerm, storySearchIdsQuery } from '@common/utils/search-fold';
import { NarrationsService } from '@modules/narrations/narrations.service';
import { AudioService } from '@modules/audio/audio.service';
import { StorageService } from '@modules/storage/storage.service';
import { resolveEffectivePlan } from '@common/utils/subscription-plan';
import { LanguageLevel, StoryStatus, SubscriptionPlan } from '@common/enums/prisma.enums';
import { CONTENT_LANGUAGES } from '@common/constants/content-languages';
import { SettingsService } from '@modules/settings/settings.service';
import { StoryListItem, StoryListSource, toStoryListItem, toStoryListItems } from './story-list.mapper';
import { resolveContentLanguages, resolveRequestedLanguage } from './content-language';
import { storyOrderBy } from './story-query.util';
import {
  GROUP_CANDIDATE_SELECT,
  GroupCandidate,
  allMemberIds,
  groupKeyOf,
  loadStoryGroupInfo,
  pickGroupVersionIds,
} from './story-groups';
import { TranslationRequestsService } from '@modules/translation-requests/translation-requests.service';

/** i18n key; HttpExceptionFilter serves it per Accept-Language. */
export const PREMIUM_STORY_MESSAGE = 'errors.stories.premiumRequired';

/** Stories of the same category that GET /stories/:id/related returns at most. */
export const RELATED_CATEGORY_LIMIT = 12;

/**
 * GET /stories/:id/related: what the story page offers next, grouped.
 *   - languages: the other published language versions of the tale (enabled
 *     languages, catalogue order)
 *   - parts: the other published parts of a tale told in several parts, in
 *     part order, each with its `partNumber`
 *   - category: up to RELATED_CATEGORY_LIMIT other stories of the same
 *     category in the story's language, newest first, never a version or a
 *     part of this tale and only the first part of another multi-part tale;
 *     premium stories only for a plan that plays them (as GET /stories)
 * Every item has the list shape (story-list.mapper.ts).
 */
export interface RelatedStories {
  languages: StoryListItem[];
  parts: Array<StoryListItem & { partNumber: number }>;
  category: StoryListItem[];
}

const LANGUAGE_LEVEL_ORDER: readonly string[] = Object.values(LanguageLevel);

export interface StoryTranslationRef {
  id: string;
  language: string;
  title: string;
}

/** Which stories a list request covers. */
export interface StoryScopeOptions {
  /** One or several content languages: a flat list, one row per story per language. */
  language?: string | string[];
  /** One item per tale (translation group). Ignored when a language is sent. */
  grouped?: boolean;
  /** Content language to prefer in a grouped list (wins over the stored preference). */
  prefer?: string;
}

export interface CatalogueLanguage {
  code: string;
  nativeName: string;
  englishName: string;
  isDefault: boolean;
  /** Published stories in this language. */
  storyCount: number;
  /** CEFR levels that at least one published story of this language has, easiest first. */
  levels: string[];
}

@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private prisma: PrismaService,
    private audioService: AudioService,
    private storageService: StorageService,
    @Inject(forwardRef(() => NarrationsService))
    private narrationsService: NarrationsService,
    private settings: SettingsService,
    private translationRequests: TranslationRequestsService,
  ) {}

  /**
   * Effective plan for an (optionally anonymous) caller. Anonymous callers
   * and expired admin grants resolve to FREE.
   */
  private async getEffectivePlan(userId?: string | null): Promise<SubscriptionPlan> {
    if (!userId) return SubscriptionPlan.FREE;
    const subscription = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    return resolveEffectivePlan(subscription);
  }

  private async getFavoriteIds(
    userId: string | null | undefined,
    storyIds: string[],
  ): Promise<Set<string>> {
    if (!userId || storyIds.length === 0) return new Set<string>();
    const favorites = await this.prisma.favoriteStory.findMany({
      where: { userId, storyId: { in: storyIds } },
      select: { storyId: true },
    });
    return new Set(favorites.map((f) => f.storyId));
  }

  /**
   * Content language a grouped list prefers for this caller: the `prefer`
   * parameter, else the stored contentLanguage preference, else the
   * content.defaultLanguage setting. A language that is not enabled is
   * skipped at every step.
   */
  private async resolvePreferredLanguage(
    userId: string | null | undefined,
    prefer: string | undefined,
    enabled: string[],
    defaultLanguage: string,
  ): Promise<string> {
    if (prefer && enabled.includes(prefer)) return prefer;
    if (userId) {
      const preferences = await this.prisma.userPreferences.findUnique({
        where: { userId },
        select: { contentLanguage: true },
      });
      const stored = preferences?.contentLanguage;
      if (stored && enabled.includes(stored)) return stored;
    }
    return defaultLanguage;
  }

  /**
   * The Prisma filter that selects which published stories a list covers,
   * or null when the answer is an empty list (a language that is switched
   * off).
   *   - language(s) sent: those languages, flat (one row per story per language)
   *   - grouped=true, no language: the chosen version of every tale
   *   - neither: the default content language, exactly as before grouping
   *     existed, so app versions in the field see no change
   */
  private async resolveScope(
    userId: string | undefined,
    options: StoryScopeOptions,
  ): Promise<Record<string, unknown> | null> {
    const languages = ([] as string[]).concat(options.language ?? []);

    if (languages.length > 1) {
      const { enabled } = resolveContentLanguages(this.settings);
      const served = languages.filter((code) => enabled.includes(code));
      if (served.length === 0) return null;
      return { status: StoryStatus.PUBLISHED, language: { in: served } };
    }

    if (languages.length === 0 && options.grouped) {
      const { enabled, defaultLanguage } = resolveContentLanguages(this.settings);
      const preferred = await this.resolvePreferredLanguage(
        userId,
        options.prefer,
        enabled,
        defaultLanguage,
      );
      // The version of each tale is chosen first; every other filter then
      // applies to that version. Only ids and a few columns are read here.
      const candidates = (await this.prisma.story.findMany({
        where: { status: StoryStatus.PUBLISHED, language: { in: enabled } },
        select: GROUP_CANDIDATE_SELECT,
      })) as GroupCandidate[];
      const chosen = pickGroupVersionIds(candidates, { preferred, defaultLanguage });
      return { status: StoryStatus.PUBLISHED, id: { in: chosen } };
    }

    // Content language is an explicit parameter (never Accept-Language). App
    // versions in the field send none and get the default language.
    const requested = resolveRequestedLanguage(this.settings, languages[0]);
    if (!requested.available) return null;
    return { status: StoryStatus.PUBLISHED, language: requested.language };
  }

  /**
   * List items for a page of stories: group info (availableLanguages) and
   * the favourites of the caller, including those on another language version.
   */
  private async toItems(userId: string | null | undefined, stories: StoryListSource[]) {
    const groupInfo = await loadStoryGroupInfo(this.prisma, this.settings, stories);
    const favoriteStoryIds = await this.getFavoriteIds(userId, allMemberIds(groupInfo));
    return toStoryListItems(stories, this.storageService, favoriteStoryIds, groupInfo);
  }

  /**
   * `userId` is undefined for anonymous callers (GET /stories is @Public
   * with optional auth).
   */
  async getStories(userId: string | undefined, query: StoryQueryDto) {
    const { ageGroup, category, page = 1, limit = 20, isPremium, languageLevel, sort } = query;

    // Lists only ever show published stories.
    const where: any = await this.resolveScope(userId, query);
    if (!where) {
      return PaginationHelper.createPaginatedResponse([], 0, page, limit);
    }

    const plan = await this.getEffectivePlan(userId);
    const isFreePlan = plan === SubscriptionPlan.FREE;

    if (languageLevel && languageLevel.length > 0) where.languageLevel = { in: languageLevel };
    if (ageGroup) where.ageGroup = ageGroup;
    if (category) where.category = category;
    if (isPremium !== undefined) where.isPremium = isPremium;

    if (isFreePlan && isPremium === undefined) {
      where.isPremium = false;
    }

    const [stories, total] = await Promise.all([
      this.prisma.story.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: storyOrderBy(sort),
      }),
      this.prisma.story.count({ where }),
    ]);

    const items = await this.toItems(userId, stories);

    return PaginationHelper.createPaginatedResponse(items, total, page, limit);
  }

  /**
   * GET /stories/languages: the enabled content languages with the number
   * of published stories and the CEFR levels present in each, so a client
   * can draw a language switch and level chips. Counts are plan-independent.
   */
  async getLanguages(): Promise<{ defaultLanguage: string; languages: CatalogueLanguage[] }> {
    const { enabled, defaultLanguage } = resolveContentLanguages(this.settings);

    const groups: Array<{ language: string; languageLevel: string | null; _count: { _all: number } }> =
      await (this.prisma.story.groupBy as any)({
        by: ['language', 'languageLevel'],
        where: { status: StoryStatus.PUBLISHED, language: { in: enabled } },
        _count: { _all: true },
      });

    const languages = CONTENT_LANGUAGES.filter((l) => enabled.includes(l.code)).map((l) => {
      const own = groups.filter((g) => g.language === l.code);
      const present = new Set(own.map((g) => g.languageLevel).filter(Boolean) as string[]);
      return {
        code: l.code,
        nativeName: l.nativeName,
        englishName: l.englishName,
        isDefault: l.code === defaultLanguage,
        storyCount: own.reduce((sum, g) => sum + g._count._all, 0),
        levels: LANGUAGE_LEVEL_ORDER.filter((level) => present.has(level)),
      };
    });

    return { defaultLanguage, languages };
  }

  /**
   * Published stories that tell the same tale in another enabled language.
   */
  private async getTranslations(story: {
    id: string;
    translationGroupId?: string | null;
  }): Promise<StoryTranslationRef[]> {
    if (!story.translationGroupId) return [];
    const { enabled } = resolveContentLanguages(this.settings);
    const siblings = await this.prisma.story.findMany({
      where: {
        translationGroupId: story.translationGroupId,
        id: { not: story.id },
        status: StoryStatus.PUBLISHED,
        language: { in: enabled },
      },
      select: { id: true, language: true, title: true },
      orderBy: { language: 'asc' },
    });
    return siblings.map((s) => ({ id: s.id, language: s.language, title: s.title }));
  }

  /**
   * The story a detail request names, or the 404 (missing, DRAFT) and the
   * 403 PREMIUM_STORY (a premium story for the FREE plan) it answers with.
   * ARCHIVED still resolves: old favourites and narrations point at it.
   * The plan is read only for a premium story, unless the caller has it.
   */
  private async findReadableStory(userId: string, storyId: string, plan?: SubscriptionPlan) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story || story.status === StoryStatus.DRAFT) {
      throw new NotFoundException('errors.stories.notFound');
    }

    if (story.isPremium) {
      const effective = plan ?? (await this.getEffectivePlan(userId));
      if (effective === SubscriptionPlan.FREE) {
        throw new ForbiddenException({
          code: 'PREMIUM_STORY',
          message: PREMIUM_STORY_MESSAGE,
        });
      }
    }
    return story;
  }

  async getStory(userId: string, storyId: string) {
    const story = await this.findReadableStory(userId, storyId);

    // Same client shape as list items: the full narrative, chunks and TTS
    // segment metadata never leave the server.
    const [items, translations, requestedLanguages, part, translation] = await Promise.all([
      this.toItems(userId, [story]),
      this.getTranslations(story),
      this.translationRequests.requestedLanguages(userId, story),
      loadStoryPart(this.prisma, story),
      loadStoryTranslationSource(this.prisma, story),
    ]);
    // requestedLanguages: languages the caller asked this tale to be
    // translated into and that are not published yet. part: position in a
    // multi-part tale with the previous / next published part (null for a
    // single-part story), see story-parts.ts. translation: machine flag and
    // the published original of a translated story (null when the story is
    // not a translation), see story-translation-source.ts.
    return { ...items[0], translations, requestedLanguages, part, translation };
  }

  /** GET /stories/:id/related (see `RelatedStories`). Same 404 / 403 as the detail. */
  async getRelatedStories(userId: string, storyId: string): Promise<RelatedStories> {
    const plan = await this.getEffectivePlan(userId);
    const story = await this.findReadableStory(userId, storyId, plan);
    const { enabled } = resolveContentLanguages(this.settings);

    const [languageRows, partRows] = await Promise.all([
      story.translationGroupId
        ? this.prisma.story.findMany({
            where: {
              translationGroupId: story.translationGroupId,
              id: { not: story.id },
              status: StoryStatus.PUBLISHED,
              language: { in: enabled },
            },
          })
        : Promise.resolve([] as (typeof story)[]),
      story.partGroupId
        ? this.prisma.story.findMany({
            where: {
              partGroupId: story.partGroupId,
              id: { not: story.id },
              status: StoryStatus.PUBLISHED,
            },
            orderBy: { partNumber: 'asc' },
          })
        : Promise.resolve([] as (typeof story)[]),
    ]);
    const catalogueIndex = (code: string) => {
      const index = CONTENT_LANGUAGES.findIndex((l) => l.code === code);
      return index === -1 ? CONTENT_LANGUAGES.length : index;
    };
    const languages = [...languageRows].sort((a, b) => catalogueIndex(a.language) - catalogueIndex(b.language));
    const parts = partRows.filter((row) => typeof row.partNumber === 'number');

    // Another tale of the same kind: none of this tale's versions or parts
    // (a NULL group is another tale), and only the first part of a tale
    // told in several parts.
    const otherTale: Record<string, unknown>[] = [{ OR: [{ partNumber: null }, { partNumber: 1 }] }];
    if (story.translationGroupId) {
      otherTale.push({
        OR: [{ translationGroupId: null }, { translationGroupId: { not: story.translationGroupId } }],
      });
    }
    if (story.partGroupId) {
      otherTale.push({ OR: [{ partGroupId: null }, { partGroupId: { not: story.partGroupId } }] });
    }
    const categoryWhere: Record<string, unknown> = {
      status: StoryStatus.PUBLISHED,
      language: story.language,
      category: story.category,
      id: { not: story.id },
      AND: otherTale,
      ...(plan === SubscriptionPlan.FREE ? { isPremium: false } : {}),
    };
    // A story in a language that was switched off offers no more of it.
    const categoryRows = enabled.includes(story.language)
      ? await this.prisma.story.findMany({
          where: categoryWhere,
          take: RELATED_CATEGORY_LIMIT,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        })
      : [];

    // One mapping for the three groups: the group info and the favourites
    // are read once.
    const items = await this.toItems(userId, [...languages, ...parts, ...categoryRows]);
    const languageEnd = languages.length;
    const partEnd = languageEnd + parts.length;
    return {
      languages: items.slice(0, languageEnd),
      parts: items
        .slice(languageEnd, partEnd)
        .map((item, index) => ({ ...item, partNumber: parts[index].partNumber as number })),
      category: items.slice(partEnd),
    };
  }

  async searchStories(
    userId: string | undefined,
    query: string,
    options: StoryScopeOptions & { page: number; limit: number; languageLevel?: string[] },
  ) {
    const { page, limit, languageLevel } = options;

    const scope = await this.resolveScope(userId, options);
    if (!scope) {
      return PaginationHelper.createPaginatedResponse([], 0, page, limit);
    }

    // Turkish-aware, accent- and case-insensitive match on title and content
    // ("kucuk" finds "Küçük", see search-fold.ts). The ids are intersected
    // with the scope; in a grouped search that is the chosen version.
    const term = normalizeSearchTerm(query);
    const matches = term
      ? await this.prisma.$queryRaw<{ id: string }[]>(storySearchIdsQuery(term))
      : [];
    if (matches.length === 0) {
      return PaginationHelper.createPaginatedResponse([], 0, page, limit);
    }

    const plan = await this.getEffectivePlan(userId);
    const isFreePlan = plan === SubscriptionPlan.FREE;

    const where: any = {
      ...scope,
      AND: [{ id: { in: matches.map((m) => m.id) } }],
    };

    if (languageLevel && languageLevel.length > 0) where.languageLevel = { in: languageLevel };

    if (isFreePlan) {
      where.isPremium = false;
    }

    const [stories, total] = await Promise.all([
      this.prisma.story.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.story.count({ where }),
    ]);

    const items = await this.toItems(userId, stories);

    return PaginationHelper.createPaginatedResponse(items, total, page, limit);
  }

  async updateProgress(
    userId: string,
    storyId: string,
    voiceProfileId: string,
    lastChunkIndex: number,
    completedAt?: string,
  ) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('errors.stories.notFound');
    }

    const voiceProfile = await this.prisma.voiceProfile.findFirst({
      where: { id: voiceProfileId, userId },
    });

    if (!voiceProfile) {
      throw new NotFoundException('errors.voiceProfiles.notFound');
    }

    const updateData: any = {
      lastChunkIndex,
      updatedAt: new Date(),
    };

    if (completedAt) {
      updateData.completedAt = new Date(completedAt);
    }

    const progress = await this.prisma.userStoryProgress.upsert({
      where: {
        userId_storyId_voiceProfileId: {
          userId,
          storyId,
          voiceProfileId,
        },
      },
      create: {
        userId,
        storyId,
        voiceProfileId,
        lastChunkIndex,
        completedAt: completedAt ? new Date(completedAt) : null,
      },
      update: updateData,
    });

    // Touch corresponding StoryNarration to update its updatedAt field,
    // bringing it to the top of the interaction-sorted library list.
    try {
      await this.prisma.storyNarration.update({
        where: {
          userId_storyId_voiceProfileId: {
            userId,
            storyId,
            voiceProfileId,
          },
        },
        data: {
          updatedAt: new Date(),
        },
      });
    } catch (err) {
      // Ignore if narration does not exist (e.g., guest or pre-generated free story)
    }

    return {
      message: 'Progress updated successfully',
      progress,
    };
  }

  async addToFavorites(userId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story || story.status === StoryStatus.DRAFT) {
      throw new NotFoundException('errors.stories.notFound');
    }

    const favorite = await this.prisma.favoriteStory.upsert({
      where: {
        userId_storyId: {
          userId,
          storyId,
        },
      },
      create: {
        userId,
        storyId,
      },
      update: {},
    });

    this.logger.log(`Story ${storyId} added to favorites for user ${userId}`);

    return {
      message: 'Story added to favorites',
      favorite: {
        id: favorite.id,
        storyId: favorite.storyId,
        addedAt: favorite.createdAt,
      },
    };
  }

  async removeFromFavorites(userId: string, storyId: string) {
    const deleted = await this.prisma.favoriteStory.deleteMany({
      where: {
        userId,
        storyId,
      },
    });

    if (deleted.count === 0) {
      throw new NotFoundException('errors.stories.notFavorite');
    }

    this.logger.log(`Story ${storyId} removed from favorites for user ${userId}`);

    return {
      message: 'Story removed from favorites',
    };
  }

  /**
   * GET /stories/favorites. With `grouped` a tale saved in several
   * languages is one item: the version in the content language when it is
   * among the saved ones, else the most recently saved. The item then also
   * lists every saved version (`favoriteStoryIds`), so a client can unsave
   * the whole tale.
   */
  async getFavorites(
    userId: string,
    page: number = 1,
    limit: number = 20,
    options: { grouped?: boolean; prefer?: string } = {},
  ) {
    if (options.grouped) {
      return this.getGroupedFavorites(userId, page, limit, options.prefer);
    }

    const [favorites, total] = await Promise.all([
      this.prisma.favoriteStory.findMany({
        where: { userId },
        include: {
          story: true,
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.favoriteStory.count({
        where: { userId },
      }),
    ]);

    const groupInfo = await loadStoryGroupInfo(
      this.prisma,
      this.settings,
      favorites.map((fav) => fav.story),
    );
    const stories = await Promise.all(
      favorites.map(async (fav) => ({
        ...(await toStoryListItem(fav.story, this.storageService, true, {
          availableLanguages: groupInfo.get(fav.story.id)?.availableLanguages,
          sharedCoverImageUrl: groupInfo.get(fav.story.id)?.sharedCoverImageUrl,
          sharedCoverCredit: groupInfo.get(fav.story.id)?.sharedCoverCredit,
        })),
        favoritedAt: fav.createdAt,
      })),
    );

    return PaginationHelper.createPaginatedResponse(stories, total, page, limit);
  }

  private async getGroupedFavorites(
    userId: string,
    page: number,
    limit: number,
    prefer: string | undefined,
  ) {
    const { enabled, defaultLanguage } = resolveContentLanguages(this.settings);
    const preferred = await this.resolvePreferredLanguage(userId, prefer, enabled, defaultLanguage);

    // The favourites of one user are few: all of them are read (ids only)
    // to group them, then the stories of the requested page are loaded.
    const all = await this.prisma.favoriteStory.findMany({
      where: { userId },
      select: {
        storyId: true,
        createdAt: true,
        story: { select: { id: true, language: true, translationGroupId: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const tales = new Map<string, typeof all>();
    for (const favorite of all) {
      const key = groupKeyOf(favorite.story);
      const saved = tales.get(key);
      if (saved) saved.push(favorite);
      else tales.set(key, [favorite]);
    }

    // Newest first by the most recent save of the tale (insertion order).
    const groups = [...tales.values()];
    const pageGroups = groups.slice((page - 1) * limit, page * limit);
    const shown = pageGroups.map(
      (saved) => saved.find((favorite) => favorite.story.language === preferred) ?? saved[0],
    );

    const stories =
      shown.length > 0
        ? await this.prisma.story.findMany({
            where: { id: { in: shown.map((favorite) => favorite.storyId) } },
          })
        : [];
    const storyById = new Map(stories.map((story) => [story.id, story]));
    const groupInfo = await loadStoryGroupInfo(this.prisma, this.settings, stories);

    const items: Array<Record<string, unknown>> = [];
    for (const [index, favorite] of shown.entries()) {
      const story = storyById.get(favorite.storyId);
      if (!story) continue; // deleted between the two reads
      const saved = pageGroups[index];
      items.push({
        ...(await toStoryListItem(story, this.storageService, true, {
          availableLanguages: groupInfo.get(story.id)?.availableLanguages,
          sharedCoverImageUrl: groupInfo.get(story.id)?.sharedCoverImageUrl,
          sharedCoverCredit: groupInfo.get(story.id)?.sharedCoverCredit,
        })),
        favoritedAt: saved[0].createdAt,
        favoriteStoryIds: saved.map((entry) => entry.storyId),
        favoriteLanguages: saved.map((entry) => entry.story.language),
      });
    }

    return PaginationHelper.createPaginatedResponse(items, groups.length, page, limit);
  }
}
