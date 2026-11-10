/**
 * Audio player store (MobX) on `expo-audio`.
 *
 * One native player for the app's life. It holds one source at a time
 * (`source`): a story (a narration streamed from the backend) or a sample (a
 * voice preview), or nothing. The state model:
 *   - `isPlaying` is the user's intent: true from a play (or an autoplay
 *     start) until a pause, the end of the story or a pause the store
 *     detected outside itself (audio focus, a call, the iOS lock screen).
 *     Every play / pause icon draws it; `isBuffering` says the native player
 *     still waits for data meanwhile, `isBusy` combines both for spinners.
 *   - One load path, `startNarration(input, { autoplay, fromQueue })`: it
 *     pauses before every replace, changes state only after the steps that
 *     can throw, and starts from cached metadata (`stores/narrationMeta`)
 *     without a network round trip.
 *   - The end of a story is handled here, synchronously inside the status
 *     event, by the handler `bindStoryEnd` installs (`setStoryEndHandler`):
 *     the queue advances with the player closed and the screen off. No screen
 *     consumes an end flag.
 *   - Generation (create, poll, socket progress) has fields of its own and
 *     never writes a playback field; a READY job is announced through
 *     `generationReadyId`, never loaded. A used-up allowance is a
 *     `quotaBlock` (no error, no message), a job that runs long is
 *     `generationSlow` (never a failure); only a backend FAILED is an error.
 *   - `totalDurationMs` is the real length only (the device's memory of it,
 *     or the native player); the backend's estimate is never shown.
 *
 * Background playback + lock-screen controls belong to the paid plans, Mini
 * and Premium (SubscriptionStore.canPlayInBackground):
 *   - Free: the audio mode has shouldPlayInBackground=false; the session
 *     bridge (components/audio/AudioSessionBridge) pauses a story when the app
 *     backgrounds, and the player is never put on the lock screen.
 *   - Paid: background playback, and once a story starts playing the player is
 *     put on the lock screen with story title / narrator / cover and the skip
 *     buttons: on Android through the Sesly media session
 *     (modules/sesly-media), on iOS through expo-audio's
 *     setActiveForLockScreen. Track changes only update the metadata
 *     (utils/lockScreen.ts). Samples, stop and a downgrade to free
 *     deactivate it.
 *   - Android remote commands (notification, lock screen, headset, Bluetooth)
 *     arrive through utils/mediaSession.ts and run the same store methods as
 *     the player screen, so position saving, audio focus and the sleep timer
 *     behave the same. Unplugged headphones pause for every tier.
 *
 * `useAudioPlayer()` only returns the singleton; the app-wide effects (the
 * audio mode per tier, the AppState listener, the story end handler) live
 * once in AudioSessionBridge.
 */

import { makeAutoObservable, observable, runInAction } from 'mobx';
import { useMemo } from 'react';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import type { EventSubscription } from 'expo-modules-core';
import NarrationService, {
  NarrationAlreadyExistsError,
} from '../services/NarrationService';
import WebSocketService from '../services/WebSocketService';
import {
  classifyFailure,
  getErrorMessage,
  hasApiStatus,
  isApiError,
  type FailureKind,
} from '../services/ApiError';
import { recordNonFatal } from '../services/crashReporting';
import sleepTimerService from '../services/SleepTimerService';
import { parseQuotaBlock, type QuotaBlock } from '../models/Quota';
import { getConnectivityStore } from '../stores/ConnectivityStore';
import type { Story } from '../models/Story';
import type { VoiceProfile } from '../models/VoiceProfile';
import type { StoryNarration } from '../models/Narration';
import { AudioGenerationStatus, NarrationStatus } from '../types/enums';
import { POLLING_INTERVALS, AUDIO_PLAYBACK } from '../config/constants';
import { showToast } from '../utils/toast';
import { getSubscriptionStore } from './useSubscription';
import ApiClient, { jwtExpiryMs } from '../services/ApiClient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { shouldResumeFrom } from '../utils/playback';
import { LockScreenController, buildPlayerLockScreenMetadata } from '../utils/lockScreen';
import { bindMediaSessionCommands } from '../utils/mediaSession';
import userPreferencesService from '../services/UserPreferencesService';
import { PREFERENCE_SETTING_KEYS, readNumberSetting } from '../models/UserPreferences';
import { msg } from '../i18n/messages';
import { SeekConfirmation, bindPlaybackProgress, remainingMinutes } from '../utils/playbackProgress';
import {
  hydrateNarrationDurations,
  knownNarrationDurationMs,
  rememberNarrationDuration,
  resolveNarrationDurationMs,
} from '../utils/narrationDurations';
import {
  getNarrationMeta,
  metaFromNarration,
  rememberNarrationMeta,
  type NarrationMeta,
  type PlayerStory,
} from '../stores/narrationMeta';
import { lastPlayedFrom, writeLastPlayed } from '../utils/lastPlayed';
import { getSessionUserId } from '../stores/session';
import { queueStore } from '../stores/QueueStore';
import type { LoadError } from '../utils/loadErrors';

export type { NarrationMeta, PlayerStory } from '../stores/narrationMeta';

/** Local mirror of "use this speed for every story" (applies before the network answers and offline). */
export const PLAYBACK_SPEED_STORAGE_KEY = 'playback_speed:all';
/** A sample that has not sounded this long after it was started has failed. */
export const PREVIEW_START_TIMEOUT_MS = 10000;
/**
 * The player is idle for a moment while it takes a new source; idle after
 * this long means the source could not be loaded.
 */
export const PREVIEW_IDLE_GRACE_MS = 1000;
/**
 * A fresh play() reports `playing: false` (state ready or buffering) for a
 * moment; a ready, not playing report later than this is a pause made
 * outside the store.
 */
export const PLAY_SETTLE_MS = 1500;
/** A story stream that has not sounded this long after play() has failed. */
export const STORY_START_TIMEOUT_MS = 15000;
/** The mini player stays this long after a pause made from its own button. */
export const DOCK_PAUSE_HOLD_MS = 5000;
/**
 * The stream header carries the backend JWT (1 h), and ExoPlayer keeps no
 * back buffer: every rewind, restart or re-buffer is a new range request that
 * needs the token accepted. A play or a seek this long after the stream was
 * loaded (or past the token's own deadline, see STREAM_TOKEN_MARGIN_MS)
 * reloads the stream with a fresh token first.
 */
export const STREAM_TOKEN_MAX_AGE_MS = 50 * 60 * 1000;
/** Kept between the stream token's expiry and the reload deadline of its stream. */
export const STREAM_TOKEN_MARGIN_MS = 5 * 60 * 1000;
/**
 * The validity a stream asks of its token: the whole reload window plus the
 * margin, so the backend accepts every request of it until the next reload
 * (LR-1: a token with minutes left made a rewind fail with 401).
 */
export const STREAM_TOKEN_MIN_VALIDITY_MS = STREAM_TOKEN_MAX_AGE_MS + STREAM_TOKEN_MARGIN_MS;
/**
 * A narration still not READY this long after the poll started is slow
 * (`generationSlow`), never failed: the backend keeps working on it.
 */
export const GENERATION_SLOW_AFTER_MS = 6 * 60 * 1000;
/** The status poll of a slow narration. */
export const GENERATION_SLOW_POLL_MS = 15000;
/**
 * The poll stops this long after it started, silently: the socket and the
 * push still announce the end, and opening the pair again follows it anew.
 */
export const GENERATION_POLL_LIMIT_MS = 30 * 60 * 1000;
/** A play this close to the end starts the story over instead of playing silence. */
const END_RESTART_MS = 500;
/** The position of a playing story is saved this often. */
const POSITION_SAVE_STEP_MS = 3000;

/** Slowest and fastest stop of the speed slider. */
const MIN_PLAYBACK_SPEED = 0.5;
const MAX_PLAYBACK_SPEED = 2;

function validPlaybackSpeed(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_PLAYBACK_SPEED &&
    value <= MAX_PLAYBACK_SPEED
    ? value
    : null;
}

const positionKey = (narrationId: string) => `narration_position:${narrationId}`;

/**
 * When a stream loaded at `loadedAt` with `token` in its header must be
 * reloaded before a play or a seek: STREAM_TOKEN_MAX_AGE_MS after the load,
 * or STREAM_TOKEN_MARGIN_MS before the token expires when that comes first
 * (a backend with shorter JWTs, a refresh that failed and left the old one).
 * A token that cannot be decoded keeps the fixed window.
 */
export function streamReloadDeadline(token: string | null, loadedAt: number): number {
  const window = loadedAt + STREAM_TOKEN_MAX_AGE_MS;
  let expiresAt: number | null = null;
  try {
    expiresAt = token ? jwtExpiryMs(token) : null;
  } catch {
    // jwtExpiryMs never throws; a partial ApiClient (a test double) must not fail a start.
    expiresAt = null;
  }
  return expiresAt === null ? window : Math.min(window, expiresAt - STREAM_TOKEN_MARGIN_MS);
}

/**
 * Playback audio session. `doNotMix` is required for expo-audio lock-screen
 * controls (the OS only binds Now Playing to a non-mixing session).
 */
export function playbackAudioMode(shouldPlayInBackground: boolean) {
  return {
    playsInSilentMode: true,
    shouldPlayInBackground,
    interruptionMode: 'doNotMix' as const,
  };
}

/** What the native player holds. */
export type PlayerSource = 'none' | 'story' | 'sample';
export type LoadPhase = 'idle' | 'loading' | 'ready' | 'failed';
/** Why the last story start failed (utils/loadErrors). */
export type { LoadError } from '../utils/loadErrors';
export { isUnplayableLoadError } from '../utils/loadErrors';

/** The narration exists but has no audio to stream. */
function hasNoAudio(narration: Pick<StoryNarration, 'status'>): boolean {
  return narration.status !== NarrationStatus.READY;
}

export type NarrationInput =
  /** A full narration (library row, story detail, fetched). */
  | { narration: StoryNarration }
  /** A queue entry, the continue card, a route id (meta read from the cache when absent). */
  | { narrationId: string; meta?: NarrationMeta };

export interface StartOptions {
  /** Start sound once loaded. Default false. */
  autoplay?: boolean;
  /** Started by the queue (keeps the queue context). */
  fromQueue?: boolean;
}

