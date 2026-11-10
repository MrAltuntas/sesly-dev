/**
 * ApiClient unit tests.
 *
 * ApiClient is a singleton created at import time and keeps refresh state
 * (in-flight flag, waiters, session-expired latch), so every test loads a
 * fresh copy via jest.resetModules(). HTTP is driven through custom axios
 * adapters installed on the two underlying axios instances (main + refresh);
 * axios itself is real, nothing touches the network.
 */
import { AxiosError } from 'axios';
import type {
  AxiosInstance,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import { ERROR_MESSAGES } from '../config/constants';
import { maintenanceFallbackMessage } from './ApiError';

type ApiClientModule = typeof import('./ApiClient');
type ApiErrorModule = typeof import('./ApiError');
type I18nModule = typeof import('../i18n');
type Client = ApiClientModule['default'];
type RequestConfig = InternalAxiosRequestConfig;

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// In-memory secure storage (the global mock always returns null).
const mockStorage = new Map<string, string>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();
const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockRemoveItem = jest.fn<Promise<void>, [string]>();

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    setItem: (key: string, value: string) => mockSetItem(key, value),
    getItem: (key: string) => mockGetItem(key),
    removeItem: (key: string) => mockRemoveItem(key),
    clear: () => Promise.resolve(),
  },
}));

interface MockFirebaseUser {
  getIdToken: jest.Mock<Promise<string>, [boolean?]>;
}

// ApiClient only reads auth().currentUser; the extra members keep the mock
// tolerant of a dev-only emulator hook (connectAuthEmulator / useEmulator).
const mockFirebase: { currentUser: MockFirebaseUser | null } = {
  currentUser: null,
};

jest.mock('@react-native-firebase/auth', () => {
  const instance = {
    get currentUser() {
      return mockFirebase.currentUser;
    },
    useEmulator: () => undefined,
  };
  const auth = () => instance;
  return {
    __esModule: true,
    default: auth,
    getAuth: auth,
    connectAuthEmulator: () => undefined,
  };
});

// ---------------------------------------------------------------------------
// Fake transport
// ---------------------------------------------------------------------------

const mainAdapter = jest.fn<Promise<AxiosResponse>, [RequestConfig]>();
const refreshAdapter = jest.fn<Promise<AxiosResponse>, [RequestConfig]>();
// Bearer header of every main-instance request, captured at send time (the
// 401 interceptor later mutates the failed request's config in place).
let sentBearers: Array<string | undefined> = [];

/** Build a response; statuses >= 400 throw like axios' settle() would. */
function respond(
  config: RequestConfig,
  status: number,
  data: unknown = {},
): AxiosResponse {
  const response: AxiosResponse = {
    data,
    status,
    statusText: String(status),
    headers: {},
    config,
  };
  if (status >= 400) {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    );
  }
  return response;
}

/** No response at all (offline, DNS, timeout). */
function networkDown(config: RequestConfig): never {
  throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config, {});
}

function bearer(config: RequestConfig): string | undefined {
  const value = config.headers.get('Authorization');
  return typeof value === 'string' ? value : undefined;
}

function sentBody(config: RequestConfig): unknown {
  return typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
}

function tokenPair(accessToken: string, refreshToken: string) {
  return { accessToken, refreshToken };
}

/** 200 only for the new token, 401 for anything else. */
function acceptOnly(token: string, data: (config: RequestConfig) => unknown) {
  return async (config: RequestConfig) =>
    bearer(config) === `Bearer ${token}`
      ? respond(config, 200, data(config))
      : respond(config, 401, { statusCode: 401, message: 'Unauthorized' });
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Microtask-only wait: fake timers are on globally, promises still run. */
async function waitUntil(predicate: () => boolean, maxTicks = 1000) {
  for (let i = 0; i < maxTicks && !predicate(); i++) {
    await Promise.resolve();
  }
  if (!predicate()) {
    throw new Error('waitUntil: condition was never reached');
  }
}

/** Attach a rejection handler immediately and hand back the error. */
async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the request to fail');
}

function seedTokens(accessToken: string, refreshToken: string) {
  mockStorage.set('access_token', accessToken);
  mockStorage.set('refresh_token', refreshToken);
}

function firebaseUser(getIdToken: () => Promise<string>): MockFirebaseUser {
  return { getIdToken: jest.fn<Promise<string>, [boolean?]>(getIdToken) };
}

// ---------------------------------------------------------------------------
// Fresh client per test
// ---------------------------------------------------------------------------

let client: Client;
let apiErrors: ApiErrorModule;
let clientModule: ApiClientModule;
let i18nModule: I18nModule;

function internals(c: Client) {
  return c as unknown as {
    axiosInstance: AxiosInstance;
    refreshAxiosInstance: AxiosInstance;
    refreshSubscribers: unknown[];
  };
}

function loadClient(): void {
  jest.resetModules();
  const mod = require('./ApiClient') as ApiClientModule;
  // Same registry as the fresh ApiClient, so instanceof checks line up.
  apiErrors = require('./ApiError') as ApiErrorModule;
  i18nModule = require('../i18n') as I18nModule;
  clientModule = mod;
  client = mod.default;
  const raw = internals(client);
  raw.axiosInstance.defaults.adapter = config => {
    sentBearers.push(bearer(config));
    return mainAdapter(config);
  };
  raw.refreshAxiosInstance.defaults.adapter = config => refreshAdapter(config);
}

function pendingWaiters(): number {
  return internals(client).refreshSubscribers.length;
}

