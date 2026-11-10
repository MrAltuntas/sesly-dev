import { createHash } from 'crypto';
import { TTSProvider, VoiceProfileKind } from '../../common/enums/prisma.enums';
import { resolveSynthesisVoiceId } from '../../common/utils/voice-language';
import { isChirpVoice } from '../tts-providers/ssml.helper';
import { SettingsService } from '../settings/settings.service';

/**
 * Bump whenever the way a shared narration is synthesised changes in a way
 * the parameters below do not capture (new request builder, new merge, new
 * pause markup). Old rows keep their key and are simply never hit again.
 */
export const SHARED_AUDIO_CACHE_VERSION = 1;

/**
 * Everything that changes the audio of a ready-made (Google) narration.
 * Two requests with equal parameters get the same file.
 */
export interface SharedAudioParams {
  cacheVersion: number;
  storyId: string;
  /**
   * `v<n>`: made from the stored segments of Story.segmentationVersion n.
   * `lazy-v<n>`: the story had no stored segments at version n (the first
   * request segments it; the key moves to `v<n+1>` once they are stored).
   */
  segmentation: string;
  /** sha256 of the story text (first 16 hex): an edited text never reuses old audio. */
  contentHash: string;
  provider: 'GOOGLE';
  /** The voice actually synthesised (the same-name voice of the story's locale on a mismatch). */
  voiceId: string;
  /** Story language. */
  language: string;
  /** tts.google.speakingRate at request time. */
  speakingRate: number;
  /** tts.google.pitch; null for Chirp voices (Google never receives a pitch for them). */
  pitch: number | null;
  /** tts.groupSegments (grouping changes the requests and their seams). */
  grouped: boolean;
}

/** The voice profile fields that decide whether a narration may be shared. */
export interface ShareableVoice {
  provider: string | null;
  kind?: string | null;
  voiceId: string;
  language: string;
}

/**
 * Only ready-made Google voices are shared. A cloned voice (Cartesia, or a
 * profile of kind CLONE) belongs to one user and is never shared.
 */
export function isShareableVoice(voice: Pick<ShareableVoice, 'provider' | 'kind'>): boolean {
  const provider = String(voice.provider ?? '').toUpperCase();
  const kind = String(voice.kind ?? VoiceProfileKind.PRESET).toUpperCase();
  return provider === TTSProvider.GOOGLE && kind === VoiceProfileKind.PRESET;
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16);
}

export function buildSharedAudioParams(
  story: { id: string; content: string; language: string; segmentationVersion: number },
  voice: ShareableVoice,
  settings: Pick<SettingsService, 'get'>,
  segmented: boolean,
): SharedAudioParams {
  const voiceId = resolveSynthesisVoiceId(voice, story.language);
  return {
    cacheVersion: SHARED_AUDIO_CACHE_VERSION,
    storyId: story.id,
    segmentation: segmented ? `v${story.segmentationVersion}` : `lazy-v${story.segmentationVersion}`,
    contentHash: contentHash(story.content),
    provider: 'GOOGLE',
    voiceId,
    language: story.language,
    speakingRate: settings.get('tts.google.speakingRate'),
    pitch: isChirpVoice(voiceId) ? null : settings.get('tts.google.pitch'),
    grouped: settings.get('tts.groupSegments'),
  };
}

/** The same parameters for the stored segments of `version`. */
export function withSegmentationVersion(params: SharedAudioParams, version: number): SharedAudioParams {
  return { ...params, segmentation: `v${version}` };
}

/** sha256 of the parameters in a fixed key order. */
export function sharedAudioKey(params: SharedAudioParams): string {
  const ordered = Object.keys(params)
    .sort()
    .map((k) => [k, (params as unknown as Record<string, unknown>)[k]]);
  return createHash('sha256').update(JSON.stringify(ordered), 'utf8').digest('hex');
}

/** Storage folder of an audio: shared audio never sits under a user-related path. */
export function audioStoragePrefix(audio: { id: string; shared?: boolean | null }): string {
  return audio.shared ? `shared-audio/${audio.id}` : `audio/${audio.id}`;
}