/** What happens after a story ended: the queue started the next one, or nothing follows. */
export type StoryEndDecision = 'advance' | 'stop';
export type StoryEndHandler = (narrationId: string) => StoryEndDecision;
export type StartListener = (narrationId: string, options: StartOptions) => void;

/** A sample: `key` names it for the screen that started it (defaults to the url). */
export interface SampleMeta {
  key?: string;
  title?: string;
}

/**
 * What play() asks the sleep timer. `onPlayRequested` turns off a duration
 * timer whose deadline passed while the app was suspended; `isFading` keeps
 * the volume of a fade-out. Optional until the timer service has them.
 */
interface PlayRequestTimer {
  onPlayRequested?: () => void;
  readonly isFading?: boolean;
}
const playTimer = (): PlayRequestTimer => sleepTimerService as unknown as PlayRequestTimer;

// ============================================================================
// Audio Player Store (MobX)
// ============================================================================

class AudioPlayerStore {
  // ── Generation (never a playback field) ──
  isGenerating = false;
  generationProgress = 0;
  /** The narration being generated. */
  generatingNarrationId: string | null = null;
  generatingStory: Story | null = null;
  generatingVoiceProfile: VoiceProfile | null = null;
  /** The job that became READY in this session; the generation screen reads it. */
  generationReadyId: string | null = null;
  /**
   * The job has run longer than GENERATION_SLOW_AFTER_MS. Not an error: it
   * goes on, the screen says it takes longer and offers the background.
   */
  generationSlow = false;
  /**
   * The backend refused the narration because an allowance is used up (403
   * QUOTA_* or PREMIUM_STORY). Not an error and no message: the generation
   * screen explains the plan (`describeQuotaBlock`) and offers the ways out.
   */
  quotaBlock: QuotaBlock | null = null;

  // Set when the backend rejects a fresh generation with 409 because a
  // (story, voice) narration already exists. The screen reads this to
  // surface "Var olanı dinle" / "Yeniden oluştur" buttons.
  conflictExistingNarrationId: string | null = null;
  conflictExistingNarrationStatus: string | null = null;

  // ── What the player holds ──
  source: PlayerSource = 'none';
  /** The narration whose stream is in the player ('' = none). Only a story start writes it. */
  audioId = '';
  /** Set when startNarration begins, cleared when it ends. */
  pendingNarrationId: string | null = null;
  loadPhase: LoadPhase = 'idle';
  loadError: LoadError | null = null;
  /**
   * The narration `loadError` is about. A start that fails before its stream
   * takes the player leaves the previous story loaded, so the error belongs
   * to the narration that was started, not to `audioId`; a stream that never
   * sounded (or a refresh that answered 404) belongs to the loaded story.
   * Null exactly when `loadError` is.
   */
  loadErrorNarrationId: string | null = null;

  // ── Playback ──
  /** The user's intent to play (see the header). */
  isPlaying = false;
  /** The native player waits for data while `isPlaying` is true. */
  isBuffering = false;
  /** The loaded story rests at its end. */
  storyEnded = false;
  currentPositionMs = 0;
  /** Real length only (device memory or native); 0 = unknown. */
  totalDurationMs = 0;
  playbackSpeed = 1.0;
  /**
   * Bumped whenever the position jumps on purpose (seek, restart, new track),
   * so the shared progress animation re-anchors even on a tiny jump.
   */
  positionEpoch = 0;
  /**
   * "Bütün masallarda bu hızı kullan". Off: the speed belongs to the loaded
   * story and the next one starts at 1,0x. On: the speed is stored (device
   * mirror + preferences) and used for every story.
   */
  speedForAllStories = false;

  // ── The loaded story (belongs to audioId) ──
  currentStory: PlayerStory | null = null;
  /** Only when a full narration is known; null for a start from a stored meta. */
  currentVoiceProfile: VoiceProfile | null = null;
  currentNarratorName: string | null = null;
  currentOwnVoice = false;

  /** True for DOCK_PAUSE_HOLD_MS after a pause made from the mini player. */
  dockHold = false;
  /** Free plan: the story was paused because the app went to the background. */
  pausedByBackground = false;

  // ── Samples ──
  /** Key of the sample in the player (`source === 'sample'`). */
  sampleKey: string | null = null;
  /**
   * A sample was handed to the player and has not sounded yet. Its play
   * button shows a spinner meanwhile.
   */
  previewPending = false;
  /**
   * The player could not start a sample: the source failed to load or never
   * began. The store has shown the message; a screen that started the sample
   * resets its play button and calls `acknowledgePreviewFailure()`.
   */
  previewFailed = false;

  // Error handling (generation)
  errorMessage = '';
  hasError = false;
  /** Why a generation could not start (offline, server...); null for a backend FAILED. */
  errorKind: FailureKind | null = null;

  // Seeks in flight. Status updates emitted before a seek landed still carry
  // the old position; taking them would throw the progress bar back.
  pendingSeeks = 0;
  // After a seek landed, a report the player read before the jump can still
  // arrive: only a report near the target counts until one does, at most
  // SEEK_CONFIRM_MS after the player answered (NL-01).
  private readonly seekConfirmation = new SeekConfirmation();

  // expo-audio player: ONE native instance for the app lifetime. Samples
  // (playFromUrl) reuse it through replace(), so no temporary players pile up
  // (expo issue #41852: didJustFinish stops after ~40 player instances).
  private player: AudioPlayer | null = null;
  private statusSub: EventSubscription | null = null;
  private setupPromise: Promise<void> | null = null;
  private readonly lockScreen = new LockScreenController();
  // Android media session commands (no-op elsewhere), bound for the store's life.
  private unbindMediaSession: (() => void) | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  // The pair of a job started with `replace` (a regenerate), until it is READY.
  private replacingPair: { storyId: string; voiceProfileId: string } | null = null;
  // Bumped by every generation session: a start the user left for another
  // job that answers late never writes (or fails) the newer job.
  private generationSeq = 0;
  private previewWatchdog: ReturnType<typeof setTimeout> | null = null;
  private previewStartedAt = 0;
  private storyStartWatchdog: ReturnType<typeof setTimeout> | null = null;
  private dockHoldTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedPositionMs = 0;
  private speedHydration: Promise<void> | null = null;
  // Bumped by every speed change the user makes, so a slow hydration never
  // overwrites a choice made while it was in flight.
  private speedEpoch = 0;
  // Bumped by every start, reload, sample and stop: an older start that
  // wakes up after an await sees it lost and leaves the state alone.
  private loadSeq = 0;
  private currentStart: { id: string; promise: Promise<boolean> } | null = null;
  private lastPlayCallAt = 0;
  // A play at the end seeks back to the start (see play()).
  private restarting = false;
  // When the stream in the player was loaded, and the deadline after which a
  // play or a seek loads it again with a fresh token (streamReloadDeadline).
  private streamTokenAt = 0;
  private streamTokenDeadline = 0;
  // The one automatic reload after a native source failure was used for this
  // stream; cleared by every deliberate load and once the stream sounds.
  private streamRetried = false;
  // The narration the current speed belongs to. A sample in between does not
  // make the same story "new": it comes back at its own speed.
  private speedNarrationId = '';
  private storyEndHandler: StoryEndHandler | null = null;
  private startListener: StartListener | null = null;

  constructor() {
    makeAutoObservable<
      this,
      | 'player'
      | 'statusSub'
      | 'setupPromise'
      | 'lockScreen'
      | 'unbindMediaSession'
      | 'pollingTimer'
      | 'replacingPair'
      | 'generationSeq'
      | 'previewWatchdog'
      | 'previewStartedAt'
      | 'storyStartWatchdog'
      | 'dockHoldTimer'
      | 'lastSavedPositionMs'
      | 'speedHydration'
      | 'speedEpoch'
      | 'loadSeq'
      | 'currentStart'
      | 'lastPlayCallAt'
      | 'restarting'
      | 'streamTokenAt'
      | 'streamTokenDeadline'
      | 'streamRetried'
      | 'speedNarrationId'
      | 'storyEndHandler'
      | 'startListener'
      | 'seekConfirmation'
    >(
      this,
      {
        // The native shared object is a plain reference, never an observable.
        player: false,
        statusSub: false,
        setupPromise: false,
        lockScreen: false,
        unbindMediaSession: false,
        pollingTimer: false,
        replacingPair: false,
        generationSeq: false,
        previewWatchdog: false,
        previewStartedAt: false,
        storyStartWatchdog: false,
        dockHoldTimer: false,
        lastSavedPositionMs: false,
        speedHydration: false,
        speedEpoch: false,
        loadSeq: false,
        currentStart: false,
        lastPlayCallAt: false,
        restarting: false,
        streamTokenAt: false,
        streamTokenDeadline: false,
        streamRetried: false,
        speedNarrationId: false,
        storyEndHandler: false,
        startListener: false,
        seekConfirmation: false,
        // Reads the plain native reference: a getter, not a computed.
        nativePlayer: false,
        // A parsed answer with a Date, replaced whole.
        quotaBlock: observable.ref,
      },
      { autoBind: true },
    );
    void hydrateNarrationDurations();
    this.setupPlayer();
    this.unbindMediaSession = bindMediaSessionCommands(this);
  }

  // ============================================================================
  // Getters
  // ============================================================================

  /** A story (not a sample, not nothing) is in the player. */
  get isPlayingStory(): boolean {
    return this.source === 'story';
  }

  get isStoryLoaded(): boolean {
    return this.source === 'story' && !!this.audioId;
  }

  /** The mini player shows: a story plays (intent), or was just paused from the dock. */
  get showMiniPlayer(): boolean {
    return this.isStoryLoaded && (this.isPlaying || this.dockHold);
  }

  /** The play button spins: a start or a stall the user is waiting for. */
  get isBusy(): boolean {
    return this.isPlaying && (this.loadPhase === 'loading' || this.isBuffering);
  }

  /**
   * The native expo-audio player (the shared object), null before setup. The
   * Android sleep timer arms its deadline on it.
   */
  get nativePlayer(): AudioPlayer | null {
    return this.player;
  }

  get currentPosition(): number {
    return this.currentPositionMs / 1000;
  }

