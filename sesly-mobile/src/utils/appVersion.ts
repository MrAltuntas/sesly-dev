/**
 * The installed app version (e.g. "1.0.8"), the single source for every
 * version label and the force-update check.
 *
 * Read from the Expo config embedded at build time (app.config.js `version`,
 * which also drives the native versionName / CFBundleShortVersionString), so
 * no extra native module is needed. Returns null when it cannot be read.
 */
import Constants from 'expo-constants';
import { parseSemver } from './semver';

export function getAppVersion(): string | null {
  const raw = Constants.expoConfig?.version;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return parseSemver(trimmed) ? trimmed : null;
}

/** Label for "Sürüm" rows; never shows a made-up number. */
export function getAppVersionLabel(): string {
  return getAppVersion() ?? 'Bilinmiyor';
}

/** Profile footer eyebrow: "SESLY - V1.0.8", or just "SESLY" when unknown. */
export function formatProfileVersionLabel(version: string | null): string {
  return version ? `SESLY - V${version}` : 'SESLY';
}