beforeEach(() => {
  mockStorage.clear();
  mockFirebase.currentUser = null;
  sentBearers = [];

  mockSetItem.mockReset().mockImplementation(async (key, value) => {
    mockStorage.set(key, value);
  });
  mockGetItem
    .mockReset()
    .mockImplementation(async key => mockStorage.get(key) ?? null);
  mockRemoveItem.mockReset().mockImplementation(async key => {
    mockStorage.delete(key);
  });

  mainAdapter.mockReset().mockImplementation(async config => respond(config, 200, {}));
  refreshAdapter.mockReset().mockImplementation(async config => {
    throw new Error(`unexpected refresh call to ${config.url}`);
  });

  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  loadClient();
});

// ===========================================================================
// Request interceptor
// ===========================================================================

describe('request interceptor', () => {
  it('attaches the stored access token as a bearer header', async () => {
    seedTokens('access-1', 'refresh-1');
    mainAdapter.mockImplementation(async config =>
      respond(config, 200, { id: 'story-1' }),
    );

    await expect(client.get('/stories/story-1')).resolves.toEqual({
      id: 'story-1',
    });

    const config = mainAdapter.mock.calls[0][0];
    expect(config.url).toBe('/stories/story-1');
    expect(config.method).toBe('get');
    expect(config.baseURL).toBe('http://localhost:3000');
    expect(bearer(config)).toBe('Bearer access-1');
    expect(mockGetItem).toHaveBeenCalledWith('access_token');
  });

  it('sends no Authorization header when there is no stored token', async () => {
    await client.get('/stories');

    expect(bearer(mainAdapter.mock.calls[0][0])).toBeUndefined();
  });

  it('still sends the request without a header when storage throws', async () => {
    mockGetItem.mockRejectedValue(new Error('keystore locked'));

    await expect(client.get('/stories')).resolves.toEqual({});
    expect(bearer(mainAdapter.mock.calls[0][0])).toBeUndefined();
  });
});

// ===========================================================================
// 401 -> refresh -> retry
// ===========================================================================

describe('401 handling with a successful refresh', () => {
  it('refreshes through Firebase first and retries with the new bearer', async () => {
    seedTokens('old-access', 'old-refresh');
    const user = firebaseUser(async () => 'firebase-id-token');
    mockFirebase.currentUser = user;
    mainAdapter.mockImplementation(
      acceptOnly('new-access', config => ({ path: config.url })),
    );
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );

    await expect(client.get('/users/me')).resolves.toEqual({ path: '/users/me' });

    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
    const refreshConfig = refreshAdapter.mock.calls[0][0];
    expect(refreshConfig.url).toBe('/auth/firebase/verify');
    expect(refreshConfig.method).toBe('post');
    expect(sentBody(refreshConfig)).toEqual({ idToken: 'firebase-id-token' });
    // The refresh instance has no interceptors, so no stale bearer leaks in.
    expect(bearer(refreshConfig)).toBeUndefined();

    expect(sentBearers).toEqual(['Bearer old-access', 'Bearer new-access']);

    expect(mockStorage.get('access_token')).toBe('new-access');
    expect(mockStorage.get('refresh_token')).toBe('new-refresh');
  });

  it('falls back to /auth/refresh when there is no Firebase user', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(acceptOnly('new-access', () => ({ ok: true })));
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );

    await expect(client.get('/stories')).resolves.toEqual({ ok: true });

    expect(refreshAdapter).toHaveBeenCalledTimes(1);
    const refreshConfig = refreshAdapter.mock.calls[0][0];
    expect(refreshConfig.url).toBe('/auth/refresh');
    expect(sentBody(refreshConfig)).toEqual({ refreshToken: 'old-refresh' });
    expect(mockStorage.get('access_token')).toBe('new-access');
    expect(mockStorage.get('refresh_token')).toBe('new-refresh');
  });

  it('falls back to /auth/refresh when the Firebase id token cannot be read', async () => {
    seedTokens('old-access', 'old-refresh');
    mockFirebase.currentUser = firebaseUser(async () => {
      throw new Error('auth/network-request-failed');
    });
    mainAdapter.mockImplementation(acceptOnly('new-access', () => ({ ok: true })));
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );

    await expect(client.get('/stories')).resolves.toEqual({ ok: true });

    expect(refreshAdapter.mock.calls.map(([c]) => c.url)).toEqual(['/auth/refresh']);
  });

  it('falls back to /auth/refresh when Firebase returns an empty id token', async () => {
    seedTokens('old-access', 'old-refresh');
    mockFirebase.currentUser = firebaseUser(async () => '');
    mainAdapter.mockImplementation(acceptOnly('new-access', () => ({ ok: true })));
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );

    await expect(client.get('/stories')).resolves.toEqual({ ok: true });

    expect(refreshAdapter.mock.calls.map(([c]) => c.url)).toEqual(['/auth/refresh']);
  });

  it('falls back to /auth/refresh when the backend rejects the Firebase token', async () => {
    seedTokens('old-access', 'old-refresh');
    mockFirebase.currentUser = firebaseUser(async () => 'firebase-id-token');
    mainAdapter.mockImplementation(acceptOnly('new-access', () => ({ ok: true })));
    refreshAdapter.mockImplementation(async config =>
      config.url === '/auth/firebase/verify'
        ? respond(config, 401, { message: 'Firebase token gecersiz' })
        : respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );

    await expect(client.get('/stories')).resolves.toEqual({ ok: true });

    expect(refreshAdapter.mock.calls.map(([c]) => c.url)).toEqual([
      '/auth/firebase/verify',
      '/auth/refresh',
    ]);
    expect(mockStorage.get('refresh_token')).toBe('new-refresh');
  });

  it('runs a single refresh for concurrent 401s and retries every request', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(
      acceptOnly('new-access', config => ({ path: config.url })),
    );
    const gate = deferred();
    refreshAdapter.mockImplementation(async config => {
      await gate.promise;
      return respond(config, 200, tokenPair('new-access', 'new-refresh'));
    });
    const onRefreshed = jest.fn();
    client.onTokensRefreshed(onRefreshed);

    const first = client.get('/stories');
    const second = client.get('/users/me');

    // The first 401 owns the refresh, the second one parks as a waiter.
    await waitUntil(
      () => refreshAdapter.mock.calls.length === 1 && pendingWaiters() === 1,
    );
    gate.resolve();

    await expect(first).resolves.toEqual({ path: '/stories' });
    await expect(second).resolves.toEqual({ path: '/users/me' });

    expect(refreshAdapter).toHaveBeenCalledTimes(1);
    expect(sentBearers).toEqual([
      'Bearer old-access',
      'Bearer old-access',
      'Bearer new-access',
      'Bearer new-access',
    ]);
    expect(onRefreshed).toHaveBeenCalledTimes(1);
    expect(onRefreshed).toHaveBeenCalledWith('new-access');
  });

  it('does not refresh twice when the retried request is still unauthorized', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config =>
      respond(config, 401, { statusCode: 401, message: 'Yetkisiz istek' }),
    );
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const error = await capture(client.get('/stories'));

    expect(error).toBeInstanceOf(apiErrors.ApiError);
    expect(error).toMatchObject({
      status: 401,
      message: 'Yetkisiz istek',
      method: 'GET',
      path: '/stories',
    });
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
    expect(mainAdapter).toHaveBeenCalledTimes(2);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Refresh failures
