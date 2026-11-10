import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SETTING_GROUPS,
  SETTINGS_REGISTRY,
  SettingDefinition,
  SettingKey,
  SettingValue,
  SettingValueMap,
  getSettingDefinition,
  settingOptionLabels,
  validateSettingValue,
} from './settings.registry';

export type SettingSource = 'panel' | 'env' | 'default';

export interface SettingView {
  key: string;
  group: string;
  type: SettingDefinition['type'];
  label: string;
  description: string;
  unit: string | null;
  constraints: {
    min: number | null;
    max: number | null;
    step: number | null;
    options: string[] | null;
    /** The same options with their Turkish display names, in the same order. */
    optionLabels: Array<{ value: string; label: string }> | null;
    pattern: string | null;
    maxLength: number | null;
  };
  /** Effective value right now. */
  value: SettingValue;
  source: SettingSource;
  /** Value a reset (DELETE) would give, and where it comes from. */
  fallbackValue: SettingValue;
  fallbackSource: Exclude<SettingSource, 'panel'>;
  /** Code default, for reference. */
  defaultValue: SettingValue;
  envVar: string;
  updatedAt: string | null;
  updatedByAdminId: string | null;
}

export interface SettingsView {
  groups: Array<{ id: string; label: string; description: string; settings: SettingView[] }>;
}

interface OverrideEntry {
  value: SettingValue;
  updatedAt: Date | null;
  updatedByAdminId: string | null;
}

/** How often the in-memory copy is re-read from the database. */
export const SETTINGS_REFRESH_INTERVAL_MS = 30_000;
/** Longest the boot waits for the first load before serving env / defaults. */
export const SETTINGS_BOOT_LOAD_TIMEOUT_MS = 5_000;

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Runtime settings: database override, then environment variable, then code
 * default. `get()` is synchronous and reads an in-memory copy that is loaded
 * at start, refreshed every 30 s and right after a write in this process.
 *
 * The database is never required: when it is unreachable the service serves
 * environment / default values (or the last overrides it managed to load)
 * and logs a warning. It never fails the boot.
 */
