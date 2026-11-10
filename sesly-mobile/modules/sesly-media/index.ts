/**
 * SeslyMedia: the Android lock-screen and notification player (a Media3
 * MediaSession bound to the app's one expo-audio player), and the duration
 * sleep timer's deadline on the main looper (JS timers stop while the
 * screen is off). Android only; `null` on iOS, web and in Jest, where
 * expo-audio's own lock-screen support and the JS timers are used instead.
 * The logic that uses it lives in src/utils/mediaSession.ts and
 * src/utils/sleepDeadline.ts. A binary built before the sleep timer has no
 * `armSleepTimer`: callers check for it.
 */

import { requireOptionalNativeModule } from 'expo-modules-core';
import type { EventSubscription } from 'expo-modules-core';

/** Commands from the notification, the lock screen, headsets and Bluetooth. */
export type MediaSessionCommand =
  | 'play'
  | 'pause'
  | 'stop'
  | 'seekTo'
  | 'skipBackward'
  | 'skipForward';

export interface MediaSessionCommandEvent {
  command: MediaSessionCommand;
  /** Target position of `seekTo`. */
  positionMs?: number;
  /** Interval of `skipBackward` / `skipForward`. */
  intervalMs?: number;
}

export interface MediaSessionEndedEvent {
  reason: string;
}

export interface MediaSessionMetadata {
  title: string;
  artist?: string | null;
  albumTitle?: string | null;
  /** Remote story cover (http or https). */
  artworkUrl?: string | null;
  /** The placeholder cover as `Image.resolveAssetSource(...).uri` gives it. */
  fallbackArtworkUri?: string | null;
}

export interface MediaSessionOptions {
  skipBackwardMs: number;
  skipForwardMs: number;
}

/** The native sleep timer reached its deadline. */
export interface SleepTimerFiredEvent {
  /** The player was sounding and has been paused. */
  paused: boolean;
  /** Wall clock of the check that fired, epoch ms. */
  firedAtMs: number;
}

export interface SeslyMediaEvents {
  onCommand: (event: MediaSessionCommandEvent) => void;
  onBecomingNoisy: () => void;
  onSessionEnded: (event: MediaSessionEndedEvent) => void;
  onSleepTimerFired: (event: SleepTimerFiredEvent) => void;
}

export interface SeslyMediaModule {
  /** `player` is the expo-audio AudioPlayer (a shared object). */
  activate(player: object, metadata: MediaSessionMetadata, options: MediaSessionOptions): Promise<void>;
  updateMetadata(metadata: MediaSessionMetadata): Promise<void>;
  deactivate(): Promise<void>;
  isActive(): boolean;
  /**
   * Pause `player` (the expo-audio AudioPlayer) at `endsAtEpochMs`, fading
   * its volume out over the last `fadeMs` (0: no fade). Arming again
   * replaces the deadline. Works without an active media session.
   */
  armSleepTimer(player: object, endsAtEpochMs: number, fadeMs: number): Promise<void>;
  /** Cancel the deadline; `restoreVolume` puts a faded volume back to 1. */
  disarmSleepTimer(restoreVolume: boolean): Promise<void>;
  isSleepTimerArmed(): boolean;
  addListener<E extends keyof SeslyMediaEvents>(event: E, listener: SeslyMediaEvents[E]): EventSubscription;
}

const SeslyMedia = requireOptionalNativeModule<SeslyMediaModule>('SeslyMedia');

export default SeslyMedia;
