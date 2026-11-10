import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SettingsService } from '../settings/settings.service';
import { PaginationHelper } from '../../common/utils/pagination.helper';
import {
  localizedLanguageName,
  turkishLanguageName,
} from '../../common/constants/content-languages';
import { localizedError, serverText } from '../../common/i18n/server-text';
import { DEFAULT_UI_LANGUAGE, UiLanguage } from '../../common/i18n/ui-language';
import { resolveUserUiLanguages } from '../../common/i18n/user-ui-language';
import { StoryStatus } from '../../common/enums/prisma.enums';
import { resolveContentLanguages } from '../stories/content-language';
import {
  GROUP_CANDIDATE_SELECT,
  GroupCandidate,
  groupKeyOf,
  orderLanguages,
  pickGroupVersion,
} from '../stories/story-groups';

export const TRANSLATION_READY_TYPE = 'TRANSLATION_READY';

/** Title of the notification a requester gets, in the requester's UI language. */
export function translationReadyTitle(uiLanguage: UiLanguage = DEFAULT_UI_LANGUAGE): string {
  return serverText('notifications.translationReady.title', uiLanguage);
}

/** Body of the notification a requester gets when the version is published. */
export function translationReadyBody(
  storyTitle: string,
  language: string,
  uiLanguage: UiLanguage = DEFAULT_UI_LANGUAGE,
): string {
  return serverText('notifications.translationReady.body', uiLanguage, {
    storyTitle,
    language: localizedLanguageName(language),
  });
}

export type TranslationRequestStatus = 'pending' | 'fulfilled';

/** What the user endpoints answer with. */
export interface TranslationRequestState {
  storyId: string;
  language: string;
  /** Whether the caller has an open request for that language after the call. */
  requested: boolean;
  /** Every language the caller has an open request for on this tale, catalogue order. */
  requestedLanguages: string[];
}

export interface TranslationRequestSummary {
  /** Open requests on the tale, all languages. */
  total: number;
  /** Per language, most requested first. */
  languages: Array<{ language: string; count: number }>;
}

/** One row of GET /admin/stories/translation-requests. */
export interface TranslationRequestAggregate {
  /** Translation group id, or the story id for a story without a group. */
  groupKey: string;
  language: string;
  /** Turkish name of the requested language. */
  languageName: string;
  requestCount: number;
  latestRequestedAt: Date | null;
  /** The story a translation would be made from (null when the tale has no story in another language). */
  story: { id: string; title: string; language: string; status: string } | null;
  /** Languages the tale already has a story in (any status), catalogue order. */
  groupLanguages: string[];
  /** A story of the tale in the requested language that already exists (for example a draft awaiting review). */
  existingVersion: { id: string; title: string; status: string } | null;
}

interface StoryRef {
  id: string;
  title: string;
  language: string;
  status: string;
  translationGroupId: string | null;
}

const STORY_REF_SELECT = {
  id: true,
  title: true,
  language: true,
  status: true,
  translationGroupId: true,
} as const;

const STORY_NOT_FOUND = { code: 'STORY_NOT_FOUND', ...localizedError('errors.stories.notFound') };

/**
 * Translation requests from users. A request is stored on the story it was
 * made from and counts for that story's whole translation group: the group
 * is resolved through the story at read time, so linking, merging or
 * unlinking groups in the admin panel never orphans a request.
 */
