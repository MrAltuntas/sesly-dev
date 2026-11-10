/**
 * AuthStore (src/hooks/useAuth.ts) unit tests.
 *
 * Every service the store talks to is mocked; AsyncStorage is the global
 * in-memory mock, so the cached user (@sesly/me) and the cache owner
 * (@sesly/lastUserId) behave for real. session.ts is the real module (end
 * handlers registered here observe the sign-out order). The global
 * '@react-native-firebase/auth' mock has no `getAuth`, so it is overridden
 * here with a modular-style mock; connectivity is a hand-driven fake.
 */

const mockOnSessionExpired = jest.fn();
const mockHasValidTokens = jest.fn();
const mockClearTokens = jest.fn();
const mockAuthInitialize = jest.fn();
const mockRestoreSession = jest.fn();
const mockGetCurrentFirebaseUser = jest.fn();
const mockSignInWithGoogle = jest.fn();
const mockSignInWithApple = jest.fn();
const mockLoginWithEmail = jest.fn();
const mockRegisterWithEmail = jest.fn();
const mockSendPasswordResetEmail = jest.fn();
const mockLogout = jest.fn();
const mockSignOutFirebase = jest.fn();
const mockFinishSignOut = jest.fn();
const mockGetAccessToken = jest.fn();
const mockGetRefreshToken = jest.fn();
const mockWsConnect = jest.fn();
const mockWsDisconnect = jest.fn();
const mockUnregisterDevice = jest.fn();
const mockClearAllCache = jest.fn();
const mockClearAudioCache = jest.fn();
const mockPrefsWarmup = jest.fn();
const mockPrefsClear = jest.fn();
const mockOnAuthStateChanged = jest.fn();
const mockGetAuth = jest.fn();

const mockReconnectListeners = new Set<() => void>();
const mockConnectivity = {
  offline: false,
  onReconnect: (listener: () => void) => {
    mockReconnectListeners.add(listener);
    return () => {
      mockReconnectListeners.delete(listener);
    };
  },
};

jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  default: jest.fn(),
  getAuth: (...a: unknown[]) => mockGetAuth(...a),
}));
jest.mock('../services/AuthService', () => ({
  __esModule: true,
  default: {
    initialize: (...a: unknown[]) => mockAuthInitialize(...a),
    restoreSession: (...a: unknown[]) => mockRestoreSession(...a),
    getCurrentFirebaseUser: (...a: unknown[]) => mockGetCurrentFirebaseUser(...a),
    signInWithGoogle: (...a: unknown[]) => mockSignInWithGoogle(...a),
    signInWithApple: (...a: unknown[]) => mockSignInWithApple(...a),
    loginWithEmail: (...a: unknown[]) => mockLoginWithEmail(...a),
    registerWithEmail: (...a: unknown[]) => mockRegisterWithEmail(...a),
    sendPasswordResetEmail: (...a: unknown[]) => mockSendPasswordResetEmail(...a),
    logout: (...a: unknown[]) => mockLogout(...a),
    signOutFirebase: (...a: unknown[]) => mockSignOutFirebase(...a),
    finishSignOut: (...a: unknown[]) => mockFinishSignOut(...a),
  },
}));
jest.mock('../services/ApiClient', () => ({
  __esModule: true,
  default: {
    onSessionExpired: (...a: unknown[]) => mockOnSessionExpired(...a),
    hasValidTokens: (...a: unknown[]) => mockHasValidTokens(...a),
    clearTokens: (...a: unknown[]) => mockClearTokens(...a),
    getAccessToken: (...a: unknown[]) => mockGetAccessToken(...a),
    getRefreshToken: (...a: unknown[]) => mockGetRefreshToken(...a),
  },
}));
jest.mock('../services/WebSocketService', () => ({
  __esModule: true,
  default: {
    connect: (...a: unknown[]) => mockWsConnect(...a),
    disconnect: (...a: unknown[]) => mockWsDisconnect(...a),
  },
}));
jest.mock('../services/PushNotificationService', () => ({
  __esModule: true,
  default: {
    unregisterDevice: (...a: unknown[]) => mockUnregisterDevice(...a),
  },
}));
jest.mock('../services/CacheService', () => ({
  __esModule: true,
  default: {
    clearAllCache: (...a: unknown[]) => mockClearAllCache(...a),
    clearAudioCache: (...a: unknown[]) => mockClearAudioCache(...a),
  },
}));
jest.mock('../services/UserPreferencesService', () => {
  const service = {
    warmup: (...a: unknown[]) => mockPrefsWarmup(...a),
    clear: (...a: unknown[]) => mockPrefsClear(...a),
  };
  return { __esModule: true, default: service, userPreferencesService: service };
});
jest.mock('../stores/ConnectivityStore', () => ({
  __esModule: true,
  get connectivityStore() {
    return mockConnectivity;
  },
  getConnectivityStore: () => mockConnectivity,
}));
jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

import { renderHook } from '@testing-library/react-native';
import { reaction } from 'mobx';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AUTO_RESTORE_RETRY_INTERVAL_MS,
  AuthStore,
  getAuthStore,
  useAuth,
} from './useAuth';
import { ApiError, apiErrorFromResponse } from '../services/ApiError';
import {
  AuthCancelledError,
  AuthFieldError,
  EmailInUseError,
  EMAIL_IN_USE_DIALOG,
} from '../services/authErrors';
import { parseUserFromJSON, userToJSON, type User } from '../models/User';
import { ERROR_MESSAGES } from '../config/constants';
import { showToast } from '../utils/toast';
import { mockUserJSON } from '../test-utils/mock-data';
import {
  getSessionUserId,
  registerSessionEndHandler,
  resetSessionForTests,
} from '../stores/session';
import { CACHED_USER_STORAGE_KEY } from '../session/userCache';
import { LAST_USER_ID_STORAGE_KEY } from '../session/cacheOwner';

const backendUser: User = parseUserFromJSON(mockUserJSON);
const freshUser: User = parseUserFromJSON({
  ...mockUserJSON,
  firstName: 'Johnny',
  subscriptionTier: 'PRO',
});
const otherUser: User = parseUserFromJSON({
  ...mockUserJSON,
  id: 'user-456',
  email: 'other@test.sesly.io',
});
const firebaseUser = { uid: 'fb-uid-1', email: 'user@test.sesly.io' } as never;
const authResponse = { user: backendUser, accessToken: 'jwt-a', refreshToken: 'jwt-r' };

const toastError = showToast.error as jest.Mock;
const toastSuccess = showToast.success as jest.Mock;

const cachedRaw = (user: User = backendUser) =>
  JSON.stringify({ v: 1, user: userToJSON(user) });
const withCache = (user: User = backendUser) => ({
  hasTokens: true,
  cachedUserRaw: cachedRaw(user),
});
const tokensOnly = { hasTokens: true, cachedUserRaw: null };
const signedOutSnap = { hasTokens: false, cachedUserRaw: null };

// Let queued promise callbacks (fire-and-forget work, AsyncStorage) run.
const flush = async () => {
  for (let i = 0; i < 30; i++) {
    await Promise.resolve();
  }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Latest listener AuthStore registered through ApiClient.onSessionExpired. */
function sessionExpiredListener(): () => void {
  const calls = mockOnSessionExpired.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0] as () => void;
}

