import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@prisma/prisma.service';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { UserPreferencesResponseDto } from './dto/user-preferences-response.dto';
import { SettingsService } from '../settings/settings.service';
import { resolveContentLanguages } from '../stories/content-language';
import { localizedLanguageName } from '../../common/constants/content-languages';
import { localizedError } from '../../common/i18n/server-text';
import { parseUiLanguage } from '../../common/i18n/ui-language';

/**
 * Structural type matching the Prisma row — we avoid importing the generated
 * client type directly here so the service compiles even if `prisma generate`
 * is briefly out of date on a collaborator's machine. See CLAUDE.md's notes on
 * Prisma+Docker workflow for the reasoning.
 */
type RawUserPreferences = {
  userId: string;
  sleepTimerFadeOut: boolean;
  sleepTimerPauseWhenAsleep: boolean;
  sleepTimerLastDuration: number | null;
  voiceReadyNotifications: boolean;
  narrationReadyNotifications: boolean;
  promoNotifications: boolean;
  contentLanguage?: string | null;
  uiLanguage?: string | null;
  settings: unknown; // Json column — Prisma.JsonValue at runtime
  createdAt: Date;
  updatedAt: Date;
};

/** 4KB cap for the stringified `settings` payload after merge. */
const SETTINGS_MAX_BYTES = 4096;

/** The three push toggles the mobile Settings screen writes. */
export type NotificationToggleKey =
  | 'voiceReadyNotifications'
  | 'narrationReadyNotifications'
  | 'promoNotifications';

export type NotificationToggles = Record<NotificationToggleKey, boolean>;

/**
 * Values a user has when no `user_preferences` row exists yet. MUST mirror the
 * `@default(...)` of the matching columns in `prisma/schema.prisma` and the
 * fallbacks the mobile Settings screen renders (true / true / false).
 * Promo is opt-in (Law 6563 / IYS: commercial messages need prior consent).
 */
export const NOTIFICATION_TOGGLE_DEFAULTS: Readonly<NotificationToggles> = Object.freeze({
  voiceReadyNotifications: true,
  narrationReadyNotifications: true,
  promoNotifications: false,
});

/**
 * `User` filter selecting users whose toggle is effectively ON, treating a
 * missing preferences row as the column default. Used for bulk sends
 * (admin broadcast) so the "missing row" rule lives in one place.
 */
export function notificationToggleOnWhere(
  key: NotificationToggleKey,
): Prisma.UserWhereInput {
  return NOTIFICATION_TOGGLE_DEFAULTS[key]
    ? { NOT: { preferences: { is: { [key]: false } } } }
    : { preferences: { is: { [key]: true } } };
}

@Injectable()
export class UserPreferencesService {
  private readonly logger = new Logger(UserPreferencesService.name);

  constructor(
    private prisma: PrismaService,
    private settingsService: SettingsService,
  ) {}

  // ─────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────

  /**
   * Return the user's preferences row, creating it with schema defaults on
   * first access. Upsert-on-read is simpler than keeping clients aware of the
   * "row may not exist yet" state and matches how most preference endpoints
   * in the wild behave. The row is tiny and cascades on User delete.
   */
  async getOrCreate(userId: string): Promise<UserPreferencesResponseDto> {
    const existing = (await this.prisma.userPreferences.findUnique({
      where: { userId },
    })) as RawUserPreferences | null;

    if (existing) return this.toResponseDto(existing);

    const created = (await this.prisma.userPreferences.create({
      data: { userId },
    })) as unknown as RawUserPreferences;

    return this.toResponseDto(created);
  }

