/**
 * What the player, the mini player, the lock screen, the queue and the
 * continue card need to know about a narration, kept in memory so a story can
 * start (and the player can open) without a network round trip.
 *
 * Every place that has a full narration at hand (a Library page, the
 * narrations of a story detail, a fetch of the player) remembers its meta
 * here; `startNarration` reads it back by id. The map is memory only and
 * holds the newest 300 entries. Persisted copies (the queue, the last played
 * record) drop `voiceProfile` (a model object with dates) and read back with
 * `voiceProfile: null`.
 */

import { observable, runInAction } from 'mobx';
import type { StoryNarration } from '../models/Narration';
import { getNarratorDisplay } from '../models/Narrator';
import { isCloneProfile, type VoiceProfile } from '../models/VoiceProfile';
import { parseContentWarnings } from '../models/contentWarnings';

/** The five story fields every reader of the loaded story uses. */
export interface PlayerStory {
  readonly id: string;
  /** '' while the story is not known yet. */
  readonly title: string;
  readonly coverImageUrl: string | null;
  readonly translationGroupId: string | null;
  readonly category: string | null;
  /** The tale's placeholder key (`Story.coverKey`), only when known. */
  readonly coverKey?: string;
  /** Only for a story with warnings: the player's note before listening. */
  readonly contentWarnings?: readonly string[];
  readonly ageGroup?: string;
}

export interface NarrationMeta {
  readonly narrationId: string;
  readonly storyId: string;
  readonly voiceProfileId: string | null;
  /** What the player, the dock and the lock screen draw. */
  readonly story: PlayerStory;
  /** When known (from a full narration); null for a persisted meta. */
  readonly voiceProfile: VoiceProfile | null;
  /** The narrator as the player names it (bare Chirp name), null when unknown. */
  readonly narratorName: string | null;
  /** Read in the user's own (cloned) voice. */
  readonly ownVoice: boolean;
  /**
   * The length to show before the player reported the real one, in ms
   * (`narrationEstimateMs`: the story's minutes first, else the backend's
   * stored length); never shown in the player; 0 when none.
   */
  readonly estimateMs: number;
}

/** Oldest entries are dropped past this many narrations. */
export const NARRATION_META_LIMIT = 300;

const metas = observable.map<string, NarrationMeta>({}, { deep: false });
const listeners = new Set<(meta: NarrationMeta) => void>();

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** A story (full model or a stored copy) reduced to the player's five fields. */
export function playerStoryOf(story: {
  readonly id: string;
  readonly title?: string | null;
  readonly coverImageUrl?: string | null;
  readonly translationGroupId?: string | null;
  readonly category?: string | null;
  readonly coverKey?: string | null;
  readonly contentWarnings?: readonly string[] | null;
  readonly ageGroup?: string | null;
}): PlayerStory {
  const warnings = parseContentWarnings(story.contentWarnings ?? []);
  return {
    id: story.id,
    title: story.title ?? '',
    coverImageUrl: story.coverImageUrl ?? null,
    translationGroupId: story.translationGroupId ?? null,
    category: story.category ?? null,
    // Only present when known, so a story without them keeps the five fields.
    ...(story.coverKey ? { coverKey: story.coverKey } : {}),
    ...(warnings.length > 0
      ? { contentWarnings: warnings, ...(story.ageGroup ? { ageGroup: story.ageGroup } : {}) }
      : {}),
  };
}

/**
 * A narration's length before the player reported the real one, in ms: the
 * story's estimate (the minutes its card and its Library row show, counted
 * from its words), else the narration's stored `totalDuration`, which the
 * backend writes before the audio exists and which runs about three times too
 * long; 0 when neither is known.
 *
 * The rule of `narrationDurationMs` (components/library/narrationProgress),
 * which the Library rows use, kept here so the store layer imports no
 * component module; a test holds the two together.
 */
