import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { PaginationHelper } from '@common/utils/pagination.helper';
import { CreateCollectionDto } from './dto/create-collection.dto';
import { UpdateCollectionDto } from './dto/update-collection.dto';
import {
  AddStoriesDto,
  ReorderStoriesDto,
} from './dto/collection-stories.dto';
import { CollectionResponseDto } from './dto/collection-response.dto';
import { StorageService } from '@modules/storage/storage.service';
import { toStoryListItems } from '@modules/stories/story-list.mapper';
import { allMemberIds, loadStoryGroupInfo } from '@modules/stories/story-groups';
import { SettingsService } from '@modules/settings/settings.service';
import { resolveRequestedLanguage } from '@modules/stories/content-language';
import { DEFAULT_CONTENT_LANGUAGE } from '@common/constants/content-languages';
import { StoryStatus } from '@common/enums/prisma.enums';

type RawCollection = {
  id: string;
  slug: string;
  language: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  tone: 'ACCENT' | 'TRUST' | 'NATURE' | 'SUN';
  coverImageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  _count?: { stories: number };
};

@Injectable()
export class CollectionsService {
  private readonly logger = new Logger(CollectionsService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private settings: SettingsService,
  ) {}

  // ─────────────────────────────────────────────
  // Public (read-only)
  // ─────────────────────────────────────────────

  /**
   * What a client can see of a collection: published stories written in the
   * collection's own language. Used for the story list and for storyCount.
   */
  private visibleStoryFilter(language: string) {
    return { story: { status: StoryStatus.PUBLISHED, language } };
  }

