import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { PaginationDto } from '@common/dto/pagination.dto';
import { PlaylistsService } from './playlists.service';
import {
  AddPlaylistItemDto,
  CreatePlaylistDto,
  PlaylistItemResponseDto,
  PlaylistResponseDto,
  ReorderPlaylistItemsDto,
  UpdatePlaylistDto,
} from './dto';

/**
 * Per-user playlists. Every route requires the user JWT (global
 * `JwtAuthGuard`) — there is intentionally no `@Public()` and no admin
 * surface: playlists are owned by, and edited only by, their user.
 *
 * Mobile (`sesly-mobile/src/components/audio/PlaylistSheet.tsx`) will
 * replace its in-memory MobX store with calls against this contract.
 */
@ApiTags('Playlists')
@ApiBearerAuth()
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly svc: PlaylistsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the current user\'s playlists',
    description:
      'Ordered by `updatedAt` descending — recently-edited playlists surface first.',
  })
  @ApiResponse({ status: 200, type: [PlaylistResponseDto] })
  list(
    @CurrentUser('id') userId: string,
  ): Promise<PlaylistResponseDto[]> {
    return this.svc.list(userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new playlist',
    description:
      'If `isDefault: true`, any existing default playlist for the user is atomically flipped to `false` in the same transaction.',
  })
  @ApiResponse({ status: 201, type: PlaylistResponseDto })
  @ApiResponse({ status: 400, description: 'Validation failed' })
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    return this.svc.create(userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single playlist by id' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PlaylistResponseDto })
  @ApiResponse({ status: 404, description: 'Playlist not found or not owned' })
  getOne(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PlaylistResponseDto> {
    return this.svc.getOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Rename a playlist and/or toggle its default flag',
    description:
      'All fields optional. Setting `isDefault: true` on a non-default playlist atomically flips any existing default to `false`. Setting `isDefault: false` is permitted even if it leaves the user without a default (mobile treats "no default" as "last played").',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PlaylistResponseDto })
  @ApiResponse({ status: 404, description: 'Playlist not found or not owned' })
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    return this.svc.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Delete a playlist',
    description: 'Items cascade via the `onDelete: Cascade` relation.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({ status: 404, description: 'Playlist not found or not owned' })
  async remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.svc.remove(userId, id);
  }

  @Get(':id/items')
  @ApiOperation({
    summary: 'List a playlist\'s items (paginated)',
    description:
      'Ordered by `position` ascending. Ghost items (references that SetNull\'d to null) are filtered out at read time — the page may contain fewer than `limit` entries even when more items exist below.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Paginated playlist items' })
  @ApiResponse({ status: 404, description: 'Playlist not found or not owned' })
  listItems(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() pagination: PaginationDto,
  ) {
    return this.svc.listItems(userId, id, pagination);
  }

  @Post(':id/items')
  @ApiOperation({
    summary: 'Append an item to a playlist',
    description:
      'Exactly one of `narrationId` or `storyId` must be provided (XOR). `voiceProfileId` is honoured only for story items (narrations already have voice baked in; the field is silently dropped in that case). The optional `position` field is currently ignored — items always append at the tail; use `PATCH /:id/reorder` for arrangement.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, type: PlaylistItemResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'XOR violation (both or neither of narrationId/storyId), or validation failed',
  })
  @ApiResponse({
    status: 404,
    description:
      'Playlist, narration, story, or voice profile not found / not owned',
  })
  addItem(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddPlaylistItemDto,
  ): Promise<PlaylistItemResponseDto> {
    return this.svc.addItem(userId, id, dto);
  }

  @Delete(':id/items/:itemId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove a single item from a playlist',
    description:
      'Positions of surviving items are NOT compacted. Use `PATCH /:id/reorder` to assign fresh 0..n-1 positions.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiResponse({
    status: 404,
    description: 'Playlist or item not found, or not owned',
  })
  async removeItem(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ): Promise<void> {
    await this.svc.removeItem(userId, id, itemId);
  }

  @Patch(':id/reorder')
  @ApiOperation({
    summary: 'Atomically reorder the items in a playlist',
    description:
      '`itemIds` must be exactly the set of item IDs currently in the playlist (no missing, no extra, no duplicates). Array index becomes the new `position`. Returns the items in their new order.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: [PlaylistItemResponseDto] })
  @ApiResponse({
    status: 400,
    description: 'Set mismatch or duplicate id in `itemIds`',
  })
  @ApiResponse({ status: 404, description: 'Playlist not found or not owned' })
  reorder(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderPlaylistItemsDto,
  ): Promise<PlaylistItemResponseDto[]> {
    return this.svc.reorderItems(userId, id, dto);
  }
}