function signedInStore(): AuthStore {
  const store = new AuthStore();
  store.user = firebaseUser;
  store.backendUser = backendUser;
  return store;
}

function reconnect(): void {
  [...mockReconnectListeners].forEach(listener => listener());
}

let appStateListeners: Array<(state: string) => void> = [];
function foreground(): void {
  [...appStateListeners].forEach(listener => listener('active'));
}

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  resetSessionForTests();
  await AsyncStorage.clear();
  mockReconnectListeners.clear();
  mockConnectivity.offline = false;
  appStateListeners = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: string) => void,
  ) => {
    appStateListeners.push(listener);
    return {
      remove: () => {
        appStateListeners = appStateListeners.filter(l => l !== listener);
      },
    };
  }) as never);

  mockOnSessionExpired.mockReset().mockReturnValue(jest.fn());
  mockHasValidTokens.mockReset().mockResolvedValue(false);
  mockClearTokens.mockReset().mockResolvedValue(undefined);
  mockAuthInitialize.mockReset().mockResolvedValue(undefined);
  mockRestoreSession.mockReset().mockResolvedValue({ status: 'none' });
  mockGetCurrentFirebaseUser.mockReset().mockReturnValue(null);
  mockSignInWithGoogle.mockReset().mockResolvedValue(authResponse);
  mockSignInWithApple.mockReset().mockResolvedValue(authResponse);
  mockLoginWithEmail.mockReset().mockResolvedValue(authResponse);
  mockRegisterWithEmail.mockReset().mockResolvedValue(authResponse);
  mockSendPasswordResetEmail.mockReset().mockResolvedValue(undefined);
  mockLogout.mockReset().mockResolvedValue(undefined);
  mockSignOutFirebase.mockReset().mockResolvedValue(undefined);
  mockFinishSignOut.mockReset().mockResolvedValue(undefined);
  mockGetAccessToken.mockReset().mockResolvedValue('jwt-a');
  mockGetRefreshToken.mockReset().mockResolvedValue('jwt-r');
  mockWsConnect.mockReset().mockResolvedValue(undefined);
  mockWsDisconnect.mockReset();
  mockUnregisterDevice.mockReset().mockResolvedValue(undefined);
  mockClearAllCache.mockReset().mockResolvedValue(undefined);
  mockClearAudioCache.mockReset().mockResolvedValue(undefined);
  mockPrefsWarmup.mockReset().mockResolvedValue(undefined);
  mockPrefsClear.mockReset().mockResolvedValue(undefined);
  mockOnAuthStateChanged.mockReset().mockReturnValue(jest.fn());
  mockGetAuth.mockReset().mockReturnValue({
    onAuthStateChanged: mockOnAuthStateChanged,
    currentUser: null,
  });
});

// ============================================================================
// Constructor + getters
// ============================================================================

describe('AuthStore constructor and getters', () => {
  it('subscribes to ApiClient.onSessionExpired exactly once', () => {
    new AuthStore();
    expect(mockOnSessionExpired).toHaveBeenCalledTimes(1);
    expect(typeof mockOnSessionExpired.mock.calls[0][0]).toBe('function');
  });

  it('starts signed out with a clean state, the restore pending', () => {
    const store = new AuthStore();
    expect(store.user).toBeNull();
    expect(store.backendUser).toBeNull();
    expect(store.errorMessage).toBe('');
    expect(store.errorField).toBeNull();
    expect(store.isInitialized).toBe(false);
    expect(store.restoreOutcome).toBe('pending');
    expect(store.sessionStale).toBe(false);
    expect(store.isSigningOut).toBe(false);
    expect(store.isSignedIn).toBe(false);
    expect(store.isAuthenticated).toBe(false);
  });

  it('isSignedIn follows the Firebase user only', () => {
    const store = new AuthStore();
    store.backendUser = backendUser;
    expect(store.isSignedIn).toBe(false);
    store.user = firebaseUser;
    expect(store.isSignedIn).toBe(true);
  });

  it('isAuthenticated is true with either the Firebase or the backend user', () => {
    const store = new AuthStore();
    store.backendUser = backendUser;
    expect(store.isAuthenticated).toBe(true);
    store.backendUser = null;
    store.user = firebaseUser;
    expect(store.isAuthenticated).toBe(true);
    store.user = null;
    expect(store.isAuthenticated).toBe(false);
  });
});

// ============================================================================
// initialize: cached user
// ============================================================================

