/**
 * How many own (cloned) voices the account had when the Sesim tab last
 * loaded them, kept on the device per account.
 *
 * The voice list is not cached, so a cold Sesim draws a skeleton while it
 * loads. Most accounts have no own voice: their skeleton is the "Kendi sesini
 * ekle" card's. An account that has one gets the own-voice card's skeleton,
 * as many as it had, so the card that arrives replaces a skeleton of its own
 * height and "Hazır anlatıcılar" under it does not move (V5-03).
 *
 * Read once per account from storage, then served from memory; a failed
 * read or write only loses the convenience (the add card's skeleton is
 * drawn, as for a new account).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export const OWN_VOICE_COUNT_KEY = '@sesly/ownVoiceCount:';

const memory = new Map<string, number>();
const reads = new Map<string, Promise<number | null>>();

function parseCount(value: string | null): number | null {
  if (!value) return null;
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

/** The remembered count of the account, if it is in memory already (null before the read). */
export function rememberedOwnVoiceCount(accountId: string | null | undefined): number | null {
  if (!accountId) return null;
  return memory.get(accountId) ?? null;
}

/** Reads the account's count from storage (once; later calls answer from memory). */
export function loadOwnVoiceCount(accountId: string | null | undefined): Promise<number | null> {
  if (!accountId) return Promise.resolve(null);
  const known = memory.get(accountId);
  if (known !== undefined) return Promise.resolve(known);
  let read = reads.get(accountId);
  if (!read) {
    read = AsyncStorage.getItem(`${OWN_VOICE_COUNT_KEY}${accountId}`)
      .then(value => {
        // A count remembered while the read was out is newer than the stored one.
        const stored = parseCount(value);
        if (!memory.has(accountId) && stored !== null) memory.set(accountId, stored);
        return memory.get(accountId) ?? null;
      })
      .catch(error => {
        console.warn('[ownVoiceMemory] Reading the own-voice count failed:', error);
        return memory.get(accountId) ?? null;
      })
      .finally(() => {
        reads.delete(accountId);
      });
    reads.set(accountId, read);
  }
  return read;
}

/** Remembers the account's count: at once in memory, then in storage (only when it changed). */
export function rememberOwnVoiceCount(accountId: string | null | undefined, count: number): void {
  if (!accountId || !Number.isInteger(count) || count < 0) return;
  if (memory.get(accountId) === count) return;
  memory.set(accountId, count);
  AsyncStorage.setItem(`${OWN_VOICE_COUNT_KEY}${accountId}`, String(count)).catch(error => {
    console.warn('[ownVoiceMemory] Saving the own-voice count failed:', error);
  });
}

export function resetOwnVoiceMemoryForTests(): void {
  memory.clear();
  reads.clear();
}
