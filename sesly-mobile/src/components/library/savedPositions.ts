/**
 * Playback positions the player saved on the device, read for a whole page
 * of Library rows in one storage round trip.
 *
 * The audio store writes `narration_position:<id>` every 3 s while a story
 * plays and on every pause, and removes it at the end of the story. The
 * Library reads them on every focus (they change whenever something played),
 * so one `multiGet` replaces up to a page of single reads.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Storage key of a narration's saved position (the audio store's key). */
export const savedPositionKey = (narrationId: string): string => `narration_position:${narrationId}`;

/** A stored position in ms; anything missing, malformed or not positive is 0. */
export function parseSavedPosition(raw: string | null | undefined): number {
  const value = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Saved positions by narration id (0 when none). Every id gets an entry, so
 * a position removed since the last read (a story that ended) reads as 0.
 */
export async function readSavedPositions(
  narrationIds: readonly string[],
): Promise<Record<string, number>> {
  const ids = [...new Set(narrationIds.filter(Boolean))];
  const result: Record<string, number> = {};
  ids.forEach(id => {
    result[id] = 0;
  });
  if (ids.length === 0) return result;
  try {
    const pairs = await AsyncStorage.multiGet(ids.map(savedPositionKey));
    pairs.forEach(([key, raw], index) => {
      const id = ids[index] ?? key.slice('narration_position:'.length);
      result[id] = parseSavedPosition(raw);
    });
  } catch (error) {
    console.warn('[library] Reading saved positions failed:', error);
  }
  return result;
}

/** Forget a narration's saved position (it was deleted from the Library). */
export async function removeSavedPosition(narrationId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(savedPositionKey(narrationId));
  } catch (error) {
    console.warn('[library] Removing a saved position failed:', error);
  }
}