// ===========================================================================

describe('401 handling when the refresh fails definitively', () => {
  it.each([400, 401, 403, 404])(
    'ends the session when /auth/refresh answers %i',
    async status => {
      seedTokens('old-access', 'old-refresh');
      mainAdapter.mockImplementation(async config => respond(config, 401));
      refreshAdapter.mockImplementation(async config =>
        respond(config, status, { message: 'Refresh token gecersiz' }),
      );
      const onExpired = jest.fn();
      client.onSessionExpired(onExpired);

      const error = await capture(client.get('/stories'));

      expect(error).toBeInstanceOf(apiErrors.ApiError);
      expect(error).toMatchObject({
        status: 401,
        code: 'SESSION_EXPIRED',
        message: ERROR_MESSAGES.SESSION_EXPIRED,
      });
      expect(mockStorage.size).toBe(0);
      expect(mockRemoveItem).toHaveBeenCalledWith('access_token');
      expect(mockRemoveItem).toHaveBeenCalledWith('refresh_token');
      expect(onExpired).toHaveBeenCalledTimes(1);
    },
  );

  it('ends the session without a network call when no refresh token is stored', async () => {
    mockStorage.set('access_token', 'old-access');
    mainAdapter.mockImplementation(async config => respond(config, 401));
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const error = await capture(client.get('/stories'));

    expect(error).toMatchObject({ code: 'SESSION_EXPIRED', status: 401 });
    expect(refreshAdapter).not.toHaveBeenCalled();
    expect(mockStorage.has('access_token')).toBe(false);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('ends the session when the refresh answers 200 without tokens', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config => respond(config, 401));
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, { accessToken: '' }),
    );
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const error = await capture(client.get('/stories'));

    expect(error).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(mockStorage.size).toBe(0);
    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  it('notifies session-expired listeners once for several concurrent 401s', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config => respond(config, 401));
    const gate = deferred();
    refreshAdapter.mockImplementation(async config => {
      await gate.promise;
      return respond(config, 401, { message: 'Refresh token gecersiz' });
    });
    const onExpired = jest.fn();
    const onRefreshed = jest.fn();
    client.onSessionExpired(onExpired);
    client.onTokensRefreshed(onRefreshed);

    const results = ['/stories', '/users/me', '/narrations'].map(path =>
      capture(client.get(path)),
    );
    await waitUntil(
      () => refreshAdapter.mock.calls.length === 1 && pendingWaiters() === 2,
    );
    gate.resolve();
    const errors = await Promise.all(results);

    errors.forEach(error => {
      expect(error).toBeInstanceOf(apiErrors.ApiError);
      expect(error).toMatchObject({
        status: 401,
        code: 'SESSION_EXPIRED',
        message: ERROR_MESSAGES.SESSION_EXPIRED,
      });
    });
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(onRefreshed).not.toHaveBeenCalled();
    expect(mockStorage.size).toBe(0);
  });

  it('fires session-expired again only after new tokens were stored', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config => respond(config, 401));
    refreshAdapter.mockImplementation(async config => respond(config, 401));
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    await capture(client.get('/stories'));
    expect(onExpired).toHaveBeenCalledTimes(1);

    // Still logged out: another 401 must not re-notify.
    const again = await capture(client.get('/stories'));
    expect(again).toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(onExpired).toHaveBeenCalledTimes(1);

    // A fresh login re-arms the latch.
    await client.storeTokens('access-2', 'refresh-2');
    await capture(client.get('/stories'));
    expect(onExpired).toHaveBeenCalledTimes(2);
  });

  it('keeps notifying other session-expired listeners when one throws', async () => {
    mainAdapter.mockImplementation(async config => respond(config, 401));
    const broken = jest.fn(() => {
      throw new Error('listener bug');
    });
    const healthy = jest.fn();
    const removed = jest.fn();
    client.onSessionExpired(broken);
    client.onSessionExpired(healthy);
    const unsubscribe = client.onSessionExpired(removed);
    unsubscribe();

    await capture(client.get('/stories'));

    expect(broken).toHaveBeenCalledTimes(1);
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });
});

