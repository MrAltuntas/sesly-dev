/**
 * i18n keys (src/i18n/<lang>/*.json) of user-facing messages that more than
 * one module emits. An error thrown with a key is translated by
 * HttpExceptionFilter per Accept-Language; text stored on a row is written
 * with `serverText(key, ownerLanguage)` (never store the key itself).
 */
export const NARRATION_FAILED_MESSAGE_KEY = 'messages.narrationFailed';

export const NARRATION_AUDIO_REMOVED_MESSAGE_KEY = 'messages.narrationAudioRemoved';

/** Fallback story title in a notification when the story has none. */
export const STORY_FALLBACK_TITLE_KEY = 'messages.storyFallbackTitle';

export const VOICE_NOT_READY_MESSAGE_KEY = 'errors.voiceProfiles.notReady';
