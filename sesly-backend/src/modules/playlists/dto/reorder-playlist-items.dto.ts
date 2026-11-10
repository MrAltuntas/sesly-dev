import { ApiProperty } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Body for `PATCH /playlists/:id/reorder`. `itemIds` MUST be exactly the set
 * of playlist item IDs currently in the playlist — length and membership are
 * verified in the service; a mismatch throws 400. Array index becomes the
 * new `position` (0..n-1) applied atomically via `$transaction`.
 */
export class ReorderPlaylistItemsDto {
  @ApiProperty({
    type: [String],
    description:
      'Playlist item IDs in the new order. Must contain exactly the items currently in the playlist (no missing, no extra).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  itemIds: string[];
}
