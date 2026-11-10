import { AppState } from 'react-native';
import { makeAutoObservable, runInAction } from 'mobx';
import type { UserPreferences } from '../models/UserPreferences';
import type { SleepTimerPlayer } from './SleepTimerService';
import type { SleepDeadline, SleepTimerFiredEvent } from '../utils/sleepDeadline';

const mockGetCachedSync = jest.fn();
const mockPrefsGet = jest.fn();
const mockPrefsUpdate = jest.fn();
const mockToastInfo = jest.fn();

jest.mock('./UserPreferencesService', () => ({
  __esModule: true,
  default: {
    getCachedSync: (...args: unknown[]) => mockGetCachedSync(...args),
    get: (...args: unknown[]) => mockPrefsGet(...args),
    update: (...args: unknown[]) => mockPrefsUpdate(...args),
  },
}));
jest.mock('../utils/toast', () => ({
  showToast: { info: (...args: unknown[]) => mockToastInfo(...args) },
}));

/** The native deadline the service sees (null: none, as on iOS and older binaries). */
let mockDeadline: SleepDeadline | null = null;
jest.mock('../utils/sleepDeadline', () => ({
  getNativeSleepDeadline: () => mockDeadline,
}));

type SleepTimerModule = typeof import('./SleepTimerService');

/** Fresh singleton + store per test. */
const loadModule = (): SleepTimerModule => {
  let mod: SleepTimerModule | undefined;
  jest.isolateModules(() => {
    mod = require('./SleepTimerService') as SleepTimerModule;
  });
  return mod as SleepTimerModule;
};
const loadService = (): SleepTimerModule['default'] => loadModule().default;

const prefs = (overrides: Partial<UserPreferences> = {}): UserPreferences => ({
  userId: 'u-1',
  sleepTimerFadeOut: false,
  sleepTimerPauseWhenAsleep: true,
  sleepTimerLastDuration: 45,
  voiceReadyNotifications: true,
  narrationReadyNotifications: true,
  promoNotifications: false,
  contentLanguage: null,
  effectiveContentLanguage: 'tr',
  uiLanguage: null,
  settings: {},
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
  ...overrides,
});

interface FakePlayer extends SleepTimerPlayer {
  isPlaying: boolean;
  currentPositionMs: number;
  totalDuration: number;
  playbackSpeed: number;
  nativePlayer: object | null;
  pause: jest.Mock;
  setVolume: jest.Mock;
}

/** A plain player: the ticker drives the timer. */
const fakePlayer = (overrides: Partial<FakePlayer> = {}): FakePlayer => ({
  isPlaying: true,
  currentPositionMs: 0,
  totalDuration: 300,
  playbackSpeed: 1,
  nativePlayer: null,
  pause: jest.fn(),
  setVolume: jest.fn(),
  ...overrides,
});

/** An observable player like the audio store: its position reports tick the timer. */
const observablePlayer = (overrides: Partial<FakePlayer> = {}): FakePlayer =>
  makeAutoObservable(fakePlayer(overrides), { pause: false, setVolume: false, nativePlayer: false });

const report = (player: FakePlayer, positionMs: number) =>
  runInAction(() => {
    player.currentPositionMs = positionMs;
  });

interface FakeDeadline extends SleepDeadline {
  arm: jest.Mock;
  disarm: jest.Mock;
  fire: (event?: Partial<SleepTimerFiredEvent>) => void;
}

const fakeDeadline = (): FakeDeadline => {
  const listeners: ((event: SleepTimerFiredEvent) => void)[] = [];
  return {
    arm: jest.fn(),
    disarm: jest.fn(),
    onFired: jest.fn((listener: (event: SleepTimerFiredEvent) => void) => {
      listeners.push(listener);
      return () => undefined;
    }),
    fire: event =>
      listeners.forEach(l => l({ paused: true, firedAtMs: Date.now(), ...event } as SleepTimerFiredEvent)),
  };
};

const START = new Date(2026, 9, 13, 21, 42, 0).getTime();
const MINUTE = 60000;

const appState = AppState as unknown as { currentState: unknown; addEventListener: jest.Mock };
const originalAppState = appState.currentState;

/** The listener the service registered for AppState changes (the last one). */
const appStateListener = (): ((state: string) => void) => {
  const calls = appState.addEventListener.mock.calls.filter(call => call[0] === 'change');
  return calls[calls.length - 1][1];
};

