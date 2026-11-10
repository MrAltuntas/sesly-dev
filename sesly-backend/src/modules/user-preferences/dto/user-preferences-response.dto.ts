import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Full shape returned by `GET /users/me/preferences` and `PATCH /users/me/preferences`.
 *
 * Explicit columns cover hot/known fields (sleep timer + notification toggles) that
 * are read on every notification dispatch and by the mobile player. The `settings`
 * bucket is a free-form JSON object for forward-compatible additions — theme,
 * language, playbackSpeed, etc. — validated (and size-capped) at the service layer.
 */
export class UserPreferencesResponseDto {
  @ApiProperty({ description: 'Owning user ID (same as the JWT subject)' })
  userId: string;

  // ─────────────────────────────────────────────
  // Sleep timer
  // ─────────────────────────────────────────────

  @ApiProperty({
    description: 'Whether playback should fade out over the last few seconds',
    default: true,
  })
  sleepTimerFadeOut: boolean;

  @ApiProperty({
    description:
      'Whether to auto-pause when the device detects the user has fallen asleep',
    default: false,
  })
  sleepTimerPauseWhenAsleep: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Last chosen sleep timer duration in minutes (1-480). Null means the user has never set one.',
  })
  sleepTimerLastDuration: number | null;

  // ─────────────────────────────────────────────
  // Notification toggles
  // ─────────────────────────────────────────────

  @ApiProperty({
    description: 'Opt-in: push notification when a cloned voice becomes ready',
    default: true,
  })
  voiceReadyNotifications: boolean;

  @ApiProperty({
    description: 'Opt-in: push notification when a narration finishes generating',
    default: true,
  })
  narrationReadyNotifications: boolean;

  @ApiProperty({
    description: 'Opt-in: promotional / marketing push notifications',
    default: false,
  })
  promoNotifications: boolean;

  // ─────────────────────────────────────────────
  // Content language
  // ─────────────────────────────────────────────

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Stored content language of the story catalogue, or null when the user never chose one (the default language is used).',
  })
  contentLanguage: string | null;

  @ApiProperty({
    description:
      'Content language grouped story lists use for this user right now: the stored one when it is still enabled, else the content.defaultLanguage setting.',
    example: 'tr',
  })
  effectiveContentLanguage: string;

  @ApiPropertyOptional({
    nullable: true,
    enum: ['tr', 'en'],
    description:
      'Stored UI language ("tr" | "en") for server-written text, or null when never set (Turkish is used).',
  })
  uiLanguage: 'tr' | 'en' | null;

  // ─────────────────────────────────────────────
  // Extensible bucket
  // ─────────────────────────────────────────────

  @ApiProperty({
    description:
      'Free-form JSON bag for forward-compat preferences. Total stringified payload capped at 4KB. Known (soft-typed) keys: theme, language, playbackSpeed, autoplayNextStory.',
    example: {
      theme: 'system',
      language: 'tr',
      playbackSpeed: 1.0,
      autoplayNextStory: false,
    },
  })
  settings: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
