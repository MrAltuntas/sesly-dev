/**
 * User Preferences Model with Strict TypeScript Typing
 *
 * Mirrors the backend `UserPreferencesResponseDto` surfaced by:
 *   - GET   /users/me/preferences
 *   - PATCH /users/me/preferences
 *
 * The preferences row is upserted on first GET with schema defaults, so
 * clients never have to create it explicitly.
 *
 * `settings` is a forward-compat free-form JSON bag. Backend shallow-merges
 * top-level keys when PATCH'ed. Total stringified payload is capped at 4KB.
 */

// ============================================================================
// User Preferences Model
// ============================================================================

export interface UserPreferences {
  readonly userId: string;
  readonly sleepTimerFadeOut: boolean;
  readonly sleepTimerPauseWhenAsleep: boolean;
  readonly sleepTimerLastDuration: number | null;
  readonly voiceReadyNotifications: boolean;
  readonly narrationReadyNotifications: boolean;
  readonly promoNotifications: boolean;
  /** Stored "Masal dili", or null when the user never chose (the default is used). */
  readonly contentLanguage: string | null;
  /**
   * The backend's resolution of the content language (its own default for a
   * null pick). The app decides with the UI language instead
   * (useContentLanguage), so this is informational only.
   */
  readonly effectiveContentLanguage: string | null;
  /** The UI language the backend writes pushes and e-mails in; null when not known. */
  readonly uiLanguage: 'tr' | 'en' | null;
  readonly settings: Record<string, unknown>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Partial update payload for PATCH /users/me/preferences.
 *
 * NOTE on `sleepTimerLastDuration`:
 *   - To clear it, OMIT the key from the payload entirely rather than
 *     sending `null`. Backend's `@IsInt` on the DTO rejects `null`. We
 *     intentionally do not include `null` in this type so the compiler
 *     catches the mistake.
 */
export type UpdateUserPreferencesPayload = Partial<{
  sleepTimerFadeOut: boolean;
  sleepTimerPauseWhenAsleep: boolean;
  sleepTimerLastDuration: number;
  voiceReadyNotifications: boolean;
  narrationReadyNotifications: boolean;
  promoNotifications: boolean;
  /** One of the enabled content languages, or null to follow the default. */
  contentLanguage: string | null;
  settings: Record<string, unknown>;
}>;

/**
 * PATCH body for the UI language. Always sent alone
 * (UserPreferencesService.syncUiLanguage): an older backend rejects the
 * unknown field with 400, which must not take a content language or a
 * toggle down with it. Not part of UpdateUserPreferencesPayload on purpose.
 */
export interface UpdateUiLanguagePayload {
  uiLanguage: 'tr' | 'en';
}

/** Keys the app keeps in the free-form `settings` bag. */
export const PREFERENCE_SETTING_KEYS = {
  /** Playback speed used for every story (number), absent when off. */
  playbackSpeed: 'playbackSpeed',
  /** Last sleep timer mode: 'stories' | 'duration'. */
  sleepTimerMode: 'sleepTimerMode',
  /** Last "stop after N stories" value. */
  sleepTimerStoryCount: 'sleepTimerStoryCount',
} as const;

export function readNumberSetting(
  prefs: Pick<UserPreferences, 'settings'> | null | undefined,
  key: string,
): number | null {
  const value = prefs?.settings?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function readStringSetting(
  prefs: Pick<UserPreferences, 'settings'> | null | undefined,
  key: string,
): string | null {
  const value = prefs?.settings?.[key];
  return typeof value === 'string' && value ? value : null;
}

// ============================================================================
// Parser
// ============================================================================

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function asIsoString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  return '';
}

function asLanguageCode(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function asSettings(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function parseUserPreferencesFromJSON(raw: unknown): UserPreferences {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid user preferences data: expected object');
  }

  const data = raw as Record<string, unknown>;

  if (typeof data.userId !== 'string' || !data.userId) {
    throw new Error(
      'Invalid user preferences data: missing or invalid userId',
    );
  }

  const lastDuration = data.sleepTimerLastDuration;
  const sleepTimerLastDuration: number | null =
    typeof lastDuration === 'number' && Number.isFinite(lastDuration)
      ? lastDuration
      : null;

  return {
    userId: data.userId,
    sleepTimerFadeOut: asBoolean(data.sleepTimerFadeOut, true),
    sleepTimerPauseWhenAsleep: asBoolean(data.sleepTimerPauseWhenAsleep, false),
    sleepTimerLastDuration,
    voiceReadyNotifications: asBoolean(data.voiceReadyNotifications, true),
    narrationReadyNotifications: asBoolean(
      data.narrationReadyNotifications,
      true,
    ),
    promoNotifications: asBoolean(data.promoNotifications, false),
    contentLanguage: asLanguageCode(data.contentLanguage),
    effectiveContentLanguage: asLanguageCode(data.effectiveContentLanguage),
    uiLanguage: data.uiLanguage === 'tr' || data.uiLanguage === 'en' ? data.uiLanguage : null,
    settings: asSettings(data.settings),
    createdAt: asIsoString(data.createdAt),
    updatedAt: asIsoString(data.updatedAt),
  };
}
