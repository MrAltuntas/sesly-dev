/**
 * Sleep Timer Service (design v3, frames 25, 25a, 25b; SPEC-audio 7).
 *
 * One timer with two modes:
 *   - 'stories': stop after N stories. 1 is the story playing now. The audio
 *     store reports every finished story through the queue's story end
 *     handler (`handleStoryFinished`, stores/queuePlayback); when the count
 *     is used up playback stops there instead of advancing.
 *   - 'duration': stop at a wall-clock deadline (1 to 180 minutes away). The
 *     default for a user who never chose a mode, 20 minutes.
 *
 * The service owns the countdown and the fade-out: with "fade out" on, the
 * volume ramps down over the last minute (of the duration, or of the last
 * story) and is put back afterwards.
 *
 * Three things drive it, because no single one runs everywhere:
 *   - A ticker, while a timer is on: a self-aligning timeout that lands just
 *     after each whole second of the deadline, so the countdown never skips a
 *     second (a 1 s interval drifts against the ceil() of the deadline).
 *   - The player's position: expo-audio reports it every 500 ms while a story
 *     plays, also with the screen off, when Android pauses every JS timer.
 *     Each report ticks the timer; ticks read the wall clock, so any number of
 *     them agree.
 *   - On Android, the native deadline (utils/sleepDeadline, modules/sesly-media):
 *     the duration's fade and pause run on the main looper next to the player.
 *     While it is armed JS only mirrors the countdown, and takes over only if
 *     the native timer stays silent NATIVE_GRACE_MS past the deadline. The
 *     stories-mode fade always stays in JS.
 *
 * A deadline that passed while the app was suspended (nothing played, so
 * nothing ticked) turns off silently when playback is asked for again
 * (`onPlayRequested`, called by the audio store's play()). "Uyku
 * zamanlayıcısı doldu" is shown at once in the foreground, else when the app
 * comes back.
 *
 * Persisted: fade-out, the last duration (preference columns), the last
 * mode and the last story count (preference `settings` bag). Whether a
 * timer is running is session-only: a sleep timer never survives a relaunch.
 * "Pause when asleep" has no control; its stored value is read and left alone.
 *
 * Writes are optimistic: local state changes at once and the PATCH runs in
 * the background; a failed PATCH is logged and a later one reconciles.
 */

import { AppState, type NativeEventSubscription } from 'react-native';
import { makeAutoObservable, reaction, runInAction } from 'mobx';
import userPreferencesService from './UserPreferencesService';
import {
  PREFERENCE_SETTING_KEYS,
  UpdateUserPreferencesPayload,
  UserPreferences,
  readNumberSetting,
  readStringSetting,
} from '../models/UserPreferences';
import i18n from '../i18n';
import { showToast } from '../utils/toast';
import {
  getNativeSleepDeadline,
  type SleepDeadline,
  type SleepTimerFiredEvent,
} from '../utils/sleepDeadline';

export type SleepTimerMode = 'stories' | 'duration';

export const SLEEP_TIMER_MIN_MINUTES = 1;
export const SLEEP_TIMER_MAX_MINUTES = 180;
export const SLEEP_TIMER_DEFAULT_MINUTES = 20;
/** Length of the fade-out at the end. */
export const SLEEP_TIMER_FADE_SECONDS = 60;
export const SLEEP_TIMER_EXTEND_MINUTES = 5;
/** An armed native deadline is left to the native timer until this long after it. */
export const NATIVE_GRACE_MS = 3000;

/** Stories mode: the ticker only follows the playing story's last minute. */
const TICK_MS = 1000;
/** A duration tick lands this long after the whole second it shows. */
const TICK_ALIGN_MS = 25;

/** What the timer needs from the audio player (AudioPlayerStore satisfies it). */
export interface SleepTimerPlayer {
  /** The user's intent to play. */
  readonly isPlaying: boolean;
  /**
   * Milliseconds. Observable: expo-audio reports it every 500 ms while the
   * story plays, also with the screen off.
   */
  readonly currentPositionMs: number;
  /** Seconds; 0 while unknown. */
  readonly totalDuration: number;
  readonly playbackSpeed: number;
  /** The expo-audio shared object the Android deadline arms on; null before setup. */
  readonly nativePlayer: object | null;
  pause(): Promise<void> | void;
  setVolume(volume: number): void;
}

const MINUTE_MS = 60000;

const clampMinutes = (minutes: number): number =>
  Math.min(
    SLEEP_TIMER_MAX_MINUTES,
    Math.max(SLEEP_TIMER_MIN_MINUTES, Math.round(Number.isFinite(minutes) ? minutes : SLEEP_TIMER_DEFAULT_MINUTES)),
  );

