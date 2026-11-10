/**
 * The sleep timer's drain (sleepDrain.ts): one native-driven value anchored
 * on the wall clock, run in chunks of at most 20 s, re-anchored on a new
 * deadline or length, stopped in the background and while nothing shows it.
 *
 * Animated.timing is replaced by a recorder, so a chunk ends exactly when a
 * test says so (finished or stopped).
 */

import { Animated, AppState } from 'react-native';
import { makeAutoObservable, runInAction } from 'mobx';
import { DrainSource, SLEEP_DRAIN_CHUNK_MS, SleepDrain, drainFraction } from './sleepDrain';

jest.mock('../../services/UserPreferencesService', () => ({
  __esModule: true,
  default: { getCachedSync: () => null, get: jest.fn(() => new Promise(() => undefined)), update: jest.fn() },
}));

const NOW = 1_800_000_000_000;
const MINUTE = 60000;

type Source = { -readonly [K in keyof DrainSource]: DrainSource[K] };

const source = (overrides: Partial<Source> = {}): Source =>
  makeAutoObservable({
    isDurationRunning: true,
    endsAtMs: (NOW + 30 * MINUTE) as number | null,
    durationTotalMs: 30 * MINUTE,
    ...overrides,
  });

interface Chunk {
  value: unknown;
  config: Animated.TimingAnimationConfig;
  stopped: boolean;
  /** End the chunk as the native driver would. */
  end: (finished: boolean) => void;
}

/** Record every Animated.timing; nothing runs until a test ends a chunk. */
function recordTimings(): Chunk[] {
  const chunks: Chunk[] = [];
  jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
    let callback: Animated.EndCallback | undefined;
    const chunk: Chunk = {
      value,
      config,
      stopped: false,
      end: finished => callback?.({ finished }),
    };
    chunks.push(chunk);
    return {
      start: (cb?: Animated.EndCallback) => {
        callback = cb;
      },
      stop: () => {
        chunk.stopped = true;
        callback?.({ finished: false });
      },
      reset: () => undefined,
    } as Animated.CompositeAnimation;
  });
  return chunks;
}

const appState = AppState as unknown as { currentState: unknown; addEventListener: jest.Mock };
const originalState = appState.currentState;

/** The AppState listener of the drain (the last one registered). */
const appStateListener = () =>
  appState.addEventListener.mock.calls.filter(c => c[0] === 'change').pop()?.[1] as (s: string) => void;

const valueOf = (drain: SleepDrain) => (drain.value as unknown as { __getValue(): number }).__getValue();

beforeEach(() => {
  jest.setSystemTime(NOW);
  appState.currentState = originalState;
});

afterEach(() => {
  appState.currentState = originalState;
});

describe('drainFraction', () => {
  it('is the part of the timer left, clamped to 0..1', () => {
    expect(drainFraction(NOW + 15 * MINUTE, 30 * MINUTE, NOW)).toBe(0.5);
    expect(drainFraction(NOW + 30 * MINUTE, 30 * MINUTE, NOW)).toBe(1);
    expect(drainFraction(NOW + 40 * MINUTE, 30 * MINUTE, NOW)).toBe(1);
    expect(drainFraction(NOW - 1, 30 * MINUTE, NOW)).toBe(0);
    expect(drainFraction(null, 30 * MINUTE, NOW)).toBe(0);
    expect(drainFraction(NOW + MINUTE, 0, NOW)).toBe(0);
  });
});

