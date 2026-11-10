import { apiErrorFromResponse } from './ApiError';

const mockGet = jest.fn();
const mockPatch = jest.fn();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    patch: (...args: unknown[]) => mockPatch(...args),
  },
}));

// Local AsyncStorage with getAllKeys / multiRemove (used by clear()).
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  const api = {
    getItem: jest.fn(async (k: string) => (store.has(k) ? (store.get(k) as string) : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    getAllKeys: jest.fn(async () => Array.from(store.keys())),
    multiSet: jest.fn(async (pairs: [string, string][]) => {
      pairs.forEach(([k, v]) => store.set(k, v));
    }),
    multiRemove: jest.fn(async (keys: string[]) => {
      keys.forEach(k => store.delete(k));
    }),
    clear: jest.fn(async () => {
      store.clear();
    }),
  };
  return { __esModule: true, default: api, ...api };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import userPreferencesService from './UserPreferencesService';

const storage = AsyncStorage as unknown as Record<string, jest.Mock>;

// Backend UserPreferencesResponseDto.
const prefsResponse = (overrides: Record<string, unknown> = {}) => ({
  userId: 'u-1',
  sleepTimerFadeOut: true,
  sleepTimerPauseWhenAsleep: false,
  sleepTimerLastDuration: 30,
  voiceReadyNotifications: true,
  narrationReadyNotifications: false,
  promoNotifications: false,
  contentLanguage: null,
  effectiveContentLanguage: null,
  uiLanguage: null,
  settings: { playbackSpeed: 1 },
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-27T10:00:00.000Z',
  ...overrides,
});

beforeEach(async () => {
  mockGet.mockReset();
  mockPatch.mockReset();
  await userPreferencesService.clear();
  await AsyncStorage.clear();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('UserPreferencesService.get', () => {
  it('GETs /users/me/preferences, caches it per user + last, and exposes it sync', async () => {
    mockGet.mockResolvedValue(prefsResponse());
    expect(userPreferencesService.getCachedSync()).toBeNull();

    const prefs = await userPreferencesService.get();

    expect(mockGet).toHaveBeenCalledWith('/users/me/preferences');
    expect(prefs).toEqual(prefsResponse());
    expect(userPreferencesService.getCachedSync()).toEqual(prefs);
    expect(JSON.parse((await AsyncStorage.getItem('user_preferences:u-1')) as string)).toEqual(prefs);
    expect(JSON.parse((await AsyncStorage.getItem('user_preferences:last')) as string)).toEqual(prefs);
  });

  it('defaults missing booleans and drops a non-numeric duration', async () => {
    mockGet.mockResolvedValue({ userId: 'u-2', sleepTimerLastDuration: null, settings: [] });
    const prefs = await userPreferencesService.get();
    expect(prefs).toMatchObject({
      sleepTimerFadeOut: true,
      sleepTimerPauseWhenAsleep: false,
      sleepTimerLastDuration: null,
      voiceReadyNotifications: true,
      narrationReadyNotifications: true,
      promoNotifications: false,
      settings: {},
    });
  });

  it('deduplicates concurrent calls into a single request', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockGet.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r;
        }),
    );

    const a = userPreferencesService.get();
    const b = userPreferencesService.get();
    resolve(prefsResponse());

    await expect(a).resolves.toEqual(prefsResponse());
    await expect(b).resolves.toEqual(prefsResponse());
    expect(mockGet).toHaveBeenCalledTimes(1);

    mockGet.mockResolvedValue(prefsResponse({ promoNotifications: true }));
    await expect(userPreferencesService.get()).resolves.toMatchObject({ promoNotifications: true });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('falls back to the last cached snapshot when offline', async () => {
    // Mirror left behind by an earlier successful GET.
    await AsyncStorage.setItem(
      'user_preferences:last',
      JSON.stringify(prefsResponse({ sleepTimerLastDuration: 45 })),
    );

    mockGet.mockRejectedValue(apiErrorFromResponse(undefined, null));
    const prefs = await userPreferencesService.get();

    expect(prefs.sleepTimerLastDuration).toBe(45);
    expect(userPreferencesService.getCachedSync()?.sleepTimerLastDuration).toBe(45);
  });

  it('rethrows when offline without a usable cache', async () => {
    const error = apiErrorFromResponse(undefined, null);
    mockGet.mockRejectedValue(error);
    await expect(userPreferencesService.get()).rejects.toBe(error);

    await AsyncStorage.setItem('user_preferences:last', JSON.stringify({ noUserId: true }));
    await expect(userPreferencesService.get()).rejects.toBe(error);
  });

  it('still resolves when the cache write fails', async () => {
    storage.multiSet.mockRejectedValueOnce(new Error('disk full'));
    mockGet.mockResolvedValue(prefsResponse());
    await expect(userPreferencesService.get()).resolves.toEqual(prefsResponse());
  });
});

describe('UserPreferencesService.update', () => {
  it('PATCHes the payload and refreshes memory + cache from the response', async () => {
    mockPatch.mockResolvedValue(prefsResponse({ sleepTimerFadeOut: false }));

    const prefs = await userPreferencesService.update({ sleepTimerFadeOut: false });

    expect(mockPatch).toHaveBeenCalledWith('/users/me/preferences', { sleepTimerFadeOut: false });
    expect(prefs.sleepTimerFadeOut).toBe(false);
    expect(userPreferencesService.getCachedSync()?.sleepTimerFadeOut).toBe(false);
    expect(JSON.parse((await AsyncStorage.getItem('user_preferences:last')) as string).sleepTimerFadeOut).toBe(false);
  });

  it('rethrows errors and leaves the snapshot untouched', async () => {
    mockGet.mockResolvedValue(prefsResponse());
    await userPreferencesService.get();

    const error = apiErrorFromResponse(400, { message: ['sleepTimerLastDuration must be an integer'] });
    mockPatch.mockRejectedValue(error);
    await expect(userPreferencesService.update({ sleepTimerLastDuration: 1.5 })).rejects.toBe(error);
    expect(userPreferencesService.getCachedSync()?.sleepTimerLastDuration).toBe(30);
  });
});

describe('UserPreferencesService.warmup / clear', () => {
  it('hydrates from the disk mirror first, then refreshes from the backend', async () => {
    await AsyncStorage.setItem('user_preferences:last', JSON.stringify(prefsResponse({ sleepTimerLastDuration: 10 })));
    let resolve: (v: unknown) => void = () => {};
    mockGet.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r;
        }),
    );

    const warm = userPreferencesService.warmup();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(userPreferencesService.getCachedSync()?.sleepTimerLastDuration).toBe(10);

    resolve(prefsResponse({ sleepTimerLastDuration: 60 }));
    await warm;
    expect(userPreferencesService.getCachedSync()?.sleepTimerLastDuration).toBe(60);
  });

  it('never throws when the backend is unreachable at boot', async () => {
    mockGet.mockRejectedValue(apiErrorFromResponse(undefined, null));
    await expect(userPreferencesService.warmup()).resolves.toBeUndefined();
    expect(userPreferencesService.getCachedSync()).toBeNull();
  });

  it('clear() wipes memory and only the preference keys', async () => {
    mockGet.mockResolvedValue(prefsResponse());
    await userPreferencesService.get();
    await AsyncStorage.setItem('legal:privacy', 'keep');

    await userPreferencesService.clear();

    expect(userPreferencesService.getCachedSync()).toBeNull();
    expect(await AsyncStorage.getItem('user_preferences:u-1')).toBeNull();
    expect(await AsyncStorage.getItem('user_preferences:last')).toBeNull();
    expect(await AsyncStorage.getItem('legal:privacy')).toBe('keep');
  });

  it('clear() swallows storage failures', async () => {
    storage.getAllKeys.mockRejectedValueOnce(new Error('storage down'));
    await expect(userPreferencesService.clear()).resolves.toBeUndefined();
  });
});

