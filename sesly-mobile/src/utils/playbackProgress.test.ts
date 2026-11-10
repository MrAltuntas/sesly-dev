/**
 * The shared playback progress value: anchoring, drift tolerance, seeking,
 * speed, the foreground gate and the binding to the audio store.
 */

import { Animated, AppState, NativeModules } from 'react-native';
import { observable, runInAction } from 'mobx';
import {
  DRIFT_TOLERANCE_MS,
  PROGRESS_CHUNK_MS,
  PlaybackProgressDriver,
  PlaybackSnapshot,
  SEEK_CONFIRM_MS,
  SeekConfirmation,
  bindPlaybackProgress,
  playedFraction,
  remainingMinutes,
} from './playbackProgress';

const valueOf = (value: Animated.Value): number =>
  (value as unknown as { __getValue: () => number }).__getValue();

const snap = (patch: Partial<PlaybackSnapshot> = {}): PlaybackSnapshot => ({
  narrationId: 'n-1',
  positionMs: 0,
  durationMs: 300000,
  playing: false,
  rate: 1,
  epoch: 0,
  ...patch,
});

function makeDriver() {
  const clock = { now: 1_000_000 };
  const driver = new PlaybackProgressDriver(() => clock.now);
  return { driver, clock };
}

let timing: jest.SpyInstance;

beforeEach(() => {
  timing = jest.spyOn(Animated, 'timing');
});

describe('remainingMinutes / playedFraction', () => {
  it('round the minutes up and clamp the fraction', () => {
    expect(remainingMinutes(134000, 362000)).toBe(4);
    expect(remainingMinutes(362000, 362000)).toBe(0);
    expect(remainingMinutes(0, 0)).toBeNull();
    expect(playedFraction(90, 360)).toBe(0.25);
    expect(playedFraction(500, 360)).toBe(1);
    expect(playedFraction(1, 0)).toBe(0);
  });

  it('minutes left follow the playback speed; an unusable rate counts as 1', () => {
    expect(remainingMinutes(0, 600000, 2)).toBe(5);
    expect(remainingMinutes(0, 600000)).toBe(10);
    expect(remainingMinutes(0, 600000, 0.5)).toBe(20);
    expect(remainingMinutes(0, 600000, 0)).toBe(10);
    expect(remainingMinutes(0, 600000, Number.NaN)).toBe(10);
    // 10 s left at 2,0x is still "1 dk", never 0 before the end.
    expect(remainingMinutes(590000, 600000, 2)).toBe(1);
  });
});

/**
 * Animated.timing replaced by a recorder: each started animation keeps its
 * end callback, so a test can finish (or stop) it at a chosen time.
 */
type EndResult = { finished: boolean };
interface TimingRun {
  config: { toValue: number; duration: number };
  end: (result: EndResult) => void;
  stop: jest.Mock;
}

function recordTimings(): TimingRun[] {
  const runs: TimingRun[] = [];
  timing.mockImplementation((_value: unknown, config: TimingRun['config']) => {
    const run: TimingRun = {
      config,
      end: () => undefined,
      stop: jest.fn(() => run.end({ finished: false })),
    };
    runs.push(run);
    return {
      start: (callback?: (result: EndResult) => void) => {
        run.end = (result: EndResult) => callback?.(result);
      },
      stop: run.stop,
      reset: jest.fn(),
    };
  });
  return runs;
}

