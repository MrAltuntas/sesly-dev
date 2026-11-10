import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /playlists`. `isDefault` is advisory — the service flips any
 * other playlists the user has back to `false` inside a transaction so at
 * most one playlist per user is default at any moment.
 */
export class CreatePlaylistDto {
  @ApiProperty({
    description: 'Human-readable playlist name, 1-80 chars',
    minLength: 1,
    maxLength: 80,
    example: 'Bu gece',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({
    description:
      'If true, this playlist becomes the user\'s default (any existing default is flipped to false).',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