describe('SleepDrain', () => {
  it('runs from the wall clock toward the deadline in native linear chunks of 20 s', () => {
    const chunks = recordTimings();
    const drain = new SleepDrain(source());
    const release = drain.retain();

    expect(chunks).toHaveLength(1);
    const [first] = chunks;
    expect(first.value).toBe(drain.value);
    expect(valueOf(drain)).toBe(1);
    expect(first.config.duration).toBe(SLEEP_DRAIN_CHUNK_MS);
    expect(first.config.toValue).toBeCloseTo(1 - 20_000 / (30 * MINUTE), 12);
    expect(first.config.useNativeDriver).toBe(true);
    expect(first.config.easing?.(0.25)).toBeCloseTo(0.25);

    // The chunk ends a little late: the next one starts from the clock, not from the chunk's end.
    jest.setSystemTime(NOW + 20_500);
    first.end(true);
    expect(chunks).toHaveLength(2);
    expect(valueOf(drain)).toBeCloseTo((30 * MINUTE - 20_500) / (30 * MINUTE), 12);
    expect(chunks[1].config.duration).toBe(20_000);
    expect(chunks[1].config.toValue).toBeCloseTo((30 * MINUTE - 40_500) / (30 * MINUTE), 12);
    release();
  });

  it('a stopped chunk starts nothing', () => {
    const chunks = recordTimings();
    const drain = new SleepDrain(source());
    const release = drain.retain();
    chunks[0].end(false);
    expect(chunks).toHaveLength(1);
    release();
  });

  it('the last chunk ends at the deadline, and nothing runs after it', () => {
    const chunks = recordTimings();
    const drain = new SleepDrain(source({ endsAtMs: NOW + 5_000, durationTotalMs: MINUTE }));
    const release = drain.retain();
    expect(chunks[0].config.duration).toBe(5_000);
    expect(chunks[0].config.toValue).toBe(0);
    jest.setSystemTime(NOW + 5_000);
    chunks[0].end(true);
    expect(valueOf(drain)).toBe(0);
    expect(chunks).toHaveLength(1);
    release();

    const done = new SleepDrain(source({ endsAtMs: NOW - 1 }));
    const releaseDone = done.retain();
    expect(valueOf(done)).toBe(0);
    expect(chunks).toHaveLength(1);
    releaseDone();
  });

  it('re-anchors on a new deadline or length ("+5 dk") and rests at 0 when the timer stops', () => {
    const chunks = recordTimings();
    const timer = source({ endsAtMs: NOW + 10 * MINUTE, durationTotalMs: 20 * MINUTE });
    const drain = new SleepDrain(timer);
    const release = drain.retain();
    expect(valueOf(drain)).toBe(0.5);

    runInAction(() => {
      timer.endsAtMs = NOW + 15 * MINUTE;
      timer.durationTotalMs = 25 * MINUTE;
    });
    expect(chunks[0].stopped).toBe(true);
    expect(valueOf(drain)).toBeCloseTo(0.6, 12);
    expect(chunks).toHaveLength(2);

    runInAction(() => {
      timer.isDurationRunning = false;
      timer.endsAtMs = null;
      timer.durationTotalMs = 0;
    });
    expect(chunks[1].stopped).toBe(true);
    expect(valueOf(drain)).toBe(0);
    expect(chunks).toHaveLength(2);
    release();
  });

  it('stops in the background and starts again from the clock on return', () => {
    const chunks = recordTimings();
    const drain = new SleepDrain(source());
    const release = drain.retain();
    const listener = appStateListener();

    listener('background');
    expect(chunks[0].stopped).toBe(true);
    // Locked for 10 minutes: nothing ran meanwhile.
    jest.setSystemTime(NOW + 10 * MINUTE);
    expect(chunks).toHaveLength(1);

    listener('inactive');
    expect(chunks).toHaveLength(1);
    listener('active');
    expect(valueOf(drain)).toBeCloseTo(20 / 30, 12);
    expect(chunks).toHaveLength(2);
    release();
  });

  it('opened in the background it waits for the foreground', () => {
    appState.currentState = 'background';
    const chunks = recordTimings();
    const drain = new SleepDrain(source({ endsAtMs: NOW + 15 * MINUTE }));
    const release = drain.retain();
    expect(valueOf(drain)).toBe(0.5);
    expect(chunks).toHaveLength(0);
    appStateListener()('active');
    expect(chunks).toHaveLength(1);
    release();
  });

  it('runs while anything shows it, and stops listening when the last one goes', () => {
    const chunks = recordTimings();
    const timer = source();
    const drain = new SleepDrain(timer);
    const a = drain.retain();
    const b = drain.retain();
    expect(chunks).toHaveLength(1);
    a();
    a(); // a second release of the same hold does nothing
    runInAction(() => {
      timer.endsAtMs = NOW + 20 * MINUTE;
    });
    expect(chunks).toHaveLength(2);

    b();
    expect(chunks[1].stopped).toBe(true);
    runInAction(() => {
      timer.endsAtMs = NOW + 25 * MINUTE;
    });
    expect(chunks).toHaveLength(2);
    const subscription = appState.addEventListener.mock.results.at(-1)?.value as { remove: jest.Mock };
    expect(subscription.remove).toHaveBeenCalled();
  });
});
