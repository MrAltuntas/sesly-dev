/**
 * One playback progress value for the whole app.
 *
 * expo-audio reports the position twice a second. Drawing a bar straight from
 * those reports moves it in steps, and running a JS timer in between re-renders
 * React for every step. Instead the progress of the loaded narration lives in
 * a single `Animated.Value` (0 to 1) that is animated on the native driver:
 * after each anchor (play, pause, seek, speed change, new track, a report that
 * drifted) a linear animation runs from the current position, at the playback
 * rate, in chunks of 20 seconds (one timing toward the end of a long story
 * would build a frame array for the whole story on every anchor). Reports that
 * agree with that prediction change nothing, so the bar glides and React is
 * not involved.
 *
 * Nothing animates while the stream buffers or while the real length is
 * unknown: the bar rests at its position (0 or the resume point) until audio
 * arrives, so it never runs ahead and snaps back.
 *
 * The player screen, the mini player and the library row all read this same
 * value, so they cannot disagree.
 *
 * Two things must never throw the bar back after a seek (NL-01):
 * - React Native's end-of-animation sync. A stopped native animation reports
 *   where it stood when it was stopped, after the driver already set the
 *   seek target, and Fabric commits that old value over the native one. The
 *   driver answers that sync with what it shows now (`syncFromDriver`).
 * - A position report the player read before the jump. The audio store keeps
 *   a seek's target until a report agrees with it, at most
 *   `SEEK_CONFIRM_MS` after the player answered (`SeekConfirmation`).
 */

import { Animated, AppState, Easing } from 'react-native';
import { reaction } from 'mobx';

/**
 * Whole minutes left at the playback rate, rounded up; null when the duration
 * is unknown. A story that is not loaded has no speed: callers pass rate 1.
 */
export function remainingMinutes(
  positionMs: number,
  durationMs: number,
  rate: number = 1,
): number | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const speed = Number.isFinite(rate) && rate > 0 ? rate : 1;
  const left = Math.max(0, durationMs - Math.max(0, positionMs)) / speed;
  if (left <= 0) return 0;
  return Math.max(1, Math.ceil(left / 60000));
}

/** Played fraction, clamped to 0..1; 0 when the duration is unknown. */
export function playedFraction(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  return Math.min(1, Math.max(0, positionMs / durationMs));
}

/**
 * How far a position report may be from the predicted position before the
 * animation is re-anchored. Reports arrive every 500 ms with some jitter; a
 * smaller tolerance would restart the animation on most of them.
 */
export const DRIFT_TOLERANCE_MS = 400;

/**
 * Wall-clock length of one native animation. At 60 fps that is at most 1 200
 * frames per anchor, whatever the length of the story.
 */
export const PROGRESS_CHUNK_MS = 20000;

export interface PlaybackSnapshot {
  /** Narration the player holds; '' when it holds no story. */
  readonly narrationId: string;
  readonly positionMs: number;
  readonly durationMs: number;
  readonly playing: boolean;
  /** Playback rate (1 = normal). */
  readonly rate: number;
  /** Bumped by every seek or restart, so even a tiny jump re-anchors. */
  readonly epoch: number;
}

interface Anchor extends PlaybackSnapshot {
  /** Clock time the snapshot was taken at. */
  readonly at: number;
}

/**
 * What the native value does since the driver last set it: it rests at
 * `from` (`durationMs` 0), or runs linearly from `from` to `to` over
 * `durationMs` from the clock time `at`.
 */
interface Segment {
  readonly from: number;
  readonly to: number;
  readonly at: number;
  readonly durationMs: number;
}

/** The internal hook React Native syncs the JS side of a native value through. */
type NativeValueSync = (value: number, offset?: number) => void;

/**
 * Point React Native's end-of-animation sync at the driver.
 *
 * When a native animation ends, React Native copies the value the native node
 * had at that moment into the JS side of the value and re-renders the views
 * bound to it; on Fabric that render commits the copied value over what the
 * native driver drew. An animation the driver stopped reports the place it
 * was stopped at, and the report arrives after the driver set the new value:
 * a 15 s rewind stopped the running chunk at the old position, set the
 * target, and a moment later the knob was committed back at the old position.
 * Nothing animates while the stream buffers after a rewind, so it stayed
 * there until the next native write, about half a second (NL-01). The JS
 * side therefore takes what the driver shows now; while a chunk runs that is
 * the native value within a frame.
 *
 * `__onAnimatedValueUpdateReceived` is React Native's internal name for that
 * sync (`Animation.__startAnimationIfNative`, RN 0.83); a test runs the real
 * end callback through it. Without the method this changes nothing.
 */
function syncFromDriver(value: Animated.Value, shown: () => number): void {
  const node = value as unknown as { __onAnimatedValueUpdateReceived?: NativeValueSync };
  const original = node.__onAnimatedValueUpdateReceived;
  if (typeof original !== 'function') return;
  node.__onAnimatedValueUpdateReceived = (_reported: number, offset?: number) => {
    original.call(value, shown(), offset);
  };
}

