import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {
  CONTENT_LANGUAGE_CODES,
  CONTENT_LANGUAGE_MESSAGE,
} from '../../../common/constants/content-languages';
import {
  normaliseContentLanguagePreference,
  normaliseUiLanguagePreference,
} from '../content-language-preference';
import { UI_LANGUAGES } from '../../../common/i18n/ui-language';

/**
 * Body for `PATCH /users/me/preferences`. Every field is optional — the
 * service applies only the keys that were actually provided (undefined vs
 * null is meaningful for `sleepTimerLastDuration`: null clears it, undefined
 * leaves it alone).
 *
 * `settings` is deep-merged at the top level (see UserPreferencesService.update)
 * so the client can patch a single key without having to re-send the whole bag.
 */
export class UpdateUserPreferencesDto {
  @ApiPropertyOptional({ description: 'Fade out audio over the last few seconds' })
  @IsOptional()
  @IsBoolean()
  sleepTimerFadeOut?: boolean;

  @ApiPropertyOptional({
    description: 'Auto-pause when the device detects the user is asleep',
  })
  @IsOptional()
  @IsBoolean()
  sleepTimerPauseWhenAsleep?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    minimum: 1,
    maximum: 480,
    description:
      'Last chosen sleep timer duration in minutes. Range 1-480 (up to 8h). Pass null to clear.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(480)
  sleepTimerLastDuration?: number | null;

  @ApiPropertyOptional({ description: 'Voice-ready push notifications' })
  @IsOptional()
  @IsBoolean()
  voiceReadyNotifications?: boolean;

  @ApiPropertyOptional({ description: 'Narration-ready push notifications' })
  @IsOptional()
  @IsBoolean()
  narrationReadyNotifications?: boolean;

  @ApiPropertyOptional({ description: 'Promotional / marketing push notifications' })
  @IsOptional()
  @IsBoolean()
  promoNotifications?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    enum: CONTENT_LANGUAGE_CODES,
    description:
      'Content language of the story catalogue ("Masal dili"). Must be one of the enabled content languages (400 CONTENT_LANGUAGE_NOT_ENABLED otherwise). Pass null to go back to the default language.',
  })
  @IsOptional()
  @Transform(({ value }) => normaliseContentLanguagePreference(value))
  @IsIn(CONTENT_LANGUAGE_CODES as string[], { message: CONTENT_LANGUAGE_MESSAGE })
  contentLanguage?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    enum: UI_LANGUAGES,
    description:
      'UI language of the app, used for text the server writes on its own (push notifications, stored failure messages). "tr" or "en"; case and a region suffix are ignored ("EN", "en-US"). Pass null to clear it (Turkish is used). Also recorded at sign in from Accept-Language.',
  })
  @IsOptional()
  @Transform(({ value }) => normaliseUiLanguagePreference(value))
  @IsIn(UI_LANGUAGES as readonly string[] as string[], { message: 'errors.validation.uiLanguage' })
  uiLanguage?: 'tr' | 'en' | null;

  @ApiPropertyOptional({
    description:
      'Partial update for the settings bag. Shallow-merged into the existing object — top-level keys in the provided object fully replace their prior value; unrelated keys are preserved. Full merged payload must stringify to <=4KB.',
    example: { theme: 'dark', playbackSpeed: 1.25 },
  })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
