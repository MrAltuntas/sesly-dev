import { isPremiumVoice } from '../../common/utils/voice-tier';
import { voiceContentLanguage } from '../../common/utils/voice-language';
import { serverText } from '../../common/i18n/server-text';
import { DEFAULT_UI_LANGUAGE, UiLanguage } from '../../common/i18n/ui-language';

/**
 * Client-safe voice profile shape used by every user-facing response
 * (GET /voice-profiles, create/upload responses, narration.voiceProfile).
 *
 * Never exposes `voiceCloningKey` (provider credential material),
 * `consentAudioUrl` (the user's recorded consent statement) or
 * `consentVersion`. The failure reason is surfaced as `errorMessage`;
 * `errorReason` is kept for older clients.
 */
export interface VoiceProfileSource {
  id: string;
  userId: string;
  name: string;
  profileIcon?: string | null;
  provider: string;
  kind?: string | null;
  voiceId: string;
  voiceCloningKey?: string | null;
  language: string;
  status: string;
  errorReason?: string | null;
  sampleAudioUrl?: string | null;
  consentAt?: Date | string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type PublicVoiceProfileKind = 'PRESET' | 'CLONE';

export interface PublicVoiceProfile {
  id: string;
  userId: string;
  name: string;
  profileIcon: string | null;
  provider: string;
  /** PRESET = ready-made narrator voice, CLONE = the user's own recorded voice. */
  kind: PublicVoiceProfileKind;
  voiceId: string;
  /** Locale as stored ("tr-TR", "en-US"; older clone rows may hold "tr"). */
  language: string;
  /**
   * Normalised content language code of the voice ("tr", "en"), the same
   * vocabulary as `story.language`. A client compares the two to know
   * beforehand that a narration would be a language mismatch.
   */
  contentLanguage: string;
  status: string;
  isPremium: boolean;
  errorMessage: string | null;
  errorReason: string | null;
  sampleAudioUrl: string | null;
  /** ISO timestamp of the KVKK clone consent, null for presets / not yet uploaded. */
  consentAt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** i18n key of the generic voice failure text (FAILED row without a reason). */
export const DEFAULT_VOICE_FAILURE_MESSAGE_KEY = 'messages.voiceFailure.generic';

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * @param language UI language of the generic failure text used when a FAILED
 *   row has no stored reason (every FAILED write stores one in the owner's
 *   language; only rows from before that have none).
 */
export function toPublicVoiceProfile(
  profile: VoiceProfileSource,
  language: UiLanguage = DEFAULT_UI_LANGUAGE,
): PublicVoiceProfile {
  const failed = profile.status === 'FAILED';
  const errorMessage = failed
    ? profile.errorReason || serverText(DEFAULT_VOICE_FAILURE_MESSAGE_KEY, language)
    : profile.errorReason ?? null;

  return {
    id: profile.id,
    userId: profile.userId,
    name: profile.name,
    profileIcon: profile.profileIcon ?? null,
    provider: profile.provider,
    kind: profile.kind === 'CLONE' ? 'CLONE' : 'PRESET',
    voiceId: profile.voiceId,
    language: profile.language,
    contentLanguage: voiceContentLanguage(profile),
    status: profile.status,
    isPremium: isPremiumVoice(profile),
    errorMessage,
    errorReason: profile.errorReason ?? null,
    sampleAudioUrl: profile.sampleAudioUrl ?? null,
    consentAt: toIso(profile.consentAt),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
