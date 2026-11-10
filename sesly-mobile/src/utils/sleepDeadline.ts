/**
 * The duration sleep timer's native deadline (Android, modules/sesly-media,
 * SPEC-audio 7.2).
 *
 * React Native's JS timers stop while the activity is paused, so on Android
 * a deadline kept only in JS would pass unnoticed with the screen off and
 * the story would play on. The native timer runs on the main looper next to
 * expo-audio's ExoPlayer: it fades the volume over the last minute, pauses
 * the player at the deadline and tells JS (`onFired`).
 *
 * Null on iOS (JS timers keep running there while audio plays), in Jest and
 * on a binary built before the native timer existed: SleepTimerService then
 * keeps the deadline in JS, driven by its ticker and by the player's status
 * updates. A failing call is logged, never thrown: the JS fallback stays on.
 */

import type { SeslyMediaModule, SleepTimerFiredEvent } from '../../modules/sesly-media';
import { getAndroidMediaSession } from './mediaSession';

export type { SleepTimerFiredEvent };

export interface SleepDeadline {
  /**
   * Pause `player` at `endsAtEpochMs`, fading over the last `fadeMs` (0:
   * none). Replaces a deadline. Resolves false when the native side refused
   * it (logged): the caller keeps that deadline, and its fade, in JS.
   */
  arm(player: object, endsAtEpochMs: number, fadeMs: number): Promise<boolean>;
  /** Cancel the deadline; `restoreVolume` puts a faded volume back. */
  disarm(restoreVolume: boolean): void;
  /** The deadline fired (the player is paused). Returns the unsubscribe. */
  onFired(listener: (event: SleepTimerFiredEvent) => void): () => void;
}

function warn(what: string, error: unknown): void {
  console.warn(`[SleepDeadline] ${what} failed:`, error);
}

/** Run a native call; a throw or a rejection is logged and resolves false. */
function call(what: string, run: () => Promise<void> | void): Promise<boolean> {
  try {
    const result = run();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).then(
        () => true,
        error => {
          warn(what, error);
          return false;
        },
      );
    }
    return Promise.resolve(true);
  } catch (error) {
    warn(what, error);
    return Promise.resolve(false);
  }
}

/** Android builds that have the native timer; null on iOS, in Jest and on an older binary. */
export function getNativeSleepDeadline(
  module: SeslyMediaModule | null = getAndroidMediaSession(),
): SleepDeadline | null {
  if (
    !module ||
    typeof module.armSleepTimer !== 'function' ||
    typeof module.disarmSleepTimer !== 'function'
  ) {
    return null;
  }
  return {
    arm(player, endsAtEpochMs, fadeMs) {
      return call('Arming', () => module.armSleepTimer(player, endsAtEpochMs, Math.max(0, fadeMs)));
    },
    disarm(restoreVolume) {
      void call('Disarming', () => module.disarmSleepTimer(restoreVolume));
    },
    onFired(listener) {
      try {
        const subscription = module.addListener('onSleepTimerFired', event => {
          try {
            listener(event);
          } catch (error) {
            warn('Handling the deadline', error);
          }
        });
        return () => subscription.remove();
      } catch (error) {
        warn('Listening', error);
        return () => {};
      }
    },
  };
}
