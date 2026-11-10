import { DEFAULT_CONTENT_LANGUAGE } from '../constants/content-languages';
import { presetVoiceInLanguage } from '../constants/google-preset-voices';
import { languageCodeOf } from '../constants/voice-languages';

/** What the language helpers need to know about a voice profile. */
export interface VoiceLanguageInfo {
  provider?: string | null;
  kind?: string | null;
  voiceId?: string | null;
  language?: string | null;
}

/** "tr-TR-Wavenet-A" or "tr-TR": the locale a Google voice is bound to. */
const LOCALE_PREFIX = /^([a-z]{2,3})[-_][A-Za-z]{2}/;

/**
 * A Google preset voice carries its locale in the voice id and ignores the
 * language of the text it is given. Cloned voices (Cartesia) speak any
 * language, so they are never "bound".
 */
export function isLanguageBoundVoice(voice: VoiceLanguageInfo): boolean {
  return voice.provider === 'GOOGLE' && voice.kind !== 'CLONE';
}

/**
 * Lower-case ISO 639 code a language-bound voice speaks: read from the voice
 * id ("en-US-Chirp3-HD-Aoede" is "en"), else from the profile language.
 * Null when neither says.
 */
export function voiceLanguageCode(voice: VoiceLanguageInfo): string | null {
  const fromId = LOCALE_PREFIX.exec(voice.voiceId ?? '');
  if (fromId) return fromId[1].toLowerCase();
  return languageCodeOf(voice.language ?? '');
}

/**
 * The content language code ("tr", "en") of any voice profile, in the same
 * vocabulary as `story.language`. This is the `contentLanguage` every voice
 * profile response carries.
 *
 *   - ready-made (Google) voice: the language of the voice id, else the
 *     language stored on the profile;
 *   - cloned voice: the language the user chose to speak when recording
 *     (stored on the profile). Its provider voice id is an opaque id and is
 *     never read.
 * A profile that says neither is Turkish: every voice created before the
 * language became explicit was.
 */
export function voiceContentLanguage(voice: VoiceLanguageInfo): string {
  const code = isLanguageBoundVoice(voice)
    ? voiceLanguageCode(voice)
    : languageCodeOf(voice.language ?? '');
  return code ?? DEFAULT_CONTENT_LANGUAGE;
}

/**
 * The provider voice id a text of `textLanguage` is synthesised with.
 *
 * A ready-made Chirp 3 HD voice narrating a story of another language is
 * swapped for the voice of the same name in the story's locale
 * (tr-TR-Chirp3-HD-Achernar reading an English story is synthesised as
 * en-US-Chirp3-HD-Achernar), because a Google voice id is bound to its
 * locale. When the story's language has no such voice (Russian), or the
 * voice is not a catalogue voice, the profile's own id is used.
 *
 * A cloned voice always keeps its own id: Cartesia takes the text language
 * as a request parameter and the clone reads it with its own accent.
 */
export function resolveSynthesisVoiceId(
  voice: VoiceLanguageInfo & { voiceId: string },
  textLanguage: string | null | undefined,
): string {
  if (!isLanguageBoundVoice(voice)) return voice.voiceId;
  const sibling = presetVoiceInLanguage(voice.voiceId, languageCodeOf(textLanguage ?? ''));
  return sibling?.id ?? voice.voiceId;
}

/** How the language of a voice relates to the language of a story. */
export interface NarrationLanguageInfo {
  /** Content language code of the voice ("tr"). */
  voiceLanguage: string;
  /** Content language code of the story ("en"). */
  storyLanguage: string;
  /**
   * The two codes differ. Narration is still allowed; the client warns
   * ("Dil tipleri uyuşmuyor. Aksan kaymaları olabilir.").
   */
  languageMismatch: boolean;
  /**
   * Only ever true together with `languageMismatch`, and only for a
   * ready-made voice: the story is read by the voice of the same name in
   * the story's own locale, so the text is pronounced natively. False for a
   * cloned voice (it reads the story with an accent) and when the story's
   * language has no ready-made voices.
   */
  nativeVoiceUsed: boolean;
}

/**
 * Replaces the old hard rejection (400 VOICE_LANGUAGE_MISMATCH): a voice of
 * another language MAY narrate a story. The narration responses carry this
 * so the client can warn before or after.
 */
export function describeNarrationLanguage(
  voice: VoiceLanguageInfo & { voiceId: string },
  story: { language?: string | null },
): NarrationLanguageInfo {
  const voiceLanguage = voiceContentLanguage(voice);
  const storyLanguage = languageCodeOf(story.language ?? '') ?? DEFAULT_CONTENT_LANGUAGE;
  const languageMismatch = voiceLanguage !== storyLanguage;
  return {
    voiceLanguage,
    storyLanguage,
    languageMismatch,
    nativeVoiceUsed:
      languageMismatch && resolveSynthesisVoiceId(voice, storyLanguage) !== voice.voiceId,
  };
}
