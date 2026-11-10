/**
 * Lock-screen / Now Playing controller for the single expo-audio player.
 *
 * Two backends, one policy:
 *   - Android: the Sesly media session (modules/sesly-media, a Media3
 *     MediaSession on expo-audio's ExoPlayer). It shows the cover (or the
 *     placeholder cover), title, narrator, a live seek bar, back 15 s /
 *     play-pause / forward 15 s, and routes every command to the audio store
 *     (utils/mediaSession.ts).
 *   - iOS: expo-audio's built-in support (MPNowPlayingInfoCenter through
 *     player.setActiveForLockScreen / updateLockScreenMetadata). Remote
 *     commands act on the player natively and surface through the normal
 *     playbackStatusUpdate events. expo-audio fixes its skip buttons at 10 s.
 *
 * This class decides WHEN to call the backend:
 *   - activate once per player activation (first Pro story play),
 *   - afterwards only update metadata when the track actually changes,
 *     throttled on iOS (rapid artwork updates crash it, expo issue #44496),
 *   - deactivate for free users, previews and on stop.
 */

import { Image } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import type { AudioLockScreenOptions, AudioMetadata } from 'expo-audio';
import i18n from '../i18n';
import { resolveCover } from '../components/design/covers';
import type { CoverSubject } from '../components/design/covers';
import { MEDIA_SESSION_OPTIONS, getAndroidMediaSession } from './mediaSession';
import type { MediaSessionMetadata, SeslyMediaModule } from './mediaSession';

export interface LockScreenCapablePlayer {
  setActiveForLockScreen(
    active: boolean,
    metadata?: AudioMetadata,
    options?: AudioLockScreenOptions,
  ): void;
  updateLockScreenMetadata(metadata: AudioMetadata): void;
}

/** What the lock screen shows for the loaded story. */
export interface NowPlayingMetadata {
  title: string;
  /** The narrator ("Annem", "Aoede"). */
  artist: string;
  albumTitle: string;
  /** The story's remote cover (absolute http(s) URL). */
  artworkUrl?: string;
  /** The placeholder cover the app shows when there is no remote cover. */
  fallbackArtworkUri?: string;
}

/** One way of putting the player on the lock screen. */
export interface LockScreenBackend {
  /** Minimum gap between two metadata updates. */
  readonly minUpdateIntervalMs: number;
  /** `onFailed` runs when the activation turned out to fail (async backends). */
  activate(metadata: NowPlayingMetadata, onFailed: () => void): void;
  update(metadata: NowPlayingMetadata): void;
  deactivate(): void;
}

export const LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showSeekForward: true,
  showSeekBackward: true,
};

/** Minimum gap between two native metadata updates on iOS. */
export const LOCK_SCREEN_METADATA_MIN_INTERVAL_MS = 2000;

const ALBUM_TITLE = 'Sesly';

