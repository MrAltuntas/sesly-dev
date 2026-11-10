import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoryCategory } from '../../../common/enums/prisma.enums';

/**
 * Narration status values mirror the `NarrationStatus` enum in schema.prisma.
 * Kept as a local literal union so this DTO file stays isolated from any
 * schema-wide enum registry — swap in a central `NarrationStatus` const if
 * one is ever added to `common/enums/prisma.enums.ts`.
 */
export type PlaylistItemNarrationStatus =
  | 'PENDING'
  | 'GENERATING'
  | 'READY'
  | 'FAILED';

/**
 * Subset of StoryNarration fields embedded on a playlist item. Mobile needs
 * just enough to render a queue row and decide playability — no segments,
 * no error messages, no full text.
 */
export class PlaylistItemNarrationDto {
  @ApiProperty()
  id: string;

  @ApiProperty({
    enum: ['PENDING', 'GENERATING', 'READY', 'FAILED'],
    description: 'Narration generation status (mirrors NarrationStatus enum)',
  })
  status: PlaylistItemNarrationStatus;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Duration in seconds (null until audio merge completes)',
  })
  duration: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Final merged audio URL (null until Audio.status transitions to READY)',
  })
  finalAudioUrl: string | null;

  @ApiProperty({ description: 'Underlying story id — useful for cover art lookups' })
  storyId: string;
}

/**
 * Subset of Story fields. Enough to render a queue row without an extra
 * round-trip.
 */
export class PlaylistItemStoryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  coverImageUrl: string | null;

  @ApiProperty({ enum: StoryCategory })
  category: StoryCategory;

  @ApiProperty({ description: 'Estimated duration in minutes' })
  estimatedDuration: number;
}

/**
 * Subset of VoiceProfile fields. Only present when the item is a raw story
 * (narrationId is null) — narration items already bake in voice.
 */
export class PlaylistItemVoiceProfileDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ nullable: true })
  sampleAudioUrl: string | null;
}

/**
 * Response shape for `POST /playlists/:id/items`, `GET /playlists/:id/items`,
 * and `PATCH /playlists/:id/reorder`.
 *
 * Either `narrationId` or `storyId` is non-null (XOR — enforced at the service
 * layer). Embedded relations (`narration`, `story`, `voiceProfile`) mirror the
 * non-null FK so the mobile client can render a queue row in one call.
 *
 * Ghost items — items whose referenced narration/story has been deleted and
 * the FK was SetNull'd — are filtered out of `listItems()` server-side.
 */
export class PlaylistItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  playlistId: string;

  @ApiProperty({ description: '0-indexed position within the playlist' })
  position: number;

  @ApiPropertyOptional({ nullable: true })
  narrationId: string | null;

  @ApiPropertyOptional({ nullable: true })
  storyId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Only meaningful when the item references a raw story. Null for narration items (voice is already baked in).',
  })
  voiceProfileId: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Content language of the story this item plays. Null for a ghost item.',
  })
  language: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Languages the tale exists in: the language of this item first, then the other published versions of its translation group. Empty for a ghost item.',
  })
  availableLanguages: string[];

  @ApiPropertyOptional({ type: PlaylistItemNarrationDto, nullable: true })
  narration: PlaylistItemNarrationDto | null;

  @ApiPropertyOptional({ type: PlaylistItemStoryDto, nullable: true })
  story: PlaylistItemStoryDto | null;

  @ApiPropertyOptional({ type: PlaylistItemVoiceProfileDto, nullable: true })
  voiceProfile: PlaylistItemVoiceProfileDto | null;

  @ApiProperty()
  createdAt: Date;
}
