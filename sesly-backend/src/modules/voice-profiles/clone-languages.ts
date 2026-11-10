import { BadRequestException } from '@nestjs/common';
import {
  DEFAULT_VOICE_LANGUAGE,
  VOICE_LANGUAGES,
  VoiceLanguage,
  findVoiceLanguage,
} from '../../common/constants/voice-languages';
import { SettingsService } from '../settings/settings.service';

type SettingsReader = Pick<SettingsService, 'get'>;

/**
 * The voice languages a user can clone in right now: VOICE_LANGUAGES
 * narrowed by the `tts.cloneLanguages` runtime setting, in catalogue order.
 * An empty or entirely unknown setting falls back to Turkish, so cloning can
 * never be switched off by accident.
 */
export function resolveCloneLanguages(settings: SettingsReader): VoiceLanguage[] {
  const enabled = new Set(settings.get('tts.cloneLanguages') ?? []);
  const languages = VOICE_LANGUAGES.filter((l) => enabled.has(l.code));
  if (languages.length > 0) return languages;
  return VOICE_LANGUAGES.filter((l) => l.code === DEFAULT_VOICE_LANGUAGE);
}

/**
 * The clone language of a request. Absent means Turkish (every app build
 * released before the language became a choice sends nothing, or "tr").
 * Anything that is not an enabled voice language is a coded 400
 * VOICE_LANGUAGE_NOT_SUPPORTED with the list the client may offer.
 */
export function requireCloneLanguage(
  settings: SettingsReader,
  requested: string | null | undefined,
): VoiceLanguage {
  const supported = resolveCloneLanguages(settings);
  const wanted =
    requested === undefined || requested === null || requested === ''
      ? DEFAULT_VOICE_LANGUAGE
      : findVoiceLanguage(requested)?.code;
  const language = supported.find((l) => l.code === wanted);
  if (!language) {
    throw new BadRequestException({
      code: 'VOICE_LANGUAGE_NOT_SUPPORTED',
      message: 'errors.voiceProfiles.cloneLanguageNotSupported',
      supportedLanguages: supported.map((l) => l.code),
    });
  }
  return language;
}
