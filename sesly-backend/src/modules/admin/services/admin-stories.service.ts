import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { StorageService } from '@modules/storage/storage.service';
import { AudioService } from '@modules/audio/audio.service';
import {
  LlmPreprocessingService,
  LlmContentDriftError,
} from '@modules/llm-preprocessing/llm-preprocessing.service';
import { CreateStoryDto } from '../dto/create-story.dto';
import { UpdateStoryDto } from '../dto/update-story.dto';
import { Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { extractStorageKey } from '../../../common/utils/storage-key';
import { findFreeSlug, slugify } from '../../../common/utils/slug';
import {
  CONTENT_LANGUAGES,
  CONTENT_LANGUAGE_CODES,
  DEFAULT_CONTENT_LANGUAGE,
  estimateDurationMinutes,
} from '../../../common/constants/content-languages';
import {
  AgeGroup,
  AgeGroupSource,
  LanguageLevelSource,
  StoryStatus,
} from '../../../common/enums/prisma.enums';
import {
  AGE_GROUP_LABELS,
  AGE_GROUP_SOURCE_LABELS,
  LANGUAGE_LEVEL_LABELS,
  LANGUAGE_LEVEL_SOURCE_LABELS,
  STORY_CATEGORY_LABELS,
  STORY_LLM_TASK_STATUS_LABELS,
  STORY_LLM_TASK_TYPE_LABELS,
  STORY_ORIGIN_LABELS,
  STORY_RIGHTS_BASIS_LABELS,
  STORY_SORT_LABELS,
  STORY_STATUS_LABELS,
  STORY_TEXT_FIDELITY_LABELS,
  TRANSLATION_METHOD_LABELS,
  toEnumOptions,
} from '../../../common/constants/story-labels';
import { SettingsService } from '@modules/settings/settings.service';
import { CONTENT_WARNING_LABELS } from '../../../common/constants/content-warnings';
import { StoryLlmTasksService } from '@modules/story-llm/story-llm-tasks.service';
import { splitStoryIntoChunks } from '../../../common/utils/story-chunks';
import { resolveContentLanguages } from '@modules/stories/content-language';
import { storyOrderBy } from '@modules/stories/story-query.util';
import { loadTaleStoryIds } from '@modules/stories/story-covers';
import { CoverCredit, normalizeCoverCredit } from '@modules/stories/cover-credit';
import {
  CC_BY_REQUIRED_FIELDS,
  RIGHTS_REQUIRED_ORIGINS,
  assertStoryPublishable,
} from '@modules/stories/story-publish.rules';
import { AdminStoriesQueryDto } from '../dto/admin-stories-query.dto';
import {
  TranslationRequestSummary,
  TranslationRequestsService,
} from '@modules/translation-requests/translation-requests.service';

/** Age band stored until the model (or an admin) decides. */
export const AGE_GROUP_PLACEHOLDER = AgeGroup.THREE_TO_SIX;

const NO_TRANSLATION_REQUESTS: TranslationRequestSummary = { total: 0, languages: [] };

const STORY_NOT_FOUND = 'Story not found';

/** DTO fields createStory / updateStory resolve themselves (not copied one to one). */
const HANDLED_SEPARATELY = new Set([
  'content',
  'coverImageUrl',
  'translatedFromId',
  'slug',
  'applyCoverToTale',
  'coverCredit',
]);

/** Largest cover file accepted (POST /admin/stories/:id/cover). */
export const COVER_MAX_BYTES = 10 * 1024 * 1024;

export interface SetCoverOptions {
  /** Raw credit (JSON text or object, cover-credit.ts); absent or blank: none. */
  coverCredit?: unknown;
  /** Write the cover to every story of the tale. Default true. */
  applyCoverToTale?: boolean;
}

export interface StoryTranslationSibling {
  id: string;
  language: string;
  title: string;
  status: string;
}

interface TranslationInfo {
  /** The other stories of the translation group. */
  translations: StoryTranslationSibling[];
  /** Every language of the group including the story's own, in catalogue order. */
  groupLanguages: string[];
}

/** What the translation group rules need to know about a story. */
interface TranslationMember {
  id: string;
  language: string;
  title: string;
  translationGroupId: string | null;
}

const TRANSLATION_MEMBER_SELECT = {
  id: true,
  language: true,
  title: true,
  translationGroupId: true,
} as const;

@Injectable()
export class AdminStoriesService {
  private readonly logger = new Logger(AdminStoriesService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private audioService: AudioService,
    private llmPreprocessing: LlmPreprocessingService,
    private settings: SettingsService,
    private storyLlmTasks: StoryLlmTasksService,
    private translationRequests: TranslationRequestsService,
  ) { }

  /**
   * GET /admin/stories. Every filter is optional. Each row also carries the
   * languages present in its translation group (`groupLanguages`), the
   * sibling stories (`translations`) and the open translation requests of
   * users for the tale (`translationRequests`).
   */
  async getAllStories(query: AdminStoriesQueryDto = {}) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;
    const where = await this.buildAdminWhere(query);

    const [stories, total] = await Promise.all([
      this.prisma.story.findMany({
        where,
        skip,
        take: limit,
        orderBy: storyOrderBy(query.sort),
        // A page holds up to 200 rows: the text and the segments (which
        // repeat it) stay out of the list; GET /admin/stories/:id has them.
        omit: { content: true, preprocessedSegments: true },
        include: {
          _count: {
            select: {
              chunks: true,
              userProgress: true,
              favoritedBy: true,
            },
          },
        },
      }),
      this.prisma.story.count({ where }),
    ]);

    const [translationInfo, requests] = await Promise.all([
      this.loadTranslationInfo(stories),
      this.translationRequests.summaryForStories(stories),
    ]);

    const storiesWithPresignedUrls = await Promise.all(
      stories.map(async (story) => ({
        ...story,
        coverImageUrl: await this.getPresignedCoverImageUrl(story),
        ...translationInfo.get(story.id)!,
        translationRequests: requests.get(story.id) ?? NO_TRANSLATION_REQUESTS,
      })),
    );

    return {
      data: storiesWithPresignedUrls,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getStoryById(storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      include: {
        chunks: {
          orderBy: { chunkIndex: 'asc' },
        },
        _count: {
          select: {
            userProgress: true,
            favoritedBy: true,
          },
        },
      },
    });

    if (!story) {
      throw new NotFoundException(STORY_NOT_FOUND);
    }

    const [translationInfo, requests] = await Promise.all([
      this.loadTranslationInfo([story]),
      this.translationRequests.summaryForStories([story]),
    ]);

    return {
      ...story,
      coverImageUrl: await this.getPresignedCoverImageUrl(story),
      ...translationInfo.get(story.id)!,
      translationRequests: requests.get(story.id) ?? NO_TRANSLATION_REQUESTS,
    };
  }

  /**
   * GET /admin/stories/meta: the language list and every story enum with its
   * Turkish label, so the admin panel keeps no hardcoded copy.
   */
  getStoriesMeta() {
    const { enabled, defaultLanguage } = resolveContentLanguages(this.settings);
    return {
      languages: {
        all: CONTENT_LANGUAGES.map((l) => ({
          code: l.code,
          nativeName: l.nativeName,
          englishName: l.englishName,
          wordsPerMinute: l.wordsPerMinute,
          enabled: enabled.includes(l.code),
        })),
        enabled,
        default: defaultLanguage,
      },
      enums: {
        status: toEnumOptions(STORY_STATUS_LABELS),
        origin: toEnumOptions(STORY_ORIGIN_LABELS),
        textFidelity: toEnumOptions(STORY_TEXT_FIDELITY_LABELS),
        rightsBasis: toEnumOptions(STORY_RIGHTS_BASIS_LABELS),
        languageLevel: toEnumOptions(LANGUAGE_LEVEL_LABELS),
        languageLevelSource: toEnumOptions(LANGUAGE_LEVEL_SOURCE_LABELS),
        translationMethod: toEnumOptions(TRANSLATION_METHOD_LABELS),
        category: toEnumOptions(STORY_CATEGORY_LABELS),
        ageGroup: toEnumOptions(AGE_GROUP_LABELS),
        contentWarning: toEnumOptions(CONTENT_WARNING_LABELS),
        ageGroupSource: toEnumOptions(AGE_GROUP_SOURCE_LABELS),
        llmTaskType: toEnumOptions(STORY_LLM_TASK_TYPE_LABELS),
        llmTaskStatus: toEnumOptions(STORY_LLM_TASK_STATUS_LABELS),
      },
      sorts: toEnumOptions(STORY_SORT_LABELS),
      publishRules: {
        // Needed by every story before it can be PUBLISHED.
        always: ['origin', 'textFidelity'],
        // Origins that additionally need rightsBasis, a source (sourceName or
        // sourceUrl) and a credit (authorName or collectorName; a folk tale
        // needs no name).
        rightsRequiredOrigins: [...RIGHTS_REQUIRED_ORIGINS],
        // rightsBasis CC_BY additionally needs these (whatever the origin).
        ccByRequires: [...CC_BY_REQUIRED_FIELDS],
      },
    };
  }

  // ---------------------------------------------------------------------
  // List filters and translation info
  // ---------------------------------------------------------------------

  /**
   * Prisma filter of the admin story list (also used by the review list and
   * the bulk actions). Every filter is optional.
   */
  async buildAdminWhere(query: AdminStoriesQueryDto): Promise<any> {
    const where: any = {};
    if (query.language) where.language = query.language;
    if (query.status) where.status = query.status;
    if (query.languageLevel && query.languageLevel.length > 0) {
      where.languageLevel = { in: query.languageLevel };
    }
    if (query.category) where.category = query.category;
    if (query.ageGroup) where.ageGroup = query.ageGroup;
    if (query.origin) where.origin = query.origin;
    if (query.imported !== undefined) {
      where.importedAt = query.imported ? { not: null } : null;
    }
    if (query.importBatch) where.importBatch = query.importBatch;
    if (query.reviewed !== undefined) {
      where.reviewedAt = query.reviewed ? { not: null } : null;
    }
    if (query.createdFrom || query.createdTo) {
      where.createdAt = {
        ...(query.createdFrom ? { gte: new Date(`${query.createdFrom}T00:00:00.000Z`) } : {}),
        // The whole last day counts.
        ...(query.createdTo
          ? { lt: new Date(new Date(`${query.createdTo}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000) }
          : {}),
      };
    }

    const and: any[] = [];

    const term = query.q?.trim();
    if (term) {
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { content: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (query.missingLanguage) {
      // Stories that are not in that language themselves and whose group
      // (if any) has no story in it. A group is a shared column value, not
      // a relation, so the groups that do have the language are read first.
      const covered = await this.prisma.story.findMany({
        where: { language: query.missingLanguage, translationGroupId: { not: null } },
        select: { translationGroupId: true },
      });
      const coveredGroups = covered.map((s) => s.translationGroupId as string);
      and.push({ language: { not: query.missingLanguage } });
      if (coveredGroups.length > 0) {
        and.push({
          OR: [{ translationGroupId: null }, { translationGroupId: { notIn: coveredGroups } }],
        });
      }
    }

    if (and.length > 0) where.AND = and;
    return where;
  }

  private async loadTranslationInfo(
    stories: Array<{ id: string; language: string; translationGroupId?: string | null }>,
  ): Promise<Map<string, TranslationInfo>> {
    const groupIds = [
      ...new Set(stories.map((s) => s.translationGroupId).filter(Boolean) as string[]),
    ];
    const members =
      groupIds.length > 0
        ? await this.prisma.story.findMany({
            where: { translationGroupId: { in: groupIds } },
            select: { id: true, language: true, title: true, status: true, translationGroupId: true },
          })
        : [];

    const order = (code: string) => {
      const index = CONTENT_LANGUAGE_CODES.indexOf(code);
      return index === -1 ? CONTENT_LANGUAGE_CODES.length : index;
    };

    const info = new Map<string, TranslationInfo>();
    for (const story of stories) {
      const siblings = story.translationGroupId
        ? members
            .filter((m) => m.translationGroupId === story.translationGroupId && m.id !== story.id)
            .sort((a, b) => order(a.language) - order(b.language))
        : [];
      const languages = [...new Set([story.language, ...siblings.map((m) => m.language)])].sort(
        (a, b) => order(a) - order(b),
      );
      info.set(story.id, {
        translations: siblings.map((m) => ({
          id: m.id,
          language: m.language,
          title: m.title,
          status: m.status,
        })),
        groupLanguages: languages,
      });
    }
    return info;
  }

  // ---------------------------------------------------------------------
  // Create / update helpers
  // ---------------------------------------------------------------------

  /**
   * DTO fields that map one to one onto columns. Undefined keys are left
   * out (not sent means "do not touch"); null clears a nullable column.
   */
  private toStoryData(dto: Partial<CreateStoryDto>): Record<string, any> {
    const { sourceRetrievedAt, rightsVerifiedAt, languageLevel, ageGroup, ...rest } = dto;

    const data: Record<string, any> = {};
    for (const [key, value] of Object.entries(rest)) {
      if (value !== undefined && !HANDLED_SEPARATELY.has(key)) data[key] = value;
    }
    if (sourceRetrievedAt !== undefined) {
      data.sourceRetrievedAt = sourceRetrievedAt ? new Date(sourceRetrievedAt) : null;
    }
    if (rightsVerifiedAt !== undefined) {
      data.rightsVerifiedAt = rightsVerifiedAt ? new Date(rightsVerifiedAt) : null;
    }
    // A level set by hand is a MANUAL assessment made now; clearing it
    // clears the assessment.
    if (languageLevel !== undefined) {
      data.languageLevel = languageLevel;
      data.languageLevelSource = languageLevel ? LanguageLevelSource.MANUAL : null;
      data.languageLevelAssessedAt = languageLevel ? new Date() : null;
    }
    // An age group sent by the admin is a MANUAL choice made now; the note
    // of an earlier AI assessment no longer describes it.
    if (ageGroup !== undefined) {
      data.ageGroup = ageGroup;
      data.ageGroupSource = AgeGroupSource.MANUAL;
      data.ageGroupAssessedAt = new Date();
      data.ageGroupNote = null;
    }
    return data;
  }

  private async isSlugTaken(slug: string, language: string, exceptId?: string): Promise<boolean> {
    const hit = await this.prisma.story.findFirst({
      where: { slug, language, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
      select: { id: true },
    });
    return !!hit;
  }

  /**
   * Slug of a story: the one the admin typed (409 when taken in that
   * language), else the current one if it is still free, else one generated
   * from the title ("-2", "-3" appended until free).
   */
  private async resolveSlug(input: {
    requested?: string | null;
    current?: string | null;
    title: string;
    language: string;
    exceptId?: string;
  }): Promise<string> {
    const { requested, current, title, language, exceptId } = input;
    if (requested) {
      if (await this.isSlugTaken(requested, language, exceptId)) {
        throw new ConflictException({
          code: 'STORY_SLUG_TAKEN',
          message: `"${requested}" kısa adı "${language}" dilinde başka bir masalda kullanılıyor.`,
        });
      }
      return requested;
    }
    const base = current || slugify(title);
    return findFreeSlug(base, (candidate) => this.isSlugTaken(candidate, language, exceptId));
  }

  /**
   * Group a story must join when it is declared a translation of
   * `sourceId`. Rejects a source in the same language and any result that
   * would put two stories of one language in a group.
   *
   * `self` is the story being updated (absent on create), with the language
   * and title it will have after the update. A story that already has a
   * group never leaves it: an ungrouped source is pulled into that group,
   * and a source in another group merges the two groups (the same rule as
   * the link-translation endpoint).
   */
  private async joinTranslationGroupOf(
    sourceId: string,
    language: string,
    self?: TranslationMember,
  ): Promise<string> {
    if (self && sourceId === self.id) {
      throw new BadRequestException({
        code: 'TRANSLATION_SELF',
        message: 'Bir masal kendisinin çevirisi olamaz.',
      });
    }
    const source = await this.prisma.story.findUnique({
      where: { id: sourceId },
      select: TRANSLATION_MEMBER_SELECT,
    });
    if (!source) {
      throw new NotFoundException('Çevirinin kaynağı olan masal bulunamadı.');
    }
    if (source.language === language) {
      throw new BadRequestException({
        code: 'TRANSLATION_SAME_LANGUAGE',
        message: 'Bir masal kendi dilindeki bir masalın çevirisi olamaz.',
      });
    }

    const ownGroupId = self?.translationGroupId ?? null;

    if (!source.translationGroupId) {
      // The story keeps its group and the source joins it; without one a
      // new group is started on the source.
      if (ownGroupId) {
        await this.assertLanguageFreeInGroup(ownGroupId, source.language, source.id);
      }
      const groupId = ownGroupId ?? uuidv4();
      await this.prisma.story.update({
        where: { id: source.id },
        data: { translationGroupId: groupId },
      });
      return groupId;
    }

    if (self?.translationGroupId && self.translationGroupId !== source.translationGroupId) {
      return this.mergeTranslationGroups(self, source);
    }

    await this.assertLanguageFreeInGroup(source.translationGroupId, language, self?.id);
    return source.translationGroupId;
  }

  /**
   * Puts two stories and every member of the groups they already belong to
   * into one group (the first story's group when it has one). Nothing is
   * written when the result would hold two stories of one language.
   * `story` and `other` win over their stored rows, so a caller can pass
   * the language a story is about to get.
   */
  private async mergeTranslationGroups(
    story: TranslationMember,
    other: TranslationMember,
  ): Promise<string> {
    const groupIds = [story.translationGroupId, other.translationGroupId].filter(Boolean) as string[];
    const grouped: TranslationMember[] =
      groupIds.length > 0
        ? await this.prisma.story.findMany({
            where: { translationGroupId: { in: groupIds } },
            select: TRANSLATION_MEMBER_SELECT,
          })
        : [];
    const members = new Map<string, TranslationMember>();
    for (const member of [story, other, ...grouped]) {
      if (!members.has(member.id)) members.set(member.id, member);
    }

    const byLanguage = new Map<string, TranslationMember>();
    for (const member of members.values()) {
      const clash = byLanguage.get(member.language);
      if (clash) {
        throw new BadRequestException({
          code: 'TRANSLATION_LANGUAGE_TAKEN',
          message:
            `Bu iki masal bağlanamaz: grupta "${member.language}" dilinde iki masal olurdu ` +
            `(${clash.title}, ${member.title}).`,
          storyIds: [clash.id, member.id],
        });
      }
      byLanguage.set(member.language, member);
    }

    const target = story.translationGroupId ?? other.translationGroupId ?? uuidv4();
    await this.prisma.story.updateMany({
      where: { id: { in: [...members.keys()] } },
      data: { translationGroupId: target },
    });
    return target;
  }

  private async assertLanguageFreeInGroup(
    groupId: string,
    language: string,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.prisma.story.findFirst({
      where: {
        translationGroupId: groupId,
        language,
        ...(exceptId ? { NOT: { id: exceptId } } : {}),
      },
      select: { id: true, title: true },
    });
    if (clash) {
      throw new BadRequestException({
        code: 'TRANSLATION_LANGUAGE_TAKEN',
        message: `Bu çeviri grubunda "${language}" dilinde zaten bir masal var: ${clash.title}.`,
        storyId: clash.id,
      });
    }
  }

  // ---------------------------------------------------------------------
  // Translation groups (managed by hand)
  // ---------------------------------------------------------------------

  /**
   * POST /admin/stories/:id/link-translation. Puts both stories (and the
   * groups they already belong to) into one translation group. A group
   * holds at most one story per language.
   */
  async linkTranslation(storyId: string, otherStoryId: string) {
    if (storyId === otherStoryId) {
      throw new BadRequestException({
        code: 'TRANSLATION_SELF',
        message: 'Bir masal kendisiyle eşleştirilemez.',
      });
    }

    const select = TRANSLATION_MEMBER_SELECT;
    const [story, other] = await Promise.all([
      this.prisma.story.findUnique({ where: { id: storyId }, select }),
      this.prisma.story.findUnique({ where: { id: otherStoryId }, select }),
    ]);
    if (!story || !other) {
      throw new NotFoundException(STORY_NOT_FOUND);
    }
    if (story.language === other.language) {
      throw new BadRequestException({
        code: 'TRANSLATION_SAME_LANGUAGE',
        message: 'Aynı dildeki iki masal birbirinin çevirisi olarak bağlanamaz.',
      });
    }
    // Already linked: nothing to do.
    if (story.translationGroupId && story.translationGroupId === other.translationGroupId) {
      return this.getStoryById(storyId);
    }

    const target = await this.mergeTranslationGroups(story, other);

    // A published story that joins a tale may be the version users asked for.
    void this.translationRequests.fulfilForStory(storyId);
    void this.translationRequests.fulfilForStory(otherStoryId);

    this.logger.log(`Translation group ${target}: linked ${storyId} and ${otherStoryId}`);
    return this.getStoryById(storyId);
  }

  /**
   * DELETE /admin/stories/:id/translation-link. Takes the story out of its
   * translation group. A group left with a single story is dissolved.
   * Idempotent: a story without a group is returned unchanged.
   *
   * `translatedFromId` is kept on purpose: it records which text the
   * translation was made from, which stays true after the stories are no
   * longer shown as siblings. updateStory only joins a group when that
   * field changes, so a later edit that re-sends it does not undo this.
   */
  async unlinkTranslation(storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, translationGroupId: true },
    });
    if (!story) {
      throw new NotFoundException(STORY_NOT_FOUND);
    }
    if (!story.translationGroupId) {
      return this.getStoryById(storyId);
    }

    await this.prisma.story.update({
      where: { id: storyId },
      data: { translationGroupId: null },
    });

    const remaining = await this.prisma.story.findMany({
      where: { translationGroupId: story.translationGroupId },
      select: { id: true },
    });
    if (remaining.length === 1) {
      await this.prisma.story.update({
        where: { id: remaining[0].id },
        data: { translationGroupId: null },
      });
    }

    this.logger.log(`Story ${storyId} removed from translation group ${story.translationGroupId}`);
    return this.getStoryById(storyId);
  }

  /**
   * `adminLabel` (the acting admin's email or id) is recorded as
   * rightsVerifiedBy when the rights are marked verified without a name.
   */
  async createStory(
    createStoryDto: CreateStoryDto,
    coverImage: Express.Multer.File,
    adminLabel?: string | null,
  ) {
    const { content, coverImageUrl: dtoCoverImageUrl } = createStoryDto;
    const storyData = this.toStoryData(createStoryDto);
    // Checked before anything is written; it goes with an uploaded cover.
    const coverCredit = coverImage ? normalizeCoverCredit(createStoryDto.coverCredit) : null;
    const language: string = storyData.language || DEFAULT_CONTENT_LANGUAGE;
    // A new story is a draft unless the admin publishes it explicitly.
    const status: string = storyData.status || StoryStatus.DRAFT;

    if (storyData.rightsVerifiedAt && !storyData.rightsVerifiedBy && adminLabel) {
      storyData.rightsVerifiedBy = adminLabel;
    }
    if (status === StoryStatus.PUBLISHED) {
      assertStoryPublishable(storyData);
      storyData.publishedAt = new Date();
    }

    const slug = await this.resolveSlug({
      requested: createStoryDto.slug,
      title: createStoryDto.title,
      language,
    });
    if (createStoryDto.translatedFromId) {
      storyData.translatedFromId = createStoryDto.translatedFromId;
      storyData.translationGroupId = await this.joinTranslationGroupOf(
        createStoryDto.translatedFromId,
        language,
      );
    }

    // An uploaded file wins; otherwise a cover URL sent in the DTO is stored.
    let coverImageUrl: string | undefined =
      dtoCoverImageUrl !== undefined ? this.normalizeCoverUrl(dtoCoverImageUrl) ?? undefined : undefined;

    if (coverImage) {
      coverImageUrl = await this.uploadCoverFile(coverImage);
    }

    // Auto-calculate duration from content if not provided by admin
    // (words-per-minute table per language).
    const estimatedDuration =
      storyData.estimatedDuration ?? estimateDurationMinutes(content, language);

    // No age group chosen: a placeholder is stored (the column is required)
    // and the model proposes one in the background.
    const ageGroup = storyData.ageGroup ?? AGE_GROUP_PLACEHOLDER;

    // Cast to any: the DTO's const-object enums are structurally identical
    // to the Prisma enums but are distinct nominal types to the compiler.
    const story = await this.prisma.story.create({
      data: {
        ...storyData,
        ageGroup,
        estimatedDuration,
        content,
        coverImageUrl,
        ...(coverCredit ? { coverCredit } : {}),
        language,
        status,
        slug,
        isPremium: storyData.isPremium || false,
      } as any,
    });
    if (coverImage && coverImageUrl && createStoryDto.applyCoverToTale === true) {
      await this.applyCoverToTale(story, coverImageUrl, coverCredit);
    }

    const chunks = this.splitIntoChunks(content);

    await Promise.all(
      chunks.map((chunkContent, index) =>
        this.prisma.storyChunk.create({
          data: {
            storyId: story.id,
            chunkIndex: index,
            content: chunkContent,
          },
        }),
      ),
    );

    this.logger.log(`Story created: ${story.id} with ${chunks.length} chunks`);

    // A level typed by the admin is a MANUAL decision; otherwise the model
    // tags the new text in the background. Not awaited and never throws.
    if (!story.languageLevel) {
      void this.storyLlmTasks.triggerAutoAssess(story.id, 'story created');
    }
    // Same for the age group, unless the admin chose one.
    if (storyData.ageGroupSource !== AgeGroupSource.MANUAL) {
      void this.storyLlmTasks.triggerAutoAssessAgeGroup(story.id, 'story created', { newStory: true });
    }
    if (status === StoryStatus.PUBLISHED) {
      void this.translationRequests.fulfilForStory(story.id);
    }

    return this.getStoryById(story.id);
  }

  async updateStory(
    storyId: string,
    updateStoryDto: UpdateStoryDto,
    coverImage: Express.Multer.File,
    adminLabel?: string | null,
  ) {
    // Use prisma directly to get the raw URL, not the presigned one
    const existingStory = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!existingStory) {
      throw new NotFoundException(STORY_NOT_FOUND);
    }

    const { content, coverImageUrl: dtoCoverImageUrl } = updateStoryDto;
    const storyData = this.toStoryData(updateStoryDto);
    // Checked before anything is written. With a new cover file the credit
    // goes with it (none when absent); without one it replaces the credit
    // of the current cover.
    const creditSent = updateStoryDto.coverCredit !== undefined;
    const coverCredit = coverImage || creditSent ? normalizeCoverCredit(updateStoryDto.coverCredit) : null;
    // The row as it will be after this update: rules are checked against it.
    const merged: Record<string, any> = { ...existingStory, ...storyData };
    const language: string = merged.language;
    const languageChanged = language !== existingStory.language;

    if (storyData.rightsVerifiedAt && !merged.rightsVerifiedBy && adminLabel) {
      storyData.rightsVerifiedBy = adminLabel;
    }

    // The admin form sends every field on each save. A level equal to the
    // stored one is not a new assessment: its source (AI or MANUAL) and its
    // assessment time stay as they are.
    if (
      updateStoryDto.languageLevel !== undefined &&
      (updateStoryDto.languageLevel ?? null) === (existingStory.languageLevel ?? null)
    ) {
      delete storyData.languageLevel;
      delete storyData.languageLevelSource;
      delete storyData.languageLevelAssessedAt;
    }
    // Same rule for the age group: re-sending the stored value keeps its
    // source (AI or MANUAL), note and assessment time.
    if (updateStoryDto.ageGroup !== undefined && updateStoryDto.ageGroup === existingStory.ageGroup) {
      delete storyData.ageGroup;
      delete storyData.ageGroupSource;
      delete storyData.ageGroupAssessedAt;
      delete storyData.ageGroupNote;
    }

    // Translation group. A language change must not collide inside the
    // current group. The group is only touched when translatedFromId
    // changes: re-sending the stored value (a full form save) is a no-op,
    // so a story taken out of its group by hand stays out.
    if (languageChanged && existingStory.translationGroupId) {
      await this.assertLanguageFreeInGroup(existingStory.translationGroupId, language, storyId);
    }
    const requestedSource = updateStoryDto.translatedFromId;
    if (
      requestedSource !== undefined &&
      (requestedSource ?? null) !== (existingStory.translatedFromId ?? null)
    ) {
      storyData.translatedFromId = requestedSource ?? null;
      // Clearing the source leaves the group alone (unlink endpoint).
      if (requestedSource) {
        storyData.translationGroupId = await this.joinTranslationGroupOf(requestedSource, language, {
          id: storyId,
          language,
          title: merged.title,
          translationGroupId: existingStory.translationGroupId,
        });
      }
    }

    if (updateStoryDto.slug || !existingStory.slug || languageChanged) {
      storyData.slug = await this.resolveSlug({
        requested: updateStoryDto.slug,
        current: existingStory.slug,
        title: merged.title,
        language,
        exceptId: storyId,
      });
    }

    if (merged.status === StoryStatus.PUBLISHED) {
      assertStoryPublishable(merged);
      if (!existingStory.publishedAt) storyData.publishedAt = new Date();
    }

    let coverImageUrl: string | null = existingStory.coverImageUrl;

    // A cover URL in the DTO (no file) replaces the stored one; blank clears it.
    // The previous object is not deleted here: the admin may be re-sending the
    // same cover, and a replaced one shows up in the storage orphan scan.
    if (dtoCoverImageUrl !== undefined && !coverImage) {
      coverImageUrl = this.normalizeCoverUrl(dtoCoverImageUrl);
    }

    if (coverImage) {
      coverImageUrl = await this.uploadCoverFile(coverImage);
    }

    // The duration follows the text and the language (words per minute
    // differ per language) unless an explicit override is sent.
    const updateData: any = { ...storyData, coverImageUrl };
    if (coverImage || creditSent) updateData.coverCredit = coverCredit ?? Prisma.JsonNull;
    if ((content || languageChanged) && !storyData.estimatedDuration) {
      updateData.estimatedDuration = estimateDurationMinutes(
        content || existingStory.content,
        language,
      );
    }

    // Content drift invalidates preprocessedSegments — they were authored
    // against the old text. Admin re-runs "Otomatik Böl" + edits afterward.
    if (content && content !== existingStory.content) {
      updateData.preprocessedSegments = Prisma.JsonNull;
      updateData.preprocessedAt = null;
      updateData.preprocessedModel = null;
    }

    const story = await this.prisma.story.update({
      where: { id: storyId },
      data: updateData,
    });

    if (coverImage && coverImageUrl) {
      // The new cover replaces the old one; the old object is removed only
      // when no story (of this tale or any other) still shows it.
      const replaced = new Set<string>(existingStory.coverImageUrl ? [existingStory.coverImageUrl] : []);
      if (updateStoryDto.applyCoverToTale === true) {
        for (const url of await this.applyCoverToTale(story, coverImageUrl, coverCredit)) replaced.add(url);
      }
      for (const url of replaced) {
        if (url !== coverImageUrl) await this.deleteCoverIfUnused(url);
      }
    } else if (creditSent && coverImageUrl) {
      // The credit belongs to the picture: every story showing it gets it.
      await this.prisma.story.updateMany({
        where: { coverImageUrl, id: { not: storyId } },
        data: { coverCredit: coverCredit ?? Prisma.JsonNull } as any,
      });
    }

    if (content) {
      await this.prisma.storyChunk.deleteMany({
        where: { storyId },
      });

      const chunks = this.splitIntoChunks(content);
      await Promise.all(
        chunks.map((chunkContent, index) =>
          this.prisma.storyChunk.create({
            data: {
              storyId: story.id,
              chunkIndex: index,
              content: chunkContent,
            },
          }),
        ),
      );

      await this.prisma.story.update({
        where: { id: storyId },
        data: { content },
      });

      this.logger.log(
        `Story updated: ${storyId} with ${chunks.length} new chunks`,
      );

      // A changed text (or a text moved to another language) needs a new
      // level. A MANUAL level is left alone by the trigger itself. Not
      // awaited and never throws.
      if (content !== existingStory.content || languageChanged) {
        void this.storyLlmTasks.triggerAutoAssess(storyId, 'content changed');
      }
      // The age band depends on the text, not on its language. The trigger
      // only re-assesses an age group the model decided: one an editor
      // chose (with or without a recorded source) is never replaced.
      if (content !== existingStory.content) {
        void this.storyLlmTasks.triggerAutoAssessAgeGroup(storyId, 'content changed');
      }
    } else {
      this.logger.log(`Story updated: ${storyId}`);
    }

    // Newly published, or published and moved to another language or tale:
    // users who asked for this version are told. Never throws.
    if (
      story.status === StoryStatus.PUBLISHED &&
      (existingStory.status !== StoryStatus.PUBLISHED ||
        languageChanged ||
        story.translationGroupId !== existingStory.translationGroupId)
    ) {
      void this.translationRequests.fulfilForStory(storyId);
    }

    return this.getStoryById(storyId);
  }

  async deleteStory(storyId: string) {
    // Use prisma directly to get the raw URL
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    // A cover shared with other stories of the tale stays for them.
    if (story.coverImageUrl) {
      await this.deleteCoverIfUnused(story.coverImageUrl, storyId);
    }

    // The shared ready-made voice audios of the story go with it (their
    // narrations cascade with the story; the FK on audio is SET NULL).
    const sharedAudios =
      (await this.prisma.audio.findMany({ where: { storyId, shared: true }, select: { id: true } })) ?? [];
    for (const audio of sharedAudios) {
      await this.audioService
        .adminDeleteAudio(audio.id)
        .catch((err) => this.logger.warn(`Shared audio ${audio.id} of story ${storyId} not removed: ${err?.message ?? err}`));
    }

    await this.prisma.story.delete({
      where: { id: storyId },
    });

    this.logger.log(`Story deleted: ${storyId}`);

    return { message: 'Story deleted successfully' };
  }

  /**
   * Preview how the current story content would be split into TTS segments
   * using the same paragraph-aware chunker the audio pipeline uses. Does NOT
   * persist anything — the admin can edit + save via PATCH /segments.
   */
  async previewSegments(storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const chunks = this.audioService.splitTextIntoSegments(story.content);

    return {
      storyId,
      defaultEmotion: story.defaultEmotion ?? null,
      defaultSpeed: story.defaultSpeed ?? null,
      cartesiaPronunciationDictId: story.cartesiaPronunciationDictId ?? null,
      segments: chunks.map((text) => ({ text })),
    };
  }

  /**
   * Run Gemini LLM preprocessing on the story content. Does NOT persist —
   * returns the proposed segments + warnings so the admin can review and
   * edit before saving via PATCH /segments.
   *
   * Raises 422 if the LLM tampered with the content (caller should fall
   * back to manual splitIntoChunks + manual emotion override).
   */
  async llmFillSegments(storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    try {
      const result = await this.llmPreprocessing.preprocessStory(story.content, story.language);
      this.logger.log(
        `LLM preprocess for ${storyId}: model=${result.modelUsed} ` +
        `segments=${result.segments.length} warnings=${result.warnings.length} ` +
        `duration=${result.durationMs}ms`,
      );
      return {
        storyId,
        modelUsed: result.modelUsed,
        durationMs: result.durationMs,
        usage: result.usage,
        warnings: result.warnings,
        segments: result.segments,
      };
    } catch (err) {
      if (err instanceof LlmContentDriftError) {
        this.logger.error(
          `LLM content drift for story ${storyId}: ${err.editDistance} chars off`,
        );
      }
      throw err;
    }
  }

  /**
   * Drop preprocessedSegments — generation falls back to splitIntoChunks +
   * Story.defaultEmotion/Speed (or env defaults) for every future audio.
   */
  async clearPreprocessedSegments(storyId: string) {
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    await this.prisma.story.update({
      where: { id: storyId },
      data: {
        preprocessedSegments: Prisma.JsonNull,
        preprocessedAt: null,
        preprocessedModel: null,
      },
    });

    this.logger.log(`Story ${storyId} preprocessedSegments cleared`);

    return this.getStoryById(storyId);
  }

  /**
   * POST /admin/stories/:id/cover: the quick cover upload of the story list,
   * the review view and the bulk cover upload. The picture (and its credit)
   * goes to the story and, unless `applyCoverToTale` is false, to every
   * story of the tale. Covers nothing shows any more are removed.
   */
  async setCover(storyId: string, file: Express.Multer.File | undefined, options: SetCoverOptions = {}) {
    if (!file?.buffer?.length) {
      throw new BadRequestException({ code: 'COVER_FILE_REQUIRED', message: 'Kapak resmi dosyası gönderilmedi.' });
    }
    if (!/^image\/(jpeg|png|webp)$/i.test(file.mimetype ?? '')) {
      throw new BadRequestException({
        code: 'COVER_FILE_TYPE',
        message: 'Kapak resmi JPEG, PNG ya da WebP olmalıdır.',
      });
    }
    if (file.buffer.length > COVER_MAX_BYTES) {
      throw new BadRequestException({
        code: 'COVER_FILE_TOO_LARGE',
        message: `Kapak resmi en fazla ${COVER_MAX_BYTES / (1024 * 1024)} MB olabilir.`,
      });
    }
    const coverCredit = normalizeCoverCredit(options.coverCredit);
    const story = await this.prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, coverImageUrl: true, translationGroupId: true, partGroupId: true },
    });
    if (!story) throw new NotFoundException(STORY_NOT_FOUND);

    const coverImageUrl = await this.uploadCoverFile(file);
    await this.prisma.story.update({
      where: { id: storyId },
      data: { coverImageUrl, coverCredit: coverCredit ?? Prisma.JsonNull } as any,
    });
    const replaced = new Set<string>(story.coverImageUrl ? [story.coverImageUrl] : []);
    let storyIds: string[] = [storyId];
    if (options.applyCoverToTale !== false) {
      storyIds = await loadTaleStoryIds(this.prisma, story);
      for (const url of await this.applyCoverToTale(story, coverImageUrl, coverCredit)) replaced.add(url);
    }
    for (const url of replaced) {
      if (url !== coverImageUrl) await this.deleteCoverIfUnused(url);
    }
    this.logger.log(`Cover of story ${storyId} replaced (${storyIds.length} stories)`);
    return {
      storyId,
      coverImageUrl: await this.getPresignedCoverImageUrl({ coverImageUrl }),
      coverCredit,
      storyIds,
      appliedTo: storyIds.length,
    };
  }

  private async uploadCoverFile(file: Express.Multer.File): Promise<string> {
    const key = `stories/cover/${uuidv4()}-${this.sanitizeFilename(file.originalname)}`;
    return this.storageService.uploadFile(file.buffer, key, file.mimetype);
  }

  /**
   * Writes `coverImageUrl` to every other story of the tale (all languages,
   * all parts: story-covers.ts loadTaleStoryIds). Returns the covers those
   * stories had before, so the caller can remove the ones nothing shows any more.
   */
  private async applyCoverToTale(
    story: { id: string; translationGroupId?: string | null; partGroupId?: string | null },
    coverImageUrl: string,
    coverCredit: CoverCredit | null = null,
  ): Promise<string[]> {
    const ids = (await loadTaleStoryIds(this.prisma, story)).filter((id) => id !== story.id);
    if (ids.length === 0) return [];
    const previous =
      (await this.prisma.story.findMany({
        where: { id: { in: ids }, coverImageUrl: { not: null } },
        select: { coverImageUrl: true },
      })) ?? [];
    await this.prisma.story.updateMany({
      where: { id: { in: ids } },
      data: { coverImageUrl, coverCredit: coverCredit ?? Prisma.JsonNull } as any,
    });
    this.logger.log(`Cover of story ${story.id} applied to ${ids.length} other stories of the tale`);
    return [...new Set(previous.map((p) => p.coverImageUrl as string))];
  }

  /** Deletes a cover object only when no story (but `exceptStoryId`) shows it. */
  private async deleteCoverIfUnused(coverImageUrl: string, exceptStoryId?: string): Promise<void> {
    const users = await this.prisma.story.count({
      where: { coverImageUrl, ...(exceptStoryId ? { id: { not: exceptStoryId } } : {}) },
    });
    if (users > 0) {
      this.logger.log(`Cover ${coverImageUrl} kept: ${users} other stories show it`);
      return;
    }
    await this.deleteCoverImage(coverImageUrl);
  }

  private async deleteCoverImage(coverImageUrl: string) {
    // Only our own objects are deleted; a pasted external cover URL is left alone.
    const key = this.ownStorageKey(coverImageUrl);
    if (!key) {
      return;
    }
    try {
      await this.storageService.deleteFile(key);
    } catch (error) {
      this.logger.warn(`Failed to delete cover image: ${coverImageUrl}`, error);
    }
  }

  async getPresignedCoverImageUrl(
    story: { coverImageUrl?: string | null },
  ): Promise<string | null> {
    if (!story.coverImageUrl) {
      return null;
    }
    const key = this.ownStorageKey(story.coverImageUrl);
    if (!key) {
      // External cover (admin-pasted CDN / foreign bucket): readable as is.
      return /^https?:\/\//i.test(story.coverImageUrl) ? story.coverImageUrl : null;
    }
    try {
      // Awaited so a rejected presign lands in this catch: one bad cover must
      // not fail the whole admin story list.
      return await this.storageService.generatePresignedUrl(key);
    } catch (error) {
      this.logger.warn(
        `Could not generate presigned URL for ${story.coverImageUrl}`,
        error,
      );
      return null;
    }
  }

  /**
   * Object key of a cover stored in OUR bucket, or null for anything else.
   * Handles bare keys, gs:// and both GCS URL styles, strips a stale
   * presign query string.
   */
  private ownStorageKey(url: string): string | null {
    return extractStorageKey(url, this.storageService.getBucketName?.());
  }

  /**
   * A cover URL typed/pasted by the admin: blank clears it; a presigned URL
   * of our bucket is stored without its (expiring) signature.
   */
  private normalizeCoverUrl(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (/[?&]X-Goog-(Signature|Expires|Credential)=/i.test(trimmed)) {
      return trimmed.split('?')[0];
    }
    return trimmed;
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  }

  /** Split text into chunks for story creation (shared with the translation job). */
  private splitIntoChunks(content: string): string[] {
    return splitStoryIntoChunks(content);
  }
}