describe('AuthStore.initialize with tokens and a cached user', () => {
  it('sets backendUser before the restore resolves and is initialized without the network', async () => {
    const restore = deferred<unknown>();
    mockRestoreSession.mockReturnValue(restore.promise);
    const store = new AuthStore();

    const pending = store.initialize(withCache());

    // Synchronous: the first Main render already has the user.
    expect(store.backendUser).toEqual(backendUser);
    expect(store.sessionStale).toBe(true);
    expect(getSessionUserId()).toBe(backendUser.id);

    await pending;
    expect(store.isInitialized).toBe(true);
    expect(store.restoreOutcome).toBe('pending');
    expect(mockRestoreSession).toHaveBeenCalledTimes(1);

    restore.resolve({ status: 'restored', user: freshUser });
    await flush();

    expect(store.backendUser).toEqual(freshUser);
    expect(store.sessionStale).toBe(false);
    expect(store.restoreOutcome).toBe('restored');
    const raw = await AsyncStorage.getItem(CACHED_USER_STORAGE_KEY);
    expect(JSON.parse(raw as string).user.firstName).toBe('Johnny');
  });

  it('does not touch Firebase before AuthService.initialize', async () => {
    const order: string[] = [];
    mockAuthInitialize.mockImplementation(async () => {
      order.push('auth.initialize');
    });
    mockGetCurrentFirebaseUser.mockImplementation(() => {
      order.push('firebase.currentUser');
      return firebaseUser;
    });
    mockGetAuth.mockImplementation(() => {
      order.push('firebase.getAuth');
      return { onAuthStateChanged: mockOnAuthStateChanged, currentUser: null };
    });
    mockRestoreSession.mockResolvedValue({ status: 'restored', user: backendUser });
    const store = new AuthStore();

    await store.initialize(withCache());
    await flush();

    expect(order[0]).toBe('auth.initialize');
    expect(order).toContain('firebase.getAuth');
    expect(order).toContain('firebase.currentUser');
    expect(store.user).toEqual(firebaseUser);
  });

  it('starts the socket and the warmups once for the cached and the live copy of one user', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'restored', user: freshUser });
    const store = new AuthStore();

    await store.initialize(withCache());
    await flush();

    expect(mockWsConnect).toHaveBeenCalledTimes(1);
    expect(mockPrefsWarmup).toHaveBeenCalledTimes(1);
  });


  it('a background restore rejected with 401 runs handleSessionExpired once, removes @sesly/me and clears tokens', async () => {
    await AsyncStorage.setItem(CACHED_USER_STORAGE_KEY, cachedRaw());
    const restore = deferred<unknown>();
    mockRestoreSession.mockReturnValue(restore.promise);
    const store = new AuthStore();
    await store.initialize(withCache());

    // The 401 also made ApiClient's refresh fail and fire its listener.
    sessionExpiredListener()();
    restore.resolve({ status: 'rejected' });
    await flush();

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockWsDisconnect).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(ERROR_MESSAGES.SESSION_EXPIRED, 'Oturum sona erdi');
    expect(mockClearTokens).toHaveBeenCalled();
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
    expect(store.backendUser).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.restoreOutcome).toBe('rejected');
    expect(store.sessionStale).toBe(false);
    expect(getSessionUserId()).toBeNull();
  });

  it('offline keeps the cached user (stale) and the tokens; a reconnect re-runs the restore once', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'offline' });
    const store = new AuthStore();

    await store.initialize(withCache());
    await flush();

    expect(store.backendUser).toEqual(backendUser);
    expect(store.sessionStale).toBe(true);
    expect(store.restoreOutcome).toBe('offline');
    expect(mockClearTokens).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(mockRestoreSession).toHaveBeenCalledTimes(1);

    mockRestoreSession.mockResolvedValue({ status: 'restored', user: freshUser });
    reconnect();
    reconnect();
    await flush();

    expect(mockRestoreSession).toHaveBeenCalledTimes(2);
    expect(store.backendUser).toEqual(freshUser);
    expect(store.sessionStale).toBe(false);
    expect(store.restoreOutcome).toBe('restored');

    // Restored: the retry listeners are gone.
    reconnect();
    foreground();
    await flush();
    expect(mockRestoreSession).toHaveBeenCalledTimes(2);
    expect(mockReconnectListeners.size).toBe(0);
    expect(appStateListeners).toHaveLength(0);
  });

  it('automatic retries run at most once per 30 s', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'server' });
    const store = new AuthStore();
    await store.initialize(withCache());
    await flush();

    reconnect();
    await flush();
    expect(mockRestoreSession).toHaveBeenCalledTimes(2);

    reconnect();
    foreground();
    await flush();
    expect(mockRestoreSession).toHaveBeenCalledTimes(2);

    jest.advanceTimersByTime(AUTO_RESTORE_RETRY_INTERVAL_MS);
    foreground();
    await flush();
    expect(mockRestoreSession).toHaveBeenCalledTimes(3);
    expect(store.restoreOutcome).toBe('server');
    expect(store.backendUser).toEqual(backendUser);
  });

  it('coming to the foreground retries, unless the device is still offline', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'maintenance' });
    const store = new AuthStore();
    await store.initialize(withCache());
    await flush();

    mockConnectivity.offline = true;
    foreground();
    await flush();
    expect(mockRestoreSession).toHaveBeenCalledTimes(1);

    mockConnectivity.offline = false;
    foreground();
    await flush();
    expect(mockRestoreSession).toHaveBeenCalledTimes(2);
    expect(store.restoreOutcome).toBe('maintenance');
  });

  it('a malformed cached user counts as no cache: the restore is awaited and the key removed', async () => {
    const restore = deferred<unknown>();
    mockRestoreSession.mockReturnValue(restore.promise);
    const store = new AuthStore();

    const pending = store.initialize({ hasTokens: true, cachedUserRaw: '{broken' });
    expect(store.backendUser).toBeNull();
    await flush();
    expect(store.isInitialized).toBe(false);

    restore.resolve({ status: 'restored', user: backendUser });
    await pending;

    expect(store.isInitialized).toBe(true);
    expect(store.backendUser).toEqual(backendUser);
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(CACHED_USER_STORAGE_KEY);
  });

  it('a cached user without tokens is dropped, never shown', async () => {
    await AsyncStorage.setItem(CACHED_USER_STORAGE_KEY, cachedRaw());
    const store = new AuthStore();

    await store.initialize({ hasTokens: false, cachedUserRaw: cachedRaw() });
    await flush();

    expect(store.backendUser).toBeNull();
    expect(store.restoreOutcome).toBe('none');
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
  });
});

// ============================================================================
// initialize: other paths
// ============================================================================

describe('AuthStore.initialize', () => {
  it('tokens without a cached user: awaits the restore, then applies the live user', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'restored', user: backendUser });
    mockGetCurrentFirebaseUser.mockReturnValue(firebaseUser);
    const store = new AuthStore();

    await store.initialize(tokensOnly);

    expect(store.restoreOutcome).toBe('restored');
    expect(store.backendUser).toEqual(backendUser);
    expect(store.user).toEqual(firebaseUser);
    expect(store.sessionStale).toBe(false);
    expect(store.isInitialized).toBe(true);
    await flush();
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.not.toBeNull();
    expect(mockWsConnect).toHaveBeenCalledTimes(1);
  });

  it.each(['offline', 'server', 'maintenance'] as const)(
    'tokens without a cached user, restore %s: no user, tokens kept, no toast',
    async outcome => {
      mockRestoreSession.mockResolvedValue({ status: outcome });
      const store = new AuthStore();

      await store.initialize(tokensOnly);

      expect(store.restoreOutcome).toBe(outcome);
      expect(store.backendUser).toBeNull();
      expect(store.isInitialized).toBe(true);
      expect(mockClearTokens).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    },
  );

  it('tokens without a cached user, restore rejected: outcome rejected without an expiry toast', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'rejected' });
    const store = new AuthStore();

    await store.initialize(tokensOnly);

    expect(store.restoreOutcome).toBe('rejected');
    expect(store.backendUser).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('no tokens: outcome none, no restore request, no socket or warmups', async () => {
    const store = new AuthStore();

    await store.initialize(signedOutSnap);
    await flush();

    expect(mockRestoreSession).not.toHaveBeenCalled();
    expect(store.restoreOutcome).toBe('none');
    expect(store.backendUser).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(mockWsConnect).not.toHaveBeenCalled();
    expect(mockPrefsWarmup).not.toHaveBeenCalled();
    expect(store.isInitialized).toBe(true);
  });

  it('keeps a lingering Firebase user when there is no backend session', async () => {
    mockGetCurrentFirebaseUser.mockReturnValue(firebaseUser);
    const store = new AuthStore();

    await store.initialize(signedOutSnap);

    expect(store.backendUser).toBeNull();
    expect(store.user).toEqual(firebaseUser);
    expect(store.isSignedIn).toBe(true);
  });

  it('mirrors Firebase auth state changes onto store.user', async () => {
    const store = new AuthStore();
    await store.initialize(signedOutSnap);

    const listener = mockOnAuthStateChanged.mock.calls[0][0] as (u: unknown) => void;
    listener(firebaseUser);
    expect(store.user).toEqual(firebaseUser);
    listener(null);
    expect(store.user).toBeNull();
  });

  it('AuthService.initialize throwing still sets isInitialized and restoreOutcome, with no toast', async () => {
    mockAuthInitialize.mockRejectedValue(new Error('firebase not configured'));
    const signedOut = new AuthStore();

    await expect(signedOut.initialize(signedOutSnap)).resolves.toBeUndefined();

    expect(signedOut.isInitialized).toBe(true);
    expect(signedOut.restoreOutcome).toBe('none');
    expect(toastError).not.toHaveBeenCalled();

    // With tokens the backend session still restores without Firebase.
    mockRestoreSession.mockResolvedValue({ status: 'restored', user: backendUser });
    const withTokens = new AuthStore();
    await withTokens.initialize(tokensOnly);

    expect(withTokens.isInitialized).toBe(true);
    expect(withTokens.restoreOutcome).toBe('restored');
    expect(withTokens.backendUser).toEqual(backendUser);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a Firebase failure while subscribing is logged, never thrown', async () => {
    mockGetAuth.mockImplementation(() => {
      throw new Error('No Firebase App');
    });
    mockGetCurrentFirebaseUser.mockImplementation(() => {
      throw new Error('No Firebase App');
    });
    const store = new AuthStore();

    await store.initialize(signedOutSnap);

    expect(store.isInitialized).toBe(true);
    expect(store.restoreOutcome).toBe('none');
    expect(store.user).toBeNull();
  });

  it('a restore that throws (it never should) keeps the session as server', async () => {
    mockRestoreSession.mockRejectedValue(new TypeError('boom'));
    const store = new AuthStore();

    await store.initialize(withCache());
    await flush();

    expect(store.restoreOutcome).toBe('server');
    expect(store.backendUser).toEqual(backendUser);
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it('later calls share the first run', async () => {
    const store = new AuthStore();

    const first = store.initialize(signedOutSnap);
    const second = store.initialize(withCache());
    await Promise.all([first, second]);

    expect(second).toBe(first);
    expect(mockAuthInitialize).toHaveBeenCalledTimes(1);
    expect(mockOnAuthStateChanged).toHaveBeenCalledTimes(1);
    expect(store.backendUser).toBeNull();
  });

  it('without a snapshot it reads the tokens and the cached user itself', async () => {
    mockHasValidTokens.mockResolvedValue(true);
    await AsyncStorage.setItem(CACHED_USER_STORAGE_KEY, cachedRaw());
    mockRestoreSession.mockResolvedValue({ status: 'offline' });
    const store = new AuthStore();

    await store.initialize();
    await flush();

    expect(mockHasValidTokens).toHaveBeenCalledTimes(1);
    expect(store.backendUser).toEqual(backendUser);
    expect(store.sessionStale).toBe(true);
  });

  it('swallows socket and warmup failures', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'restored', user: backendUser });
    mockWsConnect.mockRejectedValue(new Error('socket down'));
    mockPrefsWarmup.mockRejectedValue(new Error('prefs offline'));
    const store = new AuthStore();

    await store.initialize(tokensOnly);
    await flush();

    expect(store.isInitialized).toBe(true);
    expect(store.errorMessage).toBe('');
    expect(toastError).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith('Preference warmup failed:', expect.any(Error));
  });
});

