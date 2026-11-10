/**
 * The sleep timer's drain line (SPEC-audio 7.4): how much of a running
 * duration timer is left, as one native-driven `Animated.Value` (1 full, 0
 * at the deadline) that the player tile and the timer sheet both draw.
 *
 * The countdown digits never animate; the motion lives here. The value is
 * re-anchored on the wall clock whenever the deadline or the timer's length
 * changes (start, restart, "+5 dk", off) and runs toward 0 in linear chunks
 * of at most SLEEP_DRAIN_CHUNK_MS on the native driver: one long timing to
 * the deadline would build a frame table of the whole duration (108 000
 * values for 30 minutes) on every anchor. In the background nothing runs;
 * back in the foreground it starts again from the wall clock.
 *
 * It only works while something shows it: `useSleepDrain()` keeps it
 * running for the lifetime of the calling component.
 */

import { useEffect } from 'react';
import { Animated, AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import { comparer, reaction } from 'mobx';
import { EASE } from '../../theme/motion';
import sleepTimerService from '../../services/SleepTimerService';

/** Longest single native timing of the drain. */
export const SLEEP_DRAIN_CHUNK_MS = 20000;

/** What the drain follows (the sleep timer store satisfies it). */
export interface DrainSource {
  readonly isDurationRunning: boolean;
  readonly endsAtMs: number | null;
  /** The timer's whole length in ms (its minutes plus every "+5 dk"). */
  readonly durationTotalMs: number;
}

/** Fraction of the timer left at `nowMs`, 0 to 1 (0 without a timer). */
export function drainFraction(endsAtMs: number | null, totalMs: number, nowMs: number): number {
  if (endsAtMs === null || !(totalMs > 0)) return 0;
  return Math.min(1, Math.max(0, (endsAtMs - nowMs) / totalMs));
}

/** 'active' or not reported yet: the drain runs. */
function isForeground(state: AppStateStatus | null | undefined | unknown): boolean {
  return state !== 'background' && state !== 'inactive';
}

export class SleepDrain {
  /** Remaining fraction, 1 full to 0 at the deadline. */
  readonly value = new Animated.Value(1);

  private users = 0;
  private running: Animated.CompositeAnimation | null = null;
  private disposeAnchor: (() => void) | null = null;
  private appStateSub: NativeEventSubscription | null = null;
  private foreground = true;

  constructor(
    private readonly source: DrainSource,
    private readonly now: () => number = Date.now,
  ) {}

  /** Keep the drain running while the caller shows it. Returns the release. */
  retain(): () => void {
    this.users += 1;
    if (this.users === 1) this.start();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.users -= 1;
      if (this.users === 0) this.stop();
    };
  }

  /** Set the value from the wall clock and run the next chunk toward the deadline. */
  apply(): void {
    this.halt();
    const { isDurationRunning, endsAtMs, durationTotalMs } = this.source;
    const now = this.now();
    const fraction = isDurationRunning ? drainFraction(endsAtMs, durationTotalMs, now) : 0;
    this.value.setValue(fraction);
    if (!isDurationRunning || endsAtMs === null || !this.foreground || fraction <= 0) return;
    const chunkMs = Math.min(endsAtMs - now, SLEEP_DRAIN_CHUNK_MS);
    const animation = Animated.timing(this.value, {
      toValue: drainFraction(endsAtMs, durationTotalMs, now + chunkMs),
      duration: chunkMs,
      easing: EASE.linear,
      useNativeDriver: true,
    });
    this.running = animation;
    animation.start(({ finished }) => {
      // A stop (re-anchor, background, release) starts nothing.
      if (finished && this.running === animation) this.apply();
    });
  }

  private start(): void {
    this.foreground = isForeground(AppState.currentState);
    this.disposeAnchor = reaction(
      () => [this.source.isDurationRunning, this.source.endsAtMs, this.source.durationTotalMs],
      () => this.apply(),
      { equals: comparer.structural },
    );
    this.appStateSub = AppState.addEventListener('change', next => {
      const foreground = isForeground(next);
      if (foreground === this.foreground) return;
      this.foreground = foreground;
      if (foreground) this.apply();
      else this.halt();
    });
    this.apply();
  }

  private stop(): void {
    this.disposeAnchor?.();
    this.disposeAnchor = null;
    this.appStateSub?.remove();
    this.appStateSub = null;
    this.halt();
  }

  private halt(): void {
    const animation = this.running;
    this.running = null;
    animation?.stop();
  }
}

/** The app's one drain, on the sleep timer store. */
export const sleepDrain = new SleepDrain(sleepTimerService.store);

/** The shared drain value, kept running while the calling component is mounted. */
export function useSleepDrain(drain: SleepDrain = sleepDrain): Animated.Value {
  useEffect(() => drain.retain(), [drain]);
  return drain.value;
}
