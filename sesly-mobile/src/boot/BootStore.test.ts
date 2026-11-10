/**
 * BootStore: the launch decides its first route from local storage alone and
 * never waits for the network when the device already knows where to go.
 *
 * The real AuthStore, AuthService and session helpers run on top of mocked
 * edges: the network (UserService.getCurrentUser for /users/me, ApiClient.get
 * for /app/config), the token check (ApiClient.hasValidTokens), Firebase, the
 * socket and push, and navigationRef. AsyncStorage is the global in-memory
 * mock, so the one multiGet is observable. Fake timers throughout.
 */

const mockGetCurrentUser = jest.fn();
const mockHasValidTokens = jest.fn();
const mockClearTokens = jest.fn();
const mockApiGet = jest.fn();
const mockPushInitialize = jest.fn();
const mockPreloadLikelyScreens = jest.fn();
const mockPrefetchOnboardingPictures = jest.fn();
const mockReleaseOnboardingPictures = jest.fn();
const mockNav = {
  isReady: jest.fn(),
  getRootState: jest.fn(),
  reset: jest.fn(),
  addListener: jest.fn(),
};
// eslint-disable-next-line prefer-const
let mockAuth: import('../hooks/useAuth').AuthStore;

jest.mock('../services/UserService', () => ({
  __esModule: true,
  default: { getCurrentUser: (...a: unknown[]) => mockGetCurrentUser(...a) },
}));
jest.mock('../services/ApiClient', () => ({
  __esModule: true,
  default: {
    hasValidTokens: (...a: unknown[]) => mockHasValidTokens(...a),
    clearTokens: (...a: unknown[]) => mockClearTokens(...a),
    get: (...a: unknown[]) => mockApiGet(...a),
    onSessionExpired: jest.fn(),
  },
}));
jest.mock('../services/firebase', () => ({
  ensureFirebaseInitialized: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  default: jest.fn(),
  getAuth: () => ({ currentUser: null, onAuthStateChanged: () => () => undefined }),
}));
jest.mock('../services/WebSocketService', () => ({
  __esModule: true,
  default: { connect: jest.fn().mockResolvedValue(undefined), disconnect: jest.fn() },
}));
jest.mock('../services/PushNotificationService', () => ({
  __esModule: true,
  default: {
    initialize: (...a: unknown[]) => mockPushInitialize(...a),
    unregisterDevice: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../services/CacheService', () => ({
  __esModule: true,
  default: {
    clearAudioCache: jest.fn().mockResolvedValue(undefined),
    clearAllCache: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('../services/UserPreferencesService', () => {
  const service = {
    warmup: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  return { __esModule: true, default: service, userPreferencesService: service };
});
jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));
jest.mock('../navigation/navigationRef', () => ({
  get navigationRef() {
    return mockNav;
  },
}));
jest.mock('../navigation/RootNavigator', () => ({
  preloadLikelyScreens: (...a: unknown[]) => mockPreloadLikelyScreens(...a),
}));
jest.mock('./onboardingPictures', () => ({
  prefetchOnboardingPictures: (...a: unknown[]) => mockPrefetchOnboardingPictures(...a),
  releaseOnboardingPictures: (...a: unknown[]) => mockReleaseOnboardingPictures(...a),
}));
jest.mock('../hooks/useAuth', () => {
  const actual = jest.requireActual('../hooks/useAuth');
  return { ...actual, getAuthStore: () => mockAuth, useAuth: () => mockAuth };
});

import { AppState } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  APP_CONFIG_STALE_MS,
  BOOT_RESTORE_TIMEOUT_MS,
  BootStore,
  SCREEN_PRELOAD_DELAY_MS,
  getBootStore,
} from './BootStore';
import { BOOT_SNAPSHOT_KEYS } from './bootSnapshot';
import * as decideModule from './decideBootRoute';
import { AuthStore } from '../hooks/useAuth';
import AuthService from '../services/AuthService';
import { apiErrorFromResponse } from '../services/ApiError';
import { connectivityStore } from '../stores/ConnectivityStore';
import * as ThemeProviderModule from '../theme/ThemeProvider';
import i18n from '../i18n';
import { parseUserFromJSON, userToJSON } from '../models/User';
import { mockUserJSON } from '../test-utils/mock-data';
import { FALLBACK_ANDROID_STORE_URL } from '../models/AppConfig';
import * as SplashScreen from 'expo-splash-screen';
import {
  LAST_NARRATOR_KEY,
  lastNarratorId,
  resetLastNarratorForTests,
} from '../components/detail/lastNarrator';
import {
  ONBOARDING_PICTURE_HOLD_MS,
  isSplashReleased,
  markOnboardingPictureReady,
  resetSplashForTests,
} from './splash';

const user = parseUserFromJSON(mockUserJSON);
const CACHED_USER = JSON.stringify({ v: 1, user: userToJSON(user) });

const UPDATE_CONFIG = {
  minSupportedVersion: { android: '1.1.0', ios: '1.1.0' },
  latestVersion: { android: '1.2.0', ios: '1.2.0' },
  storeUrl: { android: 'https://play.google.com/store/apps/details?id=com.sesly', ios: null },
  updateMessage: 'Yeni sürüm hazır, güncelle.',
};
const FINE_CONFIG = { ...UPDATE_CONFIG, minSupportedVersion: { android: '1.0.0', ios: '1.0.0' } };
const UPDATE_INFO = {
  message: UPDATE_CONFIG.updateMessage,
  storeUrl: UPDATE_CONFIG.storeUrl.android,
};

type MutableConstants = { expoConfig: { version?: unknown } | null };
const constants = Constants as unknown as MutableConstants;
const originalExpoConfig = constants.expoConfig;

const never = () => new Promise<never>(() => undefined);

const flush = async () => {
  for (let i = 0; i < 40; i++) {
    await Promise.resolve();
  }
};

let store: BootStore;
let appStateListeners: Array<(state: string) => void>;

async function seed(values: Record<string, string>): Promise<void> {
  await Promise.all(Object.entries(values).map(([key, value]) => AsyncStorage.setItem(key, value)));
  (AsyncStorage.setItem as jest.Mock).mockClear();
}

function focusedRoot(name: string, params?: object): void {
  mockNav.isReady.mockReturnValue(true);
  mockNav.getRootState.mockReturnValue({ index: 0, routes: [{ key: `${name}-1`, name, params }] });
}

/** The last listener the store put on navigationRef for `event`. */
function listenerFor(event: string): () => void {
  const calls = mockNav.addListener.mock.calls.filter(([name]) => name === event);
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][1] as () => void;
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  constants.expoConfig = { ...(originalExpoConfig ?? {}), version: '1.0.8' };
  jest.replaceProperty(require('react-native').Platform, 'OS', 'android');

  mockGetCurrentUser.mockReset().mockImplementation(never);
  mockHasValidTokens.mockReset().mockResolvedValue(false);
  mockClearTokens.mockReset().mockResolvedValue(undefined);
  mockApiGet.mockReset().mockImplementation(never);
  mockPushInitialize.mockReset();
  mockPreloadLikelyScreens.mockReset();
  mockPrefetchOnboardingPictures.mockReset();
  mockReleaseOnboardingPictures.mockReset();
  mockNav.isReady.mockReset().mockReturnValue(false);
  mockNav.getRootState.mockReset().mockReturnValue(undefined);
  mockNav.reset.mockReset();
  mockNav.addListener.mockReset().mockReturnValue(jest.fn());

  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: (state: string) => void) => {
    appStateListeners.push(listener);
    return { remove: jest.fn() };
  }) as never);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  connectivityStore.stop();
  mockAuth = new AuthStore();
  store = new BootStore();
});

