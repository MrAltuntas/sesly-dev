import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CollectionTone } from '../../../common/enums/prisma.enums';

/**
 * Response shape surfaced by `GET /collections` and `GET /collections/:slug`.
 * Keep camelCase — mobile parses this verbatim.
 */
export class CollectionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ description: 'Stable slug used by mobile (sleep|adventure|classics|calm|...)' })
  slug: string;

  @ApiProperty({ description: 'Content language of the collection (slug is unique per language)', example: 'tr' })
  language: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional({ nullable: true })
  subtitle: string | null;

  @ApiPropertyOptional({ nullable: true })
  description: string | null;

  @ApiProperty({ enum: CollectionTone })
  tone: CollectionTone;

  @ApiPropertyOptional({ nullable: true })
  coverImageUrl: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  sortOrder: number;

  @ApiProperty({ description: 'Public endpoints: published stories of the collection language. Admin list: every attached story.' })
  storyCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