  /**
   * List the active collections of one content language, sorted by
   * `sortOrder` then `createdAt`. Public endpoint, no auth required.
   * `language` is the explicit content language; app versions in the field
   * send none and get the default language. A language that is switched off
   * has no collections.
   */
  async list(language?: string): Promise<CollectionResponseDto[]> {
    const requested = resolveRequestedLanguage(this.settings, language);
    if (!requested.available) return [];

    const rows = await this.prisma.collection.findMany({
      where: { isActive: true, language: requested.language },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { stories: { where: this.visibleStoryFilter(requested.language) } } },
      },
    });

    return Promise.all(rows.map((r) => this.toResponseDto(r as RawCollection)));
  }

  async getBySlug(slug: string, language?: string): Promise<CollectionResponseDto> {
    const requested = resolveRequestedLanguage(this.settings, language);
    const row = requested.available
      ? await this.prisma.collection.findUnique({
          where: { slug_language: { slug, language: requested.language } },
          include: {
            _count: { select: { stories: { where: this.visibleStoryFilter(requested.language) } } },
          },
        })
      : null;

    if (!row || !row.isActive) {
      throw new NotFoundException(`Collection "${slug}" not found`);
    }

    return this.toResponseDto(row as RawCollection);
  }

  /**
   * Return the stories in a collection, paginated, ordered by `position` asc.
   *
   * Items use the same shape as GET /stories list items (no `content`,
   * presigned cover, `isPremium`, `isFavorite` for the optional caller)
   * plus the curator `position`.
   */
  async getStories(
    slug: string,
    page: number,
    limit: number,
    userId?: string,
    language?: string,
  ) {
    const requested = resolveRequestedLanguage(this.settings, language);
    const collection = requested.available
      ? await this.prisma.collection.findUnique({
          where: { slug_language: { slug, language: requested.language } },
          select: { id: true, isActive: true },
        })
      : null;

    if (!collection || !collection.isActive) {
      throw new NotFoundException(`Collection "${slug}" not found`);
    }

    const { page: p, limit: l } = PaginationHelper.normalizePaginationParams(
      page,
      limit,
    );
    const skip = PaginationHelper.calculateOffset(p, l);

    // Only published stories of the collection's language are listed.
    const where = {
      collectionId: collection.id,
      ...this.visibleStoryFilter(requested.language),
    };

    const [rows, total] = await Promise.all([
      this.prisma.storyOnCollection.findMany({
        where,
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: l,
        include: { story: true },
      }),
      this.prisma.storyOnCollection.count({ where }),
    ]);

    const groupInfo = await loadStoryGroupInfo(
      this.prisma,
      this.settings,
      rows.map((r) => r.story),
    );
    // Favourites on another language version count for isFavoriteAnyLanguage.
    const storyIds = allMemberIds(groupInfo);
    const favoriteIds = new Set<string>();
    if (userId && storyIds.length > 0) {
      const favorites = await this.prisma.favoriteStory.findMany({
        where: { userId, storyId: { in: storyIds } },
        select: { storyId: true },
      });
      favorites.forEach((f) => favoriteIds.add(f.storyId));
    }

    const items = await toStoryListItems(
      rows.map((r) => r.story),
      this.storageService,
      favoriteIds,
      groupInfo,
    );
    const stories = items.map((item, index) => ({ ...item, position: rows[index].position }));

    return PaginationHelper.createPaginatedResponse(stories, total, p, l);
  }

  // ─────────────────────────────────────────────
  // Admin (read)
  // ─────────────────────────────────────────────

  /**
   * GET /admin/collections: every collection INCLUDING inactive ones,
   * optionally filtered by title/slug/subtitle and by content language.
   * Flat PaginatedResponse. storyCount counts every attached story here
   * (drafts included), unlike the public endpoints.
   */
  async listAdmin(page: number, limit: number, search?: string, language?: string) {
    const { page: p, limit: l } = PaginationHelper.normalizePaginationParams(page, limit);
    const skip = PaginationHelper.calculateOffset(p, l);

    const term = search?.trim();
    const where = {
      ...(language ? { language } : {}),
      ...(term
        ? {
            OR: [
              { title: { contains: term, mode: 'insensitive' as const } },
              { slug: { contains: term, mode: 'insensitive' as const } },
              { subtitle: { contains: term, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.collection.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: l,
        include: { _count: { select: { stories: true } } },
      }),
      this.prisma.collection.count({ where }),
    ]);

    const data = await Promise.all(rows.map((r) => this.toResponseDto(r as RawCollection)));
    return PaginationHelper.createPaginatedResponse(data, total, p, l);
  }

  /**
   * GET /admin/collections/:id/stories: works for inactive collections.
   * Item: {id,title,category,ageGroup,language,status,isPremium,coverImageUrl(presigned),position}
   */
  async getStoriesAdmin(id: string, page: number, limit: number) {
    await this.requireExists(id);

    const { page: p, limit: l } = PaginationHelper.normalizePaginationParams(page, limit);
    const skip = PaginationHelper.calculateOffset(p, l);

    const [rows, total] = await Promise.all([
      this.prisma.storyOnCollection.findMany({
        where: { collectionId: id },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: l,
        include: {
          story: {
            select: {
              id: true,
              title: true,
              category: true,
              ageGroup: true,
              language: true,
              status: true,
              isPremium: true,
              coverImageUrl: true,
            },
          },
        },
      }),
      this.prisma.storyOnCollection.count({ where: { collectionId: id } }),
    ]);

    const data = await Promise.all(
      rows.map(async (r) => ({
        id: r.story.id,
        title: r.story.title,
        category: r.story.category,
        ageGroup: r.story.ageGroup,
        language: r.story.language,
        status: r.story.status,
        isPremium: r.story.isPremium,
        coverImageUrl: await this.storageService.getReadUrl(r.story.coverImageUrl),
        position: r.position,
      })),
    );

    return PaginationHelper.createPaginatedResponse(data, total, p, l);
  }

  // ─────────────────────────────────────────────
  // Admin (write)
  // ─────────────────────────────────────────────

  async create(dto: CreateCollectionDto): Promise<CollectionResponseDto> {
    const language = dto.language ?? DEFAULT_CONTENT_LANGUAGE;

    // A slug is unique per content language.
    const existing = await this.prisma.collection.findUnique({
      where: { slug_language: { slug: dto.slug, language } },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(this.slugTakenMessage(dto.slug, language));
    }

    const row = await this.prisma.collection.create({
      data: {
        slug: dto.slug,
        language,
        title: dto.title,
        subtitle: dto.subtitle ?? null,
        description: dto.description ?? null,
        tone: dto.tone,
        coverImageUrl: dto.coverImageUrl ?? null,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { _count: { select: { stories: true } } },
    });

    return this.toResponseDto(row as RawCollection);
  }

  async update(
    id: string,
    dto: UpdateCollectionDto,
  ): Promise<CollectionResponseDto> {
    const current = await this.prisma.collection.findUnique({
      where: { id },
      select: { id: true, slug: true, language: true },
    });
    if (!current) {
      throw new NotFoundException(`Collection "${id}" not found`);
    }

    // If the slug or the language changes, the new pair must be free.
    if (dto.slug || dto.language) {
      const slug = dto.slug ?? current.slug;
      const language = dto.language ?? current.language;
      const conflict = await this.prisma.collection.findFirst({
        where: { slug, language, NOT: { id } },
        select: { id: true },
      });
      if (conflict) {
        throw new ConflictException(this.slugTakenMessage(slug, language));
      }
    }

    const row = await this.prisma.collection.update({
      where: { id },
      data: {
        ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
        ...(dto.language ? { language: dto.language } : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.subtitle !== undefined ? { subtitle: dto.subtitle ?? null } : {}),
        ...(dto.description !== undefined ? { description: dto.description ?? null } : {}),
        ...(dto.tone !== undefined ? { tone: dto.tone } : {}),
        ...(dto.coverImageUrl !== undefined ? { coverImageUrl: dto.coverImageUrl ?? null } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      include: { _count: { select: { stories: true } } },
    });

    return this.toResponseDto(row as RawCollection);
  }

  async remove(id: string): Promise<{ success: true }> {
    await this.requireExists(id);
    // StoryOnCollection rows cascade on delete.
    await this.prisma.collection.delete({ where: { id } });
    return { success: true };
  }

  async addStories(id: string, dto: AddStoriesDto) {
    const collection = await this.prisma.collection.findUnique({
      where: { id },
      select: { id: true, language: true },
    });
    if (!collection) {
      throw new NotFoundException(`Collection "${id}" not found`);
    }

    // Verify all story IDs exist
    const existingStories = await this.prisma.story.findMany({
      where: { id: { in: dto.storyIds } },
      select: { id: true, title: true, language: true },
    });
    const foundIds = new Set(existingStories.map((s) => s.id));
    const missing = dto.storyIds.filter((sid) => !foundIds.has(sid));
    if (missing.length > 0) {
      throw new NotFoundException(`Stories not found: ${missing.join(', ')}`);
    }

    // A collection only holds stories written in its own language: clients
    // would never be shown the others.
    const foreign = existingStories.filter((s) => s.language !== collection.language);
    if (foreign.length > 0) {
      throw new BadRequestException({
        code: 'COLLECTION_LANGUAGE_MISMATCH',
        message:
          `Bu koleksiyonun dili "${collection.language}". Farklı dildeki masallar eklenemez: ` +
          `${foreign.map((s) => `${s.title} (${s.language})`).join(', ')}.`,
        storyIds: foreign.map((s) => s.id),
      });
    }

    // Find current max position so newly added stories append to the end.
    const last = await this.prisma.storyOnCollection.findFirst({
      where: { collectionId: id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    let nextPosition = (last?.position ?? -1) + 1;

    // createMany with skipDuplicates so re-adding is idempotent.
    const data = dto.storyIds.map((storyId) => ({
      collectionId: id,
      storyId,
      position: nextPosition++,
    }));

    const result = await this.prisma.storyOnCollection.createMany({
      data,
      skipDuplicates: true,
    });

    return { added: result.count };
  }

  async removeStory(id: string, storyId: string): Promise<{ success: true }> {
    await this.requireExists(id);
    try {
      await this.prisma.storyOnCollection.delete({
        where: { collectionId_storyId: { collectionId: id, storyId } },
      });
    } catch {
      throw new NotFoundException(`Story "${storyId}" is not in this collection`);
    }
    return { success: true };
  }

  /**
   * Atomically update `position` for the supplied story IDs.
   * Unlisted stories keep their existing position (they are not renumbered).
   */
  async reorder(id: string, dto: ReorderStoriesDto): Promise<{ reordered: number }> {
    await this.requireExists(id);

    const currentRows = await this.prisma.storyOnCollection.findMany({
      where: { collectionId: id },
      select: { storyId: true },
    });
    const currentSet = new Set(currentRows.map((r) => r.storyId));

    const missing = dto.storyIds.filter((sid) => !currentSet.has(sid));
    if (missing.length > 0) {
      throw new NotFoundException(
        `Stories not in this collection: ${missing.join(', ')}`,
      );
    }

    await this.prisma.$transaction(
      dto.storyIds.map((storyId, idx) =>
        this.prisma.storyOnCollection.update({
          where: { collectionId_storyId: { collectionId: id, storyId } },
          data: { position: idx },
        }),
      ),
    );

    return { reordered: dto.storyIds.length };
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  private async requireExists(id: string): Promise<void> {
    const row = await this.prisma.collection.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!row) {
      throw new NotFoundException(`Collection "${id}" not found`);
    }
  }

  private slugTakenMessage(slug: string, language: string): string {
    return `Collection slug "${slug}" already exists for language "${language}"`;
  }

  private async toResponseDto(row: RawCollection): Promise<CollectionResponseDto> {
    return {
      id: row.id,
      slug: row.slug,
      language: row.language,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      tone: row.tone,
      // Presigned when stored in our bucket; external URLs pass through.
      coverImageUrl: await this.storageService.getReadUrl(row.coverImageUrl),
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      storyCount: row._count?.stories ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