const clampStories = (value: number, max?: number): number => {
  const whole = Math.max(1, Math.round(Number.isFinite(value) ? value : 1));
  return max !== undefined ? Math.min(whole, Math.max(1, Math.round(max))) : whole;
};

/**
 * Milliseconds to the next tick of a duration timer: just after the moment
 * the shown second (`ceil` of the time left) changes. `leftMs` a whole
 * number of seconds: a full second away. Always 26 to 1025 ms.
 */
export function alignedTickDelay(endsAtMs: number, nowMs: number): number {
  const intoSecond = (((endsAtMs - nowMs) % 1000) + 1000) % 1000 || 1000;
  return intoSecond + TICK_ALIGN_MS;
}

// ============================================================================
// Sleep Timer Store (MobX)
// ============================================================================

class SleepTimerStore {
  // Persisted
  fadeOut = true;
  pauseWhenAsleep = false;
  lastDurationMin: number | null = null;
  /** Last used mode; the one the switch turns on. "Süre dolunca" until the user picks one. */
  mode: SleepTimerMode = 'duration';
  /** Last used "stop after N stories". */
  storyCount = 1;

  // Session-only
  active = false;
  /** Stories still to finish, the playing one included ('stories' mode). */
  storiesLeft = 0;
  /** Wall-clock deadline in epoch ms ('duration' mode). */
  endsAtMs: number | null = null;
  /**
   * Length of the running duration timer in ms: its minutes at the start,
   * plus every "+5 dk" (at most 180 minutes). The drain line's whole.
   */
  durationTotalMs = 0;
  /** Seconds to the deadline, refreshed every tick ('duration' mode). */
  remainingSeconds = 0;

  isHydrated = false;

  constructor() {
    makeAutoObservable(this);
  }

  /** The duration the wheel opens on. */
  get durationMin(): number {
    return this.lastDurationMin ?? SLEEP_TIMER_DEFAULT_MINUTES;
  }

  get isDurationRunning(): boolean {
    return this.active && this.mode === 'duration' && this.endsAtMs !== null;
  }

  hydrateFromPreferences(prefs: UserPreferences): void {
    runInAction(() => {
      this.fadeOut = prefs.sleepTimerFadeOut;
      this.pauseWhenAsleep = prefs.sleepTimerPauseWhenAsleep;
      this.lastDurationMin =
        typeof prefs.sleepTimerLastDuration === 'number' && Number.isFinite(prefs.sleepTimerLastDuration)
          ? clampMinutes(prefs.sleepTimerLastDuration)
          : null;
      // A timer the user already started in this session wins over what the
      // backend remembers from last time.
      if (!this.active) {
        const mode = readStringSetting(prefs, PREFERENCE_SETTING_KEYS.sleepTimerMode);
        if (mode === 'stories' || mode === 'duration') this.mode = mode;
        const stories = readNumberSetting(prefs, PREFERENCE_SETTING_KEYS.sleepTimerStoryCount);
        if (stories !== null) this.storyCount = clampStories(stories);
      }
      this.isHydrated = true;
    });
  }
}

// ============================================================================
// Sleep Timer Service (singleton)
// ============================================================================

class SleepTimerService {
  private static instance: SleepTimerService;

  public readonly store = new SleepTimerStore();
  private initPromise: Promise<void> | null = null;
  private player: SleepTimerPlayer | null = null;
  private disposePosition: (() => void) | null = null;
  private ticker: ReturnType<typeof setTimeout> | null = null;
  /** The JS fade has changed the volume. */
  private fading = false;
  /** undefined until first asked for; null where there is no native timer. */
  private deadline: SleepDeadline | null | undefined;
  /** A deadline was handed to the native timer and not cancelled since. */
  private nativeArmed = false;
  /** Counts arm and disarm calls: the answer of an older arm call is ignored. */
  private armSeq = 0;
  /** "Uyku zamanlayıcısı doldu" waits for the app to come back. */
  private finishedPending = false;
  private appStateSub: NativeEventSubscription | null = null;

  private constructor() {}

  public static getInstance(): SleepTimerService {
    if (!SleepTimerService.instance) {
      SleepTimerService.instance = new SleepTimerService();
    }
    return SleepTimerService.instance;
  }