beforeEach(() => {
  jest.setSystemTime(START);
  mockDeadline = null;
  appState.currentState = originalAppState;
  mockGetCachedSync.mockReset();
  mockGetCachedSync.mockReturnValue(null);
  mockPrefsGet.mockReset();
  mockPrefsGet.mockResolvedValue(prefs());
  mockPrefsUpdate.mockReset();
  mockPrefsUpdate.mockResolvedValue(prefs());
  mockToastInfo.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  appState.currentState = originalAppState;
  jest.clearAllTimers();
});

describe('SleepTimerService.initialize', () => {
  it('starts off, on "Süre dolunca" with 20 minutes for a user who never chose', () => {
    const service = loadService();
    expect(service.store.active).toBe(false);
    expect(service.store.mode).toBe('duration');
    expect(service.store.storyCount).toBe(1);
    expect(service.store.durationMin).toBe(20);
    expect(service.store.lastDurationMin).toBeNull();
    expect(service.store.fadeOut).toBe(true);
    expect(service.store.isHydrated).toBe(false);
  });

  it('a fresh store turns on a 20 minute duration timer', () => {
    const service = loadService();
    service.turnOn();
    expect(service.store.isDurationRunning).toBe(true);
    expect(service.store.endsAtMs).toBe(START + 20 * MINUTE);
    expect(service.store.durationTotalMs).toBe(20 * MINUTE);
  });

  it('hydrates from the cached snapshot, then from the backend; a stored mode wins', async () => {
    mockGetCachedSync.mockReturnValue(prefs({ sleepTimerLastDuration: 10 }));
    let resolve: (p: UserPreferences) => void = () => {};
    mockPrefsGet.mockImplementation(
      () =>
        new Promise<UserPreferences>(r => {
          resolve = r;
        }),
    );
    const service = loadService();

    const init = service.initialize();
    expect(service.store.durationMin).toBe(10);
    expect(service.store.isHydrated).toBe(true);

    resolve(
      prefs({
        sleepTimerLastDuration: 60,
        settings: { sleepTimerMode: 'stories', sleepTimerStoryCount: 3 },
      }),
    );
    await init;

    expect(service.store.lastDurationMin).toBe(60);
    expect(service.store.durationMin).toBe(60);
    expect(service.store.fadeOut).toBe(false);
    expect(service.store.pauseWhenAsleep).toBe(true);
    expect(service.store.mode).toBe('stories');
    expect(service.store.storyCount).toBe(3);
    expect(service.store.active).toBe(false); // a running timer is never restored
  });

  it('keeps the defaults when the backend has no duration, mode or count', async () => {
    mockPrefsGet.mockResolvedValue(
      prefs({ sleepTimerLastDuration: null, settings: { sleepTimerMode: 'weekly', sleepTimerStoryCount: 'x' } }),
    );
    const service = loadService();
    await service.initialize();
    expect(service.store.lastDurationMin).toBeNull();
    expect(service.store.durationMin).toBe(20);
    expect(service.store.mode).toBe('duration');
    expect(service.store.storyCount).toBe(1);
  });

  it('does not change the mode of a timer that is already running', async () => {
    mockPrefsGet.mockResolvedValue(prefs({ settings: { sleepTimerMode: 'stories' } }));
    const service = loadService();
    service.turnOn();
    await service.initialize();
    expect(service.store.mode).toBe('duration');
    expect(service.store.active).toBe(true);
  });

  it('dedupes concurrent calls and is a no-op once hydrated', async () => {
    const service = loadService();
    await Promise.all([service.initialize(), service.initialize()]);
    await service.initialize();
    expect(mockPrefsGet).toHaveBeenCalledTimes(1);
  });

  it('swallows a failed fetch and retries on the next call', async () => {
    mockPrefsGet.mockRejectedValueOnce(new Error('offline'));
    const service = loadService();

    await expect(service.initialize()).resolves.toBeUndefined();
    expect(service.store.isHydrated).toBe(false);

    await service.initialize();
    expect(service.store.isHydrated).toBe(true);
    expect(mockPrefsGet).toHaveBeenCalledTimes(2);
  });
});