  get totalDuration(): number {
    return this.totalDurationMs / 1000;
  }

  /**
   * Whole seconds played. A computed value: observers of it re-render once a
   * second, not on every status update.
   */
  get positionSeconds(): number {
    return Math.floor(this.currentPositionMs / 1000);
  }

  /** A seek is on its way to the player: the progress bar waits at the target. */
  get isSeeking(): boolean {
    return this.pendingSeeks > 0;
  }

  /** True once the loaded track has moved off its start. */
  get hasPosition(): boolean {
    return this.currentPositionMs > 0;
  }

  /**
   * Whole minutes left in the loaded track at the playback speed (null while
   * its length is unknown). Computed, so "N dk kaldı" labels re-render once a
   * minute.
   */
  get remainingMinutes(): number | null {
    return remainingMinutes(this.currentPositionMs, this.totalDurationMs, this.playbackSpeed);
  }

  get progressPercent(): number {
    if (this.totalDurationMs <= 0) return 0;
    return Math.min((this.currentPositionMs / this.totalDurationMs) * 100, 100);
  }

  // ============================================================================
  // Setup
  // ============================================================================

  /**
   * Create the native player once. Memoized: the constructor and
   * ensurePlayer() can race, and two concurrent setups used to create two
   * players (the loser leaked with a live status listener). A failed setup
   * clears the memo so the next ensurePlayer() retries.
   */
  setupPlayer(): Promise<void> {
    if (!this.setupPromise) {
      const promise = this.createPlayerOnce().finally(() => {
        if (!this.player && this.setupPromise === promise) {
          this.setupPromise = null;
        }
      });
      this.setupPromise = promise;
    }
    return this.setupPromise;
  }

  private async createPlayerOnce(): Promise<void> {
    try {
      // The session bridge re-applies this when the plan changes; start from
      // the plan we already know (Mini plays in the background too).
      await setAudioModeAsync(playbackAudioMode(getSubscriptionStore().canPlayInBackground));

      if (!this.player) {
        const player = createAudioPlayer(null, { updateInterval: 500 });
        this.statusSub = player.addListener('playbackStatusUpdate', this.onStatusUpdate);
        this.player = player;
      }
      console.log('expo-audio player setup complete');
    } catch (error) {
      console.error('Audio setup error:', error);
    }
  }

  private async ensurePlayer(): Promise<void> {
    if (!this.player) {
      await this.setupPlayer();
    }
  }

  /**
   * Release the native player (listener, lock screen, native object). The
   * singleton normally lives for the whole app run; this exists for teardown
   * (tests, dev reloads) so a replaced store never leaks a live player.
   */
  dispose(): void {
    this.stopPolling();
    this.clearPreviewWatch();
    this.clearStoryStartWatch();
    this.clearDockHoldTimer();
    this.unbindMediaSession?.();
    this.unbindMediaSession = null;
    this.lockScreen.deactivate();
    this.statusSub?.remove();
    this.statusSub = null;
    const player = this.player;
    this.player = null;
    this.setupPromise = null;
    this.isPlaying = false;
    if (player) {
      try {
        player.pause();
        player.remove();
      } catch (error) {
        console.warn('Audio player remove failed:', error);
      }
      try {
        player.release();
      } catch (error) {
        console.warn('Audio player release failed:', error);
      }
    }
  }

  // ============================================================================
  // Wiring (installed once by bindStoryEnd in AudioSessionBridge)
  // ============================================================================

  /**
   * Decides what follows a finished story, synchronously inside the status
   * event. It may call `startNarration` (with autoplay) and return 'advance';
   * 'stop' leaves the story resting at its end. Null: nothing follows.
   */
  setStoryEndHandler(handler: StoryEndHandler | null): void {
    this.storyEndHandler = handler;
  }

  /** Told about every story start that loads a new narration (the queue leaves its context). */
  setStartListener(listener: StartListener | null): void {
    this.startListener = listener;
  }

  /** Free plan: the session bridge marks a pause made because the app went to the background. */
  setPausedByBackground(paused: boolean): void {
    this.pausedByBackground = paused;
  }

  // ============================================================================
  // Lock screen (paid plans: Mini and Premium)
  // ============================================================================

  /**
   * Converge the lock-screen state. `allowActivate` is true only from a
   * play: the player is put on the lock screen once per activation,
   * afterwards track changes only update the metadata (throttled). The free
   * plan, samples and stop take it off.
   */
  syncLockScreen(allowActivate = false): void {
    const enabled =
      this.isStoryLoaded && !!this.player && getSubscriptionStore().canPlayInBackground;
    if (!enabled) {
      this.lockScreen.deactivate();
      return;
    }
    if (!this.lockScreen.isActive && !allowActivate) return;
    this.lockScreen.sync(this.player, true, buildPlayerLockScreenMetadata(this));
  }

  /** The media session's "play": a finished story starts over (see play()). */
  async remotePlay(): Promise<void> {
    await this.play();
  }

  /**
   * The media session is gone (stopped from the notification, or ended by
   * the system). The next play in the app puts the story back.
   */
  releaseLockScreen(): void {
    this.lockScreen.deactivate();
  }

  // ============================================================================
  // Status updates
  // ============================================================================

  private onStatusUpdate(status: AudioStatus): void {
    // Nothing loaded, or a new source is being loaded: events still describe
    // the previous one.
    if (this.source === 'none' || this.loadPhase === 'loading') return;
    if (this.source === 'sample') {
      this.onSampleStatus(status);
      return;
    }
    this.onStoryStatus(status);
  }

  private onStoryStatus(status: AudioStatus): void {
    const id = this.audioId;
    const duration = status.duration;
    const knownLength = duration > 0 && Number.isFinite(duration);
    const positionMs = (status.currentTime || 0) * 1000;
    const takePosition = this.takesReportedPosition(positionMs);
    // Read before a seek that has landed: its position and its end are old.
    const fromBeforeSeek = !takePosition && this.pendingSeeks === 0;
    runInAction(() => {
      if (takePosition) this.currentPositionMs = positionMs;
      if (knownLength) this.totalDurationMs = duration * 1000;
    });
    // The real length, kept on the device: the backend's estimate runs about
    // three times too long, and the player shows real lengths only.
    if (knownLength) rememberNarrationDuration(id, duration * 1000);

    if (status.didJustFinish) {
      // The old end, reported while a restart seeks back to the start or
      // just after it landed.
      if (!this.restarting && !fromBeforeSeek) this.onStoryEnd();
      return;
    }

    const buffering =
      status.isBuffering === true ||
      status.playbackState === 'buffering' || // Android
      status.timeControlStatus === 'waitingToPlayAtSpecifiedRate'; // iOS
    // Android: a source that could not load, or a range request it refused
    // (a rewind or a re-buffer). Idle for a moment right after the replace is
    // the player taking the new source.
    const failed =
      status.playbackState === 'failed' || // iOS AVPlayer status
      (status.playbackState === 'idle' &&
        this.isPlaying &&
        Date.now() - this.streamTokenAt > PREVIEW_IDLE_GRACE_MS);

    const wasPlaying = this.isPlaying;
    if (status.playing && this.pausedByBackground) {
      // expo-audio resumes by itself when the app returns (free plan, see
      // AudioSessionBridge): the story stays paused until the user plays.
      this.repauseAfterBackground();
      return;
    }
    // Android reports `playing: true` through a stall in mid-story (the
    // player's intended state while it buffers): that is buffering, not sound.
    if (status.playing && !buffering) {
      this.clearStoryStartWatch();
      // The stream works: a later failure gets its own automatic reload.
      this.streamRetried = false;
      runInAction(() => {
        this.isBuffering = false;
        // Resumed natively (focus regained, an iOS remote command) counts too.
        this.isPlaying = true;
        if (this.loadError === 'streamFailed' || this.loadError === 'loadFailed') {
          // It sounds: whatever failed before is over.
          this.loadError = null;
          this.loadErrorNarrationId = null;
          this.loadPhase = 'ready';
        }
      });
    } else if (buffering) {
      runInAction(() => {
        this.isBuffering = this.isPlaying;
      });
    } else if (this.isExternalPause(status)) {
      // Paused outside the store: audio focus lost, a call, the iOS lock screen.
      runInAction(() => {
        this.isPlaying = false;
        this.isBuffering = false;
      });
      this.clearStoryStartWatch();
      this.savePositionNow();
    }

    if (failed) {
      // Reloaded once at the position before the inline error shows.
      if (!this.retryFailedStream()) this.failStoryStart();
      return;
    }

    // Playback resumed without the store's play() (a headset key, audio
    // focus coming back) while the story is off the lock screen, for
    // example after its notification was dismissed: put it back.
    if (!wasPlaying && this.isPlaying && !this.lockScreen.isActive) {
      this.syncLockScreen(true);
    }

    // Save the position of a playing story every 3 s.
    if (this.isStoryLoaded && this.isPlaying) {
      const current = this.currentPositionMs;
      if (Math.abs(current - this.lastSavedPositionMs) >= POSITION_SAVE_STEP_MS) {
        this.lastSavedPositionMs = current;
        AsyncStorage.setItem(positionKey(id), String(Math.floor(current))).catch(err => {
          console.warn('[AudioPlayerStore] Failed to save position:', err);
        });
      }
    }
  }

  /**
   * Whether a status's position is taken: not while a seek is on its way,
   * and after it landed only once a report agrees with its target (or the
   * confirmation window is over). A report the player read before the jump
   * would throw the bar and the clock back to the old position (NL-01).
   */
  private takesReportedPosition(positionMs: number): boolean {
    return this.pendingSeeks === 0 && this.seekConfirmation.accepts(positionMs, this.positionEpoch);
  }

  /**
   * A ready, not playing report while the user wants to play, after the
   * settle time. Never during a restart's seek: the player still stands at
   * the end it was paused at.
   */
  private isExternalPause(status: AudioStatus): boolean {
    const ready = status.playbackState === 'ready' || status.playbackState === 'readyToPlay';
    return (
      ready &&
      !status.playing &&
      this.isPlaying &&
      !this.restarting &&
      Date.now() - this.lastPlayCallAt > PLAY_SETTLE_MS
    );
  }