describe('PlaybackProgressDriver chunks', () => {
  it('a 30-minute story from 0 starts a 20 s timing toward 20 000 / 1 800 000', () => {
    const runs = recordTimings();
    const { driver } = makeDriver();

    driver.sync(snap({ positionMs: 0, durationMs: 1_800_000, playing: true }));

    expect(runs).toHaveLength(1);
    expect(runs[0].config.duration).toBe(20000);
    expect(runs[0].config.toValue).toBeCloseTo(20000 / 1_800_000, 12);
  });

  it('a finished chunk starts the next one from the predicted position, not the chunk end', () => {
    const runs = recordTimings();
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 0, durationMs: 1_800_000, playing: true }));

    // The end callback reaches JS 10 ms after the native end.
    clock.now += 20010;
    runs[0].end({ finished: true });

    expect(runs).toHaveLength(2);
    expect(valueOf(driver.progress)).toBeCloseTo(20010 / 1_800_000, 12);
    expect(runs[1].config.duration).toBe(20000);
    expect(runs[1].config.toValue).toBeCloseTo(40010 / 1_800_000, 12);
    expect(driver.isAnimating).toBe(true);
  });

  it('a stopped chunk (finished false) starts nothing', () => {
    const runs = recordTimings();
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 0, durationMs: 1_800_000, playing: true }));

    clock.now += 5000;
    runs[0].end({ finished: false });

    expect(runs).toHaveLength(1);
    expect(driver.isAnimating).toBe(false);
  });

  it('pausing stops the chunk and its stop callback does not start another one', () => {
    const runs = recordTimings();
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 0, durationMs: 1_800_000, playing: true }));
    clock.now += 4000;

    driver.sync(snap({ positionMs: 4000, durationMs: 1_800_000, playing: false }));

    expect(runs[0].stop).toHaveBeenCalledTimes(1);
    expect(runs).toHaveLength(1);
    expect(driver.isAnimating).toBe(false);
    // A late end of the stopped chunk changes nothing either.
    runs[0].end({ finished: true });
    expect(runs).toHaveLength(1);
  });

  it('the last chunk ends at the end of the story and nothing follows it', () => {
    const runs = recordTimings();
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 290000, playing: true }));
    expect(runs[0].config).toMatchObject({ duration: 10000, toValue: 1 });

    clock.now += 10000;
    runs[0].end({ finished: true });

    expect(runs).toHaveLength(1);
    expect(valueOf(driver.progress)).toBe(1);
  });

  it('rate 0 animates at the normal speed', () => {
    const runs = recordTimings();
    const { driver } = makeDriver();

    driver.sync(snap({ positionMs: 290000, playing: true, rate: 0 }));

    expect(runs[0].config).toMatchObject({ duration: 10000, toValue: 1 });
  });
});

