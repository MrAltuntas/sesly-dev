import { ApiProperty } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/**
 * Body for `POST /admin/collections/:id/stories` — add one or more stories.
 */
export class AddStoriesDto {
  @ApiProperty({ type: [String], description: 'Story IDs to attach' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  storyIds: string[];
}

/**
 * Body for `PATCH /admin/collections/:id/reorder` — set the new order.
 * Any story id in the collection that is missing from `storyIds` keeps its
 * previous position.
 */
export class ReorderStoriesDto {
  @ApiProperty({ type: [String], description: 'Story IDs in the new order (0-indexed position)' })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  storyIds: string[];
}
