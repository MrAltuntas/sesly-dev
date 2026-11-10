import { TTSProvider as TTSProviderEnum } from '@common/enums/prisma.enums';

/**
 * One piece of a grouped TTS request: a story segment with its own speed
 * and pause. The provider renders the pieces in its own syntax (Cartesia
 * inline tags, Google markup pauses) and ignores what it cannot express.
 */
export interface TTSTextPart {
  text: string;
  speed?: number;
  pauseAfterMs?: number;
}

/**
 * Per-call generation overrides. Providers that don't understand a given
 * field (e.g. Google ignores `emotion`) silently drop it; Cartesia uses
 * all of them.
 */
export interface TTSGenerationOptions {
  emotion?: string;
  speed?: number;
  volume?: number;
  pronunciationDictId?: string;
  /**
   * Language of the text (story / narration language, else the voice
   * profile language). BCP-47 or ISO 639-1 (`tr-TR` and `tr` both work).
   * Providers fall back to Turkish when omitted.
   */
  language?: string | null;
  /**
   * The request as segments. When present the provider renders them
   * (the text argument is then the plain joined text, used for logging).
   */
  parts?: TTSTextPart[];
}

/**
 * Base TTS provider interface. Every provider must support standard synthesis
 * and voice listing. Voice cloning is an OPTIONAL capability declared
 * separately via {@link VoiceCloningCapableProvider}.
 */
export interface TTSProvider {
  /**
   * Generate speech from text
   * @param text - Text to convert to speech
   * @param voiceId - Voice identifier (provider-specific)
   * @param options - Optional per-call overrides (emotion, speed, volume, etc.)
   * @returns Audio buffer
   */
  textToSpeech(text: string, voiceId: string, options?: TTSGenerationOptions): Promise<Buffer>;

  /**
   * Get available ready-made (preset) voices for this provider
   * @param contentLanguages - Content language codes ("tr", "en") to list
   *   voices for. Providers without per-language presets ignore it.
   * @returns List of available voices with metadata
   */
  getAvailableVoices(contentLanguages?: string[]): Promise<Voice[]>;

  /**
   * Get provider name
   */
  getProviderName(): string;
}

/**
 * Per-call cloning inputs. Cartesia API 2026-08-14 takes
 * clip + name + language (+ optional description and accent); the old
 * `mode` and `enhance` switches no longer exist.
 */
export interface VoiceCloningOptions {
  /**
   * Language the speaker uses in the clip (the language the user chose when
   * starting the clone). BCP-47 or ISO 639-1; defaults to `tr`.
   */
  language?: string | null;
  /**
   * Accent label of the clip for that language (Cartesia accent id, e.g.
   * `istanbul`, `general-american`). Optional metadata; Cartesia needs it
   * on the clone before more accents can be added to the voice later.
   */
  accent?: string | null;
  /**
   * Optional human-readable description stored on the cloned voice.
   * Useful for support traceability. Never put personal data here.
   */
  description?: string;
}

/**
 * In-memory clip handed to the cloning provider. Always a transcoded WAV in
 * production (Cartesia rejects m4a).
 */
export interface VoiceCloneClip {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

/**
 * Extension interface for providers that support voice cloning.
 *
 * Only providers capable of training/using custom cloned voices should
 * implement this. The factory exposes a dedicated resolver
 * (`getCloningProvider`) so callers that need cloning get a compile-time
 * guarantee they are talking to a cloning-capable provider.
 */
export interface VoiceCloningCapableProvider extends TTSProvider {
  /**
   * Create a cloned voice from a reference clip.
   * @param source - The clip bytes, or a URL the provider downloads first
   * @param voiceName - Human-readable name stored upstream
   * @param options - Optional per-call cloning inputs
   * @returns The custom voice id to use for subsequent synthesis
   */
  createVoiceClone(
    source: string | VoiceCloneClip,
    voiceName: string,
    options?: VoiceCloningOptions,
  ): Promise<string>;

  /**
   * Delete a previously created cloned voice.
   * @param customVoiceId - The custom voice id returned by createVoiceClone
   */
  deleteVoiceClone(customVoiceId: string): Promise<void>;
}

export interface Voice {
  id: string;
  name: string;
  language: string;
  languageCode: string;
  /** Content language code the voice narrates ("tr"); matches `story.language`. */
  contentLanguage?: string;
  gender?: 'male' | 'female' | 'neutral';
  description?: string;
  previewUrl?: string;
  provider: TTSProviderEnum;
}

// Re-export for convenience
export { TTSProviderEnum };
