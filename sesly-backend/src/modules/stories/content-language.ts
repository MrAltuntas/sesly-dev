import {
  CONTENT_LANGUAGES,
  ContentLanguage,
  DEFAULT_CONTENT_LANGUAGE,
  isContentLanguage,
} from '../../common/constants/content-languages';
import type { SettingsService } from '../settings/settings.service';

export interface ResolvedContentLanguages {
  /** Enabled language codes in the order of CONTENT_LANGUAGES. Never empty. */
  enabled: string[];
  /** Language served when a request names none. Always one of `enabled`. */
  defaultLanguage: string;
}

/**
 * The two content.* settings, made consistent at read time (the registry
 * validates each key on its own, so the pair can disagree):
 *   - an empty or unusable enabled list means Turkish only
 *   - a default that is not enabled means the first enabled language
 * Reads the settings on every call so a panel change applies at once.
 */
export function resolveContentLanguages(
  settings: Pick<SettingsService, 'get'>,
): ResolvedContentLanguages {
  const raw = settings.get('content.enabledLanguages');
  const wanted = new Set((Array.isArray(raw) ? raw : []).filter(isContentLanguage));
  const enabled = CONTENT_LANGUAGES.map((l) => l.code).filter((code) => wanted.has(code));
  if (enabled.length === 0) enabled.push(DEFAULT_CONTENT_LANGUAGE);

  const configured = settings.get('content.defaultLanguage');
  const defaultLanguage = enabled.includes(configured) ? configured : enabled[0];

  return { enabled, defaultLanguage };
}

export interface RequestedContentLanguage extends ResolvedContentLanguages {
  /** Language this request is answered in. */
  language: string;
  /** False when the caller asked for a language that is not enabled: answer with nothing. */
  available: boolean;
}

/**
 * Language of one public request. Old clients send no `language` and get the
 * default; a language that is switched off is not served at all.
 */
export function resolveRequestedLanguage(
  settings: Pick<SettingsService, 'get'>,
  requested?: string | null,
): RequestedContentLanguage {
  const resolved = resolveContentLanguages(settings);
  const language = requested || resolved.defaultLanguage;
  return { ...resolved, language, available: resolved.enabled.includes(language) };
}

export function enabledContentLanguages(
  settings: Pick<SettingsService, 'get'>,
): ContentLanguage[] {
  const { enabled } = resolveContentLanguages(settings);
  return CONTENT_LANGUAGES.filter((l) => enabled.includes(l.code));
}