  /**
   * Pull the latest preferences from the backend (or the AsyncStorage
   * fallback) and hydrate the MobX store. Deduped across callers.
   */
  public async initialize(): Promise<void> {
    if (this.store.isHydrated) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const cached = userPreferencesService.getCachedSync();
        if (cached) {
          this.store.hydrateFromPreferences(cached);
        }
        const prefs = await userPreferencesService.get();
        this.store.hydrateFromPreferences(prefs);
      } catch (err) {
        console.warn('[SleepTimerService] Initialize failed:', err);
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * The player the timer pauses and fades, set once by AudioSessionBridge
   * (null on its unmount). Its position reports tick the timer.
   */
  public attachPlayer(player: SleepTimerPlayer | null): void {
    this.disposePosition?.();
    this.disposePosition = null;
    this.player = player;
    if (player) {
      this.disposePosition = reaction(
        () => player.currentPositionMs,
        () => {
          if (this.store.active) this.tick();
        },
      );
    }
    this.syncNativeDeadline();
  }

  /**
   * True while the volume belongs to the timer: a duration timer with
   * fade-out in its last minute (native or JS fade), or the JS fade of the
   * last story. The audio store's play() leaves the volume alone then.
   */
  public get isFading(): boolean {
    if (this.fading) return true;
    const { store } = this;
    if (!store.fadeOut || !store.isDurationRunning || store.endsAtMs === null) return false;
    const left = store.endsAtMs - Date.now();
    return left > 0 && left <= SLEEP_TIMER_FADE_SECONDS * 1000;
  }

  /**
   * The audio store is about to play. A duration timer whose deadline passed
   * while the app was suspended (nothing played, so nothing ticked) turns
   * off silently: the story the user asks for must not stop a second later.
   */
  public onPlayRequested(): void {
    const { store } = this;
    if (store.isDurationRunning && store.endsAtMs !== null && Date.now() >= store.endsAtMs) {
      this.turnOff();
    }
  }

  // ---------------------------------------------------------------------------
  // The switch
  // ---------------------------------------------------------------------------

  /** Turn the timer on in the mode last used. `maxStories` is the queue limit. */
  public turnOn(options: { maxStories?: number } = {}): void {
    if (this.store.mode === 'stories') {
      this.activateStories(options.maxStories);
    } else {
      this.startDuration(this.store.durationMin);
    }
  }

  /** Turn the timer off. Persisted choices stay. */
  public turnOff(): void {
    this.stopTicker();
    this.restoreVolume();
    runInAction(() => {
      this.store.active = false;
      this.store.storiesLeft = 0;
      this.store.endsAtMs = null;
      this.store.durationTotalMs = 0;
      this.store.remainingSeconds = 0;
    });
    this.syncNativeDeadline();
  }

  /** Same as `turnOff()`; kept for callers of the previous API. */
  public resetMode(): void {
    this.turnOff();
  }

  // ---------------------------------------------------------------------------
  // Mode
  // ---------------------------------------------------------------------------

  /**
   * Choose the mode. A running timer switches to it at once (and the native
   * deadline follows: armed for a duration, cancelled for stories).
   */
  public setMode(mode: SleepTimerMode, options: { maxStories?: number } = {}): void {
    const changed = this.store.mode !== mode;
    const wasActive = this.store.active;
    runInAction(() => {
      this.store.mode = mode;
    });
    if (wasActive) {
      if (mode === 'stories') {
        this.activateStories(options.maxStories);
      } else {
        this.startDuration(this.store.durationMin);
      }
    }
    if (changed) {
      this.persist({ settings: { [PREFERENCE_SETTING_KEYS.sleepTimerMode]: mode } });
    }
  }

  // ---------------------------------------------------------------------------
  // Stories mode
  // ---------------------------------------------------------------------------

  /** Stop after `count` stories (1 = the one playing), at most `max`. */
  public setStoryCount(count: number, max?: number): void {
    const next = clampStories(count, max);
    const changed = next !== this.store.storyCount;
    runInAction(() => {
      this.store.storyCount = next;
      if (this.store.active && this.store.mode === 'stories') {
        this.store.storiesLeft = next;
      }
    });
    if (changed) {
      this.persist({ settings: { [PREFERENCE_SETTING_KEYS.sleepTimerStoryCount]: next } });
    }
  }

  /**
   * The playing story reached its end. 'stop': the count is used up, the
   * caller must not start the next story (the timer is now off). 'continue':
   * carry on as without a timer.
   */
  public handleStoryFinished(): 'stop' | 'continue' {
    const { store } = this;
    if (!store.active || store.mode !== 'stories') return 'continue';
    if (store.storiesLeft <= 1) {
      this.turnOff();
      return 'stop';
    }
    runInAction(() => {
      store.storiesLeft -= 1;
    });
    return 'continue';
  }

  private activateStories(maxStories?: number): void {
    this.stopTicker();
    this.restoreVolume();
    runInAction(() => {
      this.store.mode = 'stories';
      this.store.active = true;
      this.store.endsAtMs = null;
      this.store.durationTotalMs = 0;
      this.store.remainingSeconds = 0;
      this.store.storiesLeft = clampStories(this.store.storyCount, maxStories);
    });
    this.startTicker();
    this.syncNativeDeadline();
  }

  // ---------------------------------------------------------------------------
  // Duration mode
  // ---------------------------------------------------------------------------

  /** Start, or restart, a duration timer of `minutes` (1 to 180) from now. */
  public startDuration(minutes: number): void {
    const next = clampMinutes(minutes);
    const patch: UpdateUserPreferencesPayload = {};
    if (next !== this.store.lastDurationMin) patch.sleepTimerLastDuration = next;
    if (this.store.mode !== 'duration') {
      patch.settings = { [PREFERENCE_SETTING_KEYS.sleepTimerMode]: 'duration' };
    }
    this.restoreVolume();
    runInAction(() => {
      this.store.mode = 'duration';
      this.store.active = true;
      this.store.storiesLeft = 0;
      this.store.lastDurationMin = next;
      this.store.endsAtMs = Date.now() + next * MINUTE_MS;
      this.store.durationTotalMs = next * MINUTE_MS;
      this.store.remainingSeconds = next * 60;
    });
    // A restart aligns its ticks to the new deadline at once.
    this.stopTicker();
    this.startTicker();
    this.syncNativeDeadline();
    this.persist(patch);
  }

  /** "+5 dk": push the deadline of a running duration timer back. */
  public addMinutes(minutes: number = SLEEP_TIMER_EXTEND_MINUTES): void {
    const { store } = this;
    if (!store.isDurationRunning || store.endsAtMs === null) return;
    const now = Date.now();
    const latest = now + SLEEP_TIMER_MAX_MINUTES * MINUTE_MS;
    const endsAt = Math.min(latest, store.endsAtMs + minutes * MINUTE_MS);
    runInAction(() => {
      store.endsAtMs = endsAt;
      store.durationTotalMs = Math.min(
        SLEEP_TIMER_MAX_MINUTES * MINUTE_MS,
        Math.max(store.durationTotalMs + minutes * MINUTE_MS, endsAt - now),
      );
      store.remainingSeconds = Math.max(0, Math.ceil((endsAt - now) / 1000));
    });
    this.stopTicker();
    this.startTicker();
    this.syncNativeDeadline();
    if (!this.nativeArmed) this.applyFade((endsAt - now) / 1000);
  }

  // ---------------------------------------------------------------------------
  // Fade-out
  // ---------------------------------------------------------------------------

  public setFadeOut(value: boolean): void {
    if (value === this.store.fadeOut) return;
    runInAction(() => {
      this.store.fadeOut = value;
    });
    if (!value) this.restoreVolume();
    this.syncNativeDeadline();
    this.persist({ sleepTimerFadeOut: value });
  }

  // ---------------------------------------------------------------------------
  // Ticker
  // ---------------------------------------------------------------------------

  /**
   * One step of the countdown. Reads the wall clock, so it can run any
   * number of times (the ticker, every position report). Public for tests.
   */
  public tick(nowMs: number = Date.now()): void {
    const { store } = this;
    if (!store.active) {
      this.stopTicker();
      return;
    }

    if (store.mode === 'duration') {
      const endsAt = store.endsAtMs;
      if (endsAt === null) return;
      const leftMs = endsAt - nowMs;
      const remaining = Math.max(0, Math.ceil(leftMs / 1000));
      if (remaining !== store.remainingSeconds) {
        runInAction(() => {
          store.remainingSeconds = remaining;
        });
      }
      // The native timer fades and pauses an armed deadline; JS takes over
      // only when it stays silent past the grace period.
      if (this.nativeArmed && nowMs <= endsAt + NATIVE_GRACE_MS) return;
      if (leftMs <= 0) {
        this.expire();
        return;
      }
      this.applyFade(leftMs / 1000);
      return;
    }

    // 'stories': the fade covers the last minute of the last story.
    const player = this.player;
    if (store.storiesLeft === 1 && player && player.isPlaying && player.totalDuration > 0) {
      const speed = player.playbackSpeed > 0 ? player.playbackSpeed : 1;
      this.applyFade(Math.max(0, player.totalDuration - player.currentPositionMs / 1000) / speed);
    } else if (store.storiesLeft > 1) {
      this.restoreVolume();
    }
  }

  private expire(): void {
    this.pausePlayer();
    this.turnOff();
    this.announceFinished();
  }

  private pausePlayer(): void {
    try {
      const result = this.player?.pause();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(err => console.warn('[SleepTimerService] Pause failed:', err));
      }
    } catch (err) {
      console.warn('[SleepTimerService] Pause failed:', err);
    }
  }