describe('PlaybackProgressDriver', () => {
  it('rests on the position while paused and animates nothing', () => {
    const { driver } = makeDriver();
    driver.sync(snap({ positionMs: 75000 }));
    expect(valueOf(driver.progress)).toBeCloseTo(0.25, 5);
    expect(timing).not.toHaveBeenCalled();
    expect(driver.isAnimating).toBe(false);
    expect(driver.narrationId).toBe('n-1');
  });

  it('while playing runs ONE linear native animation of at most 20 s toward the next point', () => {
    const { driver } = makeDriver();
    driver.sync(snap({ positionMs: 60000, playing: true }));
    expect(valueOf(driver.progress)).toBeCloseTo(0.2, 5);
    expect(timing).toHaveBeenCalledTimes(1);
    const config = timing.mock.calls[0][1];
    expect(config).toMatchObject({ duration: PROGRESS_CHUNK_MS, useNativeDriver: true });
    expect(config.toValue).toBeCloseTo(80000 / 300000, 10);
    // Linear: the bar moves at the speed of the audio.
    expect(config.easing(0.3)).toBeCloseTo(0.3, 5);
    expect(driver.isAnimating).toBe(true);
  });

  it('position reports that agree with the prediction do not restart the animation', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 60000, playing: true }));
    for (let i = 1; i <= 20; i++) {
      clock.now += 500;
      // The player reports with some jitter.
      driver.sync(snap({ positionMs: 60000 + i * 500 + (i % 2 ? 120 : -90), playing: true }));
    }
    expect(timing).toHaveBeenCalledTimes(1);
    expect(driver.expectedPositionMs()).toBe(70000);
  });

  it('re-anchors once a report has drifted past the tolerance (buffering)', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 60000, playing: true }));
    clock.now += 2000;
    // The audio stalled: two seconds passed, the position did not move.
    driver.sync(snap({ positionMs: 60000 + (2000 - DRIFT_TOLERANCE_MS - 50), playing: true }));
    expect(timing).toHaveBeenCalledTimes(2);
    expect(valueOf(driver.progress)).toBeCloseTo((60000 + 1550) / 300000, 5);
  });

  it('a seek re-anchors at once, even a tiny one, playing or paused', () => {
    const { driver } = makeDriver();
    driver.sync(snap({ positionMs: 60000, playing: true }));
    driver.sync(snap({ positionMs: 60100, playing: true, epoch: 1 }));
    expect(timing).toHaveBeenCalledTimes(2);
    expect(timing.mock.calls[1][1].duration).toBe(PROGRESS_CHUNK_MS);
    expect(timing.mock.calls[1][1].toValue).toBeCloseTo(80100 / 300000, 10);

    driver.sync(snap({ positionMs: 150000, playing: false, epoch: 2 }));
    expect(valueOf(driver.progress)).toBeCloseTo(0.5, 5);
    expect(driver.isAnimating).toBe(false);
  });

  it('pausing stops the animation where playback stopped', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 60000, playing: true }));
    clock.now += 3000;
    driver.sync(snap({ positionMs: 63000, playing: false }));
    expect(driver.isAnimating).toBe(false);
    expect(valueOf(driver.progress)).toBeCloseTo(0.21, 5);
    clock.now += 60000;
    expect(driver.expectedPositionMs()).toBe(63000);
  });

  it('the playback speed shortens the animation', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 0, playing: true, rate: 2 }));
    // 20 s of wall clock cover 40 s of audio at 2,0x.
    expect(timing.mock.calls[0][1].duration).toBe(PROGRESS_CHUNK_MS);
    expect(timing.mock.calls[0][1].toValue).toBeCloseTo(40000 / 300000, 10);
    clock.now += 1000;
    expect(driver.expectedPositionMs()).toBe(2000);
    // Changing the speed re-anchors.
    driver.sync(snap({ positionMs: 2000, playing: true, rate: 1 }));
    expect(timing).toHaveBeenCalledTimes(2);
    expect(timing.mock.calls[1][1].duration).toBe(PROGRESS_CHUNK_MS);
    expect(timing.mock.calls[1][1].toValue).toBeCloseTo(22000 / 300000, 10);
    // Near the end the last chunk is shorter, at the rate.
    driver.sync(snap({ positionMs: 290000, playing: true, rate: 2, epoch: 1 }));
    expect(timing.mock.calls[2][1]).toMatchObject({ duration: 5000, toValue: 1 });
  });

  it('a new duration (the player reported the real length) rescales the value', () => {
    const { driver } = makeDriver();
    driver.sync(snap({ positionMs: 60000, durationMs: 900000 }));
    expect(valueOf(driver.progress)).toBeCloseTo(60000 / 900000, 5);
    driver.sync(snap({ positionMs: 60000, durationMs: 300000 }));
    expect(valueOf(driver.progress)).toBeCloseTo(0.2, 5);
  });

  it('shows nothing for an unknown length, no story or a new track', () => {
    const { driver } = makeDriver();
    driver.sync(snap({ positionMs: 60000, playing: true }));
    driver.sync(snap({ narrationId: 'n-2', positionMs: 0, durationMs: 0, playing: true }));
    expect(valueOf(driver.progress)).toBe(0);
    expect(driver.isAnimating).toBe(false);
    driver.sync(snap({ narrationId: '', positionMs: 5000, durationMs: 9000, playing: true }));
    expect(valueOf(driver.progress)).toBe(0);
    expect(driver.isAnimating).toBe(false);
  });

  it('clamps a position past the end and does not animate from there', () => {
    const { driver } = makeDriver();
    driver.sync(snap({ positionMs: 400000, playing: true }));
    expect(valueOf(driver.progress)).toBe(1);
    expect(driver.isAnimating).toBe(false);
  });

  it('animates nothing in the background and picks up again in the foreground', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 60000, playing: true }));
    clock.now += 1000;
    driver.setForeground(false);
    expect(driver.isAnimating).toBe(false);
    expect(valueOf(driver.progress)).toBeCloseTo(61000 / 300000, 5);

    // Audio went on (a Pro user); the report arrives while hidden.
    clock.now += 30000;
    driver.sync(snap({ positionMs: 91000, playing: true }));
    expect(driver.isAnimating).toBe(false);

    driver.setForeground(true);
    expect(driver.isAnimating).toBe(true);
    expect(valueOf(driver.progress)).toBeCloseTo(91000 / 300000, 5);
    // Setting the same state again changes nothing.
    const calls = timing.mock.calls.length;
    driver.setForeground(true);
    expect(timing).toHaveBeenCalledTimes(calls);
  });
});

