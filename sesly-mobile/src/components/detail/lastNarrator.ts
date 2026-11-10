/**
 * The narrator chosen last on a story page, kept on the device so the next
 * story starts with it (`pickInitialNarrator`, rule 2).
 *
 * One value per device under LAST_NARRATOR_KEY: a voice profile id belongs to
 * one account, and the story page only uses it when that voice is in the
 * signed-in user's list, so an id left by another account is simply ignored.
 * Read once from storage, then served from memory; a failed read or write
 * only loses the convenience.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const LAST_NARRATOR_KEY = '@sesly/lastNarrator';

let memory: string | null = null;
let loaded = false;
let loading: Promise<string | null> | null = null;

/** The last pick once it was read (null before that, or when there is none). */
export function lastNarratorId(): string | null {
  return memory;
}

/** Read the last pick from storage (once; later calls answer from memory). */
export function loadLastNarrator(): Promise<string | null> {
  if (loaded) return Promise.resolve(memory);
  if (!loading) {
    loading = AsyncStorage.getItem(LAST_NARRATOR_KEY)
      .then(value => {
        // A pick made while the read was out is newer than what was stored.
        if (!loaded) memory = typeof value === 'string' && value ? value : null;
        return memory;
      })
      .catch(error => {
        console.warn('[lastNarrator] Reading the last narrator failed:', error);
        return memory;
      })
      .finally(() => {
        loaded = true;
        loading = null;
      });
  }
  return loading;
}

/** Remember a pick: at once in memory, then in storage. */
export function rememberLastNarrator(profileId: string | null | undefined): void {
  if (!profileId || (loaded && memory === profileId)) return;
  memory = profileId;
  loaded = true;
  AsyncStorage.setItem(LAST_NARRATOR_KEY, profileId).catch(error => {
    console.warn('[lastNarrator] Saving the last narrator failed:', error);
  });
}

export function resetLastNarratorForTests(): void {
  memory = null;
  loaded = false;
  loading = null;
}