  /**
   * The loaded story played to its end. Runs synchronously inside the status
   * event: the end handler may start the next story right here, so the dock
   * never hides between two stories and the advance works with the screen off.
   */
  private onStoryEnd(): void {
    const id = this.audioId;
    this.clearStoryStartWatch();
    this.clearDockHoldTimer();
    // A finished story starts over next time.
    AsyncStorage.removeItem(positionKey(id)).catch(() => {});
    this.lastSavedPositionMs = 0;
    runInAction(() => {
      this.storyEnded = true;
      this.isBuffering = false;
      this.dockHold = false;
    });
    let decision: StoryEndDecision = 'stop';
    try {
      decision = this.storyEndHandler?.(id) ?? 'stop';
    } catch (error) {
      console.warn('[AudioPlayerStore] Story end handler failed:', error);
    }
    if (decision === 'stop') {
      runInAction(() => {
        this.isPlaying = false;
      });
      // Android keeps playWhenReady after the end; a later seek would start
      // the story by itself.
      try {
        this.player?.pause();
      } catch (error) {
        console.warn('Pause at the end failed:', error);
      }
    }
  }

  /** Free plan, back from the background: undo expo-audio's own resume. */
  private repauseAfterBackground(): void {
    try {
      this.player?.pause();
    } catch (error) {
      console.warn('Re-pause after background failed:', error);
    }
    runInAction(() => {
      this.isPlaying = false;
      this.isBuffering = false;
    });
  }

  // ============================================================================
  // Story start watchdog
  //
  // expo-audio has no error event: a story stream that cannot be loaded (an
  // expired token, no network) just never sounds. After every native play of
  // a story the store waits for the first `playing: true`; a timeout, an iOS
  // 'failed' or an Android 'idle' after the grace stops the intent and sets
  // `loadError: 'streamFailed'`, which the player shows inline. A source that
  // failed natively (a refused range request after a rewind, a 401) is first
  // reloaded once at the position with a new token; only a second failure
  // shows the error.
  // ============================================================================

  private watchStoryStart(): void {
    this.clearStoryStartWatch();
    this.storyStartWatchdog = setTimeout(() => {
      this.storyStartWatchdog = null;
      const player = this.player;
      // Idle within the grace after the replace was not taken for a failure;
      // nothing reported since, so the native state says it here.
      if (player && this.nativeSourceFailed(player) && this.retryFailedStream()) return;
      this.failStoryStart();
    }, STORY_START_TIMEOUT_MS);
  }

  /**
   * The loaded story's source failed natively while it was ready: reload it
   * once at the position, with a newly refreshed token (the backend refused
   * the old one, or the device clock runs off), before the inline error
   * shows. False when this stream already had its automatic reload.
   */
  private retryFailedStream(): boolean {
    if (this.streamRetried || !this.isStoryLoaded || this.loadPhase !== 'ready') return false;
    this.streamRetried = true;
    void this.reloadStream({ automatic: true });
    return true;
  }

  private clearStoryStartWatch(): void {
    if (this.storyStartWatchdog) {
      clearTimeout(this.storyStartWatchdog);
      this.storyStartWatchdog = null;
    }
  }

  /** The loaded story's stream failed (or its refresh answered 404): the error is its own. */
  private failStoryStart(error: LoadError = 'streamFailed'): void {
    this.clearStoryStartWatch();
    const failedId = this.audioId;
    try {
      this.player?.pause();
    } catch (err) {
      console.warn('Pausing a failed story failed:', err);
    }
    runInAction(() => {
      this.isPlaying = false;
      this.isBuffering = false;
      this.loadError = error;
      this.loadErrorNarrationId = this.audioId || null;
      this.loadPhase = 'failed';
    });
    if (error === 'streamFailed' && failedId) this.explainStreamFailure(failedId);
  }

  /**
   * A stream that would not play may belong to a narration whose audio is
   * gone (the backend answers the stream with 404). Ask once: then the
   * player shows why and the queue moves on, instead of an inline retry that
   * can never work. A network error leaves the stream failure as it is.
   */
  private explainStreamFailure(narrationId: string): void {
    const stillFailed = () =>
      this.audioId === narrationId &&
      this.loadPhase === 'failed' &&
      this.loadError === 'streamFailed' &&
      this.loadErrorNarrationId === narrationId;
    Promise.resolve()
      .then(() => NarrationService.getNarrationStatus(narrationId))
      .then(status => {
        if (status && status.status !== NarrationStatus.READY && stillFailed()) {
          runInAction(() => {
            this.loadError = 'audioRemoved';
          });
        }
      })
      .catch(error => {
        if (hasApiStatus(error, 404) && stillFailed()) {
          runInAction(() => {
            this.loadError = 'notFound';
          });
        }
      });
  }

  // ============================================================================
  // Preview watchdog
  //
  // A sample whose URL cannot be loaded never plays, and the row that started
  // it would show "pause" forever. After playFromUrl the store therefore
  // waits for the sample to sound. If the player goes idle instead (that is
  // where a load error leaves it), or nothing sounds within
  // PREVIEW_START_TIMEOUT_MS, the sample has failed.
  // ============================================================================

  private watchPreview(): void {
    this.clearPreviewWatch();
    this.previewStartedAt = Date.now();
    runInAction(() => {
      this.previewPending = true;
      this.previewFailed = false;
    });
    this.previewWatchdog = setTimeout(() => this.failPreview(), PREVIEW_START_TIMEOUT_MS);
  }

  private clearPreviewWatch(): void {
    if (this.previewWatchdog) {
      clearTimeout(this.previewWatchdog);
      this.previewWatchdog = null;
    }
    if (this.previewPending) {
      runInAction(() => {
        this.previewPending = false;
      });
    }
  }

  private failPreview(): void {
    if (!this.previewPending) return;
    this.clearPreviewWatch();
    try {
      this.player?.pause();
    } catch (error) {
      console.warn('Stopping a failed preview failed:', error);
    }
    runInAction(() => {
      this.previewFailed = true;
    });
    this.leaveSample();
    showToast.error(msg('player.previewFailed'));
  }

  /** Called by the screen once it has reset the play button of the failed sample. */
  acknowledgePreviewFailure(): void {
    this.previewFailed = false;
  }

  private onSampleStatus(status: AudioStatus): void {
    if (this.previewPending) {
      if (status.playing || (status.currentTime || 0) > 0 || status.didJustFinish) {
        // It sounds: nothing left to watch.
        this.clearPreviewWatch();
      } else if (
        status.playbackState === 'idle' &&
        Date.now() - this.previewStartedAt >= PREVIEW_IDLE_GRACE_MS
      ) {
        this.failPreview();
        return;
      }
    }
    // Position and length for its waveform; nothing is saved or remembered.
    const positionMs = (status.currentTime || 0) * 1000;
    const takePosition = this.takesReportedPosition(positionMs);
    runInAction(() => {
      if (takePosition) this.currentPositionMs = positionMs;
      if (status.duration > 0 && Number.isFinite(status.duration)) {
        this.totalDurationMs = status.duration * 1000;
      }
    });
    if (status.didJustFinish) {
      this.clearPreviewWatch();
      this.leaveSample();
      return;
    }
    if (status.playing) {
      runInAction(() => {
        this.isPlaying = true;
      });
    } else if (!this.previewPending && this.isExternalPause(status)) {
      runInAction(() => {
        this.isPlaying = false;
      });
    }
  }

  /** The sample is over (ended, failed, stopped): the player holds nothing. */
  private leaveSample(): void {
    runInAction(() => {
      this.sampleKey = null;
      this.source = 'none';
      this.isPlaying = false;
      this.isBuffering = false;
      this.currentPositionMs = 0;
      this.totalDurationMs = 0;
      this.positionEpoch += 1;
    });
  }

  // ============================================================================
  // Story loading: one path
  // ============================================================================

  /**
   * Put a narration in the player. Returns true once it is loaded (and
   * playing when `autoplay`), false when it failed or a newer start won.
   *
   * State changes only after the steps that can throw: a failed start leaves
   * the previous story in place. Nothing on this path uses a JS timer, so an
   * advance from the queue also works with the screen off on Android.
   */
  async startNarration(input: NarrationInput, options: StartOptions = {}): Promise<boolean> {
    const full = 'narration' in input ? input.narration : null;
    const id = full ? full.id : 'narrationId' in input ? input.narrationId : '';
    if (!id) {
      showToast.error(msg('player.notFound'));
      return false;
    }

    // The same narration is already starting: join that start.
    const inFlight = this.currentStart;
    if (inFlight && inFlight.id === id && this.loadPhase === 'loading') {
      if (options.autoplay) this.isPlaying = true;
      return inFlight.promise;
    }
    // Already loaded (and no other start about to replace it): at most play it.
    const otherStartRunning =
      this.loadPhase === 'loading' && !!this.pendingNarrationId && this.pendingNarrationId !== id;
    if (
      id === this.audioId &&
      this.isStoryLoaded &&
      this.loadPhase !== 'failed' &&
      !otherStartRunning
    ) {
      if (options.autoplay && !this.isPlaying) await this.play();
      return true;
    }

    const promise = this.runStart(id, input, options);
    this.currentStart = { id, promise };
    try {
      return await promise;
    } finally {
      if (this.currentStart?.promise === promise) this.currentStart = null;
    }
  }