export function narrationEstimateMs(
  narration: Pick<StoryNarration, 'totalDuration' | 'story'>,
): number {
  const minutes = narration.story?.estimatedDuration ?? 0;
  if (Number.isFinite(minutes) && minutes > 0) return Math.round(minutes * 60000);
  const seconds = narration.totalDuration;
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0;
}

export function metaFromNarration(narration: StoryNarration): NarrationMeta {
  const voice = narration.voiceProfile ?? null;
  const storyId = narration.storyId || narration.story?.id || '';
  // A narration without its story (the list of a story page) cannot know the
  // story's minutes: a copy remembered from a fuller source (a Library page)
  // keeps its estimate instead of the backend's longer one.
  const estimateMs =
    (narration.story ? 0 : getNarrationMeta(narration.id)?.estimateMs ?? 0) ||
    narrationEstimateMs(narration);
  return {
    narrationId: narration.id,
    storyId,
    voiceProfileId: narration.voiceProfileId ?? voice?.id ?? null,
    story: narration.story ? playerStoryOf(narration.story) : playerStoryOf({ id: storyId }),
    voiceProfile: voice,
    narratorName: getNarratorDisplay(voice)?.name ?? null,
    ownVoice: voice ? isCloneProfile(voice) : false,
    estimateMs,
  };
}

/** The meta as it is written to storage: the voice model is not persisted. */
export function storableMeta(meta: NarrationMeta): NarrationMeta {
  return meta.voiceProfile ? { ...meta, voiceProfile: null } : meta;
}

/**
 * Strict parse of a stored meta; anything without a narration id and a story
 * is treated as absent. Missing optional fields default (no voice, no length).
 */
export function parseNarrationMeta(raw: unknown): NarrationMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, unknown>;
  const narrationId = text(data.narrationId);
  const rawStory =
    data.story && typeof data.story === 'object' ? (data.story as Record<string, unknown>) : null;
  const storyId = text(data.storyId) ?? text(rawStory?.id);
  if (!narrationId || !storyId) return null;
  const estimate = data.estimateMs;
  return {
    narrationId,
    storyId,
    voiceProfileId: text(data.voiceProfileId),
    story: playerStoryOf({
      id: text(rawStory?.id) ?? storyId,
      title: text(rawStory?.title),
      coverImageUrl: text(rawStory?.coverImageUrl),
      translationGroupId: text(rawStory?.translationGroupId),
      category: text(rawStory?.category),
      coverKey: text(rawStory?.coverKey),
      contentWarnings: Array.isArray(rawStory?.contentWarnings) ? (rawStory?.contentWarnings as string[]) : null,
      ageGroup: text(rawStory?.ageGroup),
    }),
    voiceProfile: null,
    narratorName: text(data.narratorName),
    ownVoice: data.ownVoice === true,
    estimateMs:
      typeof estimate === 'number' && Number.isFinite(estimate) && estimate > 0 ? estimate : 0,
  };
}

/** Keep a meta for later starts. The newest entries win; 300 are kept. */
export function rememberNarrationMeta(meta: NarrationMeta): void {
  if (!meta?.narrationId) return;
  runInAction(() => {
    // Re-insert so the entry counts as the newest one.
    metas.delete(meta.narrationId);
    metas.set(meta.narrationId, meta);
    while (metas.size > NARRATION_META_LIMIT) {
      const oldest = metas.keys().next().value;
      if (oldest === undefined) break;
      metas.delete(oldest);
    }
  });
  [...listeners].forEach(listener => {
    try {
      listener(meta);
    } catch (error) {
      console.warn('[narrationMeta] listener failed:', error);
    }
  });
}

export function getNarrationMeta(narrationId: string | null | undefined): NarrationMeta | null {
  if (!narrationId) return null;
  return metas.get(narrationId) ?? null;
}

/**
 * Called with every remembered meta (a Library page, a fetch of the player).
 * The queue keeps its rows current through it. Returns the unsubscribe.
 */
export function onNarrationMetaRemembered(listener: (meta: NarrationMeta) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only: forget every meta and listener. */
export function resetNarrationMetaForTests(): void {
  runInAction(() => metas.clear());
  listeners.clear();
}