afterEach(() => {
  store.stop();
  connectivityStore.stop();
  constants.expoConfig = originalExpoConfig;
  jest.useRealTimers();
});

describe('BootStore first route', () => {
  it('tokens and a cached user: Main from storage alone, /users/me and /app/config still pending', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    await seed({ '@sesly/me': CACHED_USER, hasSeenOnboarding: 'true' });

    // No timer is advanced: only the storage promises resolve.
    await store.start();

    expect(store.route).toEqual({ name: 'Main' });
    expect(store.uiReady).toBe(true);
    expect(mockAuth.backendUser?.id).toBe(user.id);
    expect(mockAuth.sessionStale).toBe(true);
    // The live check and the config refresh were started, not awaited.
    await flush();
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
    expect(store.route).toEqual({ name: 'Main' });
    expect(mockApiGet).toHaveBeenCalledWith('/app/config', { timeout: 10000 });
  });

  it.each([
    ['onboarding seen', { hasSeenOnboarding: 'true' }, { name: 'Login' }],
    ['a first launch', {}, { name: 'Onboarding' }],
  ])('no tokens, %s', async (_label, values: Record<string, string>, expected) => {
    await seed(values);

    await store.start();

    expect(store.route).toEqual(expected);
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockAuth.restoreOutcome).toBe('none');
  });

  it('a cached user without tokens is not a session: Login, and the record goes', async () => {
    await seed({ '@sesly/me': CACHED_USER, hasSeenOnboarding: 'true' });

    await store.start();
    await flush();

    expect(store.route).toEqual({ name: 'Login' });
    expect(mockAuth.backendUser).toBeNull();
    await expect(AsyncStorage.getItem('@sesly/me')).resolves.toBeNull();
  });

  it.each([
    ['status 0 (offline)', apiErrorFromResponse(undefined, null), { name: 'NoInternet', params: { reason: 'offline' } }],
    ['503', apiErrorFromResponse(503, {}), { name: 'NoInternet', params: { reason: 'maintenance' } }],
    ['500', apiErrorFromResponse(500, {}), { name: 'NoInternet', params: { reason: 'server' } }],
    ['401', apiErrorFromResponse(401, {}), { name: 'Login' }],
  ])('tokens without a cached user, /users/me fails with %s', async (_label, error, expected) => {
    mockHasValidTokens.mockResolvedValue(true);
    mockGetCurrentUser.mockRejectedValue(error);
    await seed({ hasSeenOnboarding: 'true' });

    await store.start();

    expect(store.route).toEqual(expected);
    if (expected.name === 'Login') {
      expect(mockClearTokens).toHaveBeenCalled();
    } else {
      // The tokens stay for the retry.
      expect(mockClearTokens).not.toHaveBeenCalled();
    }
  });

  it('tokens without a cached user, /users/me answers: Main', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    mockGetCurrentUser.mockResolvedValue(user);

    await store.start();

    expect(store.route).toEqual({ name: 'Main' });
    expect(mockAuth.backendUser?.id).toBe(user.id);
  });

  it('a restore that never settles gives NoInternet after 10 s', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    const started = store.start();

    await jest.advanceTimersByTimeAsync(BOOT_RESTORE_TIMEOUT_MS - 1);
    expect(store.route).toBeNull();
    // The language and palette do not wait for the session check.
    expect(store.uiReady).toBe(true);

    await jest.advanceTimersByTimeAsync(1);
    await started;
    expect(store.route).toEqual({ name: 'NoInternet', params: { reason: 'offline' } });
  });

  it('reads storage in ONE multiGet', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    await seed({
      '@sesly/me': CACHED_USER,
      hasSeenOnboarding: 'true',
      '@sesly/palette': 'erik',
      '@sesly/uiLanguage': 'en',
    });

    await Promise.all([store.start(), store.start()]);

    expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.multiGet).toHaveBeenCalledWith([...BOOT_SNAPSHOT_KEYS]);
    const singleReads = (AsyncStorage.getItem as jest.Mock).mock.calls.map(([key]) => key);
    for (const key of BOOT_SNAPSHOT_KEYS) {
      expect(singleReads).not.toContain(key);
    }
  });

  it('applies the stored language and palette from the snapshot before uiReady', async () => {
    const preload = jest.spyOn(ThemeProviderModule, 'preloadStoredPalette');
    await seed({ '@sesly/palette': 'erik', '@sesly/uiLanguage': 'en' });

    await store.start();

    expect(preload).toHaveBeenCalledWith('erik');
    expect(i18n.language).toBe('en');
    expect(store.uiReady).toBe(true);
  });

  it('a cached force update wins over a signed-in user', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    await seed({ '@sesly/me': CACHED_USER, '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });

    await store.start();

    expect(store.route).toEqual({ name: 'ForceUpdate', params: UPDATE_INFO });
  });

  it('an unreadable stored config is no gate', async () => {
    await seed({ hasSeenOnboarding: 'true', '@sesly/appConfig': '{not json' });

    await store.start();

    expect(store.route).toEqual({ name: 'Login' });
  });

  it.each([
    ['tokens', true, { hasSeenOnboarding: 'true' }, { name: 'NoInternet', params: { reason: 'server' } }],
    ['no tokens, onboarding seen', false, { hasSeenOnboarding: 'true' }, { name: 'Login' }],
    ['a first launch', false, {}, { name: 'Onboarding' }],
  ])('a bug while deciding still leaves the splash (%s)', async (_label, tokens, values: Record<string, string>, expected) => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(decideModule, 'decideBootRoute').mockImplementation(() => {
      throw new Error('bug');
    });
    mockHasValidTokens.mockResolvedValue(tokens);
    await seed(values);

    await expect(store.start()).resolves.toBeUndefined();

    expect(store.route).toEqual(expected);
    expect(store.uiReady).toBe(true);
    expect(console.error).toHaveBeenCalledWith('[boot] launch failed:', expect.any(Error));
  });

  it('start() runs the launch once', async () => {
    await store.start();
    await store.start();

    expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(1);
    expect(getBootStore()).toBe(getBootStore());
  });
});