  /** "Uyku zamanlayıcısı doldu": now in the foreground, else when the app comes back. */
  private announceFinished(): void {
    const state = AppState.currentState;
    if (state !== 'background' && state !== 'inactive') {
      this.finishedPending = false;
      showToast.info(i18n.t('player:timer.finished'));
      return;
    }
    this.finishedPending = true;
    if (this.appStateSub) return;
    this.appStateSub = AppState.addEventListener('change', next => {
      if (next !== 'active' || !this.finishedPending) return;
      this.finishedPending = false;
      showToast.info(i18n.t('player:timer.finished'));
    });
  }

  private applyFade(secondsLeft: number): void {
    if (!this.store.fadeOut || secondsLeft > SLEEP_TIMER_FADE_SECONDS) {
      this.restoreVolume();
      return;
    }
    if (!this.player) return;
    this.fading = true;
    this.player.setVolume(Math.min(1, Math.max(0, secondsLeft / SLEEP_TIMER_FADE_SECONDS)));
  }

  private restoreVolume(): void {
    if (!this.fading) return;
    this.fading = false;
    this.player?.setVolume(1);
  }

  private startTicker(): void {
    if (this.ticker) return;
    const { store } = this;
    const delay =
      store.mode === 'duration' && store.endsAtMs !== null
        ? alignedTickDelay(store.endsAtMs, Date.now())
        : TICK_MS;
    this.ticker = setTimeout(() => {
      this.ticker = null;
      this.tick();
      if (this.store.active) this.startTicker();
    }, delay);
  }

