import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';
import { PaginationHelper } from '@common/utils/pagination.helper';
import { PaginationDto } from '@common/dto/pagination.dto';
import { PaginatedResponse } from '../../common/types';
import { StorageService } from '../storage/storage.service';
import {
  AddPlaylistItemDto,
  CreatePlaylistDto,
  PlaylistItemResponseDto,
  PlaylistResponseDto,
  ReorderPlaylistItemsDto,
  UpdatePlaylistDto,
} from './dto';

/**
 * Structural view of a Prisma `Playlist` row with `_count` — we avoid
 * importing the generated client types directly (see CLAUDE.md note on
 * Prisma + Docker workflow; keeps the service compilable when `prisma
 * generate` is briefly stale on a collaborator's machine).
 */
type RawPlaylist = {
  id: string;
  userId: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  _count?: { items: number };
};

/** Loose shape of the narration include used on playlist items. */
type RawNarration = {
  id: string;
  status: string;
  storyId: string;
  audio: { duration: number | null; audioUrl: string | null } | null;
  story?: { id: string; language: string; translationGroupId: string | null } | null;
} | null;

type RawStory = {
  id: string;
  title: string;
  coverImageUrl: string | null;
  category: string;
  estimatedDuration: number;
  language?: string;
  translationGroupId?: string | null;
} | null;

/** Relations every playlist item is read with. */
const ITEM_INCLUDE = {
  narration: {
    select: {
      id: true,
      status: true,
      storyId: true,
      audio: { select: { duration: true, audioUrl: true } },
      story: { select: { id: true, language: true, translationGroupId: true } },
    },
  },
  story: {
    select: {
      id: true,
      title: true,
      coverImageUrl: true,
      category: true,
      estimatedDuration: true,
      language: true,
      translationGroupId: true,
    },
  },
  voiceProfile: {
    select: { id: true, name: true, sampleAudioUrl: true },
  },
} as const;

type RawVoiceProfile = {
  id: string;
  name: string;
  sampleAudioUrl: string | null;
} | null;

/** Raw PlaylistItem row with the narrow relations we include. */
type RawPlaylistItem = {
  id: string;
  playlistId: string;
  narrationId: string | null;
  storyId: string | null;
  voiceProfileId: string | null;
  position: number;
  createdAt: Date;
  narration: RawNarration;
  story: RawStory;
  voiceProfile: RawVoiceProfile;
};

import { SettingsService } from '../settings/settings.service';
import { StoryGroupInfo, loadStoryGroupInfo } from '../stories/story-groups';

@Injectable()
export class PlaylistsService {
  private readonly logger = new Logger(PlaylistsService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private settings: SettingsService,
  ) {}

  // ─────────────────────────────────────────────
  // Playlists
  // ─────────────────────────────────────────────

