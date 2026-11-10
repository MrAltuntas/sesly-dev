/**
 * The last story the account started, remembered on the device for the
 * Library's "Kaldığın yerden devam et" card.
 *
 * The audio store writes it whenever a story starts (`startNarration`), never
 * for a sample or a generation. It is a narration meta (what the card, the
 * player and the dock draw, so the story starts again without a network
 * round trip) plus the account and the time it was written. The playback
 * position is not copied here: the player keeps it under
 * `narration_position:<id>` (every 3 s while playing, on every pause; removed
 * at the end of the story).
 *
 * Version 1 records (the flat shape the old mini player wrote) still read:
 * their story fields move into `story`, `durationMs` becomes the estimate and
 * `updatedAt` is 0.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseNarrationMeta,
  storableMeta,
  type NarrationMeta,
} from '../stores/narrationMeta';

export const LAST_PLAYED_STORAGE_KEY = '@sesly/lastPlayed';

export interface LastPlayed extends NarrationMeta {
  /** Account the record belongs to; another account must not see it. */
  readonly userId: string | null;
  /** When the record was written (ms since the epoch); 0 for a v1 record. */
  readonly updatedAt: number;
  /**
   * @deprecated v1 mirrors of `story.title`, `story.coverImageUrl`,
   * `story.translationGroupId` and `estimateMs`, read by the old
   * MiniPlayerDock until it stops docking a resting record.
   */
  readonly title: string;
  /** @deprecated see `title`. */
  readonly coverImageUrl: string | null;
  /** @deprecated see `title`. */
  readonly translationGroupId: string | null;
  /** @deprecated see `title`. */
  readonly durationMs: number;
}

/**
 * @deprecated The flat v1 record the old MiniPlayerDock still writes;
 * `writeLastPlayed` stores it in the current shape.
 */
export interface LastPlayedV1 {
  readonly userId: string | null;
  readonly narrationId: string;
  readonly storyId: string;
  readonly title: string;
  readonly coverImageUrl: string | null;
  readonly translationGroupId: string | null;
  readonly narratorName: string | null;
  readonly durationMs: number;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function withMirrors(meta: NarrationMeta, userId: string | null, updatedAt: number): LastPlayed {
  const stored = storableMeta(meta);
  return {
    ...stored,
    userId,
    updatedAt,
    title: stored.story.title,
    coverImageUrl: stored.story.coverImageUrl,
    translationGroupId: stored.story.translationGroupId,
    durationMs: stored.estimateMs,
  };
}

/** The record for a story the store just started. */
export function lastPlayedFrom(
  meta: NarrationMeta,
  userId: string | null,
  updatedAt: number = Date.now(),
): LastPlayed {
  return withMirrors(meta, userId, updatedAt);
}

/** Strict parse of a stored record; anything malformed is treated as absent. */
export function parseLastPlayed(raw: unknown): LastPlayed | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const userId = text(data.userId);
  const updatedAt = positive(data.updatedAt);
  if (data.story && typeof data.story === 'object') {
    const meta = parseNarrationMeta(data);
    if (!meta || !meta.story.title) return null;
    return withMirrors(meta, userId, updatedAt);
  }
  // Version 1: the flat shape.
  const narrationId = text(data.narrationId);
  const storyId = text(data.storyId);
  const title = text(data.title);
  if (!narrationId || !storyId || !title) return null;
  const meta = parseNarrationMeta({
    narrationId,
    storyId,
    voiceProfileId: data.voiceProfileId,
    story: {
      id: storyId,
      title,
      coverImageUrl: data.coverImageUrl,
      translationGroupId: data.translationGroupId,
      category: data.category,
    },
    narratorName: data.narratorName,
    ownVoice: data.ownVoice,
    estimateMs: positive(data.estimateMs) || positive(data.durationMs),
  });
  return meta ? withMirrors(meta, userId, updatedAt) : null;
}

/** The stored record if it belongs to `userId`, else null. */
export async function readLastPlayed(userId: string | null): Promise<LastPlayed | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_PLAYED_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseLastPlayed(JSON.parse(raw));
    if (!parsed || parsed.userId !== userId) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Store a record. A v1 record (old mini player) is written in the current shape. */
export async function writeLastPlayed(record: LastPlayed | LastPlayedV1): Promise<void> {
  try {
    const normalized =
      'story' in record
        ? withMirrors(record, record.userId, record.updatedAt)
        : parseLastPlayed({ ...record, updatedAt: Date.now() });
    if (!normalized) return;
    await AsyncStorage.setItem(LAST_PLAYED_STORAGE_KEY, JSON.stringify(normalized));
  } catch (err) {
    console.warn('[lastPlayed] write failed:', err);
  }
}

/** Forget the record (its narration is gone, or the account signed out). */
export async function clearLastPlayed(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_PLAYED_STORAGE_KEY);
  } catch (err) {
    console.warn('[lastPlayed] clear failed:', err);
  }
}

/** Position the player saved for a narration, in milliseconds (0 if none). */
export async function readSavedPositionMs(narrationId: string): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(`narration_position:${narrationId}`);
    const value = raw ? parseInt(raw, 10) : 0;
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}
