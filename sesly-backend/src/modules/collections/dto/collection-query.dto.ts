import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
} from '../../../common/constants/content-languages';
import { normaliseLanguageParam } from '../../stories/story-query.util';

const LANGUAGE_DESCRIPTION =
  'Content language (independent of Accept-Language). Defaults to the content.defaultLanguage setting.';

/** Query of GET /collections and GET /collections/:slug. */
export class CollectionLanguageQueryDto {
  @ApiPropertyOptional({ description: LANGUAGE_DESCRIPTION, enum: CONTENT_LANGUAGE_CODES })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language?: string;
}

/** Query of GET /collections/:slug/stories. */
export class CollectionStoriesQueryDto extends PaginationDto {
  @ApiPropertyOptional({ description: LANGUAGE_DESCRIPTION, enum: CONTENT_LANGUAGE_CODES })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language?: string;
}
