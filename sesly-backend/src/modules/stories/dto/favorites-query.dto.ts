import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
} from '../../../common/constants/content-languages';
import { normaliseLanguageParam, parseBooleanParam } from '../story-query.util';

/** Query of GET /stories/favorites. Old app builds send page and limit only. */
export class FavoritesQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'true: a tale saved in several languages is one item (the version in the content language when it is among the saved ones, else the most recently saved).',
  })
  @IsOptional()
  @Transform(({ value }) => parseBooleanParam(value))
  @IsBoolean({ message: 'errors.validation.groupedBoolean' })
  grouped?: boolean;

  @ApiPropertyOptional({
    description: 'Content language to prefer in a grouped list. Wins over the stored preference.',
    enum: CONTENT_LANGUAGE_CODES,
  })
  @IsOptional()
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  prefer?: string;
}

/** Body of POST /stories/:id/translation-requests. */
export class TranslationRequestDto {
  @ApiProperty({ enum: CONTENT_LANGUAGE_CODES, description: 'Language the story is wanted in' })
  @Transform(({ value }) => normaliseLanguageParam(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  language: string;
}