describe('401 handling when the refresh fails transiently', () => {
  it('keeps the session and surfaces a network error when offline', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config => respond(config, 401));
    refreshAdapter.mockImplementation(async config => networkDown(config));
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const error = await capture(client.get('/stories'));

    expect(error).toBeInstanceOf(apiErrors.ApiError);
    expect(error).toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: ERROR_MESSAGES.NETWORK,
      isNetworkError: true,
    });
    expect(onExpired).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
    expect(mockStorage.get('access_token')).toBe('old-access');
    expect(mockStorage.get('refresh_token')).toBe('old-refresh');
  });

  it('passes the backend maintenance message through on 503', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config => respond(config, 401));
    refreshAdapter.mockImplementation(async config =>
      respond(config, 503, {
        statusCode: 503,
        message: 'Sesly bakimda, 10 dakika sonra tekrar deneyin.',
      }),
    );
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const error = await capture(client.get('/stories'));

    expect(error).toMatchObject({
      status: 503,
      isMaintenance: true,
      message: 'Sesly bakimda, 10 dakika sonra tekrar deneyin.',
    });
    expect(onExpired).not.toHaveBeenCalled();
    expect(mockStorage.get('refresh_token')).toBe('old-refresh');
  });

  it('keeps the session on a 500 from the refresh endpoint', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config => respond(config, 401));
    refreshAdapter.mockImplementation(async config =>
      respond(config, 500, { message: 'Internal server error' }),
    );
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const error = await capture(client.get('/stories'));

    expect(error).toMatchObject({ status: 500, message: ERROR_MESSAGES.SERVER });
    expect(onExpired).not.toHaveBeenCalled();
    expect(mockStorage.size).toBe(2);
  });

  it('gives waiting requests the same transient classification', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config => respond(config, 401));
    const gate = deferred();
    refreshAdapter.mockImplementation(async config => {
      await gate.promise;
      return networkDown(config);
    });
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const first = capture(client.get('/stories'));
    const second = capture(client.get('/users/me'));
    await waitUntil(
      () => refreshAdapter.mock.calls.length === 1 && pendingWaiters() === 1,
    );
    gate.resolve();

    for (const error of await Promise.all([first, second])) {
      expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    }
    expect(onExpired).not.toHaveBeenCalled();
    expect(mockStorage.size).toBe(2);
  });

  it('recovers on the next 401 once the network is back', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(acceptOnly('new-access', () => ({ ok: true })));
    refreshAdapter.mockImplementationOnce(async config => networkDown(config));
    refreshAdapter.mockImplementationOnce(async config =>
      respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );

    const offline = await capture(client.get('/stories'));
    expect(offline).toMatchObject({ code: 'NETWORK_ERROR' });

    await expect(client.get('/stories')).resolves.toEqual({ ok: true });
    expect(refreshAdapter).toHaveBeenCalledTimes(2);
  });
});

describe('401 on auth endpoints', () => {
  it('passes the backend 401 through without refreshing or logging out', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(async config =>
      respond(config, 401, {
        statusCode: 401,
        message: 'Firebase oturumu dogrulanamadi',
      }),
    );
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const error = await capture(
      client.post('/auth/firebase/verify', { idToken: 'bad-token' }),
    );

    expect(error).toBeInstanceOf(apiErrors.ApiError);
    expect(error).toMatchObject({
      status: 401,
      code: null,
      message: 'Firebase oturumu dogrulanamadi',
      method: 'POST',
      path: '/auth/firebase/verify',
    });
    expect(refreshAdapter).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
    expect(mockStorage.size).toBe(2);
  });
});

// ===========================================================================
// Listeners and refreshSession()
// ===========================================================================

describe('onTokensRefreshed', () => {
  it('calls every listener, survives a throwing one and honours unsubscribe', async () => {
    seedTokens('old-access', 'old-refresh');
    let issued = 0;
    refreshAdapter.mockImplementation(async config => {
      issued += 1;
      return respond(config, 200, tokenPair(`access-${issued}`, `refresh-${issued}`));
    });
    const broken = jest.fn(() => {
      throw new Error('listener bug');
    });
    const healthy = jest.fn();
    client.onTokensRefreshed(broken);
    const unsubscribe = client.onTokensRefreshed(healthy);

    await expect(client.refreshSession()).resolves.toBe('access-1');
    expect(broken).toHaveBeenCalledWith('access-1');
    expect(healthy).toHaveBeenCalledWith('access-1');

    unsubscribe();
    await expect(client.refreshSession()).resolves.toBe('access-2');
    expect(healthy).toHaveBeenCalledTimes(1);
    expect(broken).toHaveBeenCalledTimes(2);
  });
});

