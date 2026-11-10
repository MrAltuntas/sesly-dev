/**
 * API Client with Axios
 * Handles authentication, token refresh, and error handling
 */

import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import EncryptedStorage from 'react-native-encrypted-storage';
import auth from '@react-native-firebase/auth';
import {API_CONFIG, STORAGE_KEYS, ERROR_MESSAGES} from '../config/constants';
import i18n from '../i18n';
import {
  ApiError,
  API_ERROR_CODES,
  apiErrorFromResponse,
  isApiError,
} from './ApiError';

export {ApiError, isApiError} from './ApiError';

// ============================================================================
// Types
// ============================================================================

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

type TokenListener = (accessToken: string) => void;
type SessionExpiredListener = () => void;

// Auth endpoints answer 401 for bad credentials / bad Firebase tokens. Those
// must reach the caller as-is: running the refresh-or-logout path on them
// would log out a user who merely mistyped a password.
const AUTH_PATH_PREFIX = '/auth/';

/** getFreshAccessToken's default: the token must outlive the request it goes out with. */
const DEFAULT_MIN_TOKEN_VALIDITY_MS = 120000;

/** The two stored tokens, held in memory after the first read. */
interface TokenCache {
  access: string | null;
  refresh: string | null;
}

/**
 * A request that carries its own credentials (postDetached): the interceptors
 * neither attach the stored token nor refresh it on a 401.
 */
type DetachedRequestConfig = InternalAxiosRequestConfig & { _detached?: boolean };

/**
 * Milliseconds since the epoch at which a JWT expires, or null when the token
 * cannot be decoded or carries no numeric `exp` claim.
 */