describe('BootStore after routing', () => {
  it('starts connectivity, push once Firebase is configured, and the Main preload after 1.5 s', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    await seed({ '@sesly/me': CACHED_USER });

    await store.start();
    await flush();

    expect(connectivityStore.isStarted).toBe(true);
    expect(mockPushInitialize).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(SCREEN_PRELOAD_DELAY_MS - 1);
    expect(mockPreloadLikelyScreens).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(mockPreloadLikelyScreens).toHaveBeenCalledTimes(1);
  });

  it('does not preload on a route other than Main', async () => {
    await seed({ hasSeenOnboarding: 'true' });

    await store.start();
    await jest.advanceTimersByTimeAsync(SCREEN_PRELOAD_DELAY_MS * 2);

    expect(mockPreloadLikelyScreens).not.toHaveBeenCalled();
  });

  describe('the Onboarding boot route', () => {
    beforeEach(() => {
      resetSplashForTests();
    });
    afterEach(() => {
      resetSplashForTests();
    });

    it('holds the splash from navigator ready until 800 ms when the picture never loads', async () => {
      await store.start();
      expect(store.route).toEqual({ name: 'Onboarding' });
      expect(mockNav.addListener).toHaveBeenCalledWith('ready', expect.any(Function));

      // Nothing runs before the navigator has drawn the route.
      await jest.advanceTimersByTimeAsync(ONBOARDING_PICTURE_HOLD_MS * 2);
      expect(isSplashReleased()).toBe(false);

      const onReady = listenerFor('ready');
      onReady();
      await jest.advanceTimersByTimeAsync(ONBOARDING_PICTURE_HOLD_MS - 1);
      expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });

    it('releases as soon as the first picture loads', async () => {
      mockNav.isReady.mockReturnValue(true);
      await store.start();

      markOnboardingPictureReady();

      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(ONBOARDING_PICTURE_HOLD_MS);
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });

    it('does not hold the splash on another route', async () => {
      await seed({ hasSeenOnboarding: 'true' });
      await store.start();
      await jest.advanceTimersByTimeAsync(ONBOARDING_PICTURE_HOLD_MS * 2);

      expect(mockNav.addListener).not.toHaveBeenCalledWith('ready', expect.any(Function));
      expect(isSplashReleased()).toBe(false);
    });

    it('starts decoding the onboarding pictures as soon as the route is decided (LA-5)', async () => {
      await store.start();

      expect(store.route).toEqual({ name: 'Onboarding' });
      // Before the navigator is ready: the decode runs while it mounts.
      expect(mockNav.isReady).toHaveReturnedWith(false);
      expect(mockPrefetchOnboardingPictures).toHaveBeenCalledTimes(1);
      expect(isSplashReleased()).toBe(false);
    });

    it('a throwing prefetch still holds the splash for the picture', async () => {
      mockPrefetchOnboardingPictures.mockImplementation(() => {
        throw new Error('no expo-image');
      });
      await store.start();

      expect(console.warn).toHaveBeenCalledWith('[boot] onboarding picture prefetch failed:', expect.any(Error));
      listenerFor('ready')();
      await jest.advanceTimersByTimeAsync(ONBOARDING_PICTURE_HOLD_MS);
      expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['Login', false, { hasSeenOnboarding: 'true' }],
      ['Main', true, { '@sesly/me': CACHED_USER, hasSeenOnboarding: 'true' }],
    ])('does not decode the onboarding pictures on %s', async (name, tokens, values: Record<string, string>) => {
      mockHasValidTokens.mockResolvedValue(tokens);
      await seed(values);
      await store.start();

      expect(store.route?.name).toBe(name);
      expect(mockPrefetchOnboardingPictures).not.toHaveBeenCalled();
    });

    it('starts the decode before the language, the palette and the session (ONB-PIC-LATE)', async () => {
      const order: string[] = [];
      mockPrefetchOnboardingPictures.mockImplementation(() => order.push('prefetch'));
      jest.spyOn(ThemeProviderModule, 'preloadStoredPalette').mockImplementation(async () => {
        order.push('palette');
        return 'gece-mavisi';
      });
      const initialize = jest.spyOn(mockAuth, 'initialize');
      initialize.mockImplementation(async () => {
        order.push('session');
      });

      await store.start();

      expect(order.slice(0, 3)).toEqual(['prefetch', 'palette', 'session']);
      // Once per launch: the route step does not decode a second time.
      expect(mockPrefetchOnboardingPictures).toHaveBeenCalledTimes(1);
      expect(mockReleaseOnboardingPictures).not.toHaveBeenCalled();
    });

    it('a first launch that must update first drops the pictures it decoded', async () => {
      await seed({ '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });

      await store.start();

      expect(store.route?.name).toBe('ForceUpdate');
      expect(mockPrefetchOnboardingPictures).toHaveBeenCalledTimes(1);
      expect(mockReleaseOnboardingPictures).toHaveBeenCalledTimes(1);
    });
  });

  describe('the last narrator (RB-2)', () => {
    beforeEach(() => {
      resetLastNarratorForTests();
    });

    it('a returning user has it in memory before any story page opens', async () => {
      mockHasValidTokens.mockResolvedValue(true);
      await seed({ '@sesly/me': CACHED_USER, hasSeenOnboarding: 'true', [LAST_NARRATOR_KEY]: 'vp-7' });

      await store.start();
      await flush();

      expect(AsyncStorage.getItem).toHaveBeenCalledWith(LAST_NARRATOR_KEY);
      expect(lastNarratorId()).toBe('vp-7');
    });

    it('is not read on a first launch', async () => {
      await store.start();
      await flush();

      expect(AsyncStorage.getItem).not.toHaveBeenCalledWith(LAST_NARRATOR_KEY);
    });
  });

  describe('the route a re-created navigator starts on', () => {
    function navigatedTo(routes: Array<{ name: string; params?: object }>): void {
      mockNav.isReady.mockReturnValue(true);
      mockNav.getRootState.mockReturnValue({
        index: routes.length - 1,
        routes: routes.map((route, i) => ({ key: `${route.name}-${i}`, ...route })),
      });
      listenerFor('state')();
    }

    it('follows a sign-in to Main and a sign-out to Login', async () => {
      await seed({ hasSeenOnboarding: 'true' });
      await store.start();
      expect(store.route).toEqual({ name: 'Login' });

      navigatedTo([{ name: 'Main', params: { screen: 'Voices' } }]);
      expect(store.route).toEqual({ name: 'Main' });

      navigatedTo([{ name: 'Login' }]);
      expect(store.route).toEqual({ name: 'Login' });
    });

    it('keeps the route under a screen opened on top of it', async () => {
      mockHasValidTokens.mockResolvedValue(true);
      await seed({ '@sesly/me': CACHED_USER });
      await store.start();
      const main = store.route;

      navigatedTo([{ name: 'Main' }, { name: 'AudioPlayer', params: { narrationId: 'n-1' } }]);

      expect(store.route).toBe(main);
    });

    it('carries the gate and the offline reason with their params', async () => {
      await store.start();

      navigatedTo([{ name: 'ForceUpdate', params: UPDATE_INFO }]);
      expect(store.route).toEqual({ name: 'ForceUpdate', params: UPDATE_INFO });

      navigatedTo([{ name: 'NoInternet', params: { reason: 'maintenance' } }]);
      expect(store.route).toEqual({ name: 'NoInternet', params: { reason: 'maintenance' } });

      navigatedTo([{ name: 'Login', params: { firstRun: true } }]);
      expect(store.route).toEqual({ name: 'Login', params: { firstRun: true } });
    });

    it('holds the force-update gate against any navigation away from it', async () => {
      mockHasValidTokens.mockResolvedValue(true);
      await seed({ '@sesly/me': CACHED_USER, '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });
      await store.start();
      expect(store.route?.name).toBe('ForceUpdate');

      // The session ended meanwhile: the navigator resets to Login.
      navigatedTo([{ name: 'Login' }]);

      expect(mockNav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'ForceUpdate', params: UPDATE_INFO }] });
      expect(store.route).toEqual({ name: 'ForceUpdate', params: UPDATE_INFO });
    });

    it('lets go once the backend no longer requires the update', async () => {
      mockApiGet.mockResolvedValue(FINE_CONFIG);
      await seed({ hasSeenOnboarding: 'true', '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });
      focusedRoot('ForceUpdate', UPDATE_INFO);
      await store.start();
      await flush();
      expect(mockNav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Login' }] });
      mockNav.reset.mockClear();

      navigatedTo([{ name: 'Login' }]);

      expect(mockNav.reset).not.toHaveBeenCalled();
      expect(store.route).toEqual({ name: 'Login' });
    });

    it('subscribes once, before the container exists', async () => {
      await store.start();
      await store.start();

      expect(mockNav.addListener.mock.calls.filter(([event]) => event === 'state')).toHaveLength(1);
      // Nothing was mounted yet when it subscribed.
      expect(mockNav.isReady).not.toHaveReturnedWith(true);
    });
  });

  it('a pending Firebase setup neither blocks the route nor attaches push early', async () => {
    jest.spyOn(AuthService, 'initialize').mockImplementation(never);
    mockHasValidTokens.mockResolvedValue(true);
    await seed({ '@sesly/me': CACHED_USER });

    await store.start();
    await flush();

    expect(store.route).toEqual({ name: 'Main' });
    expect(mockPushInitialize).not.toHaveBeenCalled();
  });
});

describe('BootStore force update in the background', () => {
  it('a refresh that requires an update resets to ForceUpdate and stores the config', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    mockApiGet.mockResolvedValue(UPDATE_CONFIG);
    focusedRoot('Main');
    await seed({ '@sesly/me': CACHED_USER });

    await store.start();
    await flush();

    expect(mockNav.reset).toHaveBeenCalledTimes(1);
    expect(mockNav.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'ForceUpdate', params: UPDATE_INFO }],
    });
    await expect(AsyncStorage.getItem('@sesly/appConfig')).resolves.toBe(JSON.stringify(UPDATE_CONFIG));
  });

  it('a stale stored update the backend no longer asks for resets to Main', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    mockApiGet.mockResolvedValue(FINE_CONFIG);
    await seed({ '@sesly/me': CACHED_USER, '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });
    focusedRoot('ForceUpdate');

    await store.start();
    expect(store.route?.name).toBe('ForceUpdate');
    await flush();

    expect(mockNav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Main' }] });
  });

  it('a lifted gate without a session goes to Login', async () => {
    mockApiGet.mockResolvedValue(FINE_CONFIG);
    await seed({ hasSeenOnboarding: 'true', '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });
    focusedRoot('ForceUpdate');

    await store.start();
    await flush();

    expect(mockNav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Login' }] });
  });

  it('a failed refresh keeps the stored gate', async () => {
    mockApiGet.mockRejectedValue(apiErrorFromResponse(undefined, null));
    await seed({ '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });
    focusedRoot('ForceUpdate');

    await store.start();
    await flush();

    expect(mockNav.reset).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem('@sesly/appConfig')).resolves.toBe(JSON.stringify(UPDATE_CONFIG));
  });

  it('does nothing when the app already is where the refresh says', async () => {
    mockApiGet.mockResolvedValue(UPDATE_CONFIG);
    await seed({ '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });
    focusedRoot('ForceUpdate', UPDATE_INFO);

    await store.start();
    await flush();

    expect(mockNav.reset).not.toHaveBeenCalled();
  });

  it('a newer sentence or store link replaces the gate on screen', async () => {
    const newer = { ...UPDATE_CONFIG, updateMessage: 'Sesly 1.2 hazır, güncelle.' };
    mockApiGet.mockResolvedValue(newer);
    await seed({ '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });
    focusedRoot('ForceUpdate', UPDATE_INFO);

    await store.start();
    await flush();

    expect(mockNav.reset).toHaveBeenCalledTimes(1);
    expect(mockNav.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'ForceUpdate', params: { message: newer.updateMessage, storeUrl: UPDATE_INFO.storeUrl } }],
    });
  });

  it('a lifted gate reads the onboarding flag again (finished since the launch)', async () => {
    let answer!: (config: unknown) => void;
    mockApiGet.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = resolve;
        }),
    );
    // A first launch whose stored config asks for an update.
    await seed({ '@sesly/appConfig': JSON.stringify(UPDATE_CONFIG) });
    await store.start();
    expect(store.route?.name).toBe('ForceUpdate');

    await AsyncStorage.setItem('hasSeenOnboarding', 'true');
    focusedRoot('ForceUpdate', UPDATE_INFO);
    answer(FINE_CONFIG);
    await flush();

    expect(mockNav.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Login' }] });
  });

  it('before the navigator is ready the boot route itself changes', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    mockApiGet.mockResolvedValue(UPDATE_CONFIG);
    await seed({ '@sesly/me': CACHED_USER });

    await store.start();
    await flush();

    expect(mockNav.reset).not.toHaveBeenCalled();
    expect(store.route).toEqual({ name: 'ForceUpdate', params: UPDATE_INFO });

    // A navigator that was already mounting on Main is reset once ready.
    expect(mockNav.addListener).toHaveBeenCalledWith('ready', expect.any(Function));
    const onReady = listenerFor('ready');
    focusedRoot('Main');
    onReady();
    expect(mockNav.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'ForceUpdate', params: UPDATE_INFO }],
    });
  });

  it('uses the Play listing when the backend sends no Android link', async () => {
    mockApiGet.mockResolvedValue({ ...UPDATE_CONFIG, storeUrl: {} });
    focusedRoot('Login');
    await seed({ hasSeenOnboarding: 'true' });

    await store.start();
    await flush();

    expect(mockNav.reset).toHaveBeenCalledWith({
      index: 0,
      routes: [
        { name: 'ForceUpdate', params: { message: UPDATE_INFO.message, storeUrl: FALLBACK_ANDROID_STORE_URL } },
      ],
    });
  });

  it('fetches again on app foreground once the last success is 6 h old', async () => {
    mockApiGet.mockResolvedValue(FINE_CONFIG);
    await seed({ hasSeenOnboarding: 'true' });
    await store.start();
    await flush();
    expect(mockApiGet).toHaveBeenCalledTimes(1);

    const foreground = () => appStateListeners.forEach(listener => listener('active'));

    jest.setSystemTime(Date.now() + APP_CONFIG_STALE_MS - 1000);
    foreground();
    await flush();
    expect(mockApiGet).toHaveBeenCalledTimes(1);

    jest.setSystemTime(Date.now() + 1000);
    appStateListeners.forEach(listener => listener('background'));
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    foreground();
    await flush();
    expect(mockApiGet).toHaveBeenCalledTimes(2);
  });

  it('keeps one refresh in flight', async () => {
    let answer!: (config: unknown) => void;
    mockApiGet.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = resolve;
        }),
    );
    await seed({ hasSeenOnboarding: 'true' });
    await store.start();

    const again = store.refreshConfig();
    expect(mockApiGet).toHaveBeenCalledTimes(1);
    answer(FINE_CONFIG);
    await again;
  });
});