  private stopTicker(): void {
    if (!this.ticker) return;
    clearTimeout(this.ticker);
    this.ticker = null;
  }

  // ---------------------------------------------------------------------------
  // Native deadline (Android)
  // ---------------------------------------------------------------------------

  private nativeDeadline(): SleepDeadline | null {
    if (this.deadline === undefined) {
      this.deadline = getNativeSleepDeadline();
      this.deadline?.onFired(event => this.handleNativeFired(event));
    }
    return this.deadline;
  }

  /**
   * Hand the running duration timer to the native timer, or cancel it there
   * (putting a faded volume back) when there is none.
   */
  private syncNativeDeadline(): void {
    const driver = this.nativeDeadline();
    if (!driver) return;
    const { store } = this;
    const nativePlayer = this.player?.nativePlayer ?? null;
    const seq = ++this.armSeq;
    if (store.isDurationRunning && store.endsAtMs !== null && nativePlayer) {
      // Its own fade from here on: the JS one hands the volume back first.
      this.restoreVolume();
      this.nativeArmed = true;
      const armed = driver.arm(nativePlayer, store.endsAtMs, store.fadeOut ? SLEEP_TIMER_FADE_SECONDS * 1000 : 0);
      void Promise.resolve(armed).then(ok => {
        // Refused (logged): this deadline stays in JS, fade included.
        if (ok !== false || seq !== this.armSeq) return;
        this.nativeArmed = false;
        if (this.store.active) this.tick();
      });
      return;
    }
    driver.disarm(true);
    this.nativeArmed = false;
  }

  /** The native deadline fired: it has paused the player. */
  private handleNativeFired(event: SleepTimerFiredEvent): void {
    const { store } = this;
    const firedAtMs = typeof event?.firedAtMs === 'number' ? event.firedAtMs : Date.now();
    if (store.isDurationRunning && store.endsAtMs !== null && store.endsAtMs - firedAtMs > NATIVE_GRACE_MS) {
      // It fired for a deadline this timer has replaced since ("+5 dk" or a
      // restart in its last moment, the new one already on its way to the
      // native timer): the timer goes on. Only the native pause is followed.
      if (event?.paused && this.player?.isPlaying) this.pausePlayer();
      return;
    }
    this.nativeArmed = false;
    if (store.isDurationRunning) {
      this.turnOff();
      // The native player is already paused: this syncs the store and saves the position.
      this.pausePlayer();
      this.announceFinished();
      return;
    }
    // JS already ended this timer; the store still must follow the native pause.
    if (event?.paused && this.player?.isPlaying) this.pausePlayer();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private persist(patch: UpdateUserPreferencesPayload): void {
    if (Object.keys(patch).length === 0) return;
    // Fire-and-forget: write-through PATCH.
    void userPreferencesService.update(patch).catch(err => {
      console.warn('[SleepTimerService] Preference sync failed:', err);
    });
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const sleepTimerService = SleepTimerService.getInstance();
export default sleepTimerService;