@Injectable()
export class SettingsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettingsService.name);
  private overrides = new Map<string, OverrideEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly warnedEnv = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private databaseHealthy = true;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    let bootTimer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      bootTimer = setTimeout(() => resolve('timeout'), SETTINGS_BOOT_LOAD_TIMEOUT_MS);
    });
    const outcome = await Promise.race([this.refresh(), timeout]);
    clearTimeout(bootTimer);
    if (outcome === 'timeout') {
      this.logger.warn(
        'Settings did not load from the database in time. Serving environment and default values until the next refresh.',
      );
    }

    this.timer = setInterval(() => {
      void this.refresh();
    }, SETTINGS_REFRESH_INTERVAL_MS);
    // Never keep the process (or a test run) alive just for the refresh.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  /** Effective value: panel override, else environment, else code default. */
  get<K extends SettingKey>(key: K): SettingValueMap[K] {
    const def = getSettingDefinition(key);
    if (!def) {
      throw new Error(`Unknown setting key: ${key}`);
    }
    return this.resolve(def).value as SettingValueMap[K];
  }

  /**
   * Run `listener` whenever an override changes (after a write or a refresh
   * that saw a different row set). Returns the unsubscribe function.
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** The registry with effective values, grouped for the admin panel. */
  describe(): SettingsView {
    return {
      groups: SETTING_GROUPS.map((group) => ({
        ...group,
        settings: SETTINGS_REGISTRY.filter((def) => def.group === group.id).map((def) => this.view(def)),
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Write
  // ---------------------------------------------------------------------

  /**
   * Validate every value against the registry, then persist all of them in
   * one transaction. Nothing is written when any value is invalid.
   */
  async update(values: Record<string, unknown>, adminId: string | null): Promise<SettingsView> {
    const entries = Object.entries(values ?? {});
    if (entries.length === 0) {
      throw new BadRequestException('Değiştirilecek en az bir ayar gönderilmelidir.');
    }

    const validated: Array<{ def: SettingDefinition; value: SettingValue }> = [];
    for (const [key, raw] of entries) {
      const def = getSettingDefinition(key);
      if (!def) {
        throw new BadRequestException(`Bilinmeyen ayar anahtarı: "${key}".`);
      }
      const result = validateSettingValue(def, raw);
      if (result.ok === false) {
        throw new BadRequestException(result.message);
      }
      validated.push({ def, value: result.value });
    }

    const before = new Map(validated.map(({ def }) => [def.key, this.resolve(def).value]));

    await this.prisma.$transaction(
      validated.map(({ def, value }) =>
        this.prisma.systemSetting.upsert({
          where: { key: def.key },
          create: { key: def.key, value, updatedByAdminId: adminId },
          update: { value, updatedByAdminId: adminId },
        }),
      ),
    );

    // Apply locally first so this process serves the new values even if the
    // re-read below fails, then re-read to pick up timestamps.
    const now = new Date();
    for (const { def, value } of validated) {
      this.overrides.set(def.key, { value, updatedAt: now, updatedByAdminId: adminId });
    }
    for (const { def, value } of validated) {
      this.logger.log(
        `AUDIT setting changed key=${def.key} old=${JSON.stringify(before.get(def.key))} new=${JSON.stringify(value)} admin=${adminId ?? 'unknown'}`,
      );
    }
    this.notify();
    await this.refresh();

    return this.describe();
  }

  /** Remove the panel override so the value falls back to env / default. */
  async reset(key: string, adminId: string | null): Promise<SettingView> {
    const def = getSettingDefinition(key);
    if (!def) {
      throw new NotFoundException(`Bilinmeyen ayar anahtarı: "${key}".`);
    }

    const before = this.resolve(def).value;
    await this.prisma.systemSetting.deleteMany({ where: { key: def.key } });
    const had = this.overrides.delete(def.key);
    const after = this.resolve(def).value;
    this.logger.log(
      `AUDIT setting reset key=${def.key} old=${JSON.stringify(before)} new=${JSON.stringify(after)} admin=${adminId ?? 'unknown'}`,
    );
    if (had) this.notify();
    await this.refresh();

    return this.view(def);
  }

  // ---------------------------------------------------------------------
  // Cache
  // ---------------------------------------------------------------------

  /**
   * Re-read every override from the database. Never throws: on failure the
   * previous in-memory state stays in place and a warning is logged once per
   * outage (not every 30 s).
   */
  async refresh(): Promise<boolean> {
    let rows: Array<{ key: string; value: unknown; updatedAt: Date; updatedByAdminId: string | null }>;
    try {
      rows = await this.prisma.systemSetting.findMany();
    } catch (error) {
      if (this.databaseHealthy) {
        this.logger.warn(
          `Could not load settings from the database (${(error as Error)?.message ?? error}). Serving environment and default values plus any overrides loaded earlier.`,
        );
      }
      this.databaseHealthy = false;
      return false;
    }

    if (!this.databaseHealthy) {
      this.logger.log('Settings database is reachable again.');
    }
    this.databaseHealthy = true;

    const next = new Map<string, OverrideEntry>();
    for (const row of rows) {
      const def = getSettingDefinition(row.key);
      if (!def) continue; // a key removed from the registry; harmless leftover row
      const result = validateSettingValue(def, row.value);
      if (result.ok === false) {
        this.logger.warn(`Ignoring stored override for ${row.key}: it no longer passes validation.`);
        continue;
      }
      next.set(row.key, {
        value: result.value,
        updatedAt: row.updatedAt,
        updatedByAdminId: row.updatedByAdminId,
      });
    }

    const changed =
      next.size !== this.overrides.size ||
      [...next].some(([key, entry]) => !sameValue(entry.value, this.overrides.get(key)?.value));
    this.overrides = next;
    if (changed) this.notify();
    return true;
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        this.logger.warn(`A settings change listener failed: ${(error as Error)?.message ?? error}`);
      }
    }
  }

  /** Environment value, then code default. An invalid env value is skipped with one warning. */
  private fallback(def: SettingDefinition): { value: SettingValue; source: 'env' | 'default' } {
    const raw = process.env[def.envVar];
    if (raw !== undefined && raw.trim() !== '') {
      const result = validateSettingValue(def, raw);
      if (result.ok) {
        return { value: result.value, source: 'env' };
      }
      const signature = `${def.envVar}=${raw}`;
      if (!this.warnedEnv.has(signature)) {
        this.warnedEnv.add(signature);
        this.logger.warn(
          `Environment variable ${def.envVar} is not a valid value for ${def.key}. Using the code default.`,
        );
      }
    }
    return { value: def.default, source: 'default' };
  }

  private resolve(def: SettingDefinition): { value: SettingValue; source: SettingSource } {
    const override = this.overrides.get(def.key);
    if (override) {
      return { value: override.value, source: 'panel' };
    }
    return this.fallback(def);
  }

  private view(def: SettingDefinition): SettingView {
    const effective = this.resolve(def);
    const fallback = this.fallback(def);
    const override = this.overrides.get(def.key);
    return {
      key: def.key,
      group: def.group,
      type: def.type,
      label: def.label,
      description: def.description,
      unit: def.unit,
      constraints: {
        min: def.min ?? null,
        max: def.max ?? null,
        step: def.step ?? null,
        options: def.options ? [...def.options] : null,
        optionLabels: settingOptionLabels(def),
        pattern: def.pattern ? def.pattern.source : null,
        maxLength: def.maxLength ?? null,
      },
      value: effective.value,
      source: effective.source,
      fallbackValue: fallback.value,
      fallbackSource: fallback.source,
      defaultValue: def.default,
      envVar: def.envVar,
      updatedAt: override?.updatedAt ? override.updatedAt.toISOString() : null,
      updatedByAdminId: override?.updatedByAdminId ?? null,
    };
  }
}