describe('bindPlaybackProgress', () => {
  const makeSource = () =>
    observable({
      audioId: 'n-1',
      isPlayingStory: true,
      isPlaying: false,
      currentPositionMs: 30000,
      totalDurationMs: 300000,
      playbackSpeed: 1,
      positionEpoch: 0,
      isSeeking: false,
      isBuffering: false,
    });

  it('a buffering stream holds the position and animates once audio arrives', () => {
    const source = makeSource();
    const { driver, clock } = makeDriver();
    bindPlaybackProgress(source, driver);

    runInAction(() => {
      source.isPlaying = true;
      source.isBuffering = true;
    });
    expect(driver.isAnimating).toBe(false);
    clock.now += 3000;
    // The intent is to play, but nothing ran ahead while it waited.
    expect(driver.expectedPositionMs()).toBe(30000);
    expect(valueOf(driver.progress)).toBeCloseTo(0.1, 5);

    runInAction(() => {
      source.isBuffering = false;
    });
    expect(driver.isAnimating).toBe(true);
    expect(valueOf(driver.progress)).toBeCloseTo(0.1, 5);
  });

  it('a start in progress holds the value with the intent to play, then animates', () => {
    const source = observable({ ...makeSource(), isLoading: true });
    const { driver, clock } = makeDriver();
    bindPlaybackProgress(source, driver);

    // An autoplay start: the intent is set before the stream is in the player.
    runInAction(() => {
      source.isPlaying = true;
    });
    expect(driver.isAnimating).toBe(false);
    clock.now += 2000;
    expect(driver.expectedPositionMs()).toBe(30000);

    runInAction(() => {
      source.isLoading = false;
    });
    expect(driver.isAnimating).toBe(true);
    expect(valueOf(driver.progress)).toBeCloseTo(0.1, 5);
  });

  it('an unknown length animates nothing and rests at 0', () => {
    const source = makeSource();
    runInAction(() => {
      source.totalDurationMs = 0;
      source.isPlaying = true;
    });
    const { driver } = makeDriver();

    bindPlaybackProgress(source, driver);

    expect(timing).not.toHaveBeenCalled();
    expect(valueOf(driver.progress)).toBe(0);

    // The real length arrives: the bar starts from the position.
    runInAction(() => {
      source.totalDurationMs = 300000;
    });
    expect(driver.isAnimating).toBe(true);
    expect(valueOf(driver.progress)).toBeCloseTo(0.1, 5);
  });

  it('a seek in flight holds the value at the target and starts no animation', () => {
    const source = makeSource();
    const { driver } = makeDriver();
    bindPlaybackProgress(source, driver);
    runInAction(() => {
      source.isPlaying = true;
    });
    timing.mockClear();

    runInAction(() => {
      source.isSeeking = true;
      source.currentPositionMs = 150000;
      source.positionEpoch += 1;
    });

    expect(timing).not.toHaveBeenCalled();
    expect(driver.isAnimating).toBe(false);
    expect(valueOf(driver.progress)).toBeCloseTo(0.5, 5);

    runInAction(() => {
      source.isSeeking = false;
    });
    expect(driver.isAnimating).toBe(true);
  });

  it("AppState 'inactive' pauses the animation and 'active' resumes it", () => {
    const addEventListener = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>);
    const source = makeSource();
    const { driver } = makeDriver();
    bindPlaybackProgress(source, driver);
    runInAction(() => {
      source.isPlaying = true;
    });
    const handler = addEventListener.mock.calls[0][1] as (state: string) => void;

    handler('inactive');
    expect(driver.isAnimating).toBe(false);
    handler('active');
    expect(driver.isAnimating).toBe(true);
  });

  it('bound while the app is in the background starts nothing', () => {
    const original = AppState.currentState;
    Object.defineProperty(AppState, 'currentState', { value: 'background', configurable: true, writable: true });
    try {
      const source = makeSource();
      runInAction(() => {
        source.isPlaying = true;
      });
      const { driver } = makeDriver();

      bindPlaybackProgress(source, driver);

      expect(timing).not.toHaveBeenCalled();
      expect(driver.isAnimating).toBe(false);
      expect(valueOf(driver.progress)).toBeCloseTo(0.1, 5);
    } finally {
      Object.defineProperty(AppState, 'currentState', { value: original, configurable: true, writable: true });
    }
  });

  it('follows the store: position, play, seek, and a preview shows nothing', () => {
    const source = makeSource();
    const { driver } = makeDriver();
    const dispose = bindPlaybackProgress(source, driver);
    expect(valueOf(driver.progress)).toBeCloseTo(0.1, 5);

    runInAction(() => {
      source.isPlaying = true;
    });
    expect(driver.isAnimating).toBe(true);

    runInAction(() => {
      source.currentPositionMs = 150000;
      source.positionEpoch += 1;
    });
    expect(valueOf(driver.progress)).toBeCloseTo(0.5, 5);

    // A voice preview takes the player: the story's bar is not a preview's.
    runInAction(() => {
      source.isPlayingStory = false;
      source.currentPositionMs = 2000;
    });
    expect(valueOf(driver.progress)).toBe(0);
    expect(driver.isAnimating).toBe(false);
    expect(driver.narrationId).toBe('');

    dispose();
    runInAction(() => {
      source.isPlayingStory = true;
      source.currentPositionMs = 270000;
      source.positionEpoch += 1;
    });
    expect(valueOf(driver.progress)).toBe(0);
  });

  it('listens to the app state and removes the listener when disposed', () => {
    const remove = jest.fn();
    const addEventListener = jest
      .spyOn(AppState, 'addEventListener')
      .mockReturnValue({ remove } as unknown as ReturnType<typeof AppState.addEventListener>);
    const source = makeSource();
    const { driver } = makeDriver();
    const dispose = bindPlaybackProgress(source, driver);
    runInAction(() => {
      source.isPlaying = true;
    });
    expect(driver.isAnimating).toBe(true);

    const handler = addEventListener.mock.calls[0][1] as (state: string) => void;
    handler('background');
    expect(driver.isAnimating).toBe(false);
    handler('active');
    expect(driver.isAnimating).toBe(true);

    dispose();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

/**
 * React Native's own end of a native animation, through the mocked native
 * module: `startAnimatingNode` keeps each end callback, and a test delivers
 * it the way the device does, late and with the value the native node had
 * when the animation was stopped. React Native copies that value into the
 * JS side and, on Fabric, commits it to the views (NL-01).
 */
type NativeEnd = (result: { finished: boolean; value?: number; offset?: number }) => void;

describe('PlaybackProgressDriver and the native end sync (NL-01)', () => {
  let startAnimatingNode: jest.SpyInstance;
  let ends: NativeEnd[];

  beforeEach(() => {
    ends = [];
    const nativeAnimated = NativeModules.NativeAnimatedModule as { startAnimatingNode: (...args: unknown[]) => void };
    startAnimatingNode = jest
      .spyOn(nativeAnimated, 'startAnimatingNode')
      .mockImplementation((...args: unknown[]) => {
        ends.push(args[3] as NativeEnd);
      });
  });

  afterEach(() => {
    startAnimatingNode.mockRestore();
  });

  it('runs the chunks on the native module', () => {
    const { driver } = makeDriver();
    driver.sync(snap({ positionMs: 100000, playing: true }));
    expect(startAnimatingNode).toHaveBeenCalledTimes(1);
    expect(ends).toHaveLength(1);
  });

  it('rewind 15 s: the stopped chunk reports the old position late, the value holds at the target', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 100000, playing: true }));
    clock.now += 2000;

    // The rewind is in flight: the value waits at the target.
    driver.sync(snap({ positionMs: 87000, playing: false, epoch: 1 }));
    expect(valueOf(driver.progress)).toBeCloseTo(87000 / 300000, 9);
    // The stream buffers after the rewind, nothing animates; then the end of
    // the stopped chunk arrives with where it stood at the stop.
    clock.now += 500;
    ends[0]({ finished: false, value: 102000 / 300000 });

    expect(valueOf(driver.progress)).toBeCloseTo(87000 / 300000, 9);
    expect(driver.shownFraction()).toBeCloseTo(87000 / 300000, 9);
  });

  it('a stale end that lands while the next chunk runs takes the running position', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 100000, playing: true }));
    clock.now += 2000;
    driver.sync(snap({ positionMs: 87000, playing: true, epoch: 1 }));
    expect(ends).toHaveLength(2);

    clock.now += 500;
    ends[0]({ finished: false, value: 102000 / 300000 });

    expect(valueOf(driver.progress)).toBeCloseTo(87500 / 300000, 9);
  });

  it('a forward skip and a pause: the late end of the stopped chunk moves nothing either', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 100000, playing: true }));
    clock.now += 1000;
    driver.sync(snap({ positionMs: 116000, playing: false, epoch: 1 }));
    ends[0]({ finished: false, value: 101000 / 300000 });
    expect(valueOf(driver.progress)).toBeCloseTo(116000 / 300000, 9);

    driver.sync(snap({ positionMs: 116000, playing: true, epoch: 1 }));
    clock.now += 3000;
    // Paused: the reported position is a little behind the native value.
    driver.sync(snap({ positionMs: 118900, playing: false, epoch: 1 }));
    ends[1]({ finished: false, value: 119000 / 300000 });
    expect(valueOf(driver.progress)).toBeCloseTo(118900 / 300000, 9);
  });

  it("a finished chunk's end lands on the next chunk's start", () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 0, durationMs: 1_800_000, playing: true }));

    clock.now += 20010;
    ends[0]({ finished: true, value: 20000 / 1_800_000 });

    expect(ends).toHaveLength(2);
    expect(valueOf(driver.progress)).toBeCloseTo(20010 / 1_800_000, 12);
  });

  it('a new story or no story: a late end of the old chunk keeps the value at the new start', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 100000, playing: true }));
    clock.now += 1000;
    driver.sync(snap({ narrationId: 'n-2', positionMs: 0, durationMs: 0, playing: true }));
    ends[0]({ finished: false, value: 101000 / 300000 });
    expect(valueOf(driver.progress)).toBe(0);
  });

  it('in the background the late end keeps the frozen position', () => {
    const { driver, clock } = makeDriver();
    driver.sync(snap({ positionMs: 100000, playing: true }));
    clock.now += 1000;
    driver.setForeground(false);
    clock.now += 60000;
    ends[0]({ finished: false, value: 101200 / 300000 });
    expect(valueOf(driver.progress)).toBeCloseTo(101000 / 300000, 9);
  });
});