@Injectable()
export class TranslationRequestsService {
  private readonly logger = new Logger(TranslationRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  // ---------------------------------------------------------------------
  // User side
  // ---------------------------------------------------------------------

  /** Requests on this story or on any other story of its translation group. */
  private taleFilter(story: { id: string; translationGroupId?: string | null }) {
    return story.translationGroupId
      ? { OR: [{ storyId: story.id }, { story: { translationGroupId: story.translationGroupId } }] }
      : { storyId: story.id };
  }

  /** A story a client can see: published or archived, never a draft. */
  private async loadVisibleStory(storyId: string): Promise<StoryRef> {
    const story = (await this.prisma.story.findUnique({
      where: { id: storyId },
      select: STORY_REF_SELECT,
    })) as StoryRef | null;
    if (!story || story.status === StoryStatus.DRAFT) {
      throw new NotFoundException(STORY_NOT_FOUND);
    }
    return story;
  }

  /** Languages the caller has an open request for on this tale. */
  async requestedLanguages(
    userId: string | null | undefined,
    story: { id: string; translationGroupId?: string | null },
  ): Promise<string[]> {
    if (!userId) return [];
    const rows = await this.prisma.storyTranslationRequest.findMany({
      where: { userId, fulfilledAt: null, ...this.taleFilter(story) },
      select: { language: true },
    });
    return orderLanguages(rows.map((r) => r.language));
  }

  /**
   * POST /stories/:id/translation-requests. Idempotent: asking again (from
   * this story or from another language version of the same tale) changes
   * nothing. 409 when the tale is already published in that language.
   */
  async request(userId: string, storyId: string, language: string): Promise<TranslationRequestState> {
    const story = await this.loadVisibleStory(storyId);

    const available =
      story.language === language
        ? story
        : story.translationGroupId
          ? await this.prisma.story.findFirst({
              where: {
                translationGroupId: story.translationGroupId,
                language,
                status: StoryStatus.PUBLISHED,
              },
              select: { id: true },
            })
          : null;
    if (available) {
      throw new ConflictException({
        code: 'TRANSLATION_ALREADY_AVAILABLE',
        ...localizedError('errors.translationRequests.alreadyAvailable', {
          language: localizedLanguageName(language),
        }),
        storyId: available.id,
      });
    }

    const open = await this.prisma.storyTranslationRequest.findFirst({
      where: { userId, language, fulfilledAt: null, ...this.taleFilter(story) },
      select: { id: true },
    });
    if (!open) {
      // The unique key is (user, story, language): a row that was fulfilled
      // earlier (the version was published and later withdrawn) is re-opened.
      await this.prisma.storyTranslationRequest.upsert({
        where: { userId_storyId_language: { userId, storyId: story.id, language } },
        create: { userId, storyId: story.id, language },
        update: { fulfilledAt: null, fulfilledStoryId: null, createdAt: new Date() },
      });
      this.logger.log(`Translation of story ${story.id} into ${language} requested`);
    }

    return {
      storyId: story.id,
      language,
      requested: true,
      requestedLanguages: await this.requestedLanguages(userId, story),
    };
  }

  /**
   * DELETE /stories/:id/translation-requests/:language. Idempotent:
   * withdrawing a request that does not exist is not an error. A fulfilled
   * request is history and stays.
   */
  async withdraw(userId: string, storyId: string, language: string): Promise<TranslationRequestState> {
    const story = await this.loadVisibleStory(storyId);
    await this.prisma.storyTranslationRequest.deleteMany({
      where: { userId, language, fulfilledAt: null, ...this.taleFilter(story) },
    });
    return {
      storyId: story.id,
      language,
      requested: false,
      requestedLanguages: await this.requestedLanguages(userId, story),
    };
  }

  // ---------------------------------------------------------------------
  // Fulfilment
  // ---------------------------------------------------------------------

  /**
   * Called after a story was published, or joined a translation group while
   * published: every open request for its language on its tale is marked
   * fulfilled (kept for statistics) and each requester gets one in-app
   * notification plus a push. Fire and forget: callers use `void`, it never
   * throws, and a request is claimed with a conditional write so two
   * concurrent calls cannot notify twice.
   */
  async fulfilForStory(storyId: string): Promise<void> {
    try {
      const story = (await this.prisma.story.findUnique({
        where: { id: storyId },
        select: STORY_REF_SELECT,
      })) as StoryRef | null;
      // A story without a group is a tale of its own: nobody can have asked
      // for it as a translation of something else.
      if (!story || story.status !== StoryStatus.PUBLISHED || !story.translationGroupId) return;

      const open = await this.prisma.storyTranslationRequest.findMany({
        where: {
          language: story.language,
          fulfilledAt: null,
          story: { translationGroupId: story.translationGroupId },
        },
        select: { id: true, userId: true, story: { select: { title: true } } },
        orderBy: { createdAt: 'asc' },
      });

      const languages = await resolveUserUiLanguages(
        this.prisma,
        open.map((request) => request.userId),
      );
      const notified = new Set<string>();
      for (const request of open) {
        const claimed = await this.prisma.storyTranslationRequest.updateMany({
          where: { id: request.id, fulfilledAt: null },
          data: { fulfilledAt: new Date(), fulfilledStoryId: story.id },
        });
        if (claimed.count !== 1 || notified.has(request.userId)) continue;
        notified.add(request.userId);
        try {
          await this.notifications.sendNotification(request.userId, {
            type: TRANSLATION_READY_TYPE,
            title: translationReadyTitle(languages.get(request.userId)),
            body: translationReadyBody(
              request.story.title,
              story.language,
              languages.get(request.userId),
            ),
            data: { storyId: story.id, language: story.language },
          });
        } catch (error) {
          this.logger.warn(
            `Translation-ready notification failed for request ${request.id}: ${(error as Error)?.message ?? error}`,
          );
        }
      }
      if (open.length > 0) {
        this.logger.log(
          `Story ${story.id} (${story.language}) fulfilled ${open.length} translation request(s), ${notified.size} user(s) notified`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Translation requests of story ${storyId} could not be fulfilled: ${(error as Error)?.message ?? error}`,
      );
    }
  }

  // ---------------------------------------------------------------------
  // Admin side
  // ---------------------------------------------------------------------

  /**
   * GET /admin/stories/translation-requests: requests aggregated by tale
   * and language, most requested first (then the most recent request).
   * `pending` (default) lists what is still wanted, `fulfilled` what was
   * delivered.
   */
  async listForAdmin(
    query: { page?: number; limit?: number; status?: TranslationRequestStatus; language?: string } = {},
  ) {
    const { page, limit } = PaginationHelper.normalizePaginationParams(query.page, query.limit);

    const rows: Array<{
      storyId: string;
      language: string;
      _count: { _all: number };
      _max: { createdAt: Date | null };
    }> = await (this.prisma.storyTranslationRequest.groupBy as any)({
      by: ['storyId', 'language'],
      where: {
        fulfilledAt: query.status === 'fulfilled' ? { not: null } : null,
        ...(query.language ? { language: query.language } : {}),
      },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    const sources = await this.loadStories({ id: { in: [...new Set(rows.map((r) => r.storyId))] } });
    const sourceById = new Map(sources.map((s) => [s.id, s]));

    const aggregates = new Map<
      string,
      { groupKey: string; language: string; requestCount: number; latestRequestedAt: Date | null }
    >();
    for (const row of rows) {
      const source = sourceById.get(row.storyId);
      // Requests cascade with their story; a row without one is a race with a delete.
      if (!source) continue;
      const groupKey = groupKeyOf(source);
      const key = `${groupKey}|${row.language}`;
      const entry = aggregates.get(key) ?? {
        groupKey,
        language: row.language,
        requestCount: 0,
        latestRequestedAt: null,
      };
      entry.requestCount += row._count._all;
      const latest = row._max.createdAt;
      if (latest && (!entry.latestRequestedAt || latest > entry.latestRequestedAt)) {
        entry.latestRequestedAt = latest;
      }
      aggregates.set(key, entry);
    }

    const sorted = [...aggregates.values()].sort(
      (a, b) =>
        b.requestCount - a.requestCount ||
        (b.latestRequestedAt?.getTime() ?? 0) - (a.latestRequestedAt?.getTime() ?? 0) ||
        a.groupKey.localeCompare(b.groupKey) ||
        a.language.localeCompare(b.language),
    );
    const pageRows = sorted.slice(PaginationHelper.calculateOffset(page, limit), page * limit);

    // Every story of the tales on this page: grouped ones by group id, the
    // others are their own tale.
    const keys = [...new Set(pageRows.map((r) => r.groupKey))];
    const members =
      keys.length > 0
        ? await this.loadStories({ OR: [{ translationGroupId: { in: keys } }, { id: { in: keys } }] })
        : [];
    const { defaultLanguage } = resolveContentLanguages(this.settings);

    const data: TranslationRequestAggregate[] = pageRows.map((row) => {
      const tale = members.filter((m) => groupKeyOf(m) === row.groupKey);
      const existing = tale.find((m) => m.language === row.language) ?? null;
      const candidates = tale.filter((m) => m.language !== row.language);
      // Translate from a published version when there is one.
      const published = candidates.filter((m) => m.status === StoryStatus.PUBLISHED);
      const pool = published.length > 0 ? published : candidates;
      const source =
        pool.length > 0
          ? pickGroupVersion(pool, { preferred: defaultLanguage, defaultLanguage })
          : null;
      return {
        groupKey: row.groupKey,
        language: row.language,
        languageName: turkishLanguageName(row.language),
        requestCount: row.requestCount,
        latestRequestedAt: row.latestRequestedAt,
        story: source
          ? { id: source.id, title: source.title, language: source.language, status: source.status }
          : null,
        groupLanguages: orderLanguages(tale.map((m) => m.language)),
        existingVersion: existing
          ? { id: existing.id, title: existing.title, status: existing.status }
          : null,
      };
    });

    return PaginationHelper.createPaginatedResponse(data, sorted.length, page, limit);
  }

  private async loadStories(where: Record<string, unknown>): Promise<Array<StoryRef & GroupCandidate>> {
    return (await this.prisma.story.findMany({
      where,
      select: { ...GROUP_CANDIDATE_SELECT, title: true, status: true },
    })) as Array<StoryRef & GroupCandidate>;
  }

  /**
   * Open requests per story of an admin list page, counted for the story's
   * whole tale. Stories nobody asked for are not in the map.
   */
  async summaryForStories(
    stories: Array<{ id: string; translationGroupId?: string | null }>,
  ): Promise<Map<string, TranslationRequestSummary>> {
    const summaries = new Map<string, TranslationRequestSummary>();
    if (stories.length === 0) return summaries;

    const groupIds = [
      ...new Set(stories.map((s) => s.translationGroupId).filter(Boolean) as string[]),
    ];
    const rows = await this.prisma.storyTranslationRequest.findMany({
      where: {
        fulfilledAt: null,
        OR: [
          { storyId: { in: stories.map((s) => s.id) } },
          ...(groupIds.length > 0 ? [{ story: { translationGroupId: { in: groupIds } } }] : []),
        ],
      },
      select: { storyId: true, language: true, story: { select: { translationGroupId: true } } },
    });

    const byTale = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const key = row.story.translationGroupId ?? row.storyId;
      const counts = byTale.get(key) ?? new Map<string, number>();
      counts.set(row.language, (counts.get(row.language) ?? 0) + 1);
      byTale.set(key, counts);
    }

    for (const story of stories) {
      const counts = byTale.get(groupKeyOf(story));
      if (!counts) continue;
      const languages = [...counts.entries()]
        .map(([language, count]) => ({ language, count }))
        .sort((a, b) => b.count - a.count || a.language.localeCompare(b.language));
      summaries.set(story.id, {
        total: languages.reduce((sum, entry) => sum + entry.count, 0),
        languages,
      });
    }
    return summaries;
  }
}
