/**
 * ApiClient.postDetached: the sign-out's best-effort calls (push unregister,
 * backend revoke) carry the credentials captured before the tokens were
 * cleared and must never borrow, refresh or clear the tokens of a session
 * started meanwhile (LA-4). Same harness idea as ApiClient.test.ts: a fresh
 * client per test, axios adapters on the two instances, in-memory storage.
 */
import { AxiosError } from 'axios';
import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

type ApiClientModule = typeof import('./ApiClient');
type ApiErrorModule = typeof import('./ApiError');
type RequestConfig = InternalAxiosRequestConfig;

const mockStorage = new Map<string, string>();

jest.mock('react-native-encrypted-storage', () => ({
  __esModule: true,
  default: {
    setItem: async (key: string, value: string) => {
      mockStorage.set(key, value);
    },
    getItem: async (key: string) => mockStorage.get(key) ?? null,
    removeItem: async (key: string) => {
      mockStorage.delete(key);
    },
    clear: () => Promise.resolve(),
  },
}));

// A Firebase user is signed in: the silent refresh path would succeed if a
// detached 401 ever reached it.
const mockGetIdToken = jest.fn(async () => 'firebase-id-token');
jest.mock('@react-native-firebase/auth', () => {
  const instance = {
    get currentUser() {
      return { getIdToken: mockGetIdToken };
    },
    useEmulator: () => undefined,
  };
  const auth = () => instance;
  return { __esModule: true, default: auth, getAuth: auth, connectAuthEmulator: () => undefined };
});

const mainAdapter = jest.fn<Promise<AxiosResponse>, [RequestConfig]>();
const refreshAdapter = jest.fn<Promise<AxiosResponse>, [RequestConfig]>();

function respond(config: RequestConfig, status: number, data: unknown = {}): AxiosResponse {
  const response: AxiosResponse = { data, status, statusText: String(status), headers: {}, config };
  if (status >= 400) {
    throw new AxiosError(
      `Request failed with status code ${status}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      {},
      response,
    );
  }
  return response;
}

function header(config: RequestConfig, name: string): string | undefined {
  const value = config.headers.get(name);
  return typeof value === 'string' ? value : undefined;
}

let client: ApiClientModule['default'];
let apiErrors: ApiErrorModule;

beforeEach(() => {
  mockStorage.clear();
  mockStorage.set('access_token', 'new-session-access');
  mockStorage.set('refresh_token', 'new-session-refresh');
  mainAdapter.mockReset().mockImplementation(async config => respond(config, 200, { ok: true }));
  refreshAdapter.mockReset().mockImplementation(async config =>
    respond(config, 200, { accessToken: 'minted-access', refreshToken: 'minted-refresh' }),
  );
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);

  jest.resetModules();
  const mod = require('./ApiClient') as ApiClientModule;
  apiErrors = require('./ApiError') as ApiErrorModule;
  client = mod.default;
  const raw = client as unknown as { axiosInstance: AxiosInstance; refreshAxiosInstance: AxiosInstance };
  raw.axiosInstance.defaults.adapter = config => mainAdapter(config);
  raw.refreshAxiosInstance.defaults.adapter = config => refreshAdapter(config);
});

describe('ApiClient.postDetached', () => {
  it('sends the captured bearer instead of the stored one, with the body and the timeout', async () => {
    await expect(
      client.postDetached('/notifications/unregister', { token: 'fcm-1' }, 'old-session-access', {
        timeout: 4000,
      }),
    ).resolves.toEqual({ ok: true });

    const config = mainAdapter.mock.calls[0][0];
    expect(config.url).toBe('/notifications/unregister');
    expect(config.method).toBe('post');
    expect(JSON.parse(config.data as string)).toEqual({ token: 'fcm-1' });
    expect(header(config, 'Authorization')).toBe('Bearer old-session-access');
    expect(config.timeout).toBe(4000);
    expect(header(config, 'Accept-Language')).toBeTruthy();
  });

  it('without a token it sends no Authorization header, even with a session stored', async () => {
    await client.postDetached('/auth/logout', { refreshToken: 'old-refresh' }, null);

    expect(header(mainAdapter.mock.calls[0][0], 'Authorization')).toBeUndefined();
  });

  it('a 401 goes back to the caller: no refresh, no session expiry, the stored session untouched', async () => {
    mainAdapter.mockImplementation(async config =>
      respond(config, 401, { statusCode: 401, message: 'Unauthorized' }),
    );
    const onExpired = jest.fn();
    client.onSessionExpired(onExpired);

    const error = await client
      .postDetached('/notifications/unregister', { token: 'fcm-1' }, 'revoked-access')
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(apiErrors.ApiError);
    expect(error).toMatchObject({ status: 401, method: 'POST', path: '/notifications/unregister' });
    expect(mainAdapter).toHaveBeenCalledTimes(1);
    expect(refreshAdapter).not.toHaveBeenCalled();
    expect(mockGetIdToken).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();
    await expect(client.getAccessToken()).resolves.toBe('new-session-access');
    await expect(client.getRefreshToken()).resolves.toBe('new-session-refresh');
  });

  it('a normal request still uses the stored session', async () => {
    await client.post('/notifications/register', { token: 'fcm-2' });

    expect(header(mainAdapter.mock.calls[0][0], 'Authorization')).toBe('Bearer new-session-access');
  });
});
