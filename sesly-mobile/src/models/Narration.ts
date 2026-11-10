/**
 * Narration Models with Strict TypeScript Typing
 */

import { NarrationStatus, AudioGenerationStatus as AudioStatus } from '../types/enums';
import { Story, parseStoryFromJSON } from './Story';
import { VoiceProfile, languageCodeOf, parseVoiceProfileFromJSON } from './VoiceProfile';

// ============================================================================
// Audio Chunk
// ============================================================================

export interface AudioChunk {
  readonly chunkIndex: number;
  readonly audioUrl: string | null;
  readonly duration: number;
  readonly status: AudioStatus;
}

// ============================================================================
// Story Narration Model
// ============================================================================

export interface StoryNarration {
  readonly id: string;
  readonly userId: string;
  readonly storyId: string;
  readonly voiceProfileId: string | null;
  readonly voiceProfile: VoiceProfile | null; // Added voiceProfile
  readonly status: NarrationStatus;
  readonly totalChunks: number;
  readonly completedChunks: number;
  readonly errorMessage: string | null;
  readonly isPreGenerated: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
  readonly story: Story | null;
  readonly audioChunks: AudioChunk[]; // Added audio chunks
  /** Total duration in seconds (`totalDuration`, falling back to `duration`). 0 = unknown. */
  readonly totalDuration: number;
  readonly audioUrl: string | null; // [NEW] Merged audio URL
  /** Content language of the voice that read it; null when the backend sent none. */
  readonly voiceLanguage: string | null;
  /** Content language of the story; null when the backend sent none. */
  readonly storyLanguage: string | null;
  /** The voice and the story are of different languages. False when unknown. */
  readonly languageMismatch: boolean;
  /**
   * A ready-made narrator was switched to its voice of the story's language,
   * so the narration is native in spite of `languageMismatch`. False when unknown.
   */
  readonly nativeVoiceUsed: boolean;
}

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function parseDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

// ============================================================================
// Narration Helper Functions
// ============================================================================

export function getNarrationProgressPercentage(
  narration: StoryNarration,
): number {
  if (narration.totalChunks === 0) {
    return 0;
  }
  return (narration.completedChunks / narration.totalChunks) * 100;
}

/**
 * The narration was read by a voice of another language and no native voice
 * stood in for it: it sounds accented. An older backend sends neither field,
 * which reads as "not accented".
 */
export function isNarrationAccented(
  narration: Pick<StoryNarration, 'languageMismatch' | 'nativeVoiceUsed'> | null | undefined,
): boolean {
  return !!narration && narration.languageMismatch === true && narration.nativeVoiceUsed !== true;
}

export function isNarrationReady(narration: StoryNarration): boolean {
  return narration.status === NarrationStatus.READY;
}

export function isNarrationGenerating(narration: StoryNarration): boolean {
  return narration.status === NarrationStatus.GENERATING;
}

export function isNarrationFailed(narration: StoryNarration): boolean {
  return narration.status === NarrationStatus.FAILED;
}

export function isNarrationPending(narration: StoryNarration): boolean {
  return narration.status === NarrationStatus.PENDING;
}

// ============================================================================
// Narration JSON Parsers
// ============================================================================

