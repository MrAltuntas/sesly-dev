import { PartialType } from '@nestjs/swagger';
import { CreatePlaylistDto } from './create-playlist.dto';

/**
 * Body for `PATCH /playlists/:id`. All fields optional — only provided keys
 * are applied. See `PlaylistsService.update` for `isDefault` semantics (set
 * to true ⇒ all sibling playlists are flipped to false in one transaction).
 */
export class UpdatePlaylistDto extends PartialType(CreatePlaylistDto) {}