export class PlaybackProgressDriver {
  /** Played fraction of the loaded narration, 0 to 1. Native driver only. */
  readonly progress = new Animated.Value(0);

  private anchor: Anchor | null = null;
  private foreground = true;
  private running: Animated.CompositeAnimation | null = null;
  private segment: Segment = { from: 0, to: 0, at: 0, durationMs: 0 };

  constructor(private readonly now: () => number = Date.now) {
    syncFromDriver(this.progress, () => this.shownFraction());
  }

  /**
   * The fraction the native value shows now: the value last set, moved
   * along the running chunk. The JS side of `progress` is synced to it.
   */
  shownFraction(): number {
    const { from, to, at, durationMs } = this.segment;
    if (durationMs <= 0) return from;
    const t = Math.min(1, Math.max(0, (this.now() - at) / durationMs));
    return from + (to - from) * t;
  }

  /** Narration the value describes; '' when none. */
  get narrationId(): string {
    return this.anchor?.narrationId ?? '';
  }

  /** True while the native animation is running. */
  get isAnimating(): boolean {
    return this.running !== null;
  }

  /** Where playback is right now according to the last anchor, in milliseconds. */
  expectedPositionMs(): number {
    const anchor = this.anchor;
    if (!anchor) return 0;
    const advanced =
      anchor.playing && this.foreground ? (this.now() - anchor.at) * anchor.rate : 0;
    const position = anchor.positionMs + advanced;
    return anchor.durationMs > 0 ? Math.min(anchor.durationMs, Math.max(0, position)) : 0;
  }

  /** Feed the latest player state. Cheap when nothing relevant changed. */
  sync(next: PlaybackSnapshot): void {
    const prev = this.anchor;
    const changed =
      !prev ||
      prev.narrationId !== next.narrationId ||
      prev.durationMs !== next.durationMs ||
      prev.playing !== next.playing ||
      prev.rate !== next.rate ||
      prev.epoch !== next.epoch ||
      Math.abs(next.positionMs - this.expectedPositionMs()) > DRIFT_TOLERANCE_MS;
    if (!changed) return;
    this.anchor = { ...next, at: this.now() };
    this.apply();
  }

  /**
   * The app went to the background or came back. Nothing is animated while it
   * is not visible; on return the value restarts from the last known position
   * (the next report corrects it within half a second).
   */
  setForeground(foreground: boolean): void {
    if (this.foreground === foreground) return;
    const anchor = this.anchor;
    if (anchor) {
      // Freeze the prediction under the old state before switching.
      this.anchor = { ...anchor, positionMs: this.expectedPositionMs(), at: this.now() };
    }
    this.foreground = foreground;
    this.apply();
  }

  private apply(): void {
    const previous = this.running;
    if (previous) {
      // Cleared first: the stop callback of the old animation must not start a chunk.
      this.running = null;
      previous.stop();
    }
    const anchor = this.anchor;
    if (!anchor || !anchor.narrationId || anchor.durationMs <= 0) {
      this.rest(0);
      return;
    }
    const positionMs = Math.min(anchor.durationMs, Math.max(0, anchor.positionMs));
    const fraction = positionMs / anchor.durationMs;
    this.rest(fraction);
    const rate = anchor.rate > 0 ? anchor.rate : 1;
    const leftMs = (anchor.durationMs - positionMs) / rate;
    if (!anchor.playing || !this.foreground || leftMs <= 0) return;
    const chunkMs = Math.min(leftMs, PROGRESS_CHUNK_MS);
    const toValue = Math.min(1, (positionMs + chunkMs * rate) / anchor.durationMs);
    const animation = Animated.timing(this.progress, {
      toValue,
      duration: chunkMs,
      easing: Easing.linear,
      useNativeDriver: true,
      isInteraction: false,
    });
    this.running = animation;
    this.segment = { from: fraction, to: toValue, at: this.now(), durationMs: chunkMs };
    animation.start(({ finished }) => {
      if (this.running !== animation) return;
      this.running = null;
      const current = this.anchor;
      if (!finished || !current) {
        // Stopped from outside the driver: the value stays where it stopped.
        const stoppedAt = this.shownFraction();
        this.segment = { from: stoppedAt, to: stoppedAt, at: this.now(), durationMs: 0 };
        return;
      }
      // Re-anchor on the prediction, not on the chunk's end: the end callback
      // reaches JS a little after the native end, and anchoring on the chunk
      // end would add that delay to every chunk.
      this.anchor = { ...current, positionMs: this.expectedPositionMs(), at: this.now() };
      this.apply();
    });
  }

  /** Set the value; it rests there until an animation starts from it. */
  private rest(fraction: number): void {
    this.progress.setValue(fraction);
    this.segment = { from: fraction, to: fraction, at: this.now(), durationMs: 0 };
  }
}

/** The app's single driver. */
export const playbackProgress = new PlaybackProgressDriver();