describe('SeekConfirmation (NL-01)', () => {
  function makeSeek() {
    const clock = { now: 5_000_000 };
    return { seek: new SeekConfirmation(() => clock.now), clock };
  }

  it('rewind 15 s, then a stale report at the old position: the position holds at the target', () => {
    const { seek, clock } = makeSeek();
    // Playing at 1:54; the rewind goes to 1:39 and set the position epoch 4.
    seek.begin(99000, 4);
    clock.now += 30;
    seek.landed(4);
    clock.now += 450;

    // Reports the player read before the jump, on the old timeline.
    expect(seek.accepts(114000, 4)).toBe(false);
    expect(seek.accepts(114500, 4)).toBe(false);
    expect(seek.isWaiting(4)).toBe(true);
  });

  it('a report near the target confirms the seek; every report counts again after it', () => {
    const { seek, clock } = makeSeek();
    seek.begin(99000, 4);
    seek.landed(4);
    clock.now += 480;

    expect(seek.accepts(99450, 4)).toBe(true);
    expect(seek.isWaiting(4)).toBe(false);
    expect(seek.accepts(114000, 4)).toBe(true);
  });

  it('near means the target or ahead of it by the time since the seek, within the drift tolerance', () => {
    const near = (reportMs: number) => {
      const { seek, clock } = makeSeek();
      seek.begin(99000, 1);
      seek.landed(1);
      clock.now += 600;
      return seek.accepts(reportMs, 1);
    };
    expect(near(99000 - DRIFT_TOLERANCE_MS)).toBe(true);
    expect(near(99000 - DRIFT_TOLERANCE_MS - 1)).toBe(false);
    expect(near(99000 + 600 + DRIFT_TOLERANCE_MS)).toBe(true);
    expect(near(99000 + 600 + DRIFT_TOLERANCE_MS + 1)).toBe(false);
  });

  it('the time since the seek counts at the playback rate', () => {
    const { seek, clock } = makeSeek();
    seek.begin(99000, 1, 2);
    seek.landed(1);
    clock.now += 600;
    expect(seek.accepts(99000 + 1200 + DRIFT_TOLERANCE_MS, 1)).toBe(true);
  });

  it('after the window, a genuinely different report is accepted', () => {
    const { seek, clock } = makeSeek();
    seek.begin(99000, 4);
    seek.landed(4);
    clock.now += SEEK_CONFIRM_MS;
    expect(seek.accepts(114000, 4)).toBe(false);

    // The player did not follow the seek: a second later its report counts.
    clock.now += 1;
    expect(seek.accepts(114000, 4)).toBe(true);
    expect(seek.isWaiting(4)).toBe(false);
  });

  it('the window starts when the player answered the seek, not when it was sent', () => {
    const { seek, clock } = makeSeek();
    seek.begin(99000, 4);
    clock.now += 3000;
    expect(seek.accepts(114000, 4)).toBe(false);

    seek.landed(4);
    clock.now += SEEK_CONFIRM_MS;
    expect(seek.accepts(117000, 4)).toBe(false);
    clock.now += 1;
    expect(seek.accepts(117000, 4)).toBe(true);
  });

  it('a new epoch ends the window; an older seek landing late does not open one', () => {
    const { seek, clock } = makeSeek();
    seek.begin(99000, 4);
    seek.landed(4);
    // A new track (or a reload, a restart) bumped the epoch: its reports count.
    expect(seek.accepts(0, 5)).toBe(true);
    expect(seek.isWaiting(5)).toBe(false);

    // Two seeks in a row: the first one's answer does not start the second's window.
    seek.begin(80000, 6);
    seek.begin(65000, 7);
    seek.landed(6);
    clock.now += SEEK_CONFIRM_MS + 1;
    expect(seek.accepts(80000, 7)).toBe(false);
    seek.landed(7);
    expect(seek.accepts(65100, 7)).toBe(true);
  });

  it('nothing to confirm: every report counts', () => {
    const { seek } = makeSeek();
    expect(seek.isWaiting(0)).toBe(false);
    expect(seek.accepts(123456, 0)).toBe(true);
  });
});
