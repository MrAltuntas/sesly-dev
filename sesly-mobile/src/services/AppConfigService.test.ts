/**
 * AppConfigService: GET /app/config, the stored copy the next launch
 * evaluates, and the background refresh that must never lift a gate it could
 * not check.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiErrorFromResponse } from './ApiError';
import {
  APP_CONFIG_STORAGE_KEY,
  evaluateForceUpdateForThisApp,
  fetchAppConfig,
  parseStoredAppConfig,
  refreshAppConfig,
} from './AppConfigService';
import { APP_CONFIG_REFRESH_TIMEOUT_MS } from '../config/constants';
import { getAppVersion, getAppVersionLabel, formatProfileVersionLabel } from '../utils/appVersion';

const mockApiGet = jest.fn();
jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: { get: (...args: unknown[]) => mockApiGet(...args) },
}));

type MutableConstants = { expoConfig: { version?: unknown } | null };
const constants = Constants as unknown as MutableConstants;
const originalExpoConfig = constants.expoConfig;

function setInstalledVersion(version: unknown): void {
  constants.expoConfig = { ...(originalExpoConfig ?? {}), version };
}

const config = {
  minSupportedVersion: { android: '1.1.0', ios: '1.1.0' },
  latestVersion: { android: '1.2.0', ios: '1.2.0' },
  storeUrl: {
    android: 'https://play.google.com/store/apps/details?id=com.sesly',
    ios: 'https://apps.apple.com/app/id000000000',
  },
  updateMessage: 'Güncelle lütfen.',
};

beforeEach(async () => {
  mockApiGet.mockReset();
  await AsyncStorage.clear();
  setInstalledVersion('1.0.8');
  jest.replaceProperty(Platform, 'OS', 'android');
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  constants.expoConfig = originalExpoConfig;
});

describe('app version helper', () => {
  it('reads the embedded Expo config version', () => {
    expect(getAppVersion()).toBe('1.0.8');
    expect(getAppVersionLabel()).toBe('1.0.8');
    expect(formatProfileVersionLabel(getAppVersion())).toBe('SESLY - V1.0.8');
  });

  it('never invents a version', () => {
    setInstalledVersion(undefined);
    expect(getAppVersion()).toBeNull();
    expect(getAppVersionLabel()).toBe('Bilinmiyor');
    expect(formatProfileVersionLabel(null)).toBe('SESLY');

    setInstalledVersion('dev');
    expect(getAppVersion()).toBeNull();
  });
});

describe('fetchAppConfig', () => {
  it('reads GET /app/config', async () => {
    mockApiGet.mockResolvedValue(config);

    const parsed = await fetchAppConfig();

    expect(mockApiGet).toHaveBeenCalledWith('/app/config');
    expect(parsed.minSupportedVersion.android).toBe('1.1.0');
  });
});

describe('refreshAppConfig', () => {
  it('passes a 10 s timeout and stores the raw JSON', async () => {
    mockApiGet.mockResolvedValue(config);

    await refreshAppConfig();

    expect(APP_CONFIG_REFRESH_TIMEOUT_MS).toBe(10000);
    expect(mockApiGet).toHaveBeenCalledWith('/app/config', { timeout: 10000 });
    await expect(AsyncStorage.getItem(APP_CONFIG_STORAGE_KEY)).resolves.toBe(JSON.stringify(config));
    expect(APP_CONFIG_STORAGE_KEY).toBe('@sesly/appConfig');
  });

  it('takes another timeout when asked', async () => {
    mockApiGet.mockResolvedValue(config);
    await refreshAppConfig(2500);
    expect(mockApiGet).toHaveBeenCalledWith('/app/config', { timeout: 2500 });
  });

  it('resolves to the gate when the installed version is below the minimum', async () => {
    mockApiGet.mockResolvedValue(config);

    await expect(refreshAppConfig()).resolves.toEqual({
      message: 'Güncelle lütfen.',
      storeUrl: config.storeUrl.android,
    });
  });

  it('uses the iOS values on iOS', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    mockApiGet.mockResolvedValue(config);

    await expect(refreshAppConfig()).resolves.toEqual({
      message: 'Güncelle lütfen.',
      storeUrl: config.storeUrl.ios,
    });
  });

  it('resolves to null for an up-to-date app (and still stores the config)', async () => {
    setInstalledVersion('1.1.0');
    mockApiGet.mockResolvedValue(config);

    await expect(refreshAppConfig()).resolves.toBeNull();
    await expect(AsyncStorage.getItem(APP_CONFIG_STORAGE_KEY)).resolves.toBe(JSON.stringify(config));
  });

  it('does not block when the installed version cannot be read', async () => {
    setInstalledVersion(undefined);
    mockApiGet.mockResolvedValue(config);

    await expect(refreshAppConfig()).resolves.toBeNull();
  });

  it.each([
    ['offline', apiErrorFromResponse(undefined, null)],
    ['a 404 from an older backend', apiErrorFromResponse(404, {})],
    ['a server error', apiErrorFromResponse(500, {})],
  ])('rejects and keeps the stored copy when %s', async (_label, error) => {
    await AsyncStorage.setItem(APP_CONFIG_STORAGE_KEY, '{"stored":true}');
    mockApiGet.mockRejectedValue(error);

    await expect(refreshAppConfig()).rejects.toBe(error);
    await expect(AsyncStorage.getItem(APP_CONFIG_STORAGE_KEY)).resolves.toBe('{"stored":true}');
  });

  it.each([['a string', 'maintenance'], ['an array', [config]], ['null', null]])(
    'rejects an answer that is %s and stores nothing',
    async (_label, body) => {
      mockApiGet.mockResolvedValue(body);

      await expect(refreshAppConfig()).rejects.toThrow('did not answer with an object');
      await expect(AsyncStorage.getItem(APP_CONFIG_STORAGE_KEY)).resolves.toBeNull();
    },
  );

  it('still answers when the config cannot be stored', async () => {
    mockApiGet.mockResolvedValue(config);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));

    await expect(refreshAppConfig()).resolves.toEqual({
      message: 'Güncelle lütfen.',
      storeUrl: config.storeUrl.android,
    });
    expect(console.warn).toHaveBeenCalledWith('[AppConfig] could not store the config:', expect.any(Error));
  });
});

describe('the stored copy', () => {
  it('round-trips what refreshAppConfig stored', async () => {
    mockApiGet.mockResolvedValue(config);
    await refreshAppConfig();
    const stored = parseStoredAppConfig(await AsyncStorage.getItem(APP_CONFIG_STORAGE_KEY));

    expect(stored?.minSupportedVersion).toEqual({ android: '1.1.0', ios: '1.1.0' });
    expect(evaluateForceUpdateForThisApp(stored)).toEqual({
      message: 'Güncelle lütfen.',
      storeUrl: config.storeUrl.android,
    });
  });

  it.each([
    ['nothing stored', null],
    ['an empty string', ''],
    ['broken JSON', '{"minSupportedVersion":'],
    ['a JSON string', '"1.1.0"'],
    ['a JSON array', '[1,2]'],
  ])('is no gate with %s', (_label, raw) => {
    const parsed = parseStoredAppConfig(raw);
    expect(parsed).toBeNull();
    expect(evaluateForceUpdateForThisApp(parsed)).toBeNull();
  });
});
