import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';
import {
  hasPresetVoices,
} from '../../../common/constants/google-preset-voices';
import {
  VOICE_LANGUAGE_MESSAGE,
  isVoiceLanguage,
  languageCodeOf,
} from '../../../common/constants/voice-languages';

/**
 * True when `value` is a language the profile being created can have.
 *
 *   - a clone (provider CARTESIA, or the legacy create that has no provider):
 *     one of the voice languages (tr, en), as a code or a locale
 *     ("en", "en-US");
 *   - a ready-made voice (provider GOOGLE): a content language that has
 *     ready-made voices. The stored language still comes from the voice id.
 */
export function isAllowedVoiceProfileLanguage(value: unknown, provider?: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (String(provider ?? '').toUpperCase() === 'GOOGLE') {
    const code = languageCodeOf(value);
    return code !== null && hasPresetVoices(code);
  }
  return isVoiceLanguage(value);
}

export function voiceProfileLanguageMessage(provider?: unknown): string {
  return String(provider ?? '').toUpperCase() === 'GOOGLE'
    ? 'errors.validation.presetVoiceLanguage'
    : VOICE_LANGUAGE_MESSAGE;
}

/**
 * class-validator decorator for the `language` field of the voice profile
 * create DTOs. Reads `provider` from the same object.
 */
export function IsVoiceProfileLanguage(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isVoiceProfileLanguage',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          return isAllowedVoiceProfileLanguage(value, (args.object as any)?.provider);
        },
        defaultMessage(args: ValidationArguments) {
          return voiceProfileLanguageMessage((args.object as any)?.provider);
        },
      },
    });
  };
}