type LockScreenStory = Partial<Pick<CoverSubject, 'id' | 'translationGroupId'>> & {
  readonly title?: string | null;
  readonly coverImageUrl?: string | null;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

/**
 * The placeholder cover of a story as a URI the native side can load (the
 * same picture PictureCover shows on the player screen): a drawable
 * resource name in Android release builds, a file URL in iOS release builds,
 * the Metro asset URL in development.
 */
export function placeholderArtworkUri(story: LockScreenStory | null): string | undefined {
  if (!story?.id) return undefined;
  try {
    const cover = resolveCover({ id: story.id, translationGroupId: story.translationGroupId ?? null });
    const source = cover.kind === 'placeholder' ? cover.source : cover.fallback;
    const uri = Image.resolveAssetSource(source as ImageSourcePropType)?.uri;
    return typeof uri === 'string' && uri.length > 0 ? uri : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Lock-screen metadata for a story narration: title = story title, artist =
 * the narrator, artwork = story cover (only absolute http(s) URLs) with the
 * placeholder cover as the fallback.
 */
export function buildLockScreenMetadata(
  story: LockScreenStory | null,
  narratorName?: string | null,
): NowPlayingMetadata {
  const metadata: NowPlayingMetadata = {
    title: story?.title?.trim() || i18n.t('player:untitled'),
    artist: narratorName?.trim() || ALBUM_TITLE,
    albumTitle: ALBUM_TITLE,
  };
  const artwork = story?.coverImageUrl?.trim();
  if (artwork && isHttpUrl(artwork)) {
    metadata.artworkUrl = artwork;
  }
  const fallback = placeholderArtworkUri(story);
  if (fallback) {
    metadata.fallbackArtworkUri = fallback;
  }
  return metadata;
}

/** The part of the audio store the lock screen draws. */
export interface NowPlayingSource {
  readonly currentStory: LockScreenStory | null;
  /** The narrator as the player names it; known from the meta even without a voice model. */
  readonly currentNarratorName: string | null;
}

/** Lock-screen metadata of the story loaded in the player. */
export function buildPlayerLockScreenMetadata(source: NowPlayingSource): NowPlayingMetadata {
  return buildLockScreenMetadata(source.currentStory, source.currentNarratorName);
}

/**
 * expo-audio metadata (iOS). Its native loader takes one URL: the cover, or
 * the placeholder when that is a URL it can open (file or http).
 */
export function toExpoAudioMetadata(metadata: NowPlayingMetadata): AudioMetadata {
  const out: AudioMetadata = {
    title: metadata.title,
    artist: metadata.artist,
    albumTitle: metadata.albumTitle,
  };
  const fallback = metadata.fallbackArtworkUri;
  const artwork =
    metadata.artworkUrl ??
    (fallback && (isHttpUrl(fallback) || /^file:\/\//i.test(fallback)) ? fallback : undefined);
  if (artwork) out.artworkUrl = artwork;
  return out;
}

function toSessionMetadata(metadata: NowPlayingMetadata): MediaSessionMetadata {
  return {
    title: metadata.title,
    artist: metadata.artist,
    albumTitle: metadata.albumTitle,
    artworkUrl: metadata.artworkUrl ?? null,
    fallbackArtworkUri: metadata.fallbackArtworkUri ?? null,
  };
}

/** iOS (and any build without the native session): expo-audio's lock screen. */
export function expoAudioBackend(player: LockScreenCapablePlayer): LockScreenBackend {
  return {
    minUpdateIntervalMs: LOCK_SCREEN_METADATA_MIN_INTERVAL_MS,
    activate: metadata =>
      player.setActiveForLockScreen(true, toExpoAudioMetadata(metadata), LOCK_SCREEN_OPTIONS),
    update: metadata => player.updateLockScreenMetadata(toExpoAudioMetadata(metadata)),
    deactivate: () => player.setActiveForLockScreen(false),
  };
}

/** Android: the Sesly media session bound to this expo-audio player. */
export function mediaSessionBackend(
  module: SeslyMediaModule,
  player: LockScreenCapablePlayer,
): LockScreenBackend {
  const warn = (what: string) => (error: unknown) =>
    console.warn(`[LockScreen] media session ${what} failed:`, error);
  return {
    minUpdateIntervalMs: 0,
    activate: (metadata, onFailed) => {
      module
        .activate(player, toSessionMetadata(metadata), MEDIA_SESSION_OPTIONS)
        .catch(error => {
          warn('activate')(error);
          onFailed();
        });
    },
    update: metadata => {
      module.updateMetadata(toSessionMetadata(metadata)).catch(warn('update'));
    },
    deactivate: () => {
      module.deactivate().catch(warn('deactivate'));
    },
  };
}

/** The backend of this platform for an expo-audio player. */
export function createLockScreenBackend(player: LockScreenCapablePlayer): LockScreenBackend {
  const session = getAndroidMediaSession();
  return session ? mediaSessionBackend(session, player) : expoAudioBackend(player);
}

function metadataKey(metadata: NowPlayingMetadata): string {
  return [
    metadata.title,
    metadata.artist,
    metadata.albumTitle,
    metadata.artworkUrl ?? '',
    metadata.fallbackArtworkUri ?? '',
  ].join('\n');
}

export class LockScreenController {
  private player: LockScreenCapablePlayer | null = null;
  private backend: LockScreenBackend | null = null;
  private active = false;
  private lastKey: string | null = null;
  private lastUpdateAt = 0;
  private pendingMetadata: NowPlayingMetadata | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  // Bumped by every activation and deactivation, so a late failure of an
  // old activation never touches a newer state.
  private epoch = 0;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly createBackend: (
      player: LockScreenCapablePlayer,
    ) => LockScreenBackend = createLockScreenBackend,
  ) {}

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Converge on the desired state. Idempotent and cheap: call it on play,
   * track change, tier change. `enabled` = Pro AND a story (not a preview) is
   * loaded; null metadata also means "off".
   */
  sync(
    player: LockScreenCapablePlayer | null,
    enabled: boolean,
    metadata: NowPlayingMetadata | null,
  ): void {
    if (!player || !enabled || !metadata) {
      this.deactivate();
      return;
    }
    if (this.player && this.player !== player) {
      // A different native player took over: release the old one's controls.
      this.deactivate();
    }
    if (this.player !== player || !this.backend) {
      this.player = player;
      this.backend = this.createBackend(player);
    }
    const backend = this.backend;

    const key = metadataKey(metadata);
    if (!this.active) {
      this.clearTimer();
      const epoch = ++this.epoch;
      try {
        this.active = true;
        this.lastKey = key;
        this.lastUpdateAt = this.now();
        backend.activate(metadata, () => {
          if (epoch !== this.epoch) return;
          this.active = false;
          this.lastKey = null;
        });
      } catch (error) {
        this.active = false;
        this.lastKey = null;
        console.warn('[LockScreen] activate failed:', error);
      }
      return;
    }

    if (key === this.lastKey && !this.pendingMetadata) return;
    if (this.pendingMetadata && key === metadataKey(this.pendingMetadata)) return;
    this.scheduleUpdate(metadata, key);
  }

  /** Remove this player from the lock screen. Safe when not active. */
  deactivate(): void {
    this.clearTimer();
    if (this.active && this.backend) {
      try {
        this.backend.deactivate();
      } catch (error) {
        console.warn('[LockScreen] deactivate failed:', error);
      }
    }
    this.epoch += 1;
    this.active = false;
    this.lastKey = null;
  }

  private scheduleUpdate(metadata: NowPlayingMetadata, key: string): void {
    if (key === this.lastKey) {
      // Back to what is already shown: drop the queued change.
      this.clearTimer();
      return;
    }
    const minInterval = this.backend?.minUpdateIntervalMs ?? LOCK_SCREEN_METADATA_MIN_INTERVAL_MS;
    const elapsed = this.now() - this.lastUpdateAt;
    if (elapsed >= minInterval && !this.timer) {
      this.applyUpdate(metadata, key);
      return;
    }
    this.pendingMetadata = metadata;
    if (!this.timer) {
      const wait = Math.max(0, minInterval - elapsed);
      this.timer = setTimeout(() => {
        this.timer = null;
        const next = this.pendingMetadata;
        this.pendingMetadata = null;
        if (next && this.active) {
          this.applyUpdate(next, metadataKey(next));
        }
      }, wait);
    }
  }

  private applyUpdate(metadata: NowPlayingMetadata, key: string): void {
    if (!this.backend || !this.active) return;
    try {
      this.backend.update(metadata);
      this.lastKey = key;
      this.lastUpdateAt = this.now();
    } catch (error) {
      console.warn('[LockScreen] metadata update failed:', error);
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingMetadata = null;
  }
}