describe('UserPreferencesService.syncUiLanguage', () => {
  it('PATCHes the UI language alone and keeps the answer', async () => {
    mockPatch.mockResolvedValue(prefsResponse({ uiLanguage: 'en' }));

    await expect(userPreferencesService.syncUiLanguage('en')).resolves.toBe(true);

    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockPatch).toHaveBeenCalledWith('/users/me/preferences', { uiLanguage: 'en' });
    expect(userPreferencesService.getCachedSync()?.uiLanguage).toBe('en');
  });

  it('a backend that does not know the field (400) is ignored without a log', async () => {
    (console.error as jest.Mock).mockClear();
    (console.warn as jest.Mock).mockClear();
    mockPatch.mockRejectedValue(apiErrorFromResponse(400, { message: ['property uiLanguage should not exist'] }));

    await expect(userPreferencesService.syncUiLanguage('tr')).resolves.toBe(false);

    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(userPreferencesService.getCachedSync()).toBeNull();
  });
});

describe('UserPreferencesService.readCached', () => {
  it("reads the account's copy: memory first, then storage, never another account's", async () => {
    await expect(userPreferencesService.readCached('u-1')).resolves.toBeNull();

    mockGet.mockResolvedValue(prefsResponse({ contentLanguage: 'en' }));
    await userPreferencesService.get();
    await expect(userPreferencesService.readCached('u-1')).resolves.toMatchObject({ contentLanguage: 'en' });
    await expect(userPreferencesService.readCached('u-2')).resolves.toBeNull();

    // A new launch: nothing in memory, the stored copy of that account.
    const raw = (await AsyncStorage.getItem('user_preferences:u-1')) as string;
    await userPreferencesService.clear();
    await AsyncStorage.setItem('user_preferences:u-1', raw);
    await expect(userPreferencesService.readCached('u-1')).resolves.toMatchObject({ contentLanguage: 'en' });

    await AsyncStorage.setItem('user_preferences:u-1', '{broken');
    await expect(userPreferencesService.readCached('u-1')).resolves.toBeNull();
  });
});
