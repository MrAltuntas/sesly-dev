/**
 * The last GET /users/me answer, kept on the device so a returning user lands
 * on Main from local storage alone (greeting and plan included) while the
 * live check runs in the background.
 *
 * AsyncStorage is app-private; the record holds what /users/me returns (id,
 * e-mail, names, avatar URL, plan). Never tokens.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { User, parseUserFromJSON, userToJSON } from '../models/User';

export const CACHED_USER_STORAGE_KEY = '@sesly/me';

const CACHE_VERSION = 1;

/**
 * The cached user from the raw stored value (BootStore reads it in its one
 * multiGet). Anything unreadable returns null and removes the key, so a bad
 * record never comes back.
 */
export function readCachedUser(raw: string | null): User | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('cached user is not an object');
    }
    const record = parsed as { v?: unknown; user?: unknown };
    if (record.v !== CACHE_VERSION) {
      throw new Error(`unknown cached user version ${String(record.v)}`);
    }
    return parseUserFromJSON(record.user);
  } catch (error) {
    console.warn('[userCache] dropping an unreadable cached user:', error);
    void clearCachedUser();
    return null;
  }
}

/** Writes the user after a live answer. Never throws. */
export async function writeCachedUser(user: User): Promise<void> {
  try {
    await AsyncStorage.setItem(
      CACHED_USER_STORAGE_KEY,
      JSON.stringify({ v: CACHE_VERSION, user: userToJSON(user) }),
    );
  } catch (error) {
    console.warn('[userCache] could not store the user:', error);
  }
}

/** Never throws. */
export async function clearCachedUser(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHED_USER_STORAGE_KEY);
  } catch (error) {
    console.warn('[userCache] could not remove the cached user:', error);
  }
}
