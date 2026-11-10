import { TTSTextPart } from '../../tts-providers/interfaces/tts-provider.interface';
import type { SharedAudioParams } from '../shared-audio-key';

/**
 * The voice of a shared audio (ready-made Google voice, no voice profile):
 * the synthesis voice id is already resolved for the story's language.
 */
export interface SharedJobVoice {
  provider: 'GOOGLE';
  voiceId: string;
}

// Job for segment generation (internal). One job = one TTS request (a
// "synthesis unit": one story segment, or several when grouping is on).
export interface AudioSegmentJob {
  audioId: string;
  segmentId: string;
  segmentIndex: number;
  /** Plain text of the request (no tags). */
  content: string;
  /** Null for a shared audio (see oice). */
  voiceProfileId: string | null;
  /** Set for a shared audio instead of a voice profile. */
  voice?: SharedJobVoice;
  /** Shared audio: files go under shared-audio/<audioId>/. */
  shared?: boolean;
  // Request-level Cartesia generation values. All optional; the provider
  // falls back to the runtime-setting defaults when omitted.
  emotion?: string;
  speed?: number;
  volume?: number;
  pronunciationDictId?: string;
  // Text language (story language when the audio belongs to a story). The
  // processor falls back to the voice profile language.
  language?: string;
  /**
   * The segments inside a grouped request with their own speed and pause.
   * Absent on jobs queued before grouping existed (the text is then read
   * as one piece).
   */
  parts?: TTSTextPart[];
}

// Job that segments a story on its first narration, then queues the
// segment jobs (queue `audio-generation`, job name `prepare-audio`).
export interface AudioPrepareJob {
  audioId: string;
  storyId: string;
  /** Null for a shared audio (see oice). */
  voiceProfileId: string | null;
  voice?: SharedJobVoice;
  /** Shared audio: the key parameters, moved to the stored segment version once segmented. */
  shareParams?: SharedAudioParams;
  globalEmotion: string | null;
  globalSpeed: number | null;
  globalVolume: number | null;
  pronunciationDictId: string | null;
  language: string | null;
}

// Result from segment generation
export interface AudioSegmentResult {
  audioUrl: string;
  duration: number;
  status: 'READY' | 'FAILED';
}