export function parseStoryNarrationFromJSON(json: unknown): StoryNarration {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid story narration data: expected object');
  }

  const data = json as Record<string, unknown>;

  const id = typeof data.id === 'string' ? data.id : '';
  const userId = typeof data.userId === 'string' ? data.userId : '';
  const storyId = typeof data.storyId === 'string' ? data.storyId : '';
  const status =
    typeof data.status === 'string'
      ? (data.status as NarrationStatus)
      : NarrationStatus.PENDING;

  let story: Story | null = null;
  if (data.story) {
    try {
      story = parseStoryFromJSON(data.story);
    } catch (err) {
      console.warn('Failed to parse story in narration:', err);
    }
  }

  let voiceProfile: VoiceProfile | null = null;
  if (data.voiceProfile) {
    try {
      voiceProfile = parseVoiceProfileFromJSON(data.voiceProfile);
    } catch (err) {
      console.warn('Failed to parse voice profile in narration:', err);
    }
  }

  const audioChunks: AudioChunk[] = Array.isArray(data.audioChunks)
    ? data.audioChunks.map((chunk: unknown) => {
      if (typeof chunk !== 'object' || !chunk) {
        console.warn('Invalid audio chunk data', chunk);
        return { chunkIndex: 0, audioUrl: null, duration: 0, status: AudioStatus.PENDING };
      }
      const chunkData = chunk as Record<string, unknown>;
      return {
        chunkIndex: typeof chunkData.chunkIndex === 'number' ? chunkData.chunkIndex : 0,
        audioUrl: typeof chunkData.audioUrl === 'string' ? chunkData.audioUrl : null,
        duration: typeof chunkData.duration === 'number' ? chunkData.duration : 0,
        status: typeof chunkData.status === 'string' ? (chunkData.status as AudioStatus) : AudioStatus.PENDING,
      };
    })
    : [];

  // GET /narrations/:id and list items expose `totalDuration`; `duration`
  // (Audio.duration) is the fallback for payloads that only carry that.
  const totalDuration =
    parseDurationSeconds(data.totalDuration) ??
    parseDurationSeconds(data.duration) ??
    0;
  const audioUrl = typeof data.audioUrl === 'string' ? data.audioUrl : null;

  // `updatedAt` drives "recently played / updated" ordering; never default
  // it to parse time (that would float stale rows to the top). Fall back to
  // createdAt instead.
  const createdAt = parseDateOrNull(data.createdAt) ?? new Date();
  const updatedAt = parseDateOrNull(data.updatedAt) ?? createdAt;

  return {
    id,
    userId,
    storyId,
    voiceProfileId:
      typeof data.voiceProfileId === 'string' && data.voiceProfileId
        ? data.voiceProfileId
        : null,
    status,
    totalChunks: typeof data.totalChunks === 'number' ? data.totalChunks : 0,
    completedChunks:
      typeof data.completedChunks === 'number' ? data.completedChunks : 0,
    errorMessage:
      typeof data.errorMessage === 'string' && data.errorMessage
        ? data.errorMessage
        : null,
    isPreGenerated: Boolean(data.isPreGenerated),
    createdAt,
    updatedAt,
    completedAt: parseDateOrNull(data.completedAt),
    story,
    voiceProfile,
    audioChunks,
    totalDuration,
    audioUrl,
    voiceLanguage: languageCodeOf(data.voiceLanguage) || null,
    storyLanguage: languageCodeOf(data.storyLanguage) || null,
    languageMismatch: data.languageMismatch === true,
    nativeVoiceUsed: data.nativeVoiceUsed === true,
  };
}

// ============================================================================
// Voice Slot Info (for Narration generation limits)
// ============================================================================

export interface VoiceSlotInfo {
  readonly plan: string;
  readonly totalSlots: number;
  readonly usedSlots: number;
  readonly availableSlots: number;
  readonly extraSlots: number;
  readonly canCreate: boolean;
}

export function parseVoiceSlotInfoFromJSON(json: unknown): VoiceSlotInfo {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid voice slot info data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.plan !== 'string') {
    throw new Error('Invalid voice slot info data: missing or invalid plan');
  }
  if (typeof data.totalSlots !== 'number') {
    throw new Error(
      'Invalid voice slot info data: missing or invalid totalSlots',
    );
  }
  if (typeof data.usedSlots !== 'number') {
    throw new Error(
      'Invalid voice slot info data: missing or invalid usedSlots',
    );
  }
  if (typeof data.availableSlots !== 'number') {
    throw new Error(
      'Invalid voice slot info data: missing or invalid availableSlots',
    );
  }
  if (typeof data.extraSlots !== 'number') {
    throw new Error(
      'Invalid voice slot info data: missing or invalid extraSlots',
    );
  }
  if (typeof data.canCreate !== 'boolean') {
    throw new Error(
      'Invalid voice slot info data: missing or invalid canCreate',
    );
  }

  return {
    plan: data.plan,
    totalSlots: data.totalSlots,
    usedSlots: data.usedSlots,
    availableSlots: data.availableSlots,
    extraSlots: data.extraSlots,
    canCreate: data.canCreate,
  };
}
