/**
 * App config (GET /app/config, public) and the force-update check.
 *
 * Nothing waits for it at launch: BootStore evaluates the copy stored after
 * the last successful fetch (`@sesly/appConfig`, read in the boot snapshot)
 * and refreshes it in the background after the first route is shown.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ApiClient from './ApiClient';
import {
  AppConfig,
  ForceUpdateInfo,
  evaluateForceUpdate,
  parseAppConfigFromJSON,
} from '../models/AppConfig';
import { getAppVersion } from '../utils/appVersion';
import { APP_CONFIG_REFRESH_TIMEOUT_MS, STORAGE_KEYS } from '../config/constants';

export const APP_CONFIG_STORAGE_KEY = STORAGE_KEYS.APP_CONFIG;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export async function fetchAppConfig(): Promise<AppConfig> {
  const response = await ApiClient.get<unknown>('/app/config');
  return parseAppConfigFromJSON(response);
}

/**
 * The stored config (the raw JSON of the last successful fetch), or null
 * when there is none or it cannot be read. Never throws.
 */
export function parseStoredAppConfig(raw: string | null): AppConfig | null {
  if (!raw) {
    return null;
  }
  try {
    const json: unknown = JSON.parse(raw);
    return isRecord(json) ? parseAppConfigFromJSON(json) : null;
  } catch (error) {
    console.warn('[AppConfig] ignoring an unreadable stored config:', error);
    return null;
  }
}

/** The gate for this install from a config (null: no update required). */
export function evaluateForceUpdateForThisApp(config: AppConfig | null): ForceUpdateInfo | null {
  return evaluateForceUpdate(config, Platform.OS, getAppVersion());
}

/**
 * Fetches /app/config, stores the raw JSON for the next launch and resolves
 * to the force-update info (null when the installed version is fine).
 *
 * Rejects when no config arrived (offline, the timeout, a 4xx / 5xx, an
 * answer that is not an object), so the caller can keep what it decided from
 * the stored copy instead of lifting a gate it could not check.
 */
export async function refreshAppConfig(
  timeoutMs: number = APP_CONFIG_REFRESH_TIMEOUT_MS,
): Promise<ForceUpdateInfo | null> {
  const response = await ApiClient.get<unknown>('/app/config', { timeout: timeoutMs });
  if (!isRecord(response)) {
    throw new Error('GET /app/config did not answer with an object');
  }
  try {
    await AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, JSON.stringify(response));
  } catch (error) {
    console.warn('[AppConfig] could not store the config:', error);
  }
  return evaluateForceUpdateForThisApp(parseAppConfigFromJSON(response));
}
