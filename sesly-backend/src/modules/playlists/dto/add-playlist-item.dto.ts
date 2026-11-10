import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

/**
 * Body for `POST /playlists/:id/items`.
 *
 * XOR invariant: exactly one of `narrationId` or `storyId` must be provided —
 * enforced at the service layer (cross-field validation is cleaner there
 * than in a class-validator decorator).
 *
 * `voiceProfileId` is only meaningful when the item references a raw story
 * (since narrations already have voice baked in). If both `narrationId` and
 * `voiceProfileId` are sent, the service drops `voiceProfileId` (documented
 * in the controller response).
 *
 * `position` is accepted but intentionally ignored for MVP — new items always
 * append at the end. Use `PATCH /playlists/:id/reorder` for user-driven
 * arrangement. The field is retained for future insert-at-position support
 * without breaking the DTO contract.
 */
export class AddPlaylistItemDto {
  @ApiPropertyOptional({
    description:
      'Reference to a StoryNarration. Exactly one of narrationId or storyId must be present.',
  })
  @IsOptional()
  @IsUUID()
  narrationId?: string;

  @ApiPropertyOptional({
    description:
      'Reference to a Story. Exactly one of narrationId or storyId must be present.',
  })
  @IsOptional()
  @IsUUID()
  storyId?: string;

  @ApiPropertyOptional({
    description:
      'Voice profile to use at playback time. Only applies when the item references a raw story; ignored for narration items.',
  })
  @IsOptional()
  @IsUUID()
  voiceProfileId?: string;

  @ApiPropertyOptional({
    description:
      'Preferred insertion position. Currently ignored — new items always append at the end. Use PATCH /:id/reorder for arrangement.',
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}
