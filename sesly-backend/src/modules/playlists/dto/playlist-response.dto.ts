import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape surfaced by `GET /playlists`, `POST /playlists`,
 * `GET /playlists/:id`, and `PATCH /playlists/:id`.
 *
 * `itemCount` is computed via Prisma `_count` — preferred over loading all
 * items just to measure them. Mobile reads this verbatim to render chip
 * counters in the PlaylistSheet.
 */
export class PlaylistResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Owning user ID (same as the JWT subject)' })
  userId: string;

  @ApiProperty({ description: 'User-provided name, 1-80 chars.' })
  name: string;

  @ApiProperty({
    description:
      'Whether this is the user\'s default playlist. Service layer enforces at most one default per user.',
    default: false,
  })
  isDefault: boolean;

  @ApiProperty({ description: 'Number of items currently in the playlist' })
  itemCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