describe('refreshSession', () => {
  it('returns the new access token and stores both tokens', async () => {
    seedTokens('old-access', 'old-refresh');
    mockFirebase.currentUser = firebaseUser(async () => 'firebase-id-token');
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );

    await expect(client.refreshSession()).resolves.toBe('new-access');

    expect(mockStorage.get('access_token')).toBe('new-access');
    expect(mockStorage.get('refresh_token')).toBe('new-refresh');
  });

  it('returns null and keeps the session on a transient failure', async () => {
    seedTokens('old-access', 'old-refresh');
    refreshAdapter.mockImplementation(async config => networkDown(config));
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    await expect(client.refreshSession()).resolves.toBeNull();

    expect(onExpired).not.toHaveBeenCalled();
    expect(mockStorage.size).toBe(2);
  });

  it('returns null and ends the session on a definitive failure', async () => {
    seedTokens('old-access', 'old-refresh');
    refreshAdapter.mockImplementation(async config => respond(config, 401));
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    await expect(client.refreshSession()).resolves.toBeNull();

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(mockStorage.size).toBe(0);
  });

  it('joins a refresh that is already in flight', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(acceptOnly('new-access', () => ({ ok: true })));
    const gate = deferred();
    refreshAdapter.mockImplementation(async config => {
      await gate.promise;
      return respond(config, 200, tokenPair('new-access', 'new-refresh'));
    });

    const request = client.get('/stories');
    await waitUntil(() => refreshAdapter.mock.calls.length === 1);
    const forced = client.refreshSession();
    await waitUntil(() => pendingWaiters() === 1);
    gate.resolve();

    await expect(forced).resolves.toBe('new-access');
    await expect(request).resolves.toEqual({ ok: true });
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// HTTP helpers and ApiError mapping
// ===========================================================================

describe('HTTP helpers', () => {
  it('forwards method, path and JSON body for post/put/patch/delete', async () => {
    mainAdapter.mockImplementation(async config =>
      respond(config, 200, { echo: config.method }),
    );

    await expect(client.post('/collections', { name: 'Uyku' })).resolves.toEqual({
      echo: 'post',
    });
    await expect(client.put('/collections/c-1', { name: 'Gece' })).resolves.toEqual({
      echo: 'put',
    });
    await expect(client.patch('/users/me', { firstName: 'Ayse' })).resolves.toEqual({
      echo: 'patch',
    });
    await expect(client.delete('/collections/c-1')).resolves.toEqual({
      echo: 'delete',
    });

    const calls = mainAdapter.mock.calls.map(([c]) => ({
      method: c.method,
      url: c.url,
      body: c.data === undefined ? undefined : sentBody(c),
    }));
    expect(calls).toEqual([
      { method: 'post', url: '/collections', body: { name: 'Uyku' } },
      { method: 'put', url: '/collections/c-1', body: { name: 'Gece' } },
      { method: 'patch', url: '/users/me', body: { firstName: 'Ayse' } },
      { method: 'delete', url: '/collections/c-1', body: undefined },
    ]);
  });

  it('forwards query params from the request config', async () => {
    await client.get('/stories', { params: { page: 2, limit: 20 } });

    expect(mainAdapter.mock.calls[0][0].params).toEqual({ page: 2, limit: 20 });
  });

  it('uploads multipart data and forwards upload progress', async () => {
    seedTokens('access-1', 'refresh-1');
    mainAdapter.mockImplementation(async config => {
      config.onUploadProgress?.({ loaded: 5, total: 10, bytes: 5, lengthComputable: true });
      return respond(config, 201, { id: 'voice-1' });
    });
    const onProgress = jest.fn();
    const form = new FormData();
    form.append('name', 'Annemin sesi');

    await expect(
      client.upload('/voice-profiles/clone', form, onProgress),
    ).resolves.toEqual({ id: 'voice-1' });

    const config = mainAdapter.mock.calls[0][0];
    expect(config.method).toBe('post');
    expect(config.url).toBe('/voice-profiles/clone');
    expect(config.headers.get('Content-Type')).toBe('multipart/form-data');
    expect(config.data).toBe(form);
    expect(bearer(config)).toBe('Bearer access-1');
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ loaded: 5, total: 10 }),
    );
  });

  it('maps a failed upload to an ApiError tagged with POST', async () => {
    mainAdapter.mockImplementation(async config =>
      respond(config, 413, { statusCode: 413 }),
    );

    const error = await capture(
      client.upload('/voice-profiles/clone', new FormData()),
    );

    expect(error).toMatchObject({
      status: 413,
      message: ERROR_MESSAGES.FILE_TOO_LARGE,
      method: 'POST',
      path: '/voice-profiles/clone',
    });
  });
});

