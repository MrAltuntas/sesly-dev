import { ApiProperty } from '@nestjs/swagger';
import { AgeGroup, StoryCategory } from '../../../common/enums/prisma.enums';

export class StoryResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty({
    description:
      'Short description shown in the "Hikaye hakkında" card. ' +
      'Computed from story content, capped at 150 characters. ' +
      'The full content is never sent to clients.',
  })
  description: string;

  @ApiProperty({ enum: AgeGroup })
  ageGroup: AgeGroup;

  @ApiProperty({ enum: StoryCategory })
  category: StoryCategory;

  @ApiProperty()
  language: string;

  @ApiProperty()
  estimatedDuration: number;

  @ApiProperty({ required: false })
  coverImageUrl?: string | null;

  @ApiProperty()
  isPremium: boolean;

  @ApiProperty({ description: 'Whether the current user has favorited this story' })
  isFavorite: boolean;

  @ApiProperty({
    type: [String],
    example: ['tr', 'en'],
    description:
      'Languages this tale can be opened in: the language of this item first, then the other published versions of its translation group. Never empty.',
  })
  availableLanguages: string[];

  @ApiProperty({
    description:
      'True when this story or any other language version of the tale is a favourite of the current user.',
  })
  isFavoriteAnyLanguage: boolean;

  @ApiProperty()
  createdAt: Date;
}