/**
 * How long after the player answered a seek a position report has to agree
 * with the seek's target before any report counts again.
 */
export const SEEK_CONFIRM_MS = 1000;

/**
 * The confirmation window of a seek, kept by the audio store.
 *
 * The player can deliver a status it read before the jump after its seek
 * call returned; taking it would throw the bar and the clock back to the old
 * position until the next report (NL-01). So from the moment a seek is sent
 * only a report near its target counts (the target, or ahead of it by the
 * time since the seek at the playback rate, within `DRIFT_TOLERANCE_MS`),
 * and the first such report ends the window. `SEEK_CONFIRM_MS` after the
 * player answered, any report counts again, so a seek the player did not
 * follow is corrected within a second. A new position epoch (another seek, a
 * restart, a reload, a new track) ends the window as well.
 */
export class SeekConfirmation {
  private pending: {
    readonly targetMs: number;
    readonly epoch: number;
    readonly rate: number;
    readonly sentAt: number;
    landedAt: number | null;
  } | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** A seek to `targetMs` was sent; `epoch` is the position epoch the seek set. */
  begin(targetMs: number, epoch: number, rate: number = 1): void {
    this.pending = {
      targetMs,
      epoch,
      rate: Number.isFinite(rate) && rate > 0 ? rate : 1,
      sentAt: this.now(),
      landedAt: null,
    };
  }

  /** The player answered the seek of `epoch`: the window closes `SEEK_CONFIRM_MS` from now. */
  landed(epoch: number): void {
    const pending = this.pending;
    if (pending && pending.epoch === epoch && pending.landedAt === null) {
      pending.landedAt = this.now();
    }
  }

  /** A seek is waiting for a report near its target. */
  isWaiting(epoch: number): boolean {
    const pending = this.pending;
    if (!pending) return false;
    if (pending.epoch !== epoch || this.expired()) {
      this.pending = null;
      return false;
    }
    return true;
  }

  /**
   * Whether a position report (milliseconds) counts. `epoch` is the store's
   * position epoch now. A report near the target confirms the seek.
   */
  accepts(reportMs: number, epoch: number): boolean {
    const pending = this.isWaiting(epoch) ? this.pending : null;
    if (!pending) return true;
    const ahead = Math.max(0, this.now() - pending.sentAt) * pending.rate;
    const nearTarget =
      reportMs >= pending.targetMs - DRIFT_TOLERANCE_MS &&
      reportMs <= pending.targetMs + ahead + DRIFT_TOLERANCE_MS;
    if (!nearTarget) return false;
    this.pending = null;
    return true;
  }

  private expired(): boolean {
    const landedAt = this.pending?.landedAt;
    return landedAt != null && this.now() - landedAt > SEEK_CONFIRM_MS;
  }
}

/** The part of the audio store the driver follows. */
export interface PlaybackProgressSource {
  readonly audioId: string;
  readonly isPlayingStory: boolean;
  /** The user's intent to play (true while a stream still buffers). */
  readonly isPlaying: boolean;
  readonly currentPositionMs: number;
  /** Real length only; 0 while unknown. */
  readonly totalDurationMs: number;
  readonly playbackSpeed: number;
  readonly positionEpoch: number;
  /** A seek is in flight: the value waits at the target until it lands. */
  readonly isSeeking?: boolean;
  /** The native player waits for data: the value holds its position. */
  readonly isBuffering?: boolean;
  /**
   * A start or a reload is putting a stream in the player: nothing sounds
   * yet (the outgoing story is already paused), so the value holds.
   */
  readonly isLoading?: boolean;
}

/**
 * Keep a driver in step with the audio store. Returns the disposer.
 * A preview (not a story) leaves the value at 0.
 */
export function bindPlaybackProgress(
  source: PlaybackProgressSource,
  driver: PlaybackProgressDriver = playbackProgress,
): () => void {
  const isForeground = (state: string | null | undefined) =>
    state !== 'background' && state !== 'inactive';
  // Before the first snapshot: bound in the background, nothing starts.
  driver.setForeground(isForeground(AppState.currentState));
  const disposeReaction = reaction(
    (): PlaybackSnapshot => {
      const story = source.isPlayingStory && !!source.audioId;
      return {
        narrationId: story ? source.audioId : '',
        positionMs: story ? source.currentPositionMs : 0,
        durationMs: story ? source.totalDurationMs : 0,
        playing:
          story &&
          source.isPlaying &&
          !source.isSeeking &&
          !source.isBuffering &&
          !source.isLoading &&
          source.totalDurationMs > 0,
        rate: source.playbackSpeed,
        epoch: source.positionEpoch,
      };
    },
    snapshot => driver.sync(snapshot),
    { fireImmediately: true },
  );
  const subscription = AppState.addEventListener('change', state => {
    driver.setForeground(isForeground(state));
  });
  return () => {
    disposeReaction();
    subscription?.remove();
  };
}