  /**
   * List the current user's playlists, most-recently-updated first. `itemCount`
   * is derived from a `_count` include so we don't need to load items just to
   * render the playlist chip rail.
   */
  async list(userId: string): Promise<PlaylistResponseDto[]> {
    const rows = (await this.prisma.playlist.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { items: true } } },
    })) as unknown as RawPlaylist[];

    return rows.map((r) => this.toPlaylistDto(r));
  }

  /**
   * Create a new playlist. When `dto.isDefault === true`, we atomically flip
   * every other playlist the user owns to `isDefault: false` in a single
   * transaction — the "at most one default" invariant is enforced here, not
   * at the database level (schema note).
   */
  async create(
    userId: string,
    dto: CreatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    const wantsDefault = dto.isDefault === true;

    let row: RawPlaylist;

    if (wantsDefault) {
      const [, created] = await this.prisma.$transaction([
        this.prisma.playlist.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        }),
        this.prisma.playlist.create({
          data: { userId, name: dto.name, isDefault: true },
          include: { _count: { select: { items: true } } },
        }),
      ]);
      row = created as unknown as RawPlaylist;
    } else {
      row = (await this.prisma.playlist.create({
        data: { userId, name: dto.name, isDefault: false },
        include: { _count: { select: { items: true } } },
      })) as unknown as RawPlaylist;
    }

    return this.toPlaylistDto(row);
  }

  /**
   * Fetch a single playlist the current user owns.
   * Throws 404 if missing or owned by someone else (ownership + existence
   * are collapsed into one 404 — we deliberately don't leak "exists but
   * belongs to another user").
   */
  async getOne(
    userId: string,
    playlistId: string,
  ): Promise<PlaylistResponseDto> {
    const row = (await this.prisma.playlist.findFirst({
      where: { id: playlistId, userId },
      include: { _count: { select: { items: true } } },
    })) as unknown as RawPlaylist | null;

    if (!row) {
      throw new NotFoundException(`Playlist "${playlistId}" not found`);
    }

    return this.toPlaylistDto(row);
  }

  /**
   * Partial update — rename and/or toggle `isDefault`. When the caller sets
   * `isDefault: true` on a playlist that isn't already default, we wrap the
   * flip-siblings + update into a single transaction to preserve the "at
   * most one default per user" invariant.
   *
   * Setting `isDefault: false` is allowed even if it leaves the user without
   * any default — the mobile client treats "no default" as "last played".
   */
  async update(
    userId: string,
    playlistId: string,
    dto: UpdatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    const current = await this.requireOwned(userId, playlistId);

    const wantsPromoteToDefault =
      dto.isDefault === true && current.isDefault === false;

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.isDefault !== undefined) patch.isDefault = dto.isDefault;

    let row: RawPlaylist;

    if (wantsPromoteToDefault) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.playlist.updateMany({
          where: { userId, isDefault: true, NOT: { id: playlistId } },
          data: { isDefault: false },
        }),
        this.prisma.playlist.update({
          where: { id: playlistId },
          data: patch,
          include: { _count: { select: { items: true } } },
        }),
      ]);
      row = updated as unknown as RawPlaylist;
    } else {
      row = (await this.prisma.playlist.update({
        where: { id: playlistId },
        data: patch,
        include: { _count: { select: { items: true } } },
      })) as unknown as RawPlaylist;
    }

    return this.toPlaylistDto(row);
  }

  /**
   * Delete a playlist. Items cascade via the `onDelete: Cascade` relation.
   */
  async remove(userId: string, playlistId: string): Promise<void> {
    await this.requireOwned(userId, playlistId);
    await this.prisma.playlist.delete({ where: { id: playlistId } });
  }

  // ─────────────────────────────────────────────
  // Items
  // ─────────────────────────────────────────────

  /**
   * Paginated items of a playlist, ordered by `position ASC`.
   *
   * Ghost filtering: items whose referenced narration AND story are both
   * null (because the originals were deleted and FKs were SetNull'd) are
   * stripped from the response — they're unplayable and would confuse the
   * UI. We do NOT delete them here; a sweeper job can prune if desired.
   *
   * Note: ghost filtering is applied AFTER pagination, so a page may
   * contain fewer than `limit` items even when more items exist below.
   * This mirrors how Collections handles active/inactive story filtering
   * and keeps query cost low (single bounded page read).
   */
  async listItems(
    userId: string,
    playlistId: string,
    pagination: PaginationDto,
  ): Promise<PaginatedResponse<PlaylistItemResponseDto>> {
    await this.requireOwned(userId, playlistId);

    const { page, limit } = PaginationHelper.normalizePaginationParams(
      pagination.page,
      pagination.limit,
    );
    const skip = PaginationHelper.calculateOffset(page, limit);

    const [rows, total] = await Promise.all([
      this.prisma.playlistItem.findMany({
        where: { playlistId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        skip,
        take: limit,
        include: ITEM_INCLUDE,
      }),
      this.prisma.playlistItem.count({ where: { playlistId } }),
    ]);

    const typed = rows as unknown as RawPlaylistItem[];
    const playable = typed.filter(
      (r) => r.narrationId !== null || r.storyId !== null,
    );

    const data = await this.toItemDtos(playable);

    return PaginationHelper.createPaginatedResponse(data, total, page, limit);
  }

  /**
   * Add an item to a playlist. Always appends at the tail — `dto.position`
   * is intentionally ignored for MVP (kept in the DTO so clients can start
   * sending it without waiting for a contract change). Use
   * `PATCH /:id/reorder` for user-driven arrangement.
   *
   * Invariants enforced here:
   *   - XOR: exactly one of narrationId / storyId must be set.
   *   - Narration ownership: user may only queue their own narrations
   *     (404 otherwise — narrations are private per-user).
   *   - Story existence: must exist (stories are globally readable, so
   *     no additional ACL check beyond "row exists").
   *   - VoiceProfile ownership: if present with a story item, must be
   *     owned by the caller.
   *   - VoiceProfile + narration collision: if both are sent, we null
   *     `voiceProfileId` (voice is already baked into the narration).
   */
  async addItem(
    userId: string,
    playlistId: string,
    dto: AddPlaylistItemDto,
  ): Promise<PlaylistItemResponseDto> {
    await this.requireOwned(userId, playlistId);

    const hasNarration = !!dto.narrationId;
    const hasStory = !!dto.storyId;
    if (hasNarration === hasStory) {
      throw new BadRequestException(
        'Item must reference exactly one of narrationId or storyId',
      );
    }

    if (hasNarration) {
      const narration = await this.prisma.storyNarration.findFirst({
        where: { id: dto.narrationId, userId },
        select: { id: true },
      });
      if (!narration) {
        throw new NotFoundException(
          `Narration "${dto.narrationId}" not found`,
        );
      }
    } else {
      const story = await this.prisma.story.findUnique({
        where: { id: dto.storyId },
        select: { id: true },
      });
      if (!story) {
        throw new NotFoundException(`Story "${dto.storyId}" not found`);
      }
    }

    // VoiceProfile is only meaningful alongside a story. When sent with a
    // narration, we drop it — voice is already fixed on the narration.
    let voiceProfileId: string | null = null;
    if (dto.voiceProfileId && hasStory) {
      const voice = await this.prisma.voiceProfile.findFirst({
        where: { id: dto.voiceProfileId, userId },
        select: { id: true },
      });
      if (!voice) {
        throw new NotFoundException(
          `Voice profile "${dto.voiceProfileId}" not found`,
        );
      }
      voiceProfileId = voice.id;
    }

    // Append at end. Max + 1, or 0 when the playlist is empty.
    const last = await this.prisma.playlistItem.findFirst({
      where: { playlistId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const nextPosition = last ? last.position + 1 : 0;

    const row = (await this.prisma.playlistItem.create({
      data: {
        playlistId,
        narrationId: hasNarration ? dto.narrationId ?? null : null,
        storyId: hasStory ? dto.storyId ?? null : null,
        voiceProfileId,
        position: nextPosition,
      },
      include: ITEM_INCLUDE,
    })) as unknown as RawPlaylistItem;

    // Bump playlist updatedAt so "recent first" list ordering reflects
    // activity — Prisma does not cascade updatedAt from child writes.
    await this.prisma.playlist.update({
      where: { id: playlistId },
      data: { updatedAt: new Date() },
    });

    return (await this.toItemDtos([row]))[0];
  }

  /**
   * Remove an item from a playlist. We intentionally do NOT compact the
   * positions of surviving items — the resulting gaps are harmless for
   * `ORDER BY position` and `reorder()` assigns fresh 0..n-1 values when
   * the user rearranges the queue.
   */
  async removeItem(
    userId: string,
    playlistId: string,
    itemId: string,
  ): Promise<void> {
    await this.requireOwned(userId, playlistId);

    const existing = await this.prisma.playlistItem.findFirst({
      where: { id: itemId, playlistId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException(`Playlist item "${itemId}" not found`);
    }

    await this.prisma.playlistItem.delete({ where: { id: itemId } });

    await this.prisma.playlist.update({
      where: { id: playlistId },
      data: { updatedAt: new Date() },
    });
  }

  /**
   * Atomically reorder items. `dto.itemIds` must be exactly the set of
   * item IDs currently in the playlist — same pattern as
   * `CollectionsService.reorder`.
   */
  async reorderItems(
    userId: string,
    playlistId: string,
    dto: ReorderPlaylistItemsDto,
  ): Promise<PlaylistItemResponseDto[]> {
    await this.requireOwned(userId, playlistId);

    const existing = await this.prisma.playlistItem.findMany({
      where: { playlistId },
      select: { id: true },
    });
    const existingIds = new Set(existing.map((e) => e.id));

    if (dto.itemIds.length !== existingIds.size) {
      throw new BadRequestException(
        `Reorder list must contain exactly ${existingIds.size} item ID(s); got ${dto.itemIds.length}`,
      );
    }

    const seen = new Set<string>();
    for (const id of dto.itemIds) {
      if (seen.has(id)) {
        throw new BadRequestException(`Duplicate item id in reorder list: ${id}`);
      }
      seen.add(id);
      if (!existingIds.has(id)) {
        throw new BadRequestException(
          `Item "${id}" does not belong to this playlist`,
        );
      }
    }

    await this.prisma.$transaction([
      ...dto.itemIds.map((itemId, idx) =>
        this.prisma.playlistItem.update({
          where: { id: itemId },
          data: { position: idx },
        }),
      ),
      this.prisma.playlist.update({
        where: { id: playlistId },
        data: { updatedAt: new Date() },
      }),
    ]);

    const rows = (await this.prisma.playlistItem.findMany({
      where: { playlistId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: ITEM_INCLUDE,
    })) as unknown as RawPlaylistItem[];

    return this.toItemDtos(rows);
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  /**
   * Verify the playlist exists AND belongs to the user. Returns the minimal
   * row so callers can make decisions (e.g. "was it already default?") in
   * their single transaction.
   */
  private async requireOwned(
    userId: string,
    playlistId: string,
  ): Promise<{ id: string; isDefault: boolean }> {
    const row = await this.prisma.playlist.findFirst({
      where: { id: playlistId, userId },
      select: { id: true, isDefault: true },
    });
    if (!row) {
      throw new NotFoundException(`Playlist "${playlistId}" not found`);
    }
    return row;
  }

  private toPlaylistDto(row: RawPlaylist): PlaylistResponseDto {
    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      isDefault: row.isDefault,
      itemCount: row._count?.items ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Item DTO with client-readable URLs: story cover, narration audio and
   * voice sample go through StorageService.getReadUrl like every other story /
   * narration / voice shape (the bucket needs signed URLs; external URLs pass
   * through unchanged).
   */
  /** The story an item plays: its own, or the one its narration was made from. */
  private storyRefOf(row: RawPlaylistItem) {
    const ref = row.story ?? row.narration?.story ?? null;
    return ref && ref.language ? { id: ref.id, language: ref.language, translationGroupId: ref.translationGroupId } : null;
  }

  /** Item DTOs for several rows, with the group info read once. */
  private async toItemDtos(rows: RawPlaylistItem[]): Promise<PlaylistItemResponseDto[]> {
    const refs = rows.map((r) => this.storyRefOf(r)).filter((ref) => ref !== null);
    const groupInfo = await loadStoryGroupInfo(this.prisma, this.settings, refs);
    return Promise.all(rows.map((r) => this.toItemDto(r, groupInfo)));
  }

  private async toItemDto(
    row: RawPlaylistItem,
    groupInfo: Map<string, StoryGroupInfo>,
  ): Promise<PlaylistItemResponseDto> {
    const storyRef = this.storyRefOf(row);
    const [coverImageUrl, finalAudioUrl, sampleAudioUrl] = await Promise.all([
      this.storageService.getReadUrl(row.story?.coverImageUrl),
      this.storageService.getReadUrl(row.narration?.audio?.audioUrl),
      this.storageService.getReadUrl(row.voiceProfile?.sampleAudioUrl),
    ]);
    return {
      id: row.id,
      playlistId: row.playlistId,
      position: row.position,
      narrationId: row.narrationId,
      storyId: row.storyId,
      voiceProfileId: row.voiceProfileId,
      language: storyRef?.language ?? null,
      availableLanguages: storyRef
        ? groupInfo.get(storyRef.id)?.availableLanguages ?? [storyRef.language]
        : [],
      narration: row.narration
        ? {
            id: row.narration.id,
            status: row.narration.status as
              | 'PENDING'
              | 'GENERATING'
              | 'READY'
              | 'FAILED',
            duration: row.narration.audio?.duration ?? null,
            finalAudioUrl,
            storyId: row.narration.storyId,
          }
        : null,
      story: row.story
        ? {
            id: row.story.id,
            title: row.story.title,
            coverImageUrl,
            // Cast: Prisma's generated type is the enum, but our RawStory
            // uses `string` for the Docker-compat reasons noted above. The
            // shape on the wire matches StoryCategory either way.
            category: row.story.category as never,
            estimatedDuration: row.story.estimatedDuration,
          }
        : null,
      voiceProfile: row.voiceProfile
        ? {
            id: row.voiceProfile.id,
            name: row.voiceProfile.name,
            sampleAudioUrl,
          }
        : null,
      createdAt: row.createdAt,
    };
  }
}
