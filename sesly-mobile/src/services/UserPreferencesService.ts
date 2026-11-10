/**
 * User Preferences Service
 *
 * Thin client over the backend preferences endpoints:
 *   GET   /users/me/preferences
 *   PATCH /users/me/preferences
 *
 * Caching model (simpler than LegalService — no TTL):
 *   - Every successful GET / PATCH writes the full DTO into AsyncStorage
 *     under `user_preferences:<userId>` as well as a mirror at
 *     `user_preferences:last` (for fast sync reads at boot before we know
 *     the user id).
 *   - `get()` is network-first; on failure we fall back to the cache so
 *     the UI can still render the toggles in their last-known state.
 *   - `update()` writes through — it does NOT keep an offline queue; the
 *     caller is responsible for surfacing retryable errors (optimistic UI
 *     + revert on throw).
 *
 * There is also `getCachedSync()` returning a synchronously-available
 * snapshot in memory (populated by the most recent GET or by an explicit
 * `warmup()` call at app boot).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import ApiClient from './ApiClient';
import {
  UserPreferences,
  UpdateUserPreferencesPayload,
  UpdateUiLanguagePayload,
  parseUserPreferencesFromJSON,
} from '../models/UserPreferences';

// ============================================================================
// Cache constants
// ============================================================================

const CACHE_KEY_PREFIX = 'user_preferences:';
const CACHE_KEY_LAST = `${CACHE_KEY_PREFIX}last`;

// ============================================================================
// User Preferences Service Class (Singleton)
// ============================================================================

class UserPreferencesService {
  private static instance: UserPreferencesService;

  private inMemory: UserPreferences | null = null;
  private inflightGet: Promise<UserPreferences> | null = null;

  private constructor() {}

  public static getInstance(): UserPreferencesService {
    if (!UserPreferencesService.instance) {
      UserPreferencesService.instance = new UserPreferencesService();
    }
    return UserPreferencesService.instance;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Fetch current preferences from the backend.
   *
   * Network-first with AsyncStorage fallback — the backend auto-upserts a
   * defaulted row on first GET, so this always returns something on the
   * happy path. In-flight calls are deduplicated so concurrent callers
   * (e.g. ProfileScreen + SleepTimerService on boot) hit the wire once.
   */
  public async get(): Promise<UserPreferences> {
    if (this.inflightGet) {
      return this.inflightGet;
    }

    this.inflightGet = (async () => {
      try {
        const response = await ApiClient.get<unknown>('/users/me/preferences');
        const prefs = parseUserPreferencesFromJSON(response);
        this.inMemory = prefs;
        await this.writeCache(prefs);
        return prefs;
      } catch (error) {
        console.error('Failed to fetch user preferences:', error);
        const cached = await this.readLastCached();
        if (cached) {
          this.inMemory = cached;
          return cached;
        }
        throw error;
      } finally {
        this.inflightGet = null;
      }
    })();

    return this.inflightGet;
  }

  /**
   * Patch preferences. Returns the full updated DTO from the backend.
   *
   * Errors bubble up — the caller should optimistically update local UI
   * and revert on throw. We intentionally do NOT queue offline mutations.
   *
   * Reminder: to clear `sleepTimerLastDuration`, omit the key from the
   * payload (do not send `null` — backend `@IsInt` rejects it).
   */
  public async update(
    payload: UpdateUserPreferencesPayload,
  ): Promise<UserPreferences> {
    try {
      const response = await ApiClient.patch<unknown>(
        '/users/me/preferences',
        payload,
      );
      const prefs = parseUserPreferencesFromJSON(response);
      this.inMemory = prefs;
      await this.writeCache(prefs);
      return prefs;
    } catch (error) {
      console.error('Failed to update user preferences:', error);
      throw error;
    }
  }

  /**
   * Tell the backend the UI language (it writes push notifications and
   * e-mails in it). Its own PATCH, never bundled with another field: a
   * backend that does not know `uiLanguage` refuses the whole body (400,
   * unknown fields are rejected). Resolves true when the backend took it;
   * never throws and logs nothing (an older backend refuses it every time).
   */
  public async syncUiLanguage(uiLanguage: UpdateUiLanguagePayload['uiLanguage']): Promise<boolean> {
    try {
      const body: UpdateUiLanguagePayload = { uiLanguage };
      const response = await ApiClient.patch<unknown>('/users/me/preferences', body);
      const prefs = parseUserPreferencesFromJSON(response);
      this.inMemory = prefs;
      await this.writeCache(prefs);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The preferences of `userId` as this device last saw them, without a
   * request: the in-memory snapshot, else that account's AsyncStorage copy.
   * Null when none is kept.
   */
  public async readCached(userId: string): Promise<UserPreferences | null> {
    if (this.inMemory?.userId === userId) return this.inMemory;
    try {
      const raw = await AsyncStorage.getItem(this.cacheKey(userId));
      if (!raw) return null;
      const prefs = parseUserPreferencesFromJSON(JSON.parse(raw) as unknown);
      return prefs.userId === userId ? prefs : null;
    } catch {
      return null;
    }
  }

  /**
   * Synchronous read of the in-memory snapshot. Returns `null` until the
   * first `get()` or `warmup()` resolves. Safe to call from any render —
   * does not touch AsyncStorage.
   */
  public getCachedSync(): UserPreferences | null {
    return this.inMemory;
  }

  /**
   * Fire-and-forget hydration for app boot. Attempts to populate the
   * in-memory snapshot from the AsyncStorage mirror first (for an instant
   * UI) and then refreshes from the backend opportunistically.
   */
  public async warmup(): Promise<void> {
    try {
      const cached = await this.readLastCached();
      if (cached && !this.inMemory) {
        this.inMemory = cached;
      }
    } catch {
      // ignore
    }

    try {
      await this.get();
    } catch {
      // Network failure at boot is non-fatal — cache (if any) already served.
    }
  }

  /**
   * Wipe the in-memory + on-disk caches. Call on logout.
   */
  public async clear(): Promise<void> {
    this.inMemory = null;
    try {
      const keys = await AsyncStorage.getAllKeys();
      const ours = keys.filter(k => k.startsWith(CACHE_KEY_PREFIX));
      if (ours.length > 0) {
        await AsyncStorage.multiRemove(ours);
      }
    } catch (err) {
      console.warn('[UserPreferencesService] Failed to clear cache:', err);
    }
  }

  // ============================================================================
  // Cache helpers
  // ============================================================================

  private cacheKey(userId: string): string {
    return `${CACHE_KEY_PREFIX}${userId}`;
  }

  private async writeCache(prefs: UserPreferences): Promise<void> {
    try {
      const raw = JSON.stringify(prefs);
      await AsyncStorage.multiSet([
        [this.cacheKey(prefs.userId), raw],
        [CACHE_KEY_LAST, raw],
      ]);
    } catch (err) {
      // Cache failure is non-fatal — just log.
      console.warn('[UserPreferencesService] Failed to write cache:', err);
    }
  }

  private async readLastCached(): Promise<UserPreferences | null> {
    try {
      const raw = await AsyncStorage.getItem(CACHE_KEY_LAST);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return parseUserPreferencesFromJSON(parsed);
    } catch (err) {
      console.warn('[UserPreferencesService] Failed to read cache:', err);
      return null;
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const userPreferencesService = UserPreferencesService.getInstance();
export default userPreferencesService;