  private async runStart(
    id: string,
    input: NarrationInput,
    options: StartOptions,
  ): Promise<boolean> {
    // 1. Synchronous, before the first await: the intent, the pending id and
    // the outgoing story paused with its exact position saved.
    const seq = ++this.loadSeq;
    this.clearStoryStartWatch();
    this.clearDockHoldTimer();
    this.leaveCurrentSource();
    runInAction(() => {
      this.loadPhase = 'loading';
      this.pendingNarrationId = id;
      this.loadError = null;
      this.loadErrorNarrationId = null;
      this.dockHold = false;
      // Without autoplay the new story loads paused, whatever played before.
      this.isPlaying = !!options.autoplay;
      this.isBuffering = false;
    });
    try {
      this.startListener?.(id, options);
    } catch (error) {
      console.warn('[AudioPlayerStore] Start listener failed:', error);
    }

    // 2. What the player draws: the given narration, the given meta, the cache.
    const full = 'narration' in input ? input.narration : null;
    let meta: NarrationMeta | null = full
      ? metaFromNarration(full)
      : ('meta' in input ? input.meta : undefined) ?? getNarrationMeta(id);
    let fetched = !!full;

    // 3. Nothing is known about it (a push tap): fetch it first.
    if (!meta) {
      try {
        const narration = await NarrationService.getNarrationById(id);
        if (seq !== this.loadSeq) return false;
        if (hasNoAudio(narration)) {
          // Its audio was removed (or never finished): nothing to stream.
          // The meta stays known, so the player can open the story page.
          rememberNarrationMeta(metaFromNarration(narration));
          this.endStart(id, 'audioRemoved');
          return false;
        }
        meta = metaFromNarration(narration);
        fetched = true;
      } catch (error) {
        if (seq !== this.loadSeq) return false;
        this.endStart(id, hasApiStatus(error, 404) ? 'notFound' : 'loadFailed');
        return false;
      }
    }

    let replaced = false;
    try {
      // 5. The player, a token valid for the whole reload window (every
      // rewind is a new range request with it), the known lengths.
      await this.ensurePlayer();
      if (seq !== this.loadSeq) return false;
      const token = await ApiClient.getFreshAccessToken(STREAM_TOKEN_MIN_VALIDITY_MS);
      if (seq !== this.loadSeq) return false;
      await hydrateNarrationDurations();
      if (seq !== this.loadSeq) return false;
      const player = this.player;
      if (!player) {
        this.endStart(id, 'loadFailed');
        showToast.error(msg('player.loadFailed'));
        return false;
      }

      // 7. The hard flip: from here on the player belongs to this narration.
      const isNewStory = this.speedNarrationId !== id;
      const startMeta = meta;
      this.clearPreviewWatch();
      runInAction(() => {
        this.source = 'story';
        this.audioId = id;
        this.currentStory = startMeta.story;
        this.currentVoiceProfile = startMeta.voiceProfile ?? null;
        this.currentNarratorName = startMeta.narratorName;
        this.currentOwnVoice = startMeta.ownVoice;
        this.storyEnded = false;
        this.currentPositionMs = 0;
        this.positionEpoch += 1;
        this.totalDurationMs = knownNarrationDurationMs(id) ?? 0;
        this.sampleKey = null;
      });
      this.lastSavedPositionMs = 0;
      this.speedNarrationId = id;

      // 8. The stream (paused: the outgoing source was paused in step 1).
      player.pause();
      player.replace({
        uri: this.streamUrl(id),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      this.markStreamLoaded(token);
      this.streamRetried = false;
      replaced = true;

      // 9. Speed, then the saved position. The estimate may decide "near the
      // end"; it is never shown.
      await this.applySpeedForNewStory(isNewStory);
      if (seq !== this.loadSeq) return false;
      let savedPositionMs = 0;
      try {
        const saved = await AsyncStorage.getItem(positionKey(id));
        const value = saved ? parseInt(saved, 10) : 0;
        savedPositionMs = Number.isFinite(value) && value > 0 ? value : 0;
      } catch (error) {
        console.warn('Failed to load saved position:', error);
      }
      if (seq !== this.loadSeq) return false;
      const lengthMs = resolveNarrationDurationMs(id, startMeta.estimateMs);
      const resume = shouldResumeFrom(savedPositionMs, lengthMs / 1000);
      if (!resume && savedPositionMs > 0) {
        // Finished (or invalid) position: start over next time too.
        AsyncStorage.removeItem(positionKey(id)).catch(() => {});
      }
      const startPositionMs = resume ? savedPositionMs : 0;
      if (resume) {
        await player.seekTo(savedPositionMs / 1000);
        if (seq !== this.loadSeq) return false;
      }

      // 10. The native length when the player already knows it.
      this.adoptNativeLength(player, id);

      // 11. Accept status updates again.
      runInAction(() => {
        this.loadPhase = 'ready';
        this.pendingNarrationId = null;
        this.currentPositionMs = startPositionMs;
        this.positionEpoch += 1;
      });
      this.lastSavedPositionMs = startPositionMs;

      // 12. The continue card and later instant starts.
      void writeLastPlayed(lastPlayedFrom(startMeta, getSessionUserId()));
      rememberNarrationMeta(startMeta);

      // 13. The lock screen follows the track; the intent plays it.
      this.syncLockScreen();
      if (this.isPlaying) this.startPlayback();
    } catch (error) {
      console.error('Story start failed:', error);
      if (seq !== this.loadSeq) return false;
      // After the replace the new story stays (without sound); before it the
      // previous state was never changed.
      this.endStart(id, 'loadFailed');
      showToast.error(msg('player.loadFailed'));
      return false;
    }

    // 14. Started from a meta: refresh it in the background, never awaited.
    if (!fetched) this.refreshInBackground(id);
    return true;
  }

  /**
   * The start of `narrationId` failed: the intent stops and the reason stays
   * for the screens, named after that narration (the story that was loaded
   * before may still be in the player).
   */
  private endStart(narrationId: string, error: LoadError): void {
    runInAction(() => {
      this.loadPhase = 'failed';
      this.loadError = error;
      this.loadErrorNarrationId = narrationId;
      this.pendingNarrationId = null;
      this.isPlaying = false;
      this.isBuffering = false;
    });
  }

  /**
   * Pause what the player holds before another source takes it. A story saves
   * its exact position first (the last status can be half a second old).
   */
  private leaveCurrentSource(): void {
    if (this.source === 'story') {
      this.pauseNativeAndSave();
    } else if (this.source === 'sample') {
      this.clearPreviewWatch();
      try {
        this.player?.pause();
      } catch (error) {
        console.warn('Pausing the sample failed:', error);
      }
      this.leaveSample();
    }
  }

  private streamUrl(narrationId: string): string {
    return `${ApiClient.getBaseURL()}/narrations/${narrationId}/stream`;
  }

  /** A stream went into the player with `token` in its header: its load time and reload deadline. */
  private markStreamLoaded(token: string | null): void {
    const now = Date.now();
    this.streamTokenAt = now;
    this.streamTokenDeadline = streamReloadDeadline(token, now);
  }

  /**
   * The stream's token is past its deadline: the next range request (a play
   * that re-buffers, any seek) could be refused, so it is loaded again first.
   */
  private streamTokenExpired(): boolean {
    return Date.now() > this.streamTokenDeadline;
  }

  /** The native player may know the real length before any status lands. */
  private adoptNativeLength(player: AudioPlayer, narrationId: string): void {
    let duration = 0;
    try {
      duration = player.currentStatus?.duration ?? 0;
    } catch {
      duration = 0;
    }
    if (duration > 0 && Number.isFinite(duration)) {
      runInAction(() => {
        this.totalDurationMs = duration * 1000;
      });
      rememberNarrationDuration(narrationId, duration * 1000);
    }
  }

  /** A start from a meta: fetch the narration for the full voice and fresher fields. */
  private refreshInBackground(narrationId: string): void {
    NarrationService.getNarrationById(narrationId)
      .then(narration => {
        if (this.audioId !== narrationId) return;
        if (hasNoAudio(narration)) {
          // Started from a cached meta, but the audio is gone: the stream
          // can only fail, and a retry would never help.
          const otherStart = !!this.pendingNarrationId && this.pendingNarrationId !== narrationId;
          if (!otherStart) this.failStoryStart('audioRemoved');
          return;
        }
        const fresh = metaFromNarration(narration);
        runInAction(() => {
          this.currentStory = fresh.story;
          this.currentVoiceProfile = narration.voiceProfile ?? null;
          this.currentNarratorName = fresh.narratorName;
          this.currentOwnVoice = fresh.ownVoice;
        });
        rememberNarrationMeta(fresh);
        this.syncLockScreen();
      })
      .catch(error => {
        // The narration is gone (deleted, or replaced by a regenerate). Not
        // while another start is taking the player: failing the outgoing
        // story then would stop the intent of the incoming one.
        const otherStart = !!this.pendingNarrationId && this.pendingNarrationId !== narrationId;
        if (hasApiStatus(error, 404) && this.audioId === narrationId && !otherStart) {
          this.failStoryStart('notFound');
        }
      });
  }

  /**
   * Load the stream of the loaded story again with a fresh token, at the
   * position it is at. Used by the inline "Tekrar dene" of a stream that did
   * not start (it plays again), by play() and seek() past the stream's token
   * deadline (or over a source that failed natively) and, once per stream,
   * automatically after a native source failure (`automatic`: the token is
   * refreshed even when it looks valid). `play` overrides the intent the
   * reload keeps (a seek keeps a paused story paused).
   */
  async reloadStream(options: { play?: boolean; automatic?: boolean } = {}): Promise<void> {
    const player = this.player;
    if (!this.isStoryLoaded || !player || this.loadPhase === 'loading') return;
    const id = this.audioId;
    const play = options.play ?? (this.isPlaying || this.loadError === 'streamFailed');
    const seq = ++this.loadSeq;
    this.clearStoryStartWatch();
    // A deliberate load starts a new stream with its own automatic retry.
    if (!options.automatic) this.streamRetried = false;
    const positionMs = this.storyEnded ? 0 : this.currentPositionMs;
    runInAction(() => {
      this.loadPhase = 'loading';
      this.loadError = null;
      this.loadErrorNarrationId = null;
      this.isPlaying = play;
      this.isBuffering = false;
    });
    try {
      player.pause();
      const token = await ApiClient.getFreshAccessToken(
        options.automatic ? Number.POSITIVE_INFINITY : STREAM_TOKEN_MIN_VALIDITY_MS,
      );
      if (seq !== this.loadSeq || this.audioId !== id) return;
      player.replace({
        uri: this.streamUrl(id),
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      this.markStreamLoaded(token);
      if (positionMs > 0) {
        await player.seekTo(positionMs / 1000);
        if (seq !== this.loadSeq) return;
      }
      runInAction(() => {
        this.loadPhase = 'ready';
        this.storyEnded = false;
        this.currentPositionMs = positionMs;
        this.positionEpoch += 1;
      });
      if (this.isPlaying) this.startPlayback();
    } catch (error) {
      console.warn('Reloading the stream failed:', error);
      if (seq !== this.loadSeq) return;
      runInAction(() => {
        this.loadPhase = 'failed';
        this.loadError = 'streamFailed';
        this.loadErrorNarrationId = id;
        this.isPlaying = false;
      });
    }
  }

  // ============================================================================
  // Playback controls
  // ============================================================================

  /**
   * Play the loaded story. While a start runs it only records the intent
   * (the start plays when it is loaded). A story at its end starts over.
   */
  async play(): Promise<void> {
    if (this.loadPhase === 'loading') {
      if (this.pendingNarrationId || this.isStoryLoaded) this.isPlaying = true;
      return;
    }
    const player = this.player;
    if (!this.isStoryLoaded || !player) return;
    try {
      const nearEnd =
        this.totalDurationMs > 0 && this.currentPositionMs >= this.totalDurationMs - END_RESTART_MS;
      const restart = this.storyEnded || nearEnd;
      if (
        this.loadPhase === 'failed' ||
        this.nativeSourceFailed(player) ||
        this.streamTokenExpired()
      ) {
        // A stream that did not start (or broke while paused), or a header
        // token past its deadline: reload first, with the intent set, so the
        // reload plays. A restart ("Baştan dinle") reloads at the start
        // instead of seeking a source that would refuse the request.
        runInAction(() => {
          this.isPlaying = true;
          if (restart) {
            this.storyEnded = false;
            this.currentPositionMs = 0;
            this.positionEpoch += 1;
          }
        });
        if (restart) this.lastSavedPositionMs = 0;
        await this.reloadStream({ play: true });
        return;
      }
      if (restart) {
        // Starting over: the pause icon, the knob and the clock move at once,
        // and a report of the end that lands during the seek moves none of
        // them back (no play / pause flicker).
        this.lastPlayCallAt = Date.now();
        this.restarting = true;
        runInAction(() => {
          this.isPlaying = true;
          this.storyEnded = false;
          this.currentPositionMs = 0;
          this.positionEpoch += 1;
          this.pendingSeeks += 1;
        });
        this.lastSavedPositionMs = 0;
        const epoch = this.positionEpoch;
        // A report of the end read before the jump moves nothing back either.
        this.seekConfirmation.begin(0, epoch, this.playbackSpeed);
        try {
          await player.seekTo(0);
        } finally {
          this.seekConfirmation.landed(epoch);
          this.restarting = false;
          runInAction(() => {
            this.pendingSeeks -= 1;
          });
        }
        // Paused (or replaced) while it sought back: that intent wins.
        if (!this.isPlaying) return;
      }
      this.startPlayback();
    } catch (error) {
      console.error('Play error:', error);
      runInAction(() => {
        this.isPlaying = false;
        this.isBuffering = false;
      });
      showToast.error(msg('player.playFailed'));
    }
  }

  /**
   * Android leaves a source that could not load (a dropped connection while
   * paused, a refused header) in 'idle', where play() alone never sounds; a
   * fresh replace is 'buffering' at once. Such a stream is reloaded instead
   * of waiting for the start watchdog. iOS never reports 'idle'.
   */
  private nativeSourceFailed(player: AudioPlayer): boolean {
    if (Date.now() - this.streamTokenAt <= PREVIEW_IDLE_GRACE_MS) return false;
    try {
      return player.currentStatus?.playbackState === 'idle';
    } catch {
      return false;
    }
  }

  /** The native part of every story play. */
  private startPlayback(): void {
    const player = this.player;
    if (!player || !this.isStoryLoaded) return;
    const timer = playTimer();
    timer.onPlayRequested?.();
    // A background pause (free plan) silenced the player; a fade keeps its volume.
    if (!timer.isFading) this.setVolume(1);
    this.clearDockHoldTimer();
    this.lastPlayCallAt = Date.now();
    runInAction(() => {
      this.pausedByBackground = false;
      this.isPlaying = true;
      this.isBuffering = !player.isLoaded || player.isBuffering === true;
      this.dockHold = false;
      this.storyEnded = false;
    });
    player.play();
    // Paid plan + story: activate lock-screen controls (once per activation).
    this.syncLockScreen(true);
    this.watchStoryStart();
  }

  async pause(options?: { fromDock?: boolean }): Promise<void> {
    try {
      this.clearStoryStartWatch();
      if (this.source === 'story') {
        this.pauseNativeAndSave();
      } else {
        this.player?.pause();
      }
      runInAction(() => {
        this.isPlaying = false;
        this.isBuffering = false;
      });
      if (options?.fromDock && this.isStoryLoaded) {
        this.clearDockHoldTimer();
        this.dockHold = true;
        this.dockHoldTimer = setTimeout(() => {
          this.dockHoldTimer = null;
          runInAction(() => {
            this.dockHold = false;
          });
        }, DOCK_PAUSE_HOLD_MS);
      }
    } catch (error) {
      console.error('Pause error:', error);
    }
  }

  /** Pause or play from the intent, never from the native `playing` (false while buffering). */
  async togglePlayPause(options?: { fromDock?: boolean }): Promise<void> {
    if (this.isPlaying) {
      await this.pause(options);
    } else {
      await this.play();
    }
  }

  /**
   * Pause the native player and save where the story stopped: the last
   * status can be half a second old, so the position is read from the player.
   */
  private pauseNativeAndSave(): void {
    const player = this.player;
    if (!player) return;
    player.pause();
    // A restart's seek has not landed: the player still reads the end.
    if (this.loadPhase === 'loading' || !this.isStoryLoaded || this.storyEnded || this.restarting) {
      return;
    }
    const at = player.currentTime;
    if (typeof at === 'number' && Number.isFinite(at) && at > 0) {
      runInAction(() => {
        this.currentPositionMs = at * 1000;
      });
    }
    this.savePositionNow();
  }

  /** Save the loaded story's position now (a pause, a switch, an external pause). */
  private savePositionNow(): void {
    if (!this.isStoryLoaded || this.storyEnded || this.currentPositionMs <= 0) return;
    const at = Math.floor(this.currentPositionMs);
    this.lastSavedPositionMs = this.currentPositionMs;
    AsyncStorage.setItem(positionKey(this.audioId), String(at)).catch(() => {});
  }

  private clearDockHoldTimer(): void {
    if (this.dockHoldTimer) {
      clearTimeout(this.dockHoldTimer);
      this.dockHoldTimer = null;
    }
  }

  /**
   * Seconds; clamped to the known length. Past the stream's token deadline
   * (or over a source that failed natively) the stream is loaded again at the
   * target instead: the seek's range request would be refused (LR-1). Every
   * rewind goes through here: the 15 s skip, the lock screen, "previous".
   */
  async seek(seconds: number): Promise<void> {
    try {
      const player = this.player;
      if (!player) return;
      const maxSeconds =
        this.totalDurationMs > 0 ? this.totalDurationMs / 1000 : Number.POSITIVE_INFINITY;
      const target = Math.min(maxSeconds, Math.max(0, seconds));
      if (
        this.isStoryLoaded &&
        this.loadPhase !== 'loading' &&
        (this.streamTokenExpired() || this.nativeSourceFailed(player))
      ) {
        // The bar and the clock move at once; the reload lands there and
        // keeps the intent (a paused story stays paused).
        runInAction(() => {
          this.currentPositionMs = target * 1000;
          this.positionEpoch += 1;
          this.storyEnded = false;
        });
        await this.reloadStream({ play: this.isPlaying });
        return;
      }
      // Optimistic: the progress bar and the clock follow at once; the
      // native seek confirms.
      const previousMs = this.currentPositionMs;
      runInAction(() => {
        this.currentPositionMs = target * 1000;
        this.positionEpoch += 1;
        this.pendingSeeks += 1;
        this.storyEnded = false;
      });
      const epoch = this.positionEpoch;
      // Until a report agrees with the target, one from before the jump is
      // not taken (NL-01).
      this.seekConfirmation.begin(target * 1000, epoch, this.playbackSpeed);
      try {
        await player.seekTo(target);
      } catch (error) {
        // The player did not move: neither does the UI (the new epoch also
        // ends the confirmation window).
        runInAction(() => {
          this.currentPositionMs = previousMs;
          this.positionEpoch += 1;
        });
        throw error;
      } finally {
        this.seekConfirmation.landed(epoch);
        runInAction(() => {
          this.pendingSeeks -= 1;
        });
      }
    } catch (error) {
      console.error('Seek error:', error);
    }
  }

  async skipForward(
    seconds: number = AUDIO_PLAYBACK.SEEK_INTERVAL_SECONDS,
  ): Promise<void> {
    if (!this.player) return;
    const position = this.player.currentTime ?? 0;
    await this.seek(position + seconds);
  }

  async skipBackward(
    seconds: number = AUDIO_PLAYBACK.SEEK_INTERVAL_SECONDS,
  ): Promise<void> {
    if (!this.player) return;
    const position = this.player.currentTime ?? 0;
    await this.seek(Math.max(0, position - seconds));
  }

  /**
   * Change the playback speed now. The pitch is corrected (expo-audio
   * `setPlaybackRate(rate, quality)`), so the voice keeps its tone. When the
   * speed is used for every story it is stored as well.
   */
  async setSpeed(speed: number): Promise<void> {
    try {
      this.speedEpoch += 1;
      this.applyRate(speed);
      runInAction(() => {
        this.playbackSpeed = speed;
      });
      if (this.speedForAllStories) {
        this.storeSpeed(speed);
      }
    } catch (error) {
      console.error('Set speed error:', error);
    }
  }

  /**
   * Switch "use this speed for every story". On: the current speed is stored
   * on the device and in the preferences `settings` bag. Off: both are
   * removed; the current story keeps its speed, the next one starts at 1,0x.
   */
  setSpeedForAllStories(enabled: boolean): void {
    this.speedEpoch += 1;
    this.speedForAllStories = enabled;
    this.storeSpeed(enabled ? this.playbackSpeed : null);
  }

  /** Player volume, 0 to 1 (the sleep timer's fade-out, the background pause). */
  setVolume(volume: number): void {
    if (!this.player) return;
    try {
      this.player.volume = Math.min(1, Math.max(0, volume));
    } catch (error) {
      console.warn('Set volume failed:', error);
    }
  }

  private applyRate(speed: number): void {
    if (!this.player) return;
    this.player.shouldCorrectPitch = true;
    this.player.setPlaybackRate(speed, 'high');
  }

  /** Mirror locally first (instant, offline), then PATCH the preferences. */
  private storeSpeed(speed: number | null): void {
    const local =
      speed === null
        ? AsyncStorage.removeItem(PLAYBACK_SPEED_STORAGE_KEY)
        : AsyncStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(speed));
    local.catch(err => console.warn('[AudioPlayerStore] Failed to store speed:', err));
    // The settings bag is shallow-merged by the backend; null marks "off".
    userPreferencesService
      .update({ settings: { [PREFERENCE_SETTING_KEYS.playbackSpeed]: speed } })
      .catch(err => console.warn('[AudioPlayerStore] Speed preference sync failed:', err));
  }

  /**
   * Read the stored "every story" speed once: the device mirror wins, the
   * preferences (cached snapshot, else one GET in the background) fill in on
   * a device that has no mirror yet.
   */
  hydrateSpeed(): Promise<void> {
    if (!this.speedHydration) {
      this.speedHydration = (async () => {
        const epoch = this.speedEpoch;
        const adopt = (speed: number): void => {
          if (epoch !== this.speedEpoch) return;
          runInAction(() => {
            this.speedForAllStories = true;
            this.playbackSpeed = speed;
          });
          this.applyRate(speed);
        };
        try {
          const raw = await AsyncStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY);
          const local = validPlaybackSpeed(raw ? Number(raw) : null);
          if (local !== null) {
            adopt(local);
            return;
          }
          const fromPrefs = (prefs: Parameters<typeof readNumberSetting>[0]): void => {
            const stored = validPlaybackSpeed(
              readNumberSetting(prefs, PREFERENCE_SETTING_KEYS.playbackSpeed),
            );
            if (stored === null || epoch !== this.speedEpoch) return;
            adopt(stored);
            AsyncStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, String(stored)).catch(() => {});
          };
          const cached = userPreferencesService.getCachedSync();
          if (cached) {
            fromPrefs(cached);
          } else {
            userPreferencesService.get().then(fromPrefs).catch(() => {});
          }
        } catch (err) {
          console.warn('[AudioPlayerStore] Failed to read stored speed:', err);
        }
      })();
    }
    return this.speedHydration;
  }

  /** A story was put on the player: pick its speed and apply it. */
  private async applySpeedForNewStory(isNewStory: boolean): Promise<void> {
    await this.hydrateSpeed();
    if (isNewStory && !this.speedForAllStories && this.playbackSpeed !== 1.0) {
      runInAction(() => {
        this.playbackSpeed = 1.0;
      });
    }
    try {
      this.applyRate(this.playbackSpeed);
    } catch (error) {
      console.warn('Apply speed failed:', error);
    }
  }

  // ============================================================================
  // Samples
  // ============================================================================

  /**
   * Play a sample (voice preview) on the same player (replace, no new
   * instance). A playing story is paused first and saves its exact position;
   * it leaves the player, while its saved position, the last played record
   * and the meta cache let it start again at once. Samples never reach the
   * lock screen and never save or remember anything.
   */
  async playFromUrl(url: string, meta: SampleMeta = {}): Promise<void> {
    const key = meta.key ?? url;
    try {
      if (this.isStoryLoaded && this.isPlaying) await this.pause();
      await this.ensurePlayer();
      const player = this.player;
      if (!player) throw new Error('The audio player is not available');
      // A story start in flight loses to the sample.
      ++this.loadSeq;
      this.clearStoryStartWatch();
      this.clearDockHoldTimer();
      this.lockScreen.deactivate();
      player.pause();
      player.replace({ uri: url });
      runInAction(() => {
        this.source = 'sample';
        this.sampleKey = key;
        this.audioId = '';
        this.currentStory = null;
        this.currentVoiceProfile = null;
        this.currentNarratorName = null;
        this.currentOwnVoice = false;
        this.totalDurationMs = 0;
        this.currentPositionMs = 0;
        this.positionEpoch += 1;
        this.storyEnded = false;
        this.dockHold = false;
        this.loadPhase = 'idle';
        this.loadError = null;
        this.loadErrorNarrationId = null;
        this.pendingNarrationId = null;
        this.pausedByBackground = false;
      });
      this.setVolume(1);
      // A voice sample sounds at its own speed; the next story start applies
      // the story's speed again.
      try {
        this.applyRate(1);
      } catch (error) {
        console.warn('Resetting the rate for a sample failed:', error);
      }
      player.play();
      this.lastPlayCallAt = Date.now();
      runInAction(() => {
        this.isPlaying = true;
        this.isBuffering = false;
      });
      // Until it actually sounds this is only a promise: see the watchdog.
      this.watchPreview();
    } catch (error) {
      console.error('Play from URL error:', error);
      this.clearPreviewWatch();
      runInAction(() => {
        this.isPlaying = false;
      });
      showToast.error(msg('player.audioFailed'));
      throw error;
    }
  }

  /**
   * Stop the sample in the player: with a key, only that sample. Never
   * touches a story or a saved position.
   */
  async stopPreview(key?: string): Promise<void> {
    if (this.source !== 'sample') return;
    if (key !== undefined && key !== this.sampleKey) return;
    this.clearPreviewWatch();
    try {
      this.player?.pause();
    } catch (error) {
      console.warn('Stopping the sample failed:', error);
    }
    this.leaveSample();
  }

  // ============================================================================
  // Stop, reset, sign-out
  // ============================================================================

  /**
   * Stop whatever plays and leave the player empty. A loaded story saves its
   * position first; nothing deletes a saved position here (only the end of a
   * story does). For reset() and unloadForSignOut().
   */
  async stopAndCleanup(): Promise<void> {
    // Nothing is playing any more: take the player off the lock screen.
    this.lockScreen.deactivate();
    this.clearPreviewWatch();
    this.clearStoryStartWatch();
    this.clearDockHoldTimer();
    ++this.loadSeq;
    try {
      if (this.source === 'story') {
        this.pauseNativeAndSave();
      } else {
        this.player?.pause();
      }
    } catch (e) {
      console.warn('Error stopping audio:', e);
    }
    this.clearPlayback();
  }

  /** Signed out or the session expired: stop and forget everything but saved positions. */
  async unloadForSignOut(): Promise<void> {
    await this.pause();
    this.lockScreen.deactivate();
    this.clearPreviewWatch();
    this.clearStoryStartWatch();
    this.clearDockHoldTimer();
    this.stopPolling();
    ++this.loadSeq;
    this.clearPlayback();
    runInAction(() => {
      this.clearGeneration();
      this.clearError();
      this.clearConflict();
      this.previewFailed = false;
    });
  }

  private clearPlayback(): void {
    runInAction(() => {
      this.source = 'none';
      this.audioId = '';
      this.pendingNarrationId = null;
      this.loadPhase = 'idle';
      this.loadError = null;
      this.loadErrorNarrationId = null;
      this.isPlaying = false;
      this.isBuffering = false;
      this.storyEnded = false;
      this.currentPositionMs = 0;
      this.totalDurationMs = 0;
      this.positionEpoch += 1;
      this.currentStory = null;
      this.currentVoiceProfile = null;
      this.currentNarratorName = null;
      this.currentOwnVoice = false;
      this.sampleKey = null;
      this.dockHold = false;
      this.pausedByBackground = false;
    });
    this.lastSavedPositionMs = 0;
  }

  cleanup(): void {
    this.stopPolling();
    void this.stopAndCleanup();
  }

  reset(): void {
    void this.stopAndCleanup();
    this.stopPolling();
    this.clearGeneration();
    this.clearError();
  }

  // ============================================================================
  // Audio generation (kept apart from playback)
  // ============================================================================

  private clearGeneration(): void {
    // A start still in flight belongs to the session that ends here.
    this.generationSeq += 1;
    this.isGenerating = false;
    this.generationProgress = 0;
    this.generatingNarrationId = null;
    this.generatingStory = null;
    this.generatingVoiceProfile = null;
    this.generationReadyId = null;
    this.generationSlow = false;
    this.replacingPair = null;
  }

  /**
   * Synchronously flip into the "generating" state before any await, so a
   * freshly mounted AudioGeneration screen never mistakes the previous
   * job's finished state for its own result.
   */
  beginGenerationSession(): void {
    this.stopPolling();
    this.clearGeneration();
    this.isGenerating = true;
    this.clearError();
    this.conflictExistingNarrationId = null;
    this.conflictExistingNarrationStatus = null;
  }

  async generateAudio(
    story: Story,
    voiceProfile: VoiceProfile,
    options?: { replace?: boolean },
  ): Promise<void> {
    const seq = ++this.generationSeq;
    const userId = getSessionUserId();
    // Another session started meanwhile (the user went on to another job,
    // or signed out).
    const superseded = () => seq !== this.generationSeq;
    try {
      this.stopPolling();
      this.replacingPair = options?.replace
        ? { storyId: story.id, voiceProfileId: voiceProfile.id }
        : null;
      runInAction(() => {
        this.generatingStory = story;
        this.generatingVoiceProfile = voiceProfile;
        this.generatingNarrationId = null;
        this.generationReadyId = null;
        this.isGenerating = true;
        this.generationSlow = false;
        this.clearError();
        this.generationProgress = 0;
        this.conflictExistingNarrationId = null;
        this.conflictExistingNarrationStatus = null;
      });

      let narration;
      try {
        narration = await NarrationService.createNarration(
          story.id,
          voiceProfile.id,
          { replace: options?.replace },
        );
      } catch (err) {
        if (err instanceof NarrationAlreadyExistsError && !superseded()) {
          if (err.isInProgress) {
            // Same (story, voice) narration is already being generated:
            // follow that one instead of offering a retry that would 409
            // again. The screen shows "hazırlanıyor" and opens the player
            // once it is READY.
            runInAction(() => {
              this.conflictExistingNarrationStatus = err.existingStatus;
            });
            await this.trackExistingNarration(err.existingNarrationId);
            return;
          }
          // READY: park in a "conflict" state (NOT an error). The screen
          // offers "Var olanı dinle" / "Yeniden oluştur" instead of the
          // generic retry/back pair.
          runInAction(() => {
            this.isGenerating = false;
            this.conflictExistingNarrationId = err.existingNarrationId;
            this.conflictExistingNarrationStatus = err.existingStatus;
          });
          return;
        }
        throw err;
      }

      // A job the user left for another one is still made (it goes on "in
      // the background", the push announces it); the store follows the new one.
      if (!superseded()) {
        runInAction(() => {
          this.generatingNarrationId = narration.id || null;
        });
      } else if (getSessionUserId() !== userId) {
        // Signed out (or someone else signed in) meanwhile: not theirs to make.
        return;
      }

      // The backend counts the narration here (and may refuse it with a
      // quota 403 even after the create passed its pre-check).
      await NarrationService.generateAudio(narration.id);
      getSubscriptionStore().loadUsageSoon();
      if (superseded()) return;
      await this.pollAudioStatus();
    } catch (error) {
      console.error('Generate audio error:', error);
      // A late refusal of a job the user left never fails the newer one.
      if (superseded()) return;
      this.failGeneration(error, msg('narration.createFailed'));
    }
  }

  /**
   * A generation that could not start (the create, the generate call, or
   * the screen resolving the story and the voice). A used-up allowance (a
   * quota 403, PREMIUM_STORY) becomes `quotaBlock`: no error and no
   * message (the screen explains the plan), and the usage is read again
   * soon. Anything else is the error state, with the kind of failure
   * (offline, server...) the screen picks its copy by.
   */
  failGeneration(error: unknown, fallbackMessage: string): void {
    this.stopPolling();
    this.isGenerating = false;
    this.replacingPair = null;
    const subscription = getSubscriptionStore();
    const block = parseQuotaBlock(error, subscription.planId);
    if (block) {
      this.hasError = false;
      this.errorMessage = '';
      this.errorKind = null;
      this.quotaBlock = block;
      subscription.loadUsageSoon();
      return;
    }
    this.quotaBlock = null;
    this.errorKind = classifyFailure(error, getConnectivityStore());
    this.setError(getErrorMessage(error, fallbackMessage));
    // Offline is the phone, not the app: only the other failures are reported.
    if (this.errorKind !== 'offline') {
      recordNonFatal(error, 'narration', {
        step: 'start',
        kind: this.errorKind,
        status: isApiError(error) ? error.status : null,
        code: isApiError(error) ? error.code : null,
      });
    }
  }

  /**
   * Follow a narration that is already being generated server-side (409
   * NARRATION_EXISTS with status GENERATING).
   */
  async trackExistingNarration(narrationId: string): Promise<void> {
    this.stopPolling();
    runInAction(() => {
      this.generatingNarrationId = narrationId;
      this.generationReadyId = null;
      this.isGenerating = true;
      this.generationSlow = false;
      this.clearError();
      this.generationProgress = 0;
      this.conflictExistingNarrationId = null;
    });
    await this.pollAudioStatus();
  }

  /**
   * The generation screen opened again on the running job: a poll that
   * gave up (GENERATION_POLL_LIMIT_MS) follows the job again, at the slow
   * pace once it is slow, so a READY or FAILED the socket did not bring
   * still arrives. A running poll is left alone.
   */
  resumeGenerationPoll(): void {
    const narrationId = this.generatingNarrationId;
    if (!this.isGenerating || !narrationId || this.pollingTimer) return;
    this.schedulePoll(
      narrationId,
      Date.now(),
      this.generationSlow ? GENERATION_SLOW_POLL_MS : POLLING_INTERVALS.AUDIO_GENERATION,
    );
  }

  /**
   * Follow the job until the backend reports READY or FAILED, every
   * POLLING_INTERVALS.AUDIO_GENERATION. After GENERATION_SLOW_AFTER_MS the
   * job is only slow (`generationSlow`, never an error) and is asked every
   * GENERATION_SLOW_POLL_MS; after GENERATION_POLL_LIMIT_MS the poll stops
   * without a word (the socket and the push still announce the end). A
   * failed request is asked again on the next tick. Wall-clock time, so
   * time the app spent suspended counts.
   */
  private async pollAudioStatus(): Promise<void> {
    const narrationId = this.generatingNarrationId;
    if (!narrationId) {
      runInAction(() => {
        this.isGenerating = false;
        this.setError(msg('narration.missingId'));
      });
      return;
    }
    this.schedulePoll(narrationId, Date.now(), POLLING_INTERVALS.AUDIO_GENERATION);
  }

  private schedulePoll(narrationId: string, startedAt: number, intervalMs: number): void {
    this.stopPolling();
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      void this.pollOnce(narrationId, startedAt, timer);
    }, intervalMs);
    this.pollingTimer = timer;
  }

  private async pollOnce(
    narrationId: string,
    startedAt: number,
    timer: ReturnType<typeof setInterval>,
  ): Promise<void> {
    // False for a tick of a job that was stopped or replaced meanwhile; a
    // job the socket announced READY meanwhile ends the poll.
    const current = (): boolean => {
      if (this.pollingTimer !== timer) return false;
      if (this.generatingNarrationId !== narrationId) {
        this.stopPolling();
        return false;
      }
      if (this.generationReadyId === narrationId) {
        this.stopPolling();
        this.followRegenerate(narrationId);
        return false;
      }
      return true;
    };
    if (!current()) return;

    try {
      const statusData = await NarrationService.getNarrationStatus(narrationId);
      if (!current()) return;
      const status = statusData.status;
      const progress = statusData.progress;

      if (typeof progress === 'number' && Number.isFinite(progress)) {
        runInAction(() => {
          // Never backwards within a job.
          this.generationProgress = Math.max(this.generationProgress, progress);
        });
      }

      if (status === AudioGenerationStatus.READY) {
        this.stopPolling();
        // Announced, never loaded: the story in the player stays.
        runInAction(() => {
          this.generationProgress = 100;
          this.isGenerating = false;
          this.generationSlow = false;
          this.generationReadyId = narrationId;
        });
        this.followRegenerate(narrationId);
        return;
      }
      if (status === AudioGenerationStatus.FAILED) {
        // The only failure of a running job: the backend gave up on it.
        this.stopPolling();
        recordNonFatal(new Error('Narration generation failed'), 'narration', {
          step: 'generate',
          narrationId,
        });
        runInAction(() => {
          this.isGenerating = false;
          this.generationSlow = false;
          this.setError(statusData.errorMessage ?? msg('narration.createFailed'));
        });
        return;
      }
    } catch (error) {
      // A dropped request is not a failed narration: asked again next tick.
      console.error('Polling error:', error);
      if (!current()) return;
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed >= GENERATION_POLL_LIMIT_MS) {
      this.stopPolling();
    } else if (!this.generationSlow && elapsed >= GENERATION_SLOW_AFTER_MS) {
      runInAction(() => {
        this.generationSlow = true;
      });
      this.schedulePoll(narrationId, startedAt, GENERATION_SLOW_POLL_MS);
    }
  }

  /**
   * A regenerate made a new narration of the pair and the old one is gone:
   * a queue entry of the old one takes the new one's place (SPEC-audio 2.6).
   */
  private followRegenerate(narrationId: string): void {
    const pair = this.replacingPair;
    this.replacingPair = null;
    if (!pair) return;
    const queued = queueStore.entries.some(
      e => e.storyId === pair.storyId && e.voiceProfileId === pair.voiceProfileId,
    );
    if (!queued) return;
    NarrationService.getNarrationById(narrationId)
      .then(narration => {
        const meta = metaFromNarration(narration);
        rememberNarrationMeta(meta);
        queueStore.replaceNarration(pair.storyId, pair.voiceProfileId, meta);
      })
      .catch(error => {
        // The old entry stays; the queue skips a narration that is gone.
        console.warn('[AudioPlayerStore] The regenerated narration could not be queued:', error);
      });
  }

  private stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /** Leave the generating state without touching the loaded narration. */
  stopGenerating(): void {
    this.stopPolling();
    this.isGenerating = false;
  }

  // ============================================================================
  // Errors (generation)
  // ============================================================================

  setError(message: string): void {
    this.hasError = true;
    this.errorMessage = message;
    showToast.error(message);
  }

  /** Error, its kind and a quota block gone: a retry or a new job starts clean. */
  clearError(): void {
    this.hasError = false;
    this.errorMessage = '';
    this.errorKind = null;
    this.quotaBlock = null;
  }

  clearConflict(): void {
    this.conflictExistingNarrationId = null;
    this.conflictExistingNarrationStatus = null;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let audioPlayerStoreInstance: AudioPlayerStore | null = null;

/**
 * The app's audio store, created on first use (registered with the socket
 * service and bound to the shared progress value). No effects.
 */
export function getAudioPlayerStore(): AudioPlayerStore {
  if (!audioPlayerStoreInstance) {
    audioPlayerStoreInstance = new AudioPlayerStore();
    WebSocketService.registerAudioPlayerStore(audioPlayerStoreInstance);
    // One native-driven progress value for every progress bar in the app.
    bindPlaybackProgress(audioPlayerStoreInstance);
  }
  return audioPlayerStoreInstance;
}

/** The store if something created it already; never creates it (sign-out). */
export function getAudioPlayerStoreIfCreated(): AudioPlayerStore | null {
  return audioPlayerStoreInstance;
}

/** The audio store in a component. Cheap: no effects, no listeners. */
export function useAudioPlayer(): AudioPlayerStore {
  return useMemo(getAudioPlayerStore, []);
}

// Export for testing or direct access
export { AudioPlayerStore };

/**
 * Re-apply the playback audio mode the player uses (`playbackAudioMode` for
 * the current plan). The voice recording flow switches the session to
 * `allowsRecording: true` (iOS playAndRecord, which degrades Bluetooth
 * output) and a partial setAudioModeAsync resets unspecified fields such as
 * `shouldPlayInBackground`, so it calls this after a take and on unmount.
 */
export async function restorePlaybackAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      ...playbackAudioMode(getSubscriptionStore().canPlayInBackground),
      allowsRecording: false,
    });
  } catch (err) {
    console.warn('restorePlaybackAudioMode failed:', err);
  }
}