describe('ApiError mapping', () => {
  it('picks the first non-empty string of a 400 validation message array', async () => {
    mainAdapter.mockImplementation(async config =>
      respond(config, 400, {
        statusCode: 400,
        message: ['   ', 'E-posta gecersiz', 'Sifre cok kisa'],
        error: 'Bad Request',
      }),
    );

    const error = await capture(client.get('/users/me'));

    expect(error).toBeInstanceOf(apiErrors.ApiError);
    expect(error).toMatchObject({
      status: 400,
      message: 'E-posta gecersiz',
      method: 'GET',
      path: '/users/me',
    });
  });

  it('hides the English backend message of a 500', async () => {
    mainAdapter.mockImplementation(async config =>
      respond(config, 500, { statusCode: 500, message: 'Internal server error' }),
    );

    const error = await capture(client.post('/narrations', { storyId: 's-1' }));

    expect(error).toMatchObject({
      status: 500,
      message: ERROR_MESSAGES.SERVER,
      method: 'POST',
    });
  });

  it('passes the backend Turkish message through on a 503', async () => {
    mainAdapter.mockImplementation(async config =>
      respond(config, 503, {
        statusCode: 503,
        message: 'Planli bakim calismasi yapiliyor.',
      }),
    );

    const error = await capture(client.put('/users/me', { firstName: 'Ayse' }));

    expect(error).toMatchObject({
      status: 503,
      isMaintenance: true,
      message: 'Planli bakim calismasi yapiliyor.',
      method: 'PUT',
    });
  });

  it('falls back to the maintenance message on a 503 without a body message', async () => {
    mainAdapter.mockImplementation(async config => respond(config, 503, {}));

    const error = await capture(client.patch('/users/me', { firstName: 'Ayse' }));

    expect(error).toMatchObject({
      status: 503,
      message: maintenanceFallbackMessage(),
      method: 'PATCH',
    });
  });

  it('keeps code and extra payload of a 409 conflict', async () => {
    mainAdapter.mockImplementation(async config =>
      respond(config, 409, {
        statusCode: 409,
        message: 'Bu masal bu sesle zaten seslendirilmis.',
        code: 'NARRATION_EXISTS',
        existingNarrationId: 'narration-9',
        status: 'READY',
      }),
    );

    const error = await capture(client.delete('/narrations/narration-9'));

    expect(error).toMatchObject({
      status: 409,
      code: 'NARRATION_EXISTS',
      message: 'Bu masal bu sesle zaten seslendirilmis.',
      method: 'DELETE',
      data: expect.objectContaining({ existingNarrationId: 'narration-9' }),
    });
  });

  it('maps a request without a response to NETWORK_ERROR', async () => {
    mainAdapter.mockImplementation(async config => networkDown(config));

    const error = await capture(client.get('/stories'));

    expect(error).toBeInstanceOf(apiErrors.ApiError);
    expect(error).toMatchObject({
      status: 0,
      code: 'NETWORK_ERROR',
      message: ERROR_MESSAGES.NETWORK,
      isNetworkError: true,
    });
  });

  it('maps a non-axios failure to UNKNOWN_ERROR', async () => {
    mainAdapter.mockImplementation(async () => {
      throw new TypeError('adapter exploded');
    });

    const error = await capture(client.get('/stories'));

    expect(error).toMatchObject({
      status: 0,
      code: 'UNKNOWN_ERROR',
      message: ERROR_MESSAGES.UNKNOWN,
      method: 'GET',
      path: '/stories',
    });
  });

  it('uses the status fallback and logs a warning on 404', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mainAdapter.mockImplementation(async config => respond(config, 404, {}));

    const error = await capture(client.get('/stories/missing'));

    expect(error).toMatchObject({ status: 404, message: 'İstenen içerik bulunamadı.' });
    expect(warn).toHaveBeenCalledWith('Resource not found:', '/stories/missing');
  });
});

// ===========================================================================
// Token storage helpers
// ===========================================================================