// ============================================================================
// revalidate / retryRestore
// ============================================================================

describe('AuthStore.retryRestore', () => {
  it('runs a live check and resolves to its outcome', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'offline' });
    const store = new AuthStore();
    await store.initialize(tokensOnly);

    mockRestoreSession.mockResolvedValue({ status: 'restored', user: backendUser });
    await expect(store.retryRestore()).resolves.toBe('restored');
    expect(store.backendUser).toEqual(backendUser);

    mockRestoreSession.mockResolvedValue({ status: 'none' });
    await expect(new AuthStore().retryRestore()).resolves.toBe('none');
  });

  it('concurrent checks share one request', async () => {
    const restore = deferred<unknown>();
    mockRestoreSession.mockReturnValue(restore.promise);
    const store = new AuthStore();

    const a = store.retryRestore();
    const b = store.revalidate();
    restore.resolve({ status: 'server' });

    await expect(Promise.all([a, b])).resolves.toEqual(['server', 'server']);
    expect(mockRestoreSession).toHaveBeenCalledTimes(1);
  });

  it('an answer that lands after a sign-out does not sign the user back in', async () => {
    const restore = deferred<unknown>();
    mockRestoreSession.mockReturnValue(restore.promise);
    const store = new AuthStore();
    await store.initialize(withCache());

    await store.signOut();
    restore.resolve({ status: 'restored', user: backendUser });
    await flush();

    expect(store.backendUser).toBeNull();
    expect(store.restoreOutcome).toBe('none');
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
  });

  it('none while a cached user is shown (tokens vanished) ends the session', async () => {
    const restore = deferred<unknown>();
    mockRestoreSession.mockReturnValue(restore.promise);
    const store = new AuthStore();
    await store.initialize(withCache());

    restore.resolve({ status: 'none' });
    await flush();

    expect(store.backendUser).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// Sign-in flows
// ============================================================================

type SignInCase = {
  name: string;
  mock: jest.Mock;
  run: (store: AuthStore) => Promise<boolean>;
};

const signInCases: SignInCase[] = [
  { name: 'signInWithGoogle', mock: mockSignInWithGoogle, run: s => s.signInWithGoogle() },
  { name: 'signInWithApple', mock: mockSignInWithApple, run: s => s.signInWithApple() },
  {
    name: 'signInWithEmail',
    mock: mockLoginWithEmail,
    run: s => s.signInWithEmail('user@test.sesly.io', 'secret-pass'),
  },
  {
    name: 'registerWithEmail',
    mock: mockRegisterWithEmail,
    run: s => s.registerWithEmail('user@test.sesly.io', 'secret-pass', 'Ada', 'Yilmaz'),
  },
];

describe.each(signInCases)('AuthStore.$name', ({ mock, run }) => {
  it('on success sets backendUser, caches it, connects the socket, warms up and returns true', async () => {
    const store = new AuthStore();
    store.errorMessage = 'previous failure';
    store.errorField = 'password';

    const ok = await run(store);
    await flush();

    expect(ok).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(store.backendUser).toEqual(backendUser);
    expect(store.isAuthenticated).toBe(true);
    expect(store.restoreOutcome).toBe('restored');
    expect(store.errorMessage).toBe('');
    expect(store.errorField).toBeNull();
    expect(getSessionUserId()).toBe(backendUser.id);
    expect(mockWsConnect).toHaveBeenCalledTimes(1);
    expect(mockPrefsWarmup).toHaveBeenCalledTimes(1);
    expect(mockClearAllCache).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBe(cachedRaw());
  });

  it('the same user id as last time does not clear the audio cache', async () => {
    await AsyncStorage.setItem(LAST_USER_ID_STORAGE_KEY, backendUser.id);

    await run(new AuthStore());
    await flush();

    expect(mockClearAudioCache).not.toHaveBeenCalled();
  });

  it('a different user id clears the audio cache, and sign-in resolves before it settles', async () => {
    await AsyncStorage.setItem(LAST_USER_ID_STORAGE_KEY, otherUser.id);
    const clear = deferred<void>();
    mockClearAudioCache.mockReturnValue(clear.promise);
    let settled = false;
    void clear.promise.then(() => {
      settled = true;
    });

    const ok = await run(new AuthStore());
    await flush();

    expect(ok).toBe(true);
    expect(mockClearAudioCache).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await expect(AsyncStorage.getItem(LAST_USER_ID_STORAGE_KEY)).resolves.toBe(backendUser.id);
    clear.resolve();
  });

  it('does not wait for the socket', async () => {
    mockWsConnect.mockReturnValue(new Promise(() => undefined));

    await expect(run(new AuthStore())).resolves.toBe(true);
  });

  it('a new attempt starts without the error of the previous one', async () => {
    mock.mockRejectedValueOnce(apiErrorFromResponse(401, { message: 'Geçersiz kimlik bilgileri' }));
    const store = new AuthStore();
    await run(store);
    expect(store.errorMessage).toBe('Geçersiz kimlik bilgileri');

    let release: (v: unknown) => void = () => {};
    mock.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      }),
    );
    const pending = run(store);
    // Cleared while the request is in flight, not only once it succeeds.
    expect(store.errorMessage).toBe('');
    expect(store.errorField).toBeNull();
    expect('isLoading' in store).toBe(false);
    release(authResponse);
    await expect(pending).resolves.toBe(true);
  });

  it('on failure returns false and leaves the user signed out', async () => {
    mock.mockRejectedValue(apiErrorFromResponse(401, { message: 'Geçersiz kimlik bilgileri' }));
    const store = new AuthStore();

    const ok = await run(store);

    expect(ok).toBe(false);
    expect(store.errorMessage).toBe('Geçersiz kimlik bilgileri');
    expect(store.errorField).toBeNull();
    expect(store.backendUser).toBeNull();
    expect(mockWsConnect).not.toHaveBeenCalled();
    expect(mockPrefsWarmup).not.toHaveBeenCalled();
    expect(getSessionUserId()).toBeNull();
  });
});

