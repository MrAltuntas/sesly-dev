import * as fs from 'fs';
import * as path from 'path';
import { formatUiDate } from '../utils/turkish-date';
import { DEFAULT_UI_LANGUAGE, UiLanguage } from './ui-language';

/**
 * Server text in the user's UI language, read from the same translation
 * files nestjs-i18n serves (`src/i18n/<lang>/<namespace>.json`, copied to
 * `dist/i18n` by nest-cli). A key is `<namespace>.<path>`, e.g.
 * `notifications.voiceReady.title`. Placeholders are `{name}`.
 *
 * Two ways to use it:
 * - Error responses: throw with the KEY as `message` (plus `messageArgs` from
 *   `localizedError`); HttpExceptionFilter translates it per Accept-Language.
 * - Text the server writes on its own (push notifications, failure messages
 *   stored on a row): `serverText(key, language, args)` with the owner's
 *   stored language (`UserUiLanguageResolver`).
 */

/** A value that differs per language, e.g. a language name. */
export type LocalizedValue = Readonly<Record<UiLanguage, string>>;

/** Dates are formatted per language ("1 Kasım" / "November 1"). */
export type MessageArg = string | number | Date | LocalizedValue;

export type MessageArgs = Readonly<Record<string, MessageArg>>;

/**
 * Field of an exception body that carries the placeholder values of its key.
 * HttpExceptionFilter consumes it and never sends it to the client.
 */
export const MESSAGE_ARGS_FIELD = 'messageArgs';

/**
 * Exception body (or the part to spread into one next to `code` and the
 * other structured fields) whose message the filter translates.
 */
export function localizedError(
  key: string,
  args?: MessageArgs,
): { message: string; messageArgs?: MessageArgs } {
  return args ? { message: key, [MESSAGE_ARGS_FIELD]: args } : { message: key };
}

function isLocalizedValue(value: unknown): value is LocalizedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof Date) &&
    typeof (value as Record<string, unknown>)[DEFAULT_UI_LANGUAGE] === 'string'
  );
}

/** Placeholder values as plain strings / numbers in one language. */
export function resolveMessageArgs(
  args: unknown,
  language: string,
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (typeof args !== 'object' || args === null) return out;
  for (const [name, value] of Object.entries(args as Record<string, unknown>)) {
    if (value instanceof Date) {
      out[name] = formatUiDate(value, language);
    } else if (isLocalizedValue(value)) {
      out[name] = (value as Record<string, string>)[language] ?? value[DEFAULT_UI_LANGUAGE];
    } else if (typeof value === 'string' || typeof value === 'number') {
      out[name] = value;
    } else if (value !== null && value !== undefined) {
      out[name] = String(value);
    }
  }
  return out;
}

/** `{name}` placeholders replaced; an unknown placeholder is left as it is. */
export function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : whole,
  );
}

type Catalogue = Record<string, unknown>;

const I18N_DIR = path.join(__dirname, '..', '..', 'i18n');
const catalogues = new Map<string, Catalogue>();

function loadCatalogue(language: string): Catalogue {
  const cached = catalogues.get(language);
  if (cached) return cached;
  const catalogue: Catalogue = {};
  const dir = path.join(I18N_DIR, language);
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      catalogue[file.slice(0, -'.json'.length)] = JSON.parse(
        fs.readFileSync(path.join(dir, file), 'utf8'),
      );
    }
  } catch {
    // Missing language directory: empty catalogue, the Turkish one is used.
  }
  catalogues.set(language, catalogue);
  return catalogue;
}

function lookup(language: string, key: string): string | null {
  let node: unknown = loadCatalogue(language);
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' && node.length > 0 ? node : null;
}

/**
 * The text of `key` in `language` (Turkish when that language has none),
 * placeholders filled in. The key itself when no language has it.
 */
export function serverText(key: string, language: UiLanguage | string, args?: MessageArgs): string {
  const template = lookup(language, key) ?? lookup(DEFAULT_UI_LANGUAGE, key);
  if (template === null) return key;
  return interpolate(template, resolveMessageArgs(args, language));
}

/** The same key in every UI language, e.g. to compare stored text. */
export function serverTextInAllLanguages(key: string, args?: MessageArgs): LocalizedValue {
  return { tr: serverText(key, 'tr', args), en: serverText(key, 'en', args) };
}