describe('token storage', () => {
  it('stores both tokens under the documented keys', async () => {
    await client.storeTokens('access-1', 'refresh-1');

    expect(mockSetItem).toHaveBeenCalledWith('access_token', 'access-1');
    expect(mockSetItem).toHaveBeenCalledWith('refresh_token', 'refresh-1');
    await expect(client.getAccessToken()).resolves.toBe('access-1');
    await expect(client.getRefreshToken()).resolves.toBe('refresh-1');
  });

  it.each([
    ['', 'refresh-1'],
    ['access-1', ''],
  ])('rejects empty tokens (%j, %j) without touching storage', async (a, r) => {
    await expect(client.storeTokens(a, r)).rejects.toThrow('Cannot store empty tokens');
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it('wraps storage failures when storing tokens', async () => {
    mockSetItem.mockRejectedValue(new Error('keystore full'));

    await expect(client.storeTokens('a', 'r')).rejects.toThrow(
      'Failed to store authentication tokens',
    );
  });

  it('clears both tokens and swallows storage failures', async () => {
    seedTokens('access-1', 'refresh-1');
    await client.clearTokens();
    expect(mockStorage.size).toBe(0);

    mockRemoveItem.mockRejectedValue(new Error('keystore locked'));
    await expect(client.clearTokens()).resolves.toBeUndefined();
  });

  it('returns null tokens when storage throws', async () => {
    mockGetItem.mockRejectedValue(new Error('keystore locked'));

    await expect(client.getAccessToken()).resolves.toBeNull();
    await expect(client.getRefreshToken()).resolves.toBeNull();
  });

  it('reports authentication state from stored tokens', async () => {
    await expect(client.isAuthenticated()).resolves.toBe(false);
    await expect(client.hasValidTokens()).resolves.toBe(false);

    // A new app run reads storage again.
    mockStorage.set('access_token', 'access-1');
    loadClient();
    await expect(client.isAuthenticated()).resolves.toBe(true);
    await expect(client.hasValidTokens()).resolves.toBe(false);

    mockStorage.set('refresh_token', 'refresh-1');
    loadClient();
    await expect(client.hasValidTokens()).resolves.toBe(true);
  });
});

// ===========================================================================
// Token cache (one encrypted read pass per app run)
// ===========================================================================

function storageReads(key: string): number {
  return mockGetItem.mock.calls.filter(([k]) => k === key).length;
}

describe('token cache', () => {
  it('three requests make one EncryptedStorage.getItem per key', async () => {
    seedTokens('access-1', 'refresh-1');

    await Promise.all([client.get('/a'), client.get('/b')]);
    await client.get('/c');
    await expect(client.hasValidTokens()).resolves.toBe(true);
    await expect(client.getRefreshToken()).resolves.toBe('refresh-1');

    expect(storageReads('access_token')).toBe(1);
    expect(storageReads('refresh_token')).toBe(1);
    expect(sentBearers).toEqual(['Bearer access-1', 'Bearer access-1', 'Bearer access-1']);
  });

  it('concurrent first reads share one storage pass', async () => {
    seedTokens('access-1', 'refresh-1');

    const results = await Promise.all([
      client.getAccessToken(),
      client.getRefreshToken(),
      client.hasValidTokens(),
      client.isAuthenticated(),
    ]);

    expect(results).toEqual(['access-1', 'refresh-1', true, true]);
    expect(mockGetItem).toHaveBeenCalledTimes(2);
  });

  it('clearTokens then getAccessToken resolves null without a read', async () => {
    seedTokens('access-1', 'refresh-1');
    await client.get('/warm');
    mockGetItem.mockClear();

    await client.clearTokens();

    await expect(client.getAccessToken()).resolves.toBeNull();
    await expect(client.hasValidTokens()).resolves.toBe(false);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it('clearTokens never reads storage, even before the first load', async () => {
    seedTokens('access-1', 'refresh-1');

    await client.clearTokens();

    await expect(client.getAccessToken()).resolves.toBeNull();
    expect(mockGetItem).not.toHaveBeenCalled();
    expect(mockStorage.size).toBe(0);
  });

  it('a request that starts while clearTokens removes the keys goes out without a token', async () => {
    seedTokens('access-1', 'refresh-1');
    await client.get('/warm');
    const gate = deferred();
    mockRemoveItem.mockImplementation(async key => {
      await gate.promise;
      mockStorage.delete(key);
    });

    const clearing = client.clearTokens();
    await client.get('/during-clear');
    gate.resolve();
    await clearing;

    expect(sentBearers).toEqual(['Bearer access-1', undefined]);
  });

  it('storeTokens then a request uses the new token without a read', async () => {
    seedTokens('access-1', 'refresh-1');
    await client.get('/warm');
    mockGetItem.mockClear();

    await client.storeTokens('access-2', 'refresh-2');
    await client.get('/after-login');

    expect(mockGetItem).not.toHaveBeenCalled();
    expect(sentBearers[sentBearers.length - 1]).toBe('Bearer access-2');
    await expect(client.getRefreshToken()).resolves.toBe('refresh-2');
  });

  it('a write that lands while the first read runs wins over what was read', async () => {
    seedTokens('stale-access', 'stale-refresh');
    const gate = deferred();
    mockGetItem.mockImplementation(async key => {
      await gate.promise;
      return `stale-${key}`;
    });

    const reading = client.getAccessToken();
    await client.clearTokens();
    gate.resolve();

    await expect(reading).resolves.toBeNull();
    await expect(client.getAccessToken()).resolves.toBeNull();
  });

  it('a failed read is not kept: the next call reads again', async () => {
    seedTokens('access-1', 'refresh-1');
    mockGetItem.mockRejectedValueOnce(new Error('keystore locked'));

    await expect(client.getAccessToken()).resolves.toBeNull();
    await expect(client.getAccessToken()).resolves.toBe('access-1');
  });

  it('a failed storeTokens forgets the memory copy and reads storage next time', async () => {
    seedTokens('access-1', 'refresh-1');
    await client.get('/warm');
    mockSetItem.mockImplementationOnce(async (key, value) => {
      mockStorage.set(key, value);
    });
    mockSetItem.mockRejectedValueOnce(new Error('keystore full'));
    mockGetItem.mockClear();

    await expect(client.storeTokens('access-2', 'refresh-2')).rejects.toThrow();

    // Storage now holds the new access token and the old refresh token.
    await expect(client.getAccessToken()).resolves.toBe('access-2');
    await expect(client.getRefreshToken()).resolves.toBe('refresh-1');
    expect(storageReads('access_token')).toBe(1);
  });

  it('a successful refresh updates memory for the next request', async () => {
    seedTokens('old-access', 'old-refresh');
    mainAdapter.mockImplementation(acceptOnly('new-access', () => ({ ok: true })));
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('new-access', 'new-refresh')),
    );

    await client.get('/stories');
    mockGetItem.mockClear();
    await client.get('/stories');

    expect(sentBearers[sentBearers.length - 1]).toBe('Bearer new-access');
    expect(mockGetItem).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Accept-Language
// ===========================================================================

describe('Accept-Language', () => {
  function acceptLanguage(config: RequestConfig): unknown {
    return config.headers.get('Accept-Language');
  }

  it('follows setUiLanguage', async () => {
    await i18nModule.setUiLanguage('tr');
    await client.get('/stories');
    expect(acceptLanguage(mainAdapter.mock.calls[0][0])).toBe('tr');

    await i18nModule.setUiLanguage('en');
    await client.get('/stories');
    expect(acceptLanguage(mainAdapter.mock.calls[1][0])).toBe('en');
  });

  it('is sent without a token too, and survives a token read failure', async () => {
    await i18nModule.setUiLanguage('tr');
    mockGetItem.mockRejectedValue(new Error('keystore locked'));

    await client.get('/stories');

    const config = mainAdapter.mock.calls[0][0];
    expect(acceptLanguage(config)).toBe('tr');
    expect(bearer(config)).toBeUndefined();
  });
});

// ===========================================================================
// getFreshAccessToken
// ===========================================================================

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.signature`;
}

function expiringIn(ms: number, extra: Record<string, unknown> = {}): string {
  return jwt({ sub: 'user-1', exp: Math.floor((Date.now() + ms) / 1000), ...extra });
}

describe('jwtExpiryMs', () => {
  it('decodes the exp claim of a base64url payload', () => {
    // Characters that need the URL-safe alphabet and padding.
    const token = jwt({ exp: 1900000000, name: 'Ayşe ~~~???>>>' });
    expect(token.split('.')[1]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.split('.')[1]).toMatch(/[-_]/);
    expect(clientModule.jwtExpiryMs(token)).toBe(1900000000 * 1000);
  });

  it.each([
    ['not a JWT', 'opaque-token'],
    ['a payload that is not JSON', 'aGVhZGVy.bm90IGpzb24.sig'],
    ['no exp claim', jwt({ sub: 'user-1' })],
    ['a string exp', jwt({ exp: '1900000000' })],
  ])('returns null for %s', (_label, token) => {
    expect(clientModule.jwtExpiryMs(token)).toBeNull();
  });
});

describe('getFreshAccessToken', () => {
  it('refreshes a token that expires in 60 s and returns the new one', async () => {
    const soon = expiringIn(60000);
    const fresh = expiringIn(3600000);
    seedTokens(soon, 'refresh-1');
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair(fresh, 'refresh-2')),
    );

    await expect(client.getFreshAccessToken()).resolves.toBe(fresh);

    expect(refreshAdapter).toHaveBeenCalledTimes(1);
    expect(sentBody(refreshAdapter.mock.calls[0][0])).toEqual({ refreshToken: 'refresh-1' });
    await expect(client.getAccessToken()).resolves.toBe(fresh);
  });

  it('returns a token that is valid long enough as is, without a refresh', async () => {
    const valid = expiringIn(30 * 60000);
    seedTokens(valid, 'refresh-1');

    await expect(client.getFreshAccessToken()).resolves.toBe(valid);
    expect(refreshAdapter).not.toHaveBeenCalled();
  });

  it('honours a custom minimum validity', async () => {
    const tenMinutes = expiringIn(10 * 60000);
    seedTokens(tenMinutes, 'refresh-1');
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('next-access', 'refresh-2')),
    );

    await expect(client.getFreshAccessToken(5 * 60000)).resolves.toBe(tenMinutes);
    await expect(client.getFreshAccessToken(15 * 60000)).resolves.toBe('next-access');
  });

  it('treats an undecodable token as expiring', async () => {
    seedTokens('opaque-token', 'refresh-1');
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('next-access', 'refresh-2')),
    );

    await expect(client.getFreshAccessToken()).resolves.toBe('next-access');
  });

  it('resolves null without a request when there is no session', async () => {
    await expect(client.getFreshAccessToken()).resolves.toBeNull();
    expect(refreshAdapter).not.toHaveBeenCalled();
  });

  it('resolves null and keeps the session when the refresh fails offline', async () => {
    const soon = expiringIn(30000);
    seedTokens(soon, 'refresh-1');
    refreshAdapter.mockImplementation(async config => networkDown(config));
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    await expect(client.getFreshAccessToken()).resolves.toBeNull();
    expect(onExpired).not.toHaveBeenCalled();
    await expect(client.getAccessToken()).resolves.toBe(soon);
  });

  // A stream asks for its whole reload window (50 min + 5 min margin, LR-1).
  const STREAM_WINDOW_MS = 55 * 60000;

  it('refreshes a token with 30 minutes left when a stream asks for 55', async () => {
    const thirtyMinutes = expiringIn(30 * 60000);
    const fresh = expiringIn(3600000);
    seedTokens(thirtyMinutes, 'refresh-1');
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair(fresh, 'refresh-2')),
    );

    await expect(client.getFreshAccessToken(STREAM_WINDOW_MS)).resolves.toBe(fresh);
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
    // The new token covers the window: the next stream takes it as is.
    await expect(client.getFreshAccessToken(STREAM_WINDOW_MS)).resolves.toBe(fresh);
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
  });

  it('keeps a token that still works when the refresh for a long window fails offline', async () => {
    const thirtyMinutes = expiringIn(30 * 60000);
    seedTokens(thirtyMinutes, 'refresh-1');
    refreshAdapter.mockImplementation(async config => networkDown(config));
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    await expect(client.getFreshAccessToken(STREAM_WINDOW_MS)).resolves.toBe(thirtyMinutes);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it('resolves null for a long window when the refresh fails and the token is about to expire', async () => {
    seedTokens(expiringIn(60000), 'refresh-1');
    refreshAdapter.mockImplementation(async config => networkDown(config));

    await expect(client.getFreshAccessToken(STREAM_WINDOW_MS)).resolves.toBeNull();
  });

  it('resolves null and ends the session when the refresh token is refused', async () => {
    seedTokens(expiringIn(30 * 60000), 'refresh-1');
    refreshAdapter.mockImplementation(async config => respond(config, 401));
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    await expect(client.getFreshAccessToken(STREAM_WINDOW_MS)).resolves.toBeNull();
    expect(onExpired).toHaveBeenCalledTimes(1);
    await expect(client.getAccessToken()).resolves.toBeNull();
  });

  it('always refreshes for an infinite window (a stream the backend refused)', async () => {
    const hour = expiringIn(3600000);
    seedTokens(hour, 'refresh-1');
    refreshAdapter.mockImplementation(async config =>
      respond(config, 200, tokenPair('next-access', 'refresh-2')),
    );

    await expect(client.getFreshAccessToken(Number.POSITIVE_INFINITY)).resolves.toBe('next-access');
    expect(refreshAdapter).toHaveBeenCalledTimes(1);
  });
});


describe('base URL', () => {
  it('uses the dev base URL in dev builds', () => {
    expect(client.getBaseURL()).toBe('http://localhost:3000');
  });

  it('uses the production base URL outside dev builds', async () => {
    const globals = globalThis as unknown as { __DEV__: boolean };
    const previous = globals.__DEV__;
    globals.__DEV__ = false;
    try {
      loadClient();
      expect(client.getBaseURL()).toBe('https://api.sesly.io');

      // handleError skips the dev-only warning log in production.
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      mainAdapter.mockImplementation(async config => respond(config, 400, {}));
      await capture(client.get('/stories'));
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('[ApiClient]'),
        expect.anything(),
      );
    } finally {
      globals.__DEV__ = previous;
    }
  });
});
