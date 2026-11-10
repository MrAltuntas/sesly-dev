/**
 * Real narration lengths, as reported by the player, remembered on the device.
 *
 * The backend's stored `totalDuration` is an estimate made before the audio
 * exists and runs about three times too long. Once the player has loaded a
 * narration it knows the real length; that value is kept here (in memory and
 * in AsyncStorage) and every place that shows a length or "N dk kaldı" for a
 * narration asks `resolveNarrationDurationMs` first, so the player, the mini
 * player and the library rows agree.
 *
 * The map is a MobX observable: an observer that read a length re-renders
 * when the real one arrives.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { observable, runInAction } from 'mobx';

export const NARRATION_DURATIONS_STORAGE_KEY = '@sesly/narrationDurations';
/** Oldest entries are dropped past this many narrations. */
export const NARRATION_DURATIONS_LIMIT = 300;
/** A new report closer than this to the stored one is not worth a write. */
const CHANGE_THRESHOLD_MS = 500;

const durations = observable.map<string, number>({}, { deep: false });
let hydration: Promise<void> | null = null;

const valid = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * Write the whole map. Waits for the first read, so a length learned before
 * hydration finished never overwrites the stored ones.
 */
function persist(): void {
  hydrateNarrationDurations()
    .then(() => {
      const snapshot: Record<string, number> = {};
      durations.forEach((value, key) => {
        snapshot[key] = value;
      });
      return AsyncStorage.setItem(NARRATION_DURATIONS_STORAGE_KEY, JSON.stringify(snapshot));
    })
    .catch(err => console.warn('[narrationDurations] write failed:', err));
}

/** Read the stored lengths once. Values learned meanwhile win over stored ones. */
export function hydrateNarrationDurations(): Promise<void> {
  if (!hydration) {
    hydration = (async () => {
      try {
        const raw = await AsyncStorage.getItem(NARRATION_DURATIONS_STORAGE_KEY);
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return;
        runInAction(() => {
          for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (id && valid(value) && !durations.has(id)) durations.set(id, value);
          }
        });
      } catch (err) {
        console.warn('[narrationDurations] read failed:', err);
      }
    })();
  }
  return hydration;
}

/** The real length of a narration in milliseconds, or null when the player never reported it. */
export function knownNarrationDurationMs(narrationId: string | null | undefined): number | null {
  if (!narrationId) return null;
  return durations.get(narrationId) ?? null;
}

/** The real length when known, else the given estimate (0 when neither is usable). */
export function resolveNarrationDurationMs(
  narrationId: string | null | undefined,
  estimateMs: number | null | undefined,
): number {
  return knownNarrationDurationMs(narrationId) ?? (valid(estimateMs) ? estimateMs : 0);
}

/**
 * Store the length the player reported for a narration.
 *
 * @param estimateMs the length shown so far (the backend's). When the report
 *   confirms it and nothing is stored yet, there is nothing to remember.
 */
export function rememberNarrationDuration(
  narrationId: string,
  durationMs: number,
  estimateMs?: number | null,
): void {
  if (!narrationId || !valid(durationMs)) return;
  const rounded = Math.round(durationMs);
  const previous = durations.get(narrationId) ?? (valid(estimateMs) ? estimateMs : null);
  if (previous != null && Math.abs(previous - rounded) < CHANGE_THRESHOLD_MS) return;
  runInAction(() => {
    // Re-insert so the entry counts as the newest one.
    durations.delete(narrationId);
    durations.set(narrationId, rounded);
    while (durations.size > NARRATION_DURATIONS_LIMIT) {
      const oldest = durations.keys().next().value;
      if (oldest === undefined) break;
      durations.delete(oldest);
    }
  });
  persist();
}

/** Tests only: forget everything, including the hydration memo. */
export function resetNarrationDurationsForTests(): void {
  runInAction(() => durations.clear());
  hydration = null;
}