  /**
   * Push toggles for one user, read on every notification dispatch. Does NOT
   * create the row: a missing row means "never touched" and resolves to
   * NOTIFICATION_TOGGLE_DEFAULTS.
   */
  async getNotificationToggles(userId: string): Promise<NotificationToggles> {
    const row = (await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: {
        voiceReadyNotifications: true,
        narrationReadyNotifications: true,
        promoNotifications: true,
      },
    })) as Partial<NotificationToggles> | null;

    return {
      voiceReadyNotifications:
        row?.voiceReadyNotifications ?? NOTIFICATION_TOGGLE_DEFAULTS.voiceReadyNotifications,
      narrationReadyNotifications:
        row?.narrationReadyNotifications ??
        NOTIFICATION_TOGGLE_DEFAULTS.narrationReadyNotifications,
      promoNotifications:
        row?.promoNotifications ?? NOTIFICATION_TOGGLE_DEFAULTS.promoNotifications,
    };
  }

  // ─────────────────────────────────────────────
  // Writes
  // ─────────────────────────────────────────────

  /**
   * Partial update. Uses Prisma `upsert` so a PATCH always succeeds even if
   * the row hasn't been lazily-created yet (e.g. a brand-new user who opens
   * settings before hitting any screen that reads preferences).
   *
   * Settings merge strategy: SHALLOW at the top level. If the client sends
   * `{ settings: { theme: "dark" } }`, the merged object is
   * `{ ...existingSettings, theme: "dark" }` — existing unrelated keys are
   * preserved, the `theme` key is fully replaced. This keeps merge semantics
   * predictable and avoids surprises when a client wants to overwrite a
   * nested object wholesale.
   */
  async update(
    userId: string,
    dto: UpdateUserPreferencesDto,
  ): Promise<UserPreferencesResponseDto> {
    // The content language must be one the catalogue is served in right now.
    if (dto.contentLanguage !== undefined && dto.contentLanguage !== null) {
      const { enabled } = resolveContentLanguages(this.settingsService);
      if (!enabled.includes(dto.contentLanguage)) {
        throw new BadRequestException({
          code: 'CONTENT_LANGUAGE_NOT_ENABLED',
          ...localizedError('errors.preferences.contentLanguageNotEnabled', {
            language: localizedLanguageName(dto.contentLanguage),
          }),
          enabledLanguages: enabled,
        });
      }
    }

    // Load existing settings so we can shallow-merge. A missing row is fine —
    // we treat its settings as {}.
    const existing = (await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { settings: true },
    })) as { settings: unknown } | null;

    const existingSettings = this.asRecord(existing?.settings);

    // Shallow merge only when the client actually sent a settings object.
    // Undefined leaves the stored settings untouched.
    const mergedSettings =
      dto.settings !== undefined
        ? { ...existingSettings, ...dto.settings }
        : existingSettings;

    if (dto.settings !== undefined) {
      const size = Buffer.byteLength(JSON.stringify(mergedSettings), 'utf8');
      if (size > SETTINGS_MAX_BYTES) {
        throw new BadRequestException(
          `Settings object too large (max ${SETTINGS_MAX_BYTES}B, got ${size}B)`,
        );
      }
    }

    // Build the partial update/create payloads. Keys are only included when
    // the client explicitly provided them — we never want an unset field to
    // null out an existing value.
    const explicit: Record<string, unknown> = {};
    if (dto.sleepTimerFadeOut !== undefined)
      explicit.sleepTimerFadeOut = dto.sleepTimerFadeOut;
    if (dto.sleepTimerPauseWhenAsleep !== undefined)
      explicit.sleepTimerPauseWhenAsleep = dto.sleepTimerPauseWhenAsleep;
    if (dto.sleepTimerLastDuration !== undefined)
      explicit.sleepTimerLastDuration = dto.sleepTimerLastDuration; // null clears it, number sets it
    if (dto.voiceReadyNotifications !== undefined)
      explicit.voiceReadyNotifications = dto.voiceReadyNotifications;
    if (dto.narrationReadyNotifications !== undefined)
      explicit.narrationReadyNotifications = dto.narrationReadyNotifications;
    if (dto.promoNotifications !== undefined)
      explicit.promoNotifications = dto.promoNotifications;
    if (dto.contentLanguage !== undefined)
      explicit.contentLanguage = dto.contentLanguage; // null clears it (default language)
    if (dto.uiLanguage !== undefined)
      explicit.uiLanguage = dto.uiLanguage; // null clears it (Turkish)

    // Prisma's Json column types require `InputJsonValue`; Record<string,
    // unknown> is structurally compatible at runtime but TS needs the cast.
    const settingsAsJson = mergedSettings as Prisma.InputJsonValue;
    const settingsPayload =
      dto.settings !== undefined ? { settings: settingsAsJson } : {};

    const row = (await this.prisma.userPreferences.upsert({
      where: { userId },
      update: {
        ...explicit,
        ...settingsPayload,
      },
      create: {
        userId,
        ...explicit,
        // On create we always seed `settings` with the merged value (which is
        // `{}` if the client didn't send one) so the row's Json column is a
        // real object, not SQL NULL.
        settings: settingsAsJson,
      },
    })) as unknown as RawUserPreferences;

    return this.toResponseDto(row);
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  /** Coerce Prisma's JsonValue into a plain Record at the boundary. */
  private asRecord(value: unknown): Record<string, unknown> {
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toResponseDto(row: RawUserPreferences): UserPreferencesResponseDto {
    const { enabled, defaultLanguage } = resolveContentLanguages(this.settingsService);
    const contentLanguage = row.contentLanguage ?? null;
    return {
      userId: row.userId,
      sleepTimerFadeOut: row.sleepTimerFadeOut,
      sleepTimerPauseWhenAsleep: row.sleepTimerPauseWhenAsleep,
      sleepTimerLastDuration: row.sleepTimerLastDuration,
      voiceReadyNotifications: row.voiceReadyNotifications,
      narrationReadyNotifications: row.narrationReadyNotifications,
      promoNotifications: row.promoNotifications,
      contentLanguage,
      effectiveContentLanguage:
        contentLanguage && enabled.includes(contentLanguage) ? contentLanguage : defaultLanguage,
      uiLanguage: parseUiLanguage(row.uiLanguage),
      settings: this.asRecord(row.settings),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