describe('SleepTimerService: the switch and the mode', () => {
  it('turns on in the last used mode and off again', () => {
    const service = loadService();
    service.setMode('stories');
    service.turnOn();
    expect(service.store.active).toBe(true);
    expect(service.store.mode).toBe('stories');
    expect(service.store.storiesLeft).toBe(1);

    service.turnOff();
    expect(service.store.active).toBe(false);
    expect(service.store.storiesLeft).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('turns on a duration timer with the last duration when that was the mode', async () => {
    mockPrefsGet.mockResolvedValue(prefs({ sleepTimerLastDuration: 25, settings: { sleepTimerMode: 'duration' } }));
    const service = loadService();
    await service.initialize();

    service.turnOn();

    expect(service.store.isDurationRunning).toBe(true);
    expect(service.store.remainingSeconds).toBe(25 * 60);
    expect(service.store.endsAtMs).toBe(START + 25 * MINUTE);
    // Nothing changed against the stored values: no PATCH.
    expect(mockPrefsUpdate).not.toHaveBeenCalled();
  });

  it('setMode switches a running timer at once and remembers the mode', () => {
    const service = loadService();
    service.setMode('stories');
    service.turnOn();
    mockPrefsUpdate.mockClear();

    service.setMode('duration');
    expect(service.store.mode).toBe('duration');
    expect(service.store.isDurationRunning).toBe(true);
    expect(service.store.storiesLeft).toBe(0);
    expect(mockPrefsUpdate).toHaveBeenCalledWith({ sleepTimerLastDuration: 20 });
    expect(mockPrefsUpdate).toHaveBeenCalledWith({ settings: { sleepTimerMode: 'duration' } });

    service.setMode('stories', { maxStories: 4 });
    expect(service.store.mode).toBe('stories');
    expect(service.store.endsAtMs).toBeNull();
    expect(service.store.durationTotalMs).toBe(0);
    expect(service.store.storiesLeft).toBe(1);
    expect(mockPrefsUpdate).toHaveBeenLastCalledWith({ settings: { sleepTimerMode: 'stories' } });
  });

  it('setMode while off only remembers the choice', () => {
    const service = loadService();
    service.setMode('stories');
    expect(service.store.active).toBe(false);
    expect(service.store.mode).toBe('stories');
    expect(mockPrefsUpdate).toHaveBeenCalledWith({ settings: { sleepTimerMode: 'stories' } });

    mockPrefsUpdate.mockClear();
    service.setMode('stories');
    expect(mockPrefsUpdate).not.toHaveBeenCalled();
  });

  it('resetMode() is turnOff()', () => {
    const service = loadService();
    service.startDuration(30);
    service.resetMode();
    expect(service.store.active).toBe(false);
    expect(service.store.lastDurationMin).toBe(30);
  });

  it('keeps the optimistic state when the PATCH fails', async () => {
    mockPrefsUpdate.mockRejectedValue(new Error('offline'));
    const service = loadService();

    service.startDuration(15);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(service.store.lastDurationMin).toBe(15);
    expect(console.warn).toHaveBeenCalledWith(
      '[SleepTimerService] Preference sync failed:',
      expect.any(Error),
    );
  });
});

describe('SleepTimerService: stop after N stories', () => {
  /** A service on "Masal bitince", the PATCH of that choice forgotten. */
  const storiesService = () => {
    const service = loadService();
    service.setMode('stories');
    mockPrefsUpdate.mockClear();
    return service;
  };

  it('remembers the count, clamped to the queue', () => {
    const service = storiesService();
    service.turnOn({ maxStories: 3 });

    service.setStoryCount(2, 3);
    expect(service.store.storyCount).toBe(2);
    expect(service.store.storiesLeft).toBe(2);
    expect(mockPrefsUpdate).toHaveBeenLastCalledWith({ settings: { sleepTimerStoryCount: 2 } });

    service.setStoryCount(9, 3);
    expect(service.store.storiesLeft).toBe(3);
    service.setStoryCount(0, 3);
    expect(service.store.storiesLeft).toBe(1);
  });

  it("turning on clamps the remembered count to today's queue", () => {
    const service = storiesService();
    service.setStoryCount(5);
    service.turnOn({ maxStories: 2 });
    expect(service.store.storiesLeft).toBe(2);
    expect(service.store.storyCount).toBe(5); // the preference is not rewritten
  });

  it('counts finished stories and stops at the end of the last one', () => {
    const service = storiesService();
    service.turnOn({ maxStories: 3 });
    service.setStoryCount(2, 3);

    expect(service.handleStoryFinished()).toBe('continue');
    expect(service.store.storiesLeft).toBe(1);
    expect(service.store.active).toBe(true);

    expect(service.handleStoryFinished()).toBe('stop');
    expect(service.store.active).toBe(false);

    // Off: playback carries on as without a timer.
    expect(service.handleStoryFinished()).toBe('continue');
  });

  it('a duration timer does not count stories', () => {
    const service = loadService();
    service.startDuration(10);
    expect(service.handleStoryFinished()).toBe('continue');
    expect(service.store.active).toBe(true);
  });

  it('fades over the last minute of the last story and restores the volume', () => {
    const service = storiesService();
    const player = fakePlayer({ totalDuration: 300, currentPositionMs: 200_000 });
    service.attachPlayer(player);
    service.turnOn();

    jest.advanceTimersByTime(1000);
    expect(player.setVolume).not.toHaveBeenCalled(); // 100 s left

    player.currentPositionMs = 270_000; // 30 s left
    jest.advanceTimersByTime(1000);
    expect(player.setVolume).toHaveBeenLastCalledWith(0.5);
    expect(service.isFading).toBe(true);

    expect(service.handleStoryFinished()).toBe('stop');
    expect(player.setVolume).toHaveBeenLastCalledWith(1);
    expect(service.isFading).toBe(false);
  });

  it('fades from the position reports alone, with every JS timer stopped (screen off)', () => {
    const service = storiesService();
    const player = observablePlayer({ totalDuration: 300, currentPositionMs: 200_000 });
    service.attachPlayer(player);
    service.turnOn();

    report(player, 285_000); // 15 s left, no timer advanced
    expect(player.setVolume).toHaveBeenLastCalledWith(0.25);
  });

  it('measures the last minute in listening time (speed)', () => {
    const service = storiesService();
    const player = fakePlayer({ totalDuration: 300, currentPositionMs: 210_000, playbackSpeed: 2 });
    service.attachPlayer(player);
    service.turnOn();

    jest.advanceTimersByTime(1000); // 90 s of audio = 45 s of listening
    expect(player.setVolume).toHaveBeenLastCalledWith(0.75);
  });

  it('does not fade while more stories are to come, when paused, or with fade-out off', () => {
    const service = storiesService();
    const player = fakePlayer({ totalDuration: 300, currentPositionMs: 280_000 });
    service.attachPlayer(player);
    service.turnOn({ maxStories: 2 });
    service.setStoryCount(2, 2);
    jest.advanceTimersByTime(1000);
    expect(player.setVolume).not.toHaveBeenCalled();

    service.setStoryCount(1, 2);
    player.isPlaying = false;
    jest.advanceTimersByTime(1000);
    expect(player.setVolume).not.toHaveBeenCalled();

    player.isPlaying = true;
    service.setFadeOut(false);
    jest.advanceTimersByTime(1000);
    expect(player.setVolume).not.toHaveBeenCalled();
  });

  it('seeking back out of the last minute restores the volume', () => {
    const service = storiesService();
    const player = fakePlayer({ totalDuration: 300, currentPositionMs: 285_000 });
    service.attachPlayer(player);
    service.turnOn();
    jest.advanceTimersByTime(1000);
    expect(player.setVolume).toHaveBeenLastCalledWith(0.25);

    player.currentPositionMs = 100_000;
    jest.advanceTimersByTime(1000);
    expect(player.setVolume).toHaveBeenLastCalledWith(1);
  });

  it('the stories fade stays in JS: a native timer is never armed for it', () => {
    const deadline = fakeDeadline();
    mockDeadline = deadline;
    const service = storiesService();
    service.attachPlayer(fakePlayer({ nativePlayer: {} }));
    service.turnOn();
    expect(deadline.arm).not.toHaveBeenCalled();
    expect(deadline.disarm).toHaveBeenLastCalledWith(true);
  });
});

describe('SleepTimerService: the ticker', () => {
  it('lands just after each whole second of the deadline', () => {
    const { alignedTickDelay } = loadModule();
    const end = START + 25 * MINUTE;
    // A whole number of seconds left: a full second to the next change.
    expect(alignedTickDelay(end, START)).toBe(1025);
    expect(alignedTickDelay(end, START + 40)).toBe(985);
    expect(alignedTickDelay(end, START + 999)).toBe(26);
    expect(alignedTickDelay(end, START + 1000)).toBe(1025);
    // Past the deadline still a sane delay.
    expect(alignedTickDelay(end, end + 300)).toBe(725);
  });

  it('drops exactly one second per tick over 200 ticks, also when every tick runs 15 ms late', () => {
    const service = loadService();
    const delays: number[] = [];
    let pending: (() => void) | null = null;
    jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      pending = fn;
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    jest.spyOn(global, 'clearTimeout').mockImplementation(() => undefined);

    service.startDuration(25);
    let now = START;
    let shown = service.store.remainingSeconds;
    expect(shown).toBe(1500);
    for (let i = 0; i < 200; i++) {
      const delay = delays[delays.length - 1];
      expect(delay).toBeGreaterThanOrEqual(25);
      expect(delay).toBeLessThanOrEqual(1025);
      now += delay + 15;
      jest.setSystemTime(now);
      const run = pending as (() => void) | null;
      pending = null;
      expect(run).not.toBeNull();
      run?.();
      expect(service.store.remainingSeconds).toBe(shown - 1);
      shown -= 1;
    }
    expect(shown).toBe(1300);
  });

  it('a restart aligns to the new deadline at once', () => {
    const service = loadService();
    service.startDuration(10);
    jest.advanceTimersByTime(1500);
    expect(service.store.remainingSeconds).toBe(599);
    // Restarted 1.5 s in: the next change is a full second away, not at the old phase.
    service.startDuration(10);
    jest.advanceTimersByTime(999);
    expect(service.store.remainingSeconds).toBe(600);
    jest.advanceTimersByTime(30);
    expect(service.store.remainingSeconds).toBe(599);
  });

  it('runs only while a timer is on', () => {
    const service = loadService();
    service.startDuration(5);
    expect(jest.getTimerCount()).toBe(1);
    service.turnOff();
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('SleepTimerService: stop after a duration', () => {
  it('starts, counts down on the wall clock and pauses the player at the end', () => {
    const service = loadService();
    const player = fakePlayer();
    service.attachPlayer(player);
    service.setFadeOut(false);
    service.setMode('stories');
    mockPrefsUpdate.mockClear();

    service.startDuration(2);
    expect(service.store.isDurationRunning).toBe(true);
    expect(service.store.remainingSeconds).toBe(120);
    expect(mockPrefsUpdate).toHaveBeenCalledWith({
      sleepTimerLastDuration: 2,
      settings: { sleepTimerMode: 'duration' },
    });

    jest.advanceTimersByTime(30_025);
    expect(service.store.remainingSeconds).toBe(90);
    expect(player.pause).not.toHaveBeenCalled();

    jest.advanceTimersByTime(90_000);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(service.store.active).toBe(false);
    expect(service.store.endsAtMs).toBeNull();
    expect(mockToastInfo).toHaveBeenCalledWith('Uyku zamanlayıcısı doldu.');
    expect(jest.getTimerCount()).toBe(0);
    // The remembered duration stays for next time.
    expect(service.store.lastDurationMin).toBe(2);
  });

  it('clamps to 1..180 minutes and restarts from now', () => {
    const service = loadService();
    service.startDuration(500);
    expect(service.store.remainingSeconds).toBe(180 * 60);

    jest.advanceTimersByTime(60000);
    service.startDuration(0);
    expect(service.store.remainingSeconds).toBe(60);
    expect(service.store.endsAtMs).toBe(START + MINUTE + MINUTE);
  });

  it('does not PATCH an unchanged duration again', () => {
    const service = loadService();
    service.startDuration(30);
    mockPrefsUpdate.mockClear();
    service.startDuration(30);
    expect(mockPrefsUpdate).not.toHaveBeenCalled();
  });

  it('"+5 dk" pushes the deadline back, up to the wheel maximum, and grows the whole', () => {
    const service = loadService();
    service.startDuration(25);
    expect(service.store.durationTotalMs).toBe(25 * MINUTE);
    jest.advanceTimersByTime(60000);

    service.addMinutes();
    expect(service.store.remainingSeconds).toBe(29 * 60);
    expect(service.store.endsAtMs).toBe(START + 30 * MINUTE);
    expect(service.store.durationTotalMs).toBe(30 * MINUTE);
    // The remembered duration is the one the user set, not the extended one.
    expect(service.store.lastDurationMin).toBe(25);

    service.addMinutes(500);
    expect(service.store.remainingSeconds).toBe(180 * 60);
    expect(service.store.durationTotalMs).toBe(180 * MINUTE);

    service.turnOff();
    expect(service.store.durationTotalMs).toBe(0);
  });

  it('"+5 dk" does nothing without a running duration timer', () => {
    const service = loadService();
    service.addMinutes();
    expect(service.store.active).toBe(false);
    service.setMode('stories');
    service.turnOn();
    service.addMinutes();
    expect(service.store.endsAtMs).toBeNull();
  });

  it('fades the volume over the last minute and restores it after the stop', () => {
    const service = loadService();
    const player = fakePlayer();
    service.attachPlayer(player);

    service.startDuration(2);
    jest.advanceTimersByTime(59_000);
    expect(player.setVolume).not.toHaveBeenCalled();
    expect(service.isFading).toBe(false);

    jest.advanceTimersByTime(31_025); // 30 s left
    expect(player.setVolume.mock.calls[player.setVolume.mock.calls.length - 1][0]).toBeCloseTo(0.5, 2);
    expect(service.isFading).toBe(true);

    jest.advanceTimersByTime(15_000); // 15 s left
    expect(player.setVolume.mock.calls[player.setVolume.mock.calls.length - 1][0]).toBeCloseTo(0.25, 2);

    jest.advanceTimersByTime(15_000);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.setVolume).toHaveBeenLastCalledWith(1);
  });

  it('"+5 dk" during the fade puts the volume back', () => {
    const service = loadService();
    const player = fakePlayer();
    service.attachPlayer(player);
    service.startDuration(1);
    jest.advanceTimersByTime(30_025);
    expect(player.setVolume.mock.calls[player.setVolume.mock.calls.length - 1][0]).toBeCloseTo(0.5, 2);

    service.addMinutes();
    expect(player.setVolume).toHaveBeenLastCalledWith(1);
  });

  it('turning the timer off during the fade puts the volume back', () => {
    const service = loadService();
    const player = fakePlayer();
    service.attachPlayer(player);
    service.startDuration(1);
    jest.advanceTimersByTime(45_025);
    expect(player.setVolume.mock.calls[player.setVolume.mock.calls.length - 1][0]).toBeCloseTo(0.25, 2);

    service.turnOff();
    expect(player.setVolume).toHaveBeenLastCalledWith(1);
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('switching fade-out off during the fade puts the volume back and remembers it', () => {
    const service = loadService();
    const player = fakePlayer();
    service.attachPlayer(player);
    service.startDuration(1);
    jest.advanceTimersByTime(30_025);

    service.setFadeOut(false);
    expect(player.setVolume).toHaveBeenLastCalledWith(1);
    expect(mockPrefsUpdate).toHaveBeenLastCalledWith({ sleepTimerFadeOut: false });
    expect(service.isFading).toBe(false);

    mockPrefsUpdate.mockClear();
    service.setFadeOut(false);
    expect(mockPrefsUpdate).not.toHaveBeenCalled();
  });

  it('expires without a player attached', () => {
    const service = loadService();
    service.startDuration(1);
    jest.advanceTimersByTime(60_100);
    expect(service.store.active).toBe(false);
  });

  it('leaves "pause when asleep" alone', async () => {
    const service = loadService();
    await service.initialize();
    service.startDuration(10);
    service.setFadeOut(true);
    service.setMode('stories');
    for (const call of mockPrefsUpdate.mock.calls) {
      expect(call[0]).not.toHaveProperty('sleepTimerPauseWhenAsleep');
    }
    expect(service.store.pauseWhenAsleep).toBe(true);
  });
});

describe('SleepTimerService: the position reports (screen off on Android)', () => {
  it('a report past the deadline pauses and turns off with no timer advanced', () => {
    const service = loadService();
    const player = observablePlayer();
    service.attachPlayer(player);
    service.startDuration(1);

    jest.setSystemTime(START + MINUTE + 1);
    report(player, 5_000);

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(service.store.active).toBe(false);
    expect(mockToastInfo).toHaveBeenCalledWith('Uyku zamanlayıcısı doldu.');
  });

  it('a report with 30 s left fades to half', () => {
    const service = loadService();
    const player = observablePlayer();
    service.attachPlayer(player);
    service.startDuration(1);

    jest.setSystemTime(START + 30_000);
    report(player, 1_000);
    expect(player.setVolume).toHaveBeenLastCalledWith(0.5);
    expect(service.store.remainingSeconds).toBe(30);
  });

  it('reports while the timer is off do nothing', () => {
    const service = loadService();
    const player = observablePlayer();
    service.attachPlayer(player);
    report(player, 1_000);
    expect(player.setVolume).not.toHaveBeenCalled();
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('attachPlayer(null) stops listening to the old player', () => {
    const service = loadService();
    const player = observablePlayer();
    service.attachPlayer(player);
    service.startDuration(1);
    service.attachPlayer(null);

    jest.setSystemTime(START + MINUTE + 1);
    report(player, 5_000);
    expect(player.pause).not.toHaveBeenCalled();
    expect(service.store.active).toBe(true);
  });

  it('a new player replaces the old one', () => {
    const service = loadService();
    const first = observablePlayer();
    const second = observablePlayer();
    service.attachPlayer(first);
    service.attachPlayer(second);
    service.startDuration(1);

    jest.setSystemTime(START + MINUTE + 1);
    report(first, 5_000);
    expect(service.store.active).toBe(true);
    report(second, 5_000);
    expect(second.pause).toHaveBeenCalledTimes(1);
    expect(first.pause).not.toHaveBeenCalled();
  });

  it('the "doldu" message waits for the app to come back when it ends in the background', () => {
    const service = loadService();
    const player = observablePlayer();
    service.attachPlayer(player);
    service.startDuration(1);
    appState.currentState = 'background';

    jest.setSystemTime(START + MINUTE + 1);
    report(player, 5_000);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(mockToastInfo).not.toHaveBeenCalled();

    appState.currentState = 'active';
    appStateListener()('active');
    expect(mockToastInfo).toHaveBeenCalledTimes(1);
    expect(mockToastInfo).toHaveBeenCalledWith('Uyku zamanlayıcısı doldu.');
    // Once.
    appStateListener()('background');
    appStateListener()('active');
    expect(mockToastInfo).toHaveBeenCalledTimes(1);
  });
});

describe('SleepTimerService: the native deadline (Android)', () => {
  const setup = (playerOverrides: Partial<FakePlayer> = {}) => {
    const deadline = fakeDeadline();
    mockDeadline = deadline;
    const service = loadService();
    const nativePlayer = { id: 'expo-audio-player' };
    const player = fakePlayer({ nativePlayer, ...playerOverrides });
    service.attachPlayer(player);
    deadline.arm.mockClear();
    deadline.disarm.mockClear();
    return { service, deadline, player, nativePlayer };
  };

  it('startDuration arms the deadline with the fade, or with none', () => {
    const { service, deadline, nativePlayer } = setup();
    service.startDuration(20);
    expect(deadline.arm).toHaveBeenLastCalledWith(nativePlayer, START + 20 * MINUTE, 60_000);

    service.setFadeOut(false);
    expect(deadline.arm).toHaveBeenLastCalledWith(nativePlayer, START + 20 * MINUTE, 0);
    service.startDuration(5);
    expect(deadline.arm).toHaveBeenLastCalledWith(nativePlayer, START + 5 * MINUTE, 0);
  });

  it('"+5 dk" re-arms the new deadline', () => {
    const { service, deadline, nativePlayer } = setup();
    service.startDuration(20);
    service.addMinutes();
    expect(deadline.arm).toHaveBeenLastCalledWith(nativePlayer, START + 25 * MINUTE, 60_000);
  });

  it('turnOff and switching to stories disarm with the volume put back', () => {
    const { service, deadline } = setup();
    service.startDuration(20);
    service.turnOff();
    expect(deadline.disarm).toHaveBeenLastCalledWith(true);

    service.startDuration(20);
    deadline.disarm.mockClear();
    service.setMode('stories');
    expect(deadline.disarm).toHaveBeenLastCalledWith(true);
    expect(service.store.mode).toBe('stories');
  });

  it('without the native player (not set up yet) the JS deadline stays in charge', () => {
    const { service, deadline, player } = setup({ nativePlayer: null });
    service.startDuration(1);
    expect(deadline.arm).not.toHaveBeenCalled();
    jest.advanceTimersByTime(60_100);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(service.store.active).toBe(false);
  });

  it('while armed the JS tick neither fades nor expires until 3 s past the deadline', () => {
    const { service, player } = setup();
    service.startDuration(1);

    jest.advanceTimersByTime(30_025);
    expect(service.store.remainingSeconds).toBe(30);
    expect(player.setVolume).not.toHaveBeenCalled();

    jest.advanceTimersByTime(30_000); // at the deadline
    expect(service.store.remainingSeconds).toBe(0);
    expect(service.store.active).toBe(true);
    expect(player.pause).not.toHaveBeenCalled();

    jest.advanceTimersByTime(2_900); // 2.9 s past
    expect(service.store.active).toBe(true);
    expect(player.pause).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000); // past the grace: JS takes over
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(service.store.active).toBe(false);
    expect(mockToastInfo).toHaveBeenCalledWith('Uyku zamanlayıcısı doldu.');
  });

  it('isFading covers the native fade too, so play() leaves the volume alone', () => {
    const { service } = setup();
    service.startDuration(2);
    expect(service.isFading).toBe(false);
    jest.setSystemTime(START + 61_000);
    expect(service.isFading).toBe(true);
    service.setFadeOut(false);
    expect(service.isFading).toBe(false);
  });

  it('onFired turns the timer off and pauses the store', () => {
    const { service, deadline, player } = setup();
    service.startDuration(1);
    jest.setSystemTime(START + MINUTE);
    deadline.fire({ paused: true });

    expect(service.store.active).toBe(false);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(mockToastInfo).toHaveBeenCalledWith('Uyku zamanlayıcısı doldu.');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('onFired in the background defers the message to the next return', () => {
    const { service, deadline, player } = setup();
    service.startDuration(1);
    appState.currentState = 'background';
    // Screen off: no JS timer runs, the native one fires at the deadline.
    jest.setSystemTime(START + MINUTE + 400);
    deadline.fire();

    expect(service.store.active).toBe(false);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(mockToastInfo).not.toHaveBeenCalled();

    appStateListener()('active');
    expect(mockToastInfo).toHaveBeenCalledWith('Uyku zamanlayıcısı doldu.');
  });

  it('a late onFired after JS already ended the timer only syncs a native pause', () => {
    const { service, deadline, player } = setup();
    service.startDuration(1);
    service.turnOff();
    player.pause.mockClear();

    deadline.fire({ paused: true });
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(mockToastInfo).not.toHaveBeenCalled();

    player.isPlaying = false;
    player.pause.mockClear();
    deadline.fire({ paused: true });
    expect(player.pause).not.toHaveBeenCalled();
  });

  it('an onFired for a deadline "+5 dk" replaced in its last moment leaves the new timer running', () => {
    const { service, deadline, player } = setup();
    service.startDuration(1);
    // The native timer fires at the old deadline while "+5 dk" is on its way.
    jest.setSystemTime(START + MINUTE);
    service.addMinutes();
    deadline.fire({ paused: true, firedAtMs: START + MINUTE });

    expect(service.store.isDurationRunning).toBe(true);
    expect(service.store.endsAtMs).toBe(START + 6 * MINUTE);
    expect(mockToastInfo).not.toHaveBeenCalled();
    // The native pause is followed.
    expect(player.pause).toHaveBeenCalledTimes(1);
    // Still left to the native timer: no JS fade 30 s before the new deadline.
    jest.setSystemTime(START + 5 * MINUTE + 30_000);
    service.tick();
    expect(player.setVolume).not.toHaveBeenCalled();
    // The new deadline fires as usual.
    jest.setSystemTime(START + 6 * MINUTE);
    deadline.fire({ paused: true });
    expect(service.store.active).toBe(false);
    expect(mockToastInfo).toHaveBeenCalledWith('Uyku zamanlayıcısı doldu.');
  });

  it('a refused arm keeps the deadline and its fade in JS', async () => {
    const { service, deadline, player } = setup();
    deadline.arm.mockResolvedValue(false);
    service.startDuration(1);
    await Promise.resolve();
    await Promise.resolve();

    jest.advanceTimersByTime(30_025);
    expect(player.setVolume.mock.calls[player.setVolume.mock.calls.length - 1][0]).toBeCloseTo(0.5, 2);
    // At the deadline, not 3 s later.
    jest.advanceTimersByTime(30_000);
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(service.store.active).toBe(false);
  });

  it('the answer of an older arm call does not undo a newer one', async () => {
    const { service, deadline, player } = setup();
    let refuseFirst: (ok: boolean) => void = () => undefined;
    deadline.arm
      .mockReturnValueOnce(new Promise<boolean>(resolve => (refuseFirst = resolve)))
      .mockResolvedValue(true);
    service.startDuration(1);
    service.addMinutes();
    refuseFirst(false);
    await Promise.resolve();
    await Promise.resolve();

    // The second arm took: JS leaves the fade to the native timer.
    jest.setSystemTime(START + 5 * MINUTE + 30_000);
    service.tick();
    expect(player.setVolume).not.toHaveBeenCalled();
  });
});

describe('SleepTimerService.onPlayRequested', () => {
  it('turns off a duration timer whose deadline passed while suspended, silently', () => {
    const service = loadService();
    const player = fakePlayer();
    service.attachPlayer(player);
    service.startDuration(1);

    // Suspended: no timer fired, no position reported.
    jest.setSystemTime(START + 5 * MINUTE);
    service.onPlayRequested();

    expect(service.store.active).toBe(false);
    expect(player.pause).not.toHaveBeenCalled();
    expect(mockToastInfo).not.toHaveBeenCalled();
  });

  it('leaves a timer that has time left, and a stories timer, alone', () => {
    const service = loadService();
    service.startDuration(10);
    jest.setSystemTime(START + 5 * MINUTE);
    service.onPlayRequested();
    expect(service.store.isDurationRunning).toBe(true);

    service.setMode('stories');
    service.onPlayRequested();
    expect(service.store.active).toBe(true);
  });
});