describe('AuthStore e-mail flows report on the form, never as a toast', () => {
  it.each([
    ['email', new AuthFieldError('Geçersiz e-posta adresi', 'email')],
    ['password', new AuthFieldError('Hatalı şifre', 'password')],
    [null, new AuthFieldError('Çok fazla deneme yapıldı.', null)],
  ] as const)('a failed signInWithEmail sets errorField %p and calls no showToast', async (field, error) => {
    mockLoginWithEmail.mockRejectedValue(error);
    const store = new AuthStore();

    const ok = await store.signInWithEmail('a@b.co', 'wrong');

    expect(ok).toBe(false);
    expect(store.errorField).toBe(field);
    expect(store.errorMessage).toBe(error.message);
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('an ApiError goes into the form-level line with its message', async () => {
    mockLoginWithEmail.mockRejectedValue(
      apiErrorFromResponse(403, { message: 'Hesabınız askıya alındı' }),
    );
    const store = new AuthStore();

    await store.signInWithEmail('a@b.co', 'x');

    expect(store.errorField).toBeNull();
    expect(store.errorMessage).toBe('Hesabınız askıya alındı');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a non-Error rejection gets the generic copy', async () => {
    mockLoginWithEmail.mockRejectedValue('weird');
    const store = new AuthStore();

    await store.signInWithEmail('a@b.co', 'x');

    expect(store.errorMessage).toBe('Bir hata oluştu');
    expect(store.errorField).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('registerWithEmail: a field error, no toast and no success toast', async () => {
    mockRegisterWithEmail.mockRejectedValue(
      new AuthFieldError('Şifre çok zayıf (minimum 6 karakter)', 'password'),
    );
    const store = new AuthStore();

    const ok = await store.registerWithEmail('a@b.co', 'x');

    expect(ok).toBe(false);
    expect(store.errorField).toBe('password');
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('registerWithEmail: forwards names and shows the success toast', async () => {
    const ok = await new AuthStore().registerWithEmail(
      'user@test.sesly.io',
      'secret-pass',
      'Ada',
      'Yilmaz',
    );

    expect(ok).toBe(true);
    expect(mockRegisterWithEmail).toHaveBeenCalledWith({
      email: 'user@test.sesly.io',
      password: 'secret-pass',
      firstName: 'Ada',
      lastName: 'Yilmaz',
    });
    expect(toastSuccess).toHaveBeenCalledWith('Hesap oluşturuldu', 'Başarılı');
  });

  it('registerWithEmail: the one name field of Registration goes as the first name, no last name', async () => {
    const ok = await new AuthStore().registerWithEmail('user@test.sesly.io', 'secret-pass', 'Ada');

    expect(ok).toBe(true);
    expect(mockRegisterWithEmail).toHaveBeenCalledWith({
      email: 'user@test.sesly.io',
      password: 'secret-pass',
      firstName: 'Ada',
      lastName: undefined,
    });
  });

  it('signInWithEmail forwards the credentials', async () => {
    await new AuthStore().signInWithEmail('user@test.sesly.io', 'secret-pass');
    expect(mockLoginWithEmail).toHaveBeenCalledWith({
      email: 'user@test.sesly.io',
      password: 'secret-pass',
    });
  });
});

describe('AuthStore quiet sign-in outcomes', () => {
  it.each([
    ['Google', (s: AuthStore) => s.signInWithGoogle(), () => mockSignInWithGoogle],
    ['Apple', (s: AuthStore) => s.signInWithApple(), () => mockSignInWithApple],
  ])('%s: a closed picker returns false without an error', async (_l, run, mock) => {
    mock().mockRejectedValue(new AuthCancelledError('iptal edildi'));
    const store = new AuthStore();

    const ok = await run(store);

    expect(ok).toBe(false);
    expect(store.errorMessage).toBe('');
    expect(store.errorField).toBeNull();
    expect(store.authNotice).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each([
    ['Google', (s: AuthStore) => s.signInWithGoogle(), () => mockSignInWithGoogle],
    ['Apple', (s: AuthStore) => s.signInWithApple(), () => mockSignInWithApple],
    ['email', (s: AuthStore) => s.signInWithEmail('a@b.co', 'secret1'), () => mockLoginWithEmail],
    [
      'register',
      (s: AuthStore) => s.registerWithEmail('a@b.co', 'secret1', 'Ayşe', 'Yılmaz'),
      () => mockRegisterWithEmail,
    ],
  ])('%s: EMAIL_IN_USE sets the dialog notice instead of a toast', async (_l, run, mock) => {
    mock().mockRejectedValue(new EmailInUseError());
    const store = new AuthStore();

    const ok = await run(store);

    expect(ok).toBe(false);
    expect(store.authNotice).toEqual(EMAIL_IN_USE_DIALOG);
    // Empty so the screens do not also put it under a form field.
    expect(store.errorMessage).toBe('');
    expect(store.errorField).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
    expect(store.backendUser).toBeNull();

    store.clearAuthNotice();
    expect(store.authNotice).toBeNull();
  });
});

describe('AuthStore Google and Apple keep their toasts with msg() copy', () => {
  it('Google: a non-ApiError shows the generic Google copy, never the raw text', async () => {
    mockSignInWithGoogle.mockRejectedValue(new Error('DEVELOPER_ERROR'));
    const store = new AuthStore();

    const ok = await store.signInWithGoogle();

    expect(ok).toBe(false);
    expect(store.errorMessage).toBe('Google ile giriş başarısız');
    expect(store.errorField).toBeNull();
    expect(toastError).toHaveBeenCalledWith('Google ile giriş başarısız', 'Hata');
  });

  it('Google: an ApiError message is passed through to the toast', async () => {
    mockSignInWithGoogle.mockRejectedValue(
      apiErrorFromResponse(403, { message: 'Hesabınız askıya alındı' }),
    );

    await new AuthStore().signInWithGoogle();

    expect(toastError).toHaveBeenCalledWith('Hesabınız askıya alındı', 'Hata');
  });

  it('Google: a 5xx never leaks the English server text', async () => {
    mockSignInWithGoogle.mockRejectedValue(
      apiErrorFromResponse(500, { message: 'Internal server error' }),
    );
    const store = new AuthStore();

    await store.signInWithGoogle();

    expect(store.errorMessage).toBe(ERROR_MESSAGES.SERVER);
    expect(toastError).toHaveBeenCalledWith(ERROR_MESSAGES.SERVER, 'Hata');
  });

  it('Google: a mapped error (Play Services missing) keeps its own copy', async () => {
    mockSignInWithGoogle.mockRejectedValue(
      new AuthFieldError('Google Play Services mevcut değil', null),
    );
    const store = new AuthStore();

    await store.signInWithGoogle();

    expect(store.errorMessage).toBe('Google Play Services mevcut değil');
    expect(toastError).toHaveBeenCalledWith('Google Play Services mevcut değil', 'Hata');
  });

  it('Apple: a mapped auth error shows its copy with a Hata title', async () => {
    mockSignInWithApple.mockRejectedValue(new AuthFieldError('Apple kimlik bilgisi alınamadı'));

    const ok = await new AuthStore().signInWithApple();

    expect(ok).toBe(false);
    expect(toastError).toHaveBeenCalledWith('Apple kimlik bilgisi alınamadı', 'Hata');
  });

  it('Apple: anything else shows the generic Apple copy', async () => {
    mockSignInWithApple.mockRejectedValue(new Error('native developer text'));

    await new AuthStore().signInWithApple();

    expect(toastError).toHaveBeenCalledWith('Apple ile giriş başarısız', 'Hata');
  });
});

// ============================================================================
// resetPassword
// ============================================================================

describe('AuthStore.resetPassword', () => {
  it('sends the reset email and toasts the enumeration-safe success', async () => {
    const store = new AuthStore();

    const ok = await store.resetPassword('user@test.sesly.io');

    expect(ok).toBe(true);
    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith('user@test.sesly.io');
    expect(toastSuccess).toHaveBeenCalledWith(
      'Bu adresle bir hesap varsa şifre sıfırlama bağlantısını gönderdik. Gelen kutunu kontrol et.',
      'Başarılı',
    );
  });

  it('on failure returns false, sets the error and its field, and shows no toast', async () => {
    mockSendPasswordResetEmail.mockRejectedValue(
      new AuthFieldError('Geçersiz e-posta adresi', 'email'),
    );
    const store = new AuthStore();

    const ok = await store.resetPassword('nobody@test');

    expect(ok).toBe(false);
    expect(store.errorMessage).toBe('Geçersiz e-posta adresi');
    expect(store.errorField).toBe('email');
    expect(toastError).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('too many requests: the form-level line, no field, no toast', async () => {
    mockSendPasswordResetEmail.mockRejectedValue(
      new AuthFieldError('Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.', null),
    );
    const store = new AuthStore();

    await expect(store.resetPassword('user@test.sesly.io')).resolves.toBe(false);
    expect(store.errorMessage).toBe('Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.');
    expect(store.errorField).toBeNull();
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

// ============================================================================
// updateBackendUser
// ============================================================================

describe('AuthStore.updateBackendUser', () => {
  it('replaces the user and the cached copy', async () => {
    const store = signedInStore();

    store.updateBackendUser(freshUser);
    await flush();

    expect(store.backendUser).toEqual(freshUser);
    expect(getSessionUserId()).toBe(freshUser.id);
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBe(cachedRaw(freshUser));
  });

  it('ignores an answer about another user or after a sign-out', async () => {
    const store = signedInStore();
    store.updateBackendUser(otherUser);
    expect(store.backendUser).toEqual(backendUser);

    const signedOut = new AuthStore();
    signedOut.updateBackendUser(backendUser);
    await flush();
    expect(signedOut.backendUser).toBeNull();
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
  });
});

// ============================================================================
// signOut
// ============================================================================

describe('AuthStore.signOut', () => {
  it('runs the session end handlers before backendUser is null, and backendUser is null before the cache clears resolve', async () => {
    const order: string[] = [];
    const store = new AuthStore();
    await store.signInWithEmail('user@test.sesly.io', 'secret-pass');
    await flush();
    expect(getSessionUserId()).toBe(backendUser.id);

    mockUnregisterDevice.mockImplementation(async () => {
      order.push('push.unregister');
    });
    mockSignOutFirebase.mockImplementation(async () => {
      order.push('firebase.signOut');
    });
    mockFinishSignOut.mockImplementation(async () => {
      order.push('background.finish');
    });
    mockWsDisconnect.mockImplementation(() => {
      order.push('ws.disconnect');
    });
    registerSessionEndHandler(async () => {
      await Promise.resolve();
      order.push(`end-handler:user=${store.backendUser?.id ?? 'null'}`);
    });
    mockClearTokens.mockImplementation(async () => {
      order.push(`tokens.clear:user=${store.backendUser?.id ?? 'null'}`);
    });
    const cacheClear = deferred<void>();
    const prefsClear = deferred<void>();
    mockClearAllCache.mockImplementation(() => {
      order.push(`cache.clear:user=${store.backendUser?.id ?? 'null'}`);
      return cacheClear.promise;
    });
    mockPrefsClear.mockImplementation(() => {
      order.push('prefs.clear');
      return prefsClear.promise;
    });

    const ok = await store.signOut();

    expect(ok).toBe(true);
    expect(order).toEqual([
      'push.unregister',
      'firebase.signOut',
      'background.finish',
      'ws.disconnect',
      `end-handler:user=${backendUser.id}`,
      `tokens.clear:user=${backendUser.id}`,
      'cache.clear:user=null',
      'prefs.clear',
    ]);
    // signOut resolved while both clears are still pending.
    expect(store.user).toBeNull();
    expect(store.backendUser).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(store.restoreOutcome).toBe('none');
    expect(getSessionUserId()).toBeNull();
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
    // Still busy until the navigator has left Profile (SIGNOUT-IDLE-FLASH).
    expect(store.isSigningOut).toBe(true);
    expect(toastError).not.toHaveBeenCalled();

    cacheClear.resolve();
    prefsClear.resolve();
  });

  it('isSigningOut is true from the first moment and stays on after the session is dropped (SIGNOUT-IDLE-FLASH)', async () => {
    const seen: boolean[] = [];
    const store = signedInStore();
    registerSessionEndHandler(() => {
      seen.push(store.isSigningOut);
    });
    const busyWhenUserGoes: boolean[] = [];
    const stop = reaction(
      () => store.isAuthenticated,
      authenticated => {
        if (!authenticated) busyWhenUserGoes.push(store.isSigningOut);
      },
    );

    const pending = store.signOut();
    // Set before the first await: Profile shows it at once.
    expect(store.isSigningOut).toBe(true);
    await expect(pending).resolves.toBe(true);
    stop();

    expect(seen).toEqual([true]);
    // The navigator reacts to the user going; Profile is still busy then and after.
    expect(busyWhenUserGoes).toEqual([true]);
    expect(store.isSigningOut).toBe(true);
    await flush();
    expect(store.isSigningOut).toBe(true);
  });

  it('the next session turns isSigningOut off again', async () => {
    const store = new AuthStore();
    await store.signInWithEmail('user@test.sesly.io', 'secret-pass');
    await store.signOut();
    expect(store.isSigningOut).toBe(true);

    await store.signInWithEmail('user@test.sesly.io', 'secret-pass');

    expect(store.isAuthenticated).toBe(true);
    expect(store.isSigningOut).toBe(false);
  });

  it('the Firebase sign-out runs next to the end handlers, and both end before the tokens go', async () => {
    const store = signedInStore();
    const firebase = deferred<void>();
    const order: string[] = [];
    mockSignOutFirebase.mockImplementation(() => {
      order.push('firebase.start');
      return firebase.promise.then(() => {
        order.push('firebase.end');
      });
    });
    registerSessionEndHandler(() => {
      order.push('end-handler');
    });
    mockClearTokens.mockImplementation(async () => {
      order.push('tokens.clear');
    });

    const pending = store.signOut();
    await flush();
    // The handlers did not wait for the provider; the tokens do.
    expect(order).toEqual(['firebase.start', 'end-handler']);
    expect(store.backendUser).toEqual(backendUser);

    firebase.resolve();
    await expect(pending).resolves.toBe(true);
    expect(order).toEqual(['firebase.start', 'end-handler', 'firebase.end', 'tokens.clear']);
    expect(store.backendUser).toBeNull();
  });

  it('a session-expired signal during sign-out is ignored (no expiry toast)', async () => {
    const store = signedInStore();
    const listener = sessionExpiredListener();
    // Some other request 401s while the local teardown runs and its refresh fails.
    registerSessionEndHandler(() => {
      listener();
    });

    const ok = await store.signOut();
    await flush();

    expect(ok).toBe(true);
    expect(toastError).not.toHaveBeenCalled();
    // The expiry teardown (AuthService.logout, which clears tokens) never ran.
    expect(mockLogout).not.toHaveBeenCalled();
    expect(mockWsDisconnect).toHaveBeenCalledTimes(1);
  });

  describe('the network calls run in the background (LA-4)', () => {
    const never = () => new Promise<never>(() => undefined);

    it('with the unregister and the revoke never answering, the user is gone and the tokens are cleared at once', async () => {
      mockUnregisterDevice.mockImplementation(never);
      mockFinishSignOut.mockImplementation(never);
      const store = signedInStore();

      const pending = store.signOut();
      await flush();

      expect(store.user).toBeNull();
      expect(store.backendUser).toBeNull();
      expect(store.isAuthenticated).toBe(false);
      expect(mockClearTokens).toHaveBeenCalledTimes(1);
      await expect(pending).resolves.toBe(true);
      expect(toastError).not.toHaveBeenCalled();
    });

    it('the background calls get the tokens read before they were cleared', async () => {
      const store = signedInStore();

      await store.signOut();

      expect(mockUnregisterDevice).toHaveBeenCalledWith('jwt-a');
      expect(mockFinishSignOut).toHaveBeenCalledWith({
        refreshToken: 'jwt-r',
        after: expect.any(Promise),
      });
      // Read before anything was cleared, handed over before the clear.
      const readAt = mockGetRefreshToken.mock.invocationCallOrder[0];
      const clearedAt = mockClearTokens.mock.invocationCallOrder[0];
      expect(readAt).toBeLessThan(clearedAt);
      expect(mockFinishSignOut.mock.invocationCallOrder[0]).toBeLessThan(clearedAt);
      // The revoke waits for the unregister (it needs the access token the revoke invalidates).
      const { after } = mockFinishSignOut.mock.calls[0][0] as { after: Promise<unknown> };
      expect(after).toBe(mockUnregisterDevice.mock.results[0].value);
      // The Firebase sign-out is the one provider step awaited before the tokens go.
      expect(mockSignOutFirebase.mock.invocationCallOrder[0]).toBeLessThan(clearedAt);
      expect(mockLogout).not.toHaveBeenCalled();
    });

    it('a new sign-in during the background work keeps its tokens and its user', async () => {
      const unregister = deferred<void>();
      const finish = deferred<void>();
      mockUnregisterDevice.mockReturnValue(unregister.promise);
      mockFinishSignOut.mockReturnValue(finish.promise);
      const store = new AuthStore();
      await store.signInWithEmail('user@test.sesly.io', 'secret-pass');
      await store.signOut();
      expect(mockClearTokens).toHaveBeenCalledTimes(1);

      await store.signInWithEmail('other@test.sesly.io', 'secret-pass');
      unregister.resolve();
      finish.resolve();
      await flush();

      // Nothing of the old sign-out ran after the new session started.
      expect(mockClearTokens).toHaveBeenCalledTimes(1);
      expect(mockLogout).not.toHaveBeenCalled();
      expect(store.backendUser).toEqual(backendUser);
      expect(store.isAuthenticated).toBe(true);
      expect(store.restoreOutcome).toBe('restored');
      expect(toastError).not.toHaveBeenCalled();
    });

    it('a second sign-out while the first runs shares it', async () => {
      const store = signedInStore();

      const [a, b] = await Promise.all([store.signOut(), store.signOut()]);

      expect([a, b]).toEqual([true, true]);
      expect(mockUnregisterDevice).toHaveBeenCalledTimes(1);
      expect(mockClearTokens).toHaveBeenCalledTimes(1);
    });

    it('a background step that rejects is only logged', async () => {
      mockUnregisterDevice.mockRejectedValue(new Error('bridge down'));
      mockFinishSignOut.mockRejectedValue(new Error('google down'));
      const store = signedInStore();

      await expect(store.signOut()).resolves.toBe(true);
      await flush();

      expect(store.backendUser).toBeNull();
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  it('cache and preference clear failures do not fail the sign-out', async () => {
    mockClearAllCache.mockRejectedValue(new Error('cache'));
    mockPrefsClear.mockRejectedValue(new Error('prefs'));
    const store = signedInStore();

    const ok = await store.signOut();
    await flush();

    expect(ok).toBe(true);
    expect(store.user).toBeNull();
    expect(store.backendUser).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a provider sign-out failure still signs the user out locally', async () => {
    mockSignOutFirebase.mockRejectedValue(new Error('firebase signOut failed'));
    const store = signedInStore();

    const ok = await store.signOut();

    expect(ok).toBe(true);
    expect(mockWsDisconnect).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).toHaveBeenCalled();
    expect(store.backendUser).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a socket disconnect that throws still signs the user out (the tokens are already gone)', async () => {
    mockWsDisconnect.mockImplementation(() => {
      throw new Error('socket');
    });
    const store = signedInStore();

    const ok = await store.signOut();

    expect(ok).toBe(true);
    expect(store.backendUser).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a restore answer that lands during the teardown neither re-applies the user nor re-writes @sesly/me', async () => {
    const restore = deferred<unknown>();
    mockRestoreSession.mockReturnValue(restore.promise);
    const store = new AuthStore();
    await store.initialize(withCache());
    const seen: Array<string | null> = [];
    registerSessionEndHandler(async () => {
      restore.resolve({ status: 'restored', user: freshUser });
      await flush();
      seen.push(store.backendUser?.firstName ?? null);
    });
    (AsyncStorage.setItem as jest.Mock).mockClear();

    await store.signOut();
    await flush();

    // Still the cached copy while the handlers ran, never the late answer.
    expect(seen).toEqual([backendUser.firstName]);
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      CACHED_USER_STORAGE_KEY,
      expect.anything(),
    );
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
    expect(store.backendUser).toBeNull();
    expect(store.restoreOutcome).toBe('none');
  });

  it('a failing end handler does not stop the sign-out', async () => {
    registerSessionEndHandler(() => {
      throw new Error('player gone');
    });
    const store = signedInStore();

    await expect(store.signOut()).resolves.toBe(true);
    expect(store.backendUser).toBeNull();
  });

  it('an unexpected failure returns false, toasts and keeps the user', async () => {
    mockGetAccessToken.mockRejectedValue(new Error('keystore gone'));
    const store = signedInStore();

    const ok = await store.signOut();

    expect(ok).toBe(false);
    expect(store.errorMessage).toBe('Çıkış yapılamadı');
    expect(toastError).toHaveBeenCalledWith('Çıkış yapılamadı', 'Hata');
    expect(store.backendUser).toEqual(backendUser);
    expect(store.isSigningOut).toBe(false);
    expect(mockUnregisterDevice).not.toHaveBeenCalled();
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it('signing in again as the same user reconnects the socket', async () => {
    const store = new AuthStore();
    await store.signInWithEmail('user@test.sesly.io', 'secret-pass');
    await store.signOut();
    await store.signInWithEmail('user@test.sesly.io', 'secret-pass');
    await flush();

    expect(mockWsConnect).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// handleSessionExpired
// ============================================================================

describe('AuthStore.handleSessionExpired', () => {
  it('is a no-op when nobody is signed in', async () => {
    const store = new AuthStore();

    await store.handleSessionExpired();

    expect(mockWsDisconnect).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('is a no-op while signOut is running', async () => {
    const store = signedInStore();
    store.isSigningOut = true;

    await store.handleSessionExpired();

    expect(mockWsDisconnect).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(store.backendUser).toEqual(backendUser);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('tears the session down, runs the end handlers first and toasts SESSION_EXPIRED exactly once', async () => {
    await AsyncStorage.setItem(CACHED_USER_STORAGE_KEY, cachedRaw());
    const store = signedInStore();
    const seen: Array<string | null> = [];
    registerSessionEndHandler(() => {
      seen.push(store.backendUser?.id ?? null);
    });

    await store.handleSessionExpired();

    expect(seen).toEqual([backendUser.id]);
    expect(mockWsDisconnect).toHaveBeenCalledTimes(1);
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
    expect(mockPrefsClear).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
    expect(store.user).toBeNull();
    expect(store.backendUser).toBeNull();
    expect(store.restoreOutcome).toBe('rejected');
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(ERROR_MESSAGES.SESSION_EXPIRED, 'Oturum sona erdi');
    // Push unregister needs a JWT that is already gone; it is not attempted.
    expect(mockUnregisterDevice).not.toHaveBeenCalled();
    // Caches stay; the next different user triggers the wipe.
    expect(mockClearAllCache).not.toHaveBeenCalled();
    expect(mockClearAudioCache).not.toHaveBeenCalled();
  });

  it('concurrent expiries share one teardown', async () => {
    const store = signedInStore();

    await Promise.all([store.handleSessionExpired(), store.handleSessionExpired()]);
    await store.handleSessionExpired();

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('still clears the users when logout and the preference clear throw', async () => {
    mockLogout.mockRejectedValue(new Error('logout'));
    mockPrefsClear.mockRejectedValue(new Error('prefs'));
    mockWsDisconnect.mockImplementation(() => {
      throw new Error('socket');
    });
    const store = signedInStore();

    await store.handleSessionExpired();

    expect(store.user).toBeNull();
    expect(store.backendUser).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('runs when ApiClient fires the registered onSessionExpired listener', async () => {
    const store = signedInStore();
    const listener = sessionExpiredListener();

    listener();
    await flush();

    expect(mockWsDisconnect).toHaveBeenCalledTimes(1);
    expect(store.backendUser).toBeNull();
    expect(toastError).toHaveBeenCalledWith(ERROR_MESSAGES.SESSION_EXPIRED, 'Oturum sona erdi');
  });

  it('only a backend user (no Firebase user) still counts as a session', async () => {
    const store = new AuthStore();
    store.backendUser = backendUser;

    await store.handleSessionExpired();

    expect(store.backendUser).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('a restore answer that lands during the teardown leaves no @sesly/me behind', async () => {
    const restore = deferred<unknown>();
    mockRestoreSession.mockReturnValue(restore.promise);
    const store = new AuthStore();
    await store.initialize(withCache());
    // The answer arrives after the cached user was removed.
    mockPrefsClear.mockImplementation(async () => {
      restore.resolve({ status: 'restored', user: freshUser });
      await flush();
    });

    sessionExpiredListener()();
    await flush();
    await flush();

    await expect(AsyncStorage.getItem(CACHED_USER_STORAGE_KEY)).resolves.toBeNull();
    expect(store.backendUser).toBeNull();
    expect(store.restoreOutcome).toBe('rejected');
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('stops the automatic restore retries', async () => {
    mockRestoreSession.mockResolvedValue({ status: 'offline' });
    const store = new AuthStore();
    await store.initialize(withCache());
    await flush();
    expect(mockReconnectListeners.size).toBe(1);

    await store.handleSessionExpired();
    reconnect();
    await flush();

    expect(mockReconnectListeners.size).toBe(0);
    expect(mockRestoreSession).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// getAuthStore / useAuth (module singleton)
// ============================================================================

describe('getAuthStore and useAuth', () => {
  it('return one store per app run and never initialize it', async () => {
    const first = renderHook(() => useAuth());
    const second = renderHook(() => useAuth());
    await flush();

    expect(first.result.current).toBeInstanceOf(AuthStore);
    expect(second.result.current).toBe(first.result.current);
    expect(getAuthStore()).toBe(first.result.current);
    // BootStore initializes it, not the hook.
    expect(mockAuthInitialize).not.toHaveBeenCalled();
    expect(first.result.current.isInitialized).toBe(false);

    first.unmount();
    second.unmount();
  });
});

describe('ApiError helpers used by the store', () => {
  it('a network ApiError still reaches the form with its own copy', async () => {
    mockLoginWithEmail.mockRejectedValue(
      new ApiError({ message: ERROR_MESSAGES.NETWORK, status: 0, code: 'NETWORK_ERROR' }),
    );
    const store = new AuthStore();

    await store.signInWithEmail('a@b.co', 'x');

    expect(store.errorMessage).toBe(ERROR_MESSAGES.NETWORK);
    expect(store.errorField).toBeNull();
  });
});
