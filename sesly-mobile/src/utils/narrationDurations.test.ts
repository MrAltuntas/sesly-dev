/**
 * Real narration lengths remembered on the device.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { autorun } from 'mobx';
import {
  NARRATION_DURATIONS_LIMIT,
  NARRATION_DURATIONS_STORAGE_KEY,
  hydrateNarrationDurations,
  knownNarrationDurationMs,
  rememberNarrationDuration,
  resetNarrationDurationsForTests,
  resolveNarrationDurationMs,
} from './narrationDurations';

const stored = async (): Promise<Record<string, number>> =>
  JSON.parse((await AsyncStorage.getItem(NARRATION_DURATIONS_STORAGE_KEY)) ?? '{}');

/** Let the write that follows a remembered length reach storage. */
const settle = async (): Promise<void> => {
  await hydrateNarrationDurations();
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(async () => {
  resetNarrationDurationsForTests();
  await AsyncStorage.clear();
});

describe('narrationDurations', () => {
  it('prefers the length the player reported over the backend estimate', async () => {
    // The backend says 16 minutes; the audio is 5:30.
    expect(resolveNarrationDurationMs('n-1', 960000)).toBe(960000);
    rememberNarrationDuration('n-1', 330000.4);
    expect(knownNarrationDurationMs('n-1')).toBe(330000);
    expect(resolveNarrationDurationMs('n-1', 960000)).toBe(330000);
    await settle();
    expect(await stored()).toEqual({ 'n-1': 330000 });
  });

  it('falls back to 0 when neither a real length nor a usable estimate exists', () => {
    expect(resolveNarrationDurationMs('n-1', 0)).toBe(0);
    expect(resolveNarrationDurationMs('n-1', NaN)).toBe(0);
    expect(resolveNarrationDurationMs(null, undefined)).toBe(0);
    expect(knownNarrationDurationMs('')).toBeNull();
  });

  it('ignores invalid reports and does not rewrite an unchanged length', async () => {
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    rememberNarrationDuration('', 1000);
    rememberNarrationDuration('n-1', 0);
    rememberNarrationDuration('n-1', Number.NaN);
    rememberNarrationDuration('n-1', Number.POSITIVE_INFINITY);
    expect(knownNarrationDurationMs('n-1')).toBeNull();

    rememberNarrationDuration('n-1', 330000);
    rememberNarrationDuration('n-1', 330200);
    await settle();
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(knownNarrationDurationMs('n-1')).toBe(330000);

    // A real change (the first report was short) is taken.
    rememberNarrationDuration('n-1', 341000);
    expect(knownNarrationDurationMs('n-1')).toBe(341000);
    await settle();
    expect(setItem).toHaveBeenCalledTimes(2);
  });

  it('reads the stored lengths once and keeps what was learned meanwhile', async () => {
    await AsyncStorage.setItem(
      NARRATION_DURATIONS_STORAGE_KEY,
      JSON.stringify({ 'n-1': 300000, 'n-2': 120000, bad: 'x', neg: -4 }),
    );
    rememberNarrationDuration('n-2', 125000);
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    await Promise.all([hydrateNarrationDurations(), hydrateNarrationDurations()]);
    expect(getItem).toHaveBeenCalledTimes(1);
    expect(knownNarrationDurationMs('n-1')).toBe(300000);
    expect(knownNarrationDurationMs('n-2')).toBe(125000);
    expect(knownNarrationDurationMs('bad')).toBeNull();
    expect(knownNarrationDurationMs('neg')).toBeNull();
    // The write waited for the read: nothing stored was lost.
    await settle();
    expect(await stored()).toEqual({ 'n-1': 300000, 'n-2': 125000 });
  });

  it('has nothing to remember when the report confirms the estimate', async () => {
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    rememberNarrationDuration('n-1', 300100, 300000);
    await settle();
    expect(knownNarrationDurationMs('n-1')).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    rememberNarrationDuration('n-1', 104500, 300000);
    expect(knownNarrationDurationMs('n-1')).toBe(104500);
  });

  it('survives unreadable or malformed storage', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await AsyncStorage.setItem(NARRATION_DURATIONS_STORAGE_KEY, '{not json');
    await expect(hydrateNarrationDurations()).resolves.toBeUndefined();

    resetNarrationDurationsForTests();
    await AsyncStorage.setItem(NARRATION_DURATIONS_STORAGE_KEY, '7');
    await expect(hydrateNarrationDurations()).resolves.toBeUndefined();
    expect(knownNarrationDurationMs('n-1')).toBeNull();

    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    rememberNarrationDuration('n-1', 1000);
    await settle();
    expect(knownNarrationDurationMs('n-1')).toBe(1000);
  });

  it('is observable: a reader is told when the real length arrives', () => {
    const seen: number[] = [];
    const dispose = autorun(() => {
      seen.push(resolveNarrationDurationMs('n-1', 960000));
    });
    rememberNarrationDuration('n-1', 330000);
    dispose();
    expect(seen).toEqual([960000, 330000]);
  });

  it('drops the oldest entries past the limit', () => {
    for (let i = 0; i < NARRATION_DURATIONS_LIMIT + 5; i++) {
      rememberNarrationDuration(`n-${i}`, 1000 + i * 1000);
    }
    expect(knownNarrationDurationMs('n-0')).toBeNull();
    expect(knownNarrationDurationMs('n-4')).toBeNull();
    expect(knownNarrationDurationMs('n-5')).toBe(6000);
    expect(knownNarrationDurationMs(`n-${NARRATION_DURATIONS_LIMIT + 4}`)).not.toBeNull();
  });
});