export function jwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const decode = (globalThis as { atob?: (data: string) => string }).atob;
    if (!payload || typeof decode !== 'function') {
      return null;
    }
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims: unknown = JSON.parse(decode(padded));
    if (claims && typeof claims === 'object') {
      const exp = (claims as { exp?: unknown }).exp;
      if (typeof exp === 'number' && Number.isFinite(exp)) {
        return exp * 1000;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function sessionExpiredError(): ApiError {
  return new ApiError({
    message: ERROR_MESSAGES.SESSION_EXPIRED,
    status: 401,
    code: API_ERROR_CODES.SESSION_EXPIRED,
  });
}

// ============================================================================
// API Client Class (Singleton)
// ============================================================================

class ApiClient {
  private static instance: ApiClient;
  private axiosInstance: AxiosInstance;
  private refreshAxiosInstance: AxiosInstance; // Separate instance for token refresh
  private isRefreshing = false;
  private refreshSubscribers: Array<(token: string) => void> = [];
  private tokenListeners = new Set<TokenListener>();
  private sessionExpiredListeners = new Set<SessionExpiredListener>();
  // Guards against firing the session-expired callbacks once per in-flight
  // request when several 401s land together. Reset on the next storeTokens.
  private sessionExpiredNotified = false;
  private lastRefreshError: ApiError | null = null;
  // Tokens in memory after the first EncryptedStorage pass; null until then.
  // Only storeTokens and clearTokens write the stored tokens and both keep
  // this in step, so every later read is served from memory.
  private tokens: TokenCache | null = null;
  private tokensLoad: Promise<TokenCache> | null = null;
  // Bumped by every write, so a load that started before a write cannot put
  // the old values back into memory when it lands.
  private tokenWrites = 0;

  private constructor() {
    // Main Axios instance with interceptors
    this.axiosInstance = axios.create({
      baseURL: __DEV__ ? API_CONFIG.BASE_URL : API_CONFIG.BASE_URL_PRODUCTION,
      timeout: API_CONFIG.CONNECTION_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    // Separate Axios instance for refresh requests (no interceptors)
    this.refreshAxiosInstance = axios.create({
      baseURL: __DEV__ ? API_CONFIG.BASE_URL : API_CONFIG.BASE_URL_PRODUCTION,
      timeout: API_CONFIG.CONNECTION_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    this.setupInterceptors();
  }

  public static getInstance(): ApiClient {
    if (!ApiClient.instance) {
      ApiClient.instance = new ApiClient();
    }
    return ApiClient.instance;
  }

  // ============================================================================
  // Interceptor Setup
  // ============================================================================

  private setupInterceptors(): void {
    // Request interceptor: Add access token to headers
    this.axiosInstance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        if (config.headers) {
          // Ready for when the backend localises its messages; today they are
          // Turkish only and ApiError replaces them in another UI language.
          config.headers['Accept-Language'] = i18n.language;
        }
        if ((config as DetachedRequestConfig)._detached) {
          // Its own credentials (or none), never the session's.
          return config;
        }
        try {
          const accessToken = await this.getAccessToken();
          if (accessToken && config.headers) {
            config.headers.Authorization = `Bearer ${accessToken}`;
          }
        } catch (error) {
          console.error('Failed to get access token:', error);
        }
        return config;
      },
      (error: AxiosError) => {
        return Promise.reject(error);
      },
    );

    // Response interceptor: Handle token refresh on 401
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => {
        return response;
      },
      async (error: AxiosError) => {
        const originalRequest = error.config as DetachedRequestConfig & {
          _retry?: boolean;
        };

        const isAuthEndpoint =
          typeof originalRequest?.url === 'string' &&
          originalRequest.url.startsWith(AUTH_PATH_PREFIX);

        // Handle 401 Unauthorized - Token expired. A detached request is
        // about credentials that are not the session's: its 401 goes back to
        // the caller and never refreshes or ends the current session.
        if (
          error.response?.status === 401 &&
          originalRequest &&
          !originalRequest._retry &&
          !originalRequest._detached &&
          !isAuthEndpoint
        ) {
          originalRequest._retry = true;

          try {
            const newAccessToken = await this.handleTokenRefresh();

            // Update the failed request with new token
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            }

            // Retry the original request
            return this.axiosInstance(originalRequest);
          } catch (refreshError) {
            // Only a definitive auth failure ends the session. A network blip
            // during refresh must not log the user out.
            const apiError = isApiError(refreshError)
              ? refreshError
              : sessionExpiredError();
            if (apiError.code === API_ERROR_CODES.SESSION_EXPIRED) {
              await this.handleLogout();
            }
            return Promise.reject(apiError);
          }
        }

        // Handle 404 Not Found
        if (error.response?.status === 404) {
          console.warn('Resource not found:', originalRequest.url);
        }

        return Promise.reject(error);
      },
    );
  }

  // ============================================================================
  // Token Management
  // ============================================================================

  private async handleTokenRefresh(): Promise<string> {
    // If already refreshing, wait for the result
    if (this.isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        this.refreshSubscribers.push((token: string) => {
          if (token) {
            resolve(token);
          } else {
            // Same classification as the refresh that just failed, so a
            // network blip does not look like an expired session to waiters.
            reject(this.lastRefreshError ?? sessionExpiredError());
          }
        });
      });
    }

    this.isRefreshing = true;

    try {
      // 1. Try Firebase Auth pass-through refresh first (extremely robust)
      try {
        const firebaseUser = auth().currentUser;
        if (firebaseUser) {
          console.log('[ApiClient] Attempting Firebase silent token refresh...');
          const idToken = await firebaseUser.getIdToken(true);
          if (idToken) {
            const response = await this.refreshAxiosInstance.post<{
              accessToken: string;
              refreshToken: string;
            }>('/auth/firebase/verify', { idToken });

            const { accessToken, refreshToken: newRefreshToken } = response.data;
            await this.storeTokens(accessToken, newRefreshToken);

            // Notify all subscribers
            this.refreshSubscribers.forEach(callback => callback(accessToken));
            this.refreshSubscribers = [];

            this.isRefreshing = false;
            this.notifyTokensRefreshed(accessToken);
            return accessToken;
          }
        }
      } catch (firebaseError) {
        console.warn('[ApiClient] Firebase silent refresh failed, falling back to standard Refresh Token:', firebaseError);
      }

      // 2. Fallback to standard refresh token
      const refreshToken = await this.getRefreshToken();

      if (!refreshToken) {
        throw sessionExpiredError();
      }

      // Use separate axios instance to avoid infinite loop
      const response = await this.refreshAxiosInstance.post<TokenPair>(
        '/auth/refresh',
        {
          refreshToken,
        },
      );

      const {accessToken, refreshToken: newRefreshToken} = response.data;

      // Store new tokens
      await this.storeTokens(accessToken, newRefreshToken);

      // Notify all subscribers
      this.refreshSubscribers.forEach(callback => callback(accessToken));
      this.refreshSubscribers = [];

      this.isRefreshing = false;
      this.notifyTokensRefreshed(accessToken);
      return accessToken;
    } catch (error) {
      const classified = this.classifyRefreshError(error);
      this.lastRefreshError = classified;

      // Notify all subscribers of failure
      this.refreshSubscribers.forEach(callback => callback(''));
      this.refreshSubscribers = [];

      this.isRefreshing = false;
      throw classified;
    }
  }

  /**
   * Map a refresh failure to either SESSION_EXPIRED (the server rejected our
   * credentials, re-login required) or a transient ApiError (offline, 5xx,
   * maintenance) that keeps the session intact.
   */
  private classifyRefreshError(error: unknown): ApiError {
    if (isApiError(error)) {
      return error;
    }
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      if (status === undefined) {
        return apiErrorFromResponse(undefined, null);
      }
      if (status === 400 || status === 401 || status === 403 || status === 404) {
        return sessionExpiredError();
      }
      return apiErrorFromResponse(status, error.response?.data);
    }
    return sessionExpiredError();
  }

  /**
   * Force a token refresh outside of the 401 interceptor (used by the
   * WebSocket layer when the server drops the socket for an expired token).
   * Resolves to the new access token, or null when refreshing failed. A
   * definitive auth failure also triggers the session-expired flow.
   */
  public async refreshSession(): Promise<string | null> {
    try {
      return await this.handleTokenRefresh();
    } catch (error) {
      if (isApiError(error) && error.code === API_ERROR_CODES.SESSION_EXPIRED) {
        await this.handleLogout();
      }
      return null;
    }
  }

  // ============================================================================
  // Listeners
  // ============================================================================

  /** Called with the new access token after every successful refresh. */
  public onTokensRefreshed(listener: TokenListener): () => void {
    this.tokenListeners.add(listener);
    return () => {
      this.tokenListeners.delete(listener);
    };
  }

  /**
   * Called once when both refresh paths fail and the stored session has been
   * cleared. The auth store uses this to route the user back to login.
   */
  public onSessionExpired(listener: SessionExpiredListener): () => void {
    this.sessionExpiredListeners.add(listener);
    return () => {
      this.sessionExpiredListeners.delete(listener);
    };
  }

  private notifyTokensRefreshed(accessToken: string): void {
    this.tokenListeners.forEach(listener => {
      try {
        listener(accessToken);
      } catch (error) {
        console.warn('[ApiClient] token listener failed:', error);
      }
    });
  }

  public async storeTokens(
    accessToken: string,
    refreshToken: string,
  ): Promise<void> {
    if (!accessToken || !refreshToken) {
      throw new Error('Cannot store empty tokens');
    }

    this.tokenWrites += 1;
    try {
      await EncryptedStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      await EncryptedStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
      this.tokenWrites += 1;
      this.tokens = { access: accessToken, refresh: refreshToken };
      this.sessionExpiredNotified = false;
    } catch (error) {
      // One write may have landed: forget the memory copy so the next read
      // goes back to storage instead of trusting either pair.
      this.tokenWrites += 1;
      this.tokens = null;
      this.tokensLoad = null;
      console.error('Failed to store tokens:', error);
      throw new Error('Failed to store authentication tokens');
    }
  }

  public async clearTokens(): Promise<void> {
    // Memory first: a request that starts while the removes run already goes
    // out without the old token.
    this.tokenWrites += 1;
    this.tokens = { access: null, refresh: null };
    try {
      await EncryptedStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
      await EncryptedStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    } catch (error) {
      console.error('Failed to clear tokens:', error);
    }
  }

  /**
   * Both tokens in one storage pass, shared by every caller that asks while
   * it runs. A failed read is not kept, so the next call tries again.
   */
  private loadTokens(): Promise<TokenCache> {
    if (this.tokens) {
      return Promise.resolve(this.tokens);
    }
    if (!this.tokensLoad) {
      const load = this.readStoredTokens();
      this.tokensLoad = load;
      // readStoredTokens never rejects, so this chain cannot either.
      void load.then(() => {
        if (this.tokensLoad === load) {
          this.tokensLoad = null;
        }
      });
    }
    return this.tokensLoad;
  }

  private async readStoredTokens(): Promise<TokenCache> {
    const writesAtStart = this.tokenWrites;
    try {
      const [access, refresh] = await Promise.all([
        EncryptedStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN),
        EncryptedStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN),
      ]);
      const loaded: TokenCache = { access: access ?? null, refresh: refresh ?? null };
      if (this.tokenWrites === writesAtStart && !this.tokens) {
        this.tokens = loaded;
      }
      // A write that landed meanwhile wins over what was read.
      return this.tokens ?? loaded;
    } catch (error) {
      console.error('Failed to read tokens:', error);
      return this.tokens ?? { access: null, refresh: null };
    }
  }

  public async getAccessToken(): Promise<string | null> {
    return (await this.loadTokens()).access;
  }

  public async getRefreshToken(): Promise<string | null> {
    return (await this.loadTokens()).refresh;
  }

  /**
   * An access token that stays valid for at least `minValidityMs` (a stream
   * header carries it, and every range request of that stream until its next
   * reload needs it accepted: the player asks for the whole reload window).
   * Refreshes through the usual path when the stored token expires sooner or
   * cannot be decoded; `Number.POSITIVE_INFINITY` always refreshes. Null
   * without a session. When the refresh fails, the stored token is still
   * returned while it stays valid for the default two minutes (a network blip
   * on the refresh must not break a stream that token can still carry), and
   * null otherwise (a definitive auth failure has cleared it by then).
   */
  public async getFreshAccessToken(
    minValidityMs = DEFAULT_MIN_TOKEN_VALIDITY_MS,
  ): Promise<string | null> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      return null;
    }
    const expiresAt = jwtExpiryMs(accessToken);
    if (expiresAt !== null && expiresAt - Date.now() > minValidityMs) {
      return accessToken;
    }
    const refreshed = await this.refreshSession();
    if (refreshed) {
      return refreshed;
    }
    const stored = await this.getAccessToken();
    const storedExpiresAt = stored ? jwtExpiryMs(stored) : null;
    return stored &&
      storedExpiresAt !== null &&
      storedExpiresAt - Date.now() > DEFAULT_MIN_TOKEN_VALIDITY_MS
      ? stored
      : null;
  }

  private async handleLogout(): Promise<void> {
    await this.clearTokens();
    if (this.sessionExpiredNotified) {
      return;
    }
    this.sessionExpiredNotified = true;
    console.warn('Session expired - user needs to re-login');
    // Navigation is owned by the auth store; it subscribes via
    // onSessionExpired and routes back to the login flow.
    this.sessionExpiredListeners.forEach(listener => {
      try {
        listener();
      } catch (error) {
        console.warn('[ApiClient] session-expired listener failed:', error);
      }
    });
  }

  // ============================================================================
  // HTTP Methods with Type Safety
  // ============================================================================

  public async get<T = unknown>(
    path: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.get<T>(path, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'GET', path);
    }
  }

  public async post<T = unknown, D = unknown>(
    path: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.post<T>(path, data, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'POST', path);
    }
  }

  /**
   * A POST with credentials the caller captured earlier instead of the
   * stored ones: `accessToken` as the bearer, or no Authorization header when
   * null. A 401 is not refreshed and never runs the session-expired flow.
   * Sign-out sends its best-effort calls (push unregister, backend revoke)
   * this way after the local session is gone, so they can neither borrow,
   * refresh nor clear the tokens of a session started meanwhile.
   */
  public async postDetached<T = unknown, D = unknown>(
    path: string,
    data: D,
    accessToken: string | null,
    options?: { timeout?: number },
  ): Promise<T> {
    const config: AxiosRequestConfig & { _detached: true } = {
      _detached: true,
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
    };
    try {
      const response = await this.axiosInstance.post<T>(path, data, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'POST', path);
    }
  }

  public async put<T = unknown, D = unknown>(
    path: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.put<T>(path, data, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'PUT', path);
    }
  }

  public async patch<T = unknown, D = unknown>(
    path: string,
    data?: D,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.patch<T>(path, data, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'PATCH', path);
    }
  }

  public async delete<T = unknown>(
    path: string,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.delete<T>(path, config);
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'DELETE', path);
    }
  }

  // ============================================================================
  // File Upload
  // ============================================================================

  public async upload<T = unknown>(
    path: string,
    formData: FormData,
    onUploadProgress?: (progressEvent: {loaded: number; total?: number}) => void,
  ): Promise<T> {
    try {
      const response = await this.axiosInstance.post<T>(path, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress,
      });
      return response.data;
    } catch (error) {
      throw this.handleError(error, 'POST', path);
    }
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  private handleError(
    error: unknown,
    method: RequestMethod,
    path: string,
  ): ApiError {
    // Already mapped (e.g. SESSION_EXPIRED from the refresh interceptor).
    if (isApiError(error)) {
      return error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<unknown>;
      const apiError = apiErrorFromResponse(
        axiosError.response?.status,
        axiosError.response?.data,
        {method, path},
      );

      if (__DEV__) {
        console.warn(`[ApiClient] ${method} ${path} failed:`, {
          status: apiError.status,
          code: apiError.code,
          message: apiError.message,
        });
      }

      return apiError;
    }

    // Unknown error
    console.error(`[ApiClient] ${method} ${path} failed with unknown error:`, error);
    return new ApiError({
      message: ERROR_MESSAGES.UNKNOWN,
      status: 0,
      code: API_ERROR_CODES.UNKNOWN,
      method,
      path,
    });
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  public async isAuthenticated(): Promise<boolean> {
    const accessToken = await this.getAccessToken();
    return accessToken !== null;
  }

  public async hasValidTokens(): Promise<boolean> {
    const { access, refresh } = await this.loadTokens();
    return access !== null && refresh !== null;
  }

  public getBaseURL(): string {
    return this.axiosInstance.defaults.baseURL || '';
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default ApiClient.getInstance();
