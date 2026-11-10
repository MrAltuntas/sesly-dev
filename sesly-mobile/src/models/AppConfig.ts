/**
 * GET /app/config (public): version gate for the force-update screen.
 *
 *   { minSupportedVersion: { android, ios }, latestVersion: { android, ios },
 *     storeUrl: { android, ios }, updateMessage }
 *
 * Parsed defensively: every field is optional and malformed values become
 * null, because a broken config must never lock users out (see
 * evaluateForceUpdate).
 */

import { isVersionBelow, parseSemver } from '../utils/semver';

export type AppPlatform = 'android' | 'ios';

export interface PlatformValues {
  readonly android: string | null;
  readonly ios: string | null;
}

export interface AppConfig {
  readonly minSupportedVersion: PlatformValues;
  readonly latestVersion: PlatformValues;
  readonly storeUrl: PlatformValues;
  readonly updateMessage: string | null;
}

/** Play Store listing used when the backend sends no Android store URL. */
export const FALLBACK_ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.sesly';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asVersion(value: unknown): string | null {
  return typeof value === 'string' && parseSemver(value) ? value.trim() : null;
}

function asUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Store links only: web or the platform store schemes.
  return /^(https?:|market:|itms-apps:)/i.test(trimmed) ? trimmed : null;
}

function parsePlatformValues(
  value: unknown,
  parse: (raw: unknown) => string | null,
): PlatformValues {
  const record = asRecord(value);
  return {
    android: record ? parse(record.android) : null,
    ios: record ? parse(record.ios) : null,
  };
}

/** Never throws; unknown shapes yield an all-null config (no gate). */
export function parseAppConfigFromJSON(json: unknown): AppConfig {
  const data = asRecord(json) ?? {};
  const message =
    typeof data.updateMessage === 'string' && data.updateMessage.trim()
      ? data.updateMessage.trim()
      : null;
  return {
    minSupportedVersion: parsePlatformValues(data.minSupportedVersion, asVersion),
    latestVersion: parsePlatformValues(data.latestVersion, asVersion),
    storeUrl: parsePlatformValues(data.storeUrl, asUrl),
    updateMessage: message,
  };
}

export interface ForceUpdateInfo {
  /**
   * The backend's sentence (it wins when sent); null: the screen says it in
   * the UI language (`states:forceUpdate.message`), resolved when shown.
   */
  readonly message: string | null;
  /** null when no store link is known (the screen then hides the button). */
  readonly storeUrl: string | null;
}

/**
 * Decide whether the installed version is below the platform minimum. Any
 * missing or invalid piece (unknown platform, no minimum, unreadable app
 * version) means "do not block".
 */
export function evaluateForceUpdate(
  config: AppConfig | null,
  platform: string,
  currentVersion: string | null,
): ForceUpdateInfo | null {
  if (!config || (platform !== 'android' && platform !== 'ios')) return null;
  const minimum = config.minSupportedVersion[platform];
  if (!minimum || !currentVersion) return null;
  if (!isVersionBelow(currentVersion, minimum)) return null;
  const storeUrl =
    config.storeUrl[platform] ??
    (platform === 'android' ? FALLBACK_ANDROID_STORE_URL : null);
  return {
    message: config.updateMessage,
    storeUrl,
  };
}
