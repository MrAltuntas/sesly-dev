/**
 * Authentication store (MobX) and its hook.
 *
 * BootStore owns the launch: it reads the boot snapshot and calls
 * `getAuthStore().initialize(snap)`. A returning user with a cached
 * /users/me answer is in the store synchronously, before the first Main
 * render, while the live check (`revalidate`) runs in the background. Only a
 * definitive answer from the backend ends a session; offline, a server
 * failure or maintenance keep the cached user and the tokens and retry when
 * the connection or the app comes back.
 */

import { makeAutoObservable, runInAction } from 'mobx';
import { useMemo } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FirebaseAuthTypes, getAuth } from '@react-native-firebase/auth';
import AuthService, { type RestoreResult } from '../services/AuthService';
import {
  EMAIL_IN_USE_DIALOG,
  type AuthErrorField,
  isAuthCancelledError,
  isAuthFieldError,
  isEmailInUseError,
} from '../services/authErrors';
import ApiClient from '../services/ApiClient';
import WebSocketService from '../services/WebSocketService';
import PushNotificationService from '../services/PushNotificationService';
import CacheService from '../services/CacheService';
import userPreferencesService from '../services/UserPreferencesService';
import { User } from '../models/User';
import { showToast } from '../utils/toast';
import { getErrorMessage, isApiError } from '../services/ApiError';
import { ERROR_MESSAGES } from '../config/constants';
import { msg } from '../i18n/messages';
import { setSessionUserId, runSessionEndHandlers } from '../stores/session';
import { connectivityStore } from '../stores/ConnectivityStore';
import {
  CACHED_USER_STORAGE_KEY,
  clearCachedUser,
  readCachedUser,
  writeCachedUser,
} from '../session/userCache';
import { claimCacheOwner } from '../session/cacheOwner';
import {
  type RestoreOutcome,
  isTransientRestoreOutcome,
} from '../session/restoreOutcome';

export type { RestoreOutcome } from '../session/restoreOutcome';

/** What the launch already read from storage (BootStore's snapshot). */
export interface AuthBootSnapshot {
  hasTokens: boolean;
  /** The raw `@sesly/me` value, parsed here. */
  cachedUserRaw: string | null;
}

/** Automatic restore retries (reconnect, app foreground) at most this often. */
export const AUTO_RESTORE_RETRY_INTERVAL_MS = 30000;

// ============================================================================
// Helpers
// ============================================================================

async function connectWebSocketIfPossible(): Promise<void> {
  try {
    // The service reads the latest stored access token on every (re)connect
    // and reconnects on token refresh / app foreground by itself.
    await WebSocketService.connect();
  } catch (error) {
    // Polling fallback is still active: log and continue.
    console.warn('WebSocket connect after auth failed:', error);
  }
}

/**
 * Fire-and-forget: warm up the user preferences cache so screens have an
 * instant snapshot to render on first mount. Never blocks the auth flow.
 */
function prefetchUserPreferences(): void {
  userPreferencesService.warmup().catch(error => {
    console.warn('Preference warmup failed:', error);
  });
}

/** The current Firebase user, or `fallback` when Firebase is not usable. */
function currentFirebaseUserOr(fallback: FirebaseUser | null): FirebaseUser | null {
  try {
    return AuthService.getCurrentFirebaseUser();
  } catch (error) {
    console.warn('Firebase user unavailable:', error);
    return fallback;
  }
}

/** Copy for the form error: msg() copy or the ApiError message. */
function formErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return getErrorMessage(error);
  }
  return msg('common.genericError');
}

/** Used when initialize() is called without BootStore's snapshot. */
async function readAuthSnapshot(): Promise<AuthBootSnapshot> {
  const [hasTokens, cachedUserRaw] = await Promise.all([
    ApiClient.hasValidTokens(),
    AsyncStorage.getItem(CACHED_USER_STORAGE_KEY).catch(() => null),
  ]);
  return { hasTokens, cachedUserRaw };
}

type FirebaseUser = FirebaseAuthTypes.User;

type PrivateFields =
  | 'initializing'
  | 'revalidating'
  | 'expiring'
  | 'signingOut'
  | 'sessionEpoch'
  | 'sessionStartedFor'
  | 'lastAutoRetryAt'
  | 'stopRetryListeners'
  | 'firebaseUnsubscribe';

// ============================================================================
// Auth Store (MobX)
// ============================================================================

class AuthStore {
  // Observable state
  user: FirebaseUser | null = null;
  backendUser: User | null = null;
  // No global busy flag: the auth screens keep their own pending state (the
  // pressed button spins), and nothing is busy during the launch restore.
  errorMessage = '';
  /** Where the auth screens show `errorMessage`; null is the form-level line. */
  errorField: AuthErrorField = null;
  /** True once initialize() finished, whatever happened inside it. */
  isInitialized = false;
  /**
   * How the stored session was checked: 'pending' until the first answer,
   * then the latest outcome ('restored' after a live user, 'none' after a
   * sign-out, 'rejected' after a session expiry).
   */
  restoreOutcome: RestoreOutcome | 'pending' = 'pending';
  /** The cached user is shown and the live check has not confirmed it yet. */
  sessionStale = false;
  /**
   * True from the start of signOut() until it failed or the next session
   * started (a successful sign-out keeps it, see runSignOut); see also
   * handleSessionExpired.
   */
  isSigningOut = false;
  /**
   * One-shot dialog for the auth screens (Login / Registration show it and
   * call clearAuthNotice). Set for 409 EMAIL_IN_USE instead of a toast.
   */
  authNotice: { title: string; message: string } | null = null;

  private initializing: Promise<void> | null = null;
  private revalidating: Promise<RestoreOutcome> | null = null;
  private expiring: Promise<void> | null = null;
  private signingOut: Promise<boolean> | null = null;
  // Bumped whenever a session starts or ends, so a restore answer about an
  // earlier session is dropped instead of signing someone back in.
  private sessionEpoch = 0;
  // The user the socket, the warmups and the cache owner check ran for.
  private sessionStartedFor: string | null = null;
  private lastAutoRetryAt = Number.NEGATIVE_INFINITY;
  private stopRetryListeners: (() => void) | null = null;
  private firebaseUnsubscribe: (() => void) | null = null;

  constructor() {
    makeAutoObservable<AuthStore, PrivateFields>(this, {
      initializing: false,
      revalidating: false,
      expiring: false,
      signingOut: false,
      sessionEpoch: false,
      sessionStartedFor: false,
      lastAutoRetryAt: false,
      stopRetryListeners: false,
      firebaseUnsubscribe: false,
    });
    // Both token refresh paths failed: ApiClient already cleared the stored
    // tokens. Tear the session down so the navigator routes to login instead
    // of leaving the user on Main with every request failing.
    ApiClient.onSessionExpired(() => {
      void this.handleSessionExpired();
    });
  }

  // Computed getters
  get isSignedIn(): boolean {
    return this.user !== null;
  }

  /**
   * True while either the Firebase user or the backend user is present.
   * The navigator watches this to leave authenticated screens.
   */
  get isAuthenticated(): boolean {
    return this.user !== null || this.backendUser !== null;
  }

  // ============================================================================
  // Session bookkeeping
  // ============================================================================

  /** Every change of the backend user goes through here (session.ts). */
  private setBackendUser(user: User | null): void {
    this.backendUser = user;
    setSessionUserId(user?.id ?? null);
  }

  /**
   * Puts a user into the store. 'cache' is the launch path (no Firebase, no
   * write); 'live' is an answer from the backend: it also takes the Firebase
   * user, confirms the session and refreshes the cached copy. The socket,
   * the warmups and the cache owner check run once per user and session.
   */
  private applySession(user: User, source: 'cache' | 'live'): void {
    runInAction(() => {
      // A new session: the last sign-out is over (see runSignOut).
      this.isSigningOut = false;
      this.setBackendUser(user);
      if (source === 'live') {
        this.user = currentFirebaseUserOr(this.user);
        this.sessionStale = false;
      }
    });
    if (source === 'live') {
      void writeCachedUser(user);
      this.stopRetryWatch();
    }
    if (this.sessionStartedFor !== user.id) {
      this.sessionStartedFor = user.id;
      void connectWebSocketIfPossible();
      prefetchUserPreferences();
      void claimCacheOwner(user.id);
    }
  }

  private completeSignIn(user: User): void {
    this.sessionEpoch += 1;
    this.applySession(user, 'live');
    runInAction(() => {
      this.restoreOutcome = 'restored';
    });
  }

  /**
   * A teardown started: a restore answer still in flight is about the session
   * that is ending and must not put the user (or @sesly/me) back meanwhile.
   */
  private abandonPendingRestore(): void {
    this.sessionEpoch += 1;
    this.stopRetryWatch();
  }

  /** The user leaves: everything that names them is cleared at once. */
  private endSession(outcome: 'none' | 'rejected'): void {
    this.sessionEpoch += 1;
    this.sessionStartedFor = null;
    this.stopRetryWatch();
    runInAction(() => {
      this.user = null;
      this.setBackendUser(null);
      this.sessionStale = false;
      this.restoreOutcome = outcome;
    });
  }

  /**
   * After a profile change (name edit): the store and the cached copy follow
   * the backend's answer. Ignored when it is about a user who left meanwhile.
   */
  updateBackendUser(user: User): void {
    if (this.backendUser?.id !== user.id) {
      return;
    }
    this.setBackendUser(user);
    void writeCachedUser(user);
  }

  // ============================================================================
  // Session expiry (refresh failed or the restore was rejected)
  // ============================================================================

  handleSessionExpired(): Promise<void> {
    if (this.expiring) {
      return this.expiring;
    }
    if (!this.isAuthenticated || this.isSigningOut) {
      // Nothing to tear down (e.g. a 401 before login or during restore), or
      // signOut is already tearing down: a 401 that lands meanwhile must not
      // toast "expired". Its own best-effort calls (push unregister, revoke)
      // run detached and never get here, also after an account deletion.
      return Promise.resolve();
    }
    const run = this.runSessionExpired();
    this.expiring = run;
    const release = () => {
      if (this.expiring === run) {
        this.expiring = null;
      }
    };
    run.then(release, release);
    return run;
  }

  private async runSessionExpired(): Promise<void> {
    console.warn('Session expired; returning to login');
    this.abandonPendingRestore();
    try {
      WebSocketService.disconnect();
    } catch (error) {
      console.warn('WebSocket disconnect after session expiry failed:', error);
    }
    try {
      await AuthService.logout();
    } catch (error) {
      console.warn('Firebase sign-out after session expiry failed:', error);
    }
    await runSessionEndHandlers();
    await ApiClient.clearTokens();
    await clearCachedUser();
    try {
      await userPreferencesService.clear();
    } catch (error) {
      console.warn('Preference cache clear after session expiry failed:', error);
    }

    this.endSession('rejected');
    showToast.error(ERROR_MESSAGES.SESSION_EXPIRED, msg('auth.sessionEndedTitle'));
  }

  // ============================================================================
  // Initialization (called by BootStore)
  // ============================================================================

  /**
   * Never throws and always ends with `isInitialized`. With tokens and a
   * cached user the user is applied before the first await, so the first
   * Main render has it; the live check then runs in the background. With
   * tokens and no cache the live check is awaited (BootStore waits on
   * `restoreOutcome`). Later calls share the first run.
   */
  initialize(snap?: AuthBootSnapshot): Promise<void> {
    if (!this.initializing) {
      this.initializing = this.runInitialize(snap);
    }
    return this.initializing;
  }

  private async runInitialize(given?: AuthBootSnapshot): Promise<void> {
    try {
      const snap = given ?? (await readAuthSnapshot());
      const cachedUser = snap.hasTokens ? readCachedUser(snap.cachedUserRaw) : null;
      if (!snap.hasTokens && snap.cachedUserRaw !== null) {
        // A user record without tokens belongs to a session that is over.
        void clearCachedUser();
      }
      if (cachedUser) {
        this.applySession(cachedUser, 'cache');
        runInAction(() => {
          this.sessionStale = true;
        });
      }

      try {
        await AuthService.initialize();
      } catch (error) {
        // Logged once, no toast: the cached session keeps working and the
        // auth screens report their own failures.
        console.warn('Auth initialization failed:', error);
      }

      this.subscribeFirebaseUser();

      if (cachedUser) {
        void this.revalidate();
      } else if (snap.hasTokens) {
        await this.revalidate();
      } else {
        runInAction(() => {
          this.restoreOutcome = 'none';
          // A Firebase session without a backend one stays visible, as before.
          this.user = currentFirebaseUserOr(this.user);
        });
      }
    } catch (error) {
      console.error('Auth initialization failed unexpectedly:', error);
      runInAction(() => {
        if (this.restoreOutcome === 'pending') {
          // Keeps the tokens: never sign out because of the app's own error.
          this.restoreOutcome = 'server';
        }
      });
    } finally {
      runInAction(() => {
        this.isInitialized = true;
      });
    }
  }

  private subscribeFirebaseUser(): void {
    if (this.firebaseUnsubscribe) {
      return;
    }
    try {
      this.firebaseUnsubscribe = getAuth().onAuthStateChanged(user => {
        runInAction(() => {
          this.user = user;
        });
      });
    } catch (error) {
      console.warn('Firebase auth state listener unavailable:', error);
    }
  }

  // ============================================================================
  // Live session check
  // ============================================================================

  /**
   * GET /users/me with the stored tokens (AuthService.restoreSession).
   * Concurrent calls share one request. Resolves to the outcome.
   */
  revalidate(): Promise<RestoreOutcome> {
    if (!this.revalidating) {
      const run = this.runRevalidate();
      this.revalidating = run;
      const release = () => {
        if (this.revalidating === run) {
          this.revalidating = null;
        }
      };
      run.then(release, release);
    }
    return this.revalidating;
  }

  /** NoInternet's retry button: a live check right now. */
  retryRestore(): Promise<RestoreOutcome> {
    return this.revalidate();
  }

  private async runRevalidate(): Promise<RestoreOutcome> {
    const epoch = this.sessionEpoch;
    let result: RestoreResult;
    try {
      result = await AuthService.restoreSession();
    } catch (error) {
      // restoreSession does not throw; if it ever does, keep the session.
      console.error('Session restore failed unexpectedly:', error);
      result = { status: 'server' };
    }
    if (epoch !== this.sessionEpoch) {
      // Someone signed in or out meanwhile: the answer is about a session
      // that is gone.
      return result.status;
    }

    switch (result.status) {
      case 'restored':
        this.applySession(result.user, 'live');
        runInAction(() => {
          this.restoreOutcome = 'restored';
        });
        break;
      case 'rejected':
      case 'none':
        await clearCachedUser();
        if (epoch !== this.sessionEpoch) {
          return result.status;
        }
        this.stopRetryWatch();
        runInAction(() => {
          this.restoreOutcome = result.status;
          this.sessionStale = false;
        });
        // 'none' (the tokens vanished) only ends a session the user sees.
        if (
          result.status === 'rejected' ? this.isAuthenticated : this.backendUser !== null
        ) {
          await this.handleSessionExpired();
        }
        break;
      default:
        // offline, server, maintenance: keep the cached user and the tokens.
        runInAction(() => {
          this.restoreOutcome = result.status;
        });
        this.startRetryWatch();
    }
    return result.status;
  }

  /** Retry a transient restore on reconnect and on app foreground. */
  private startRetryWatch(): void {
    if (this.stopRetryListeners) {
      return;
    }
    const offReconnect = connectivityStore.onReconnect(() => this.autoRetry());
    let removeAppState: (() => void) | null = null;
    try {
      const subscription = AppState.addEventListener(
        'change',
        (state: AppStateStatus) => {
          if (state === 'active' && !connectivityStore.offline) {
            this.autoRetry();
          }
        },
      );
      removeAppState = () => subscription.remove();
    } catch (error) {
      console.warn('AppState listener unavailable:', error);
    }
    this.stopRetryListeners = () => {
      offReconnect();
      removeAppState?.();
    };
  }

  private stopRetryWatch(): void {
    this.stopRetryListeners?.();
    this.stopRetryListeners = null;
  }

  private autoRetry(): void {
    if (!isTransientRestoreOutcome(this.restoreOutcome) || this.revalidating) {
      return;
    }
    const now = Date.now();
    if (now - this.lastAutoRetryAt < AUTO_RESTORE_RETRY_INTERVAL_MS) {
      return;
    }
    this.lastAutoRetryAt = now;
    void this.revalidate();
  }

  clearAuthNotice(): void {
    this.authNotice = null;
  }

  // ============================================================================
  // Sign-in helpers
  // ============================================================================

  /** A new attempt starts without the error of the previous one. */
  private beginAuthAttempt(): void {
    runInAction(() => {
      this.errorMessage = '';
      this.errorField = null;
    });
  }

  /**
   * Sign-in outcomes that are not plain failures: a closed picker stays
   * silent, EMAIL_IN_USE becomes a dialog (authNotice). Returns true when the
   * caller must not report an error.
   */
  private handleQuietAuthFailure(error: unknown): boolean {
    if (isAuthCancelledError(error)) {
      runInAction(() => {
        this.errorMessage = '';
        this.errorField = null;
      });
      return true;
    }
    if (isEmailInUseError(error)) {
      runInAction(() => {
        this.errorMessage = '';
        this.errorField = null;
        this.authNotice = { ...EMAIL_IN_USE_DIALOG };
      });
      return true;
    }
    return false;
  }

  /**
   * E-mail flows show their error once, on the form (under the field it
   * belongs to, or the form-level line), never as a toast.
   */
  private recordFormError(error: unknown): void {
    const message = formErrorMessage(error);
    runInAction(() => {
      this.errorMessage = message;
      this.errorField = isAuthFieldError(error) ? error.field : null;
    });
    console.warn('Auth form error:', message);
  }

  /** Google and Apple have no field to attach to: they keep a toast. */
  private recordProviderError(error: unknown, fallback: string): void {
    const message =
      isApiError(error) || isAuthFieldError(error) ? error.message || fallback : fallback;
    runInAction(() => {
      this.errorMessage = message;
      this.errorField = null;
    });
    console.error('Provider sign-in failed:', error);
    showToast.error(message, msg('common.errorTitle'));
  }

  // ============================================================================
  // Sign In with Google
  // ============================================================================

  async signInWithGoogle(): Promise<boolean> {
    this.beginAuthAttempt();
    try {
      const authResponse = await AuthService.signInWithGoogle();
      this.completeSignIn(authResponse.user);
      return true;
    } catch (error) {
      if (this.handleQuietAuthFailure(error)) return false;
      this.recordProviderError(error, msg('auth.googleFailed'));
      return false;
    }
  }

  // ============================================================================
  // Sign In with Apple
  // ============================================================================

  async signInWithApple(): Promise<boolean> {
    this.beginAuthAttempt();
    try {
      const authResponse = await AuthService.signInWithApple();
      this.completeSignIn(authResponse.user);
      return true;
    } catch (error) {
      if (this.handleQuietAuthFailure(error)) return false;
      this.recordProviderError(error, msg('auth.appleFailed'));
      return false;
    }
  }

  // ============================================================================
  // Sign In with Email and Password
  // ============================================================================

  async signInWithEmail(email: string, password: string): Promise<boolean> {
    this.beginAuthAttempt();
    try {
      const authResponse = await AuthService.loginWithEmail({ email, password });
      this.completeSignIn(authResponse.user);
      return true;
    } catch (error) {
      if (this.handleQuietAuthFailure(error)) return false;
      this.recordFormError(error);
      return false;
    }
  }

  // ============================================================================
  // Register with Email and Password
  // ============================================================================

  async registerWithEmail(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
  ): Promise<boolean> {
    this.beginAuthAttempt();
    try {
      const authResponse = await AuthService.registerWithEmail({
        email,
        password,
        firstName,
        lastName,
      });
      this.completeSignIn(authResponse.user);
      showToast.success(msg('auth.accountCreated'), msg('common.successTitle'));
      return true;
    } catch (error) {
      if (this.handleQuietAuthFailure(error)) return false;
      this.recordFormError(error);
      return false;
    }
  }

  // ============================================================================
  // Reset Password
  // ============================================================================

  async resetPassword(email: string): Promise<boolean> {
    this.beginAuthAttempt();
    try {
      await AuthService.sendPasswordResetEmail(email);
      showToast.success(msg('auth.resetSent'), msg('common.successTitle'));
      return true;
    } catch (error) {
      this.recordFormError(error);
      return false;
    }
  }

  // ============================================================================
  // Sign Out
  // ============================================================================

  /**
   * Nobody waits on the network: the credentials the best-effort calls need
   * are read first, then only local work runs (the Firebase sign-out, the
   * session end handlers that stop whatever plays or queues for this user,
   * clearing the tokens and the cached user) and the session is dropped, so
   * the navigator returns to Login at once. The push unregister, the backend
   * revoke and the Google sign-out finish in the background with the
   * captured credentials and never touch a session started meanwhile; cache
   * and preference cleanup runs afterwards too. The local steps that do not
   * depend on each other run side by side: the Firebase sign-out next to the
   * session end handlers, the token clear next to the cached user's.
   *
   * `isSigningOut` is true from the first moment (Profile shows it on the
   * sign-out button and disables "Hesabı sil"). After a successful sign-out
   * it stays true until the next session starts, so Profile never shows an
   * idle button in the frames before the navigator has left it
   * (SIGNOUT-IDLE-FLASH); a failed one turns it back off. Concurrent calls
   * share one run.
   */
  signOut(): Promise<boolean> {
    if (!this.signingOut) {
      const run = this.runSignOut();
      this.signingOut = run;
      const release = () => {
        if (this.signingOut === run) {
          this.signingOut = null;
        }
      };
      run.then(release, release);
    }
    return this.signingOut;
  }

  private async runSignOut(): Promise<boolean> {
    runInAction(() => {
      this.isSigningOut = true;
    });
    let signedOut = false;
    const startedAt = Date.now();
    try {
      // What the background calls need, read before the tokens are cleared
      // (from memory after the first read).
      const [accessToken, refreshToken] = await Promise.all([
        ApiClient.getAccessToken(),
        ApiClient.getRefreshToken(),
      ]);

      // From here on nothing may keep or bring back this session.
      this.abandonPendingRestore();

      // Push: takes the registered token now; POST /notifications/unregister
      // runs in the background with the captured JWT. Never rejects.
      const pushUnregistered = PushNotificationService.unregisterDevice(accessToken);
      pushUnregistered.catch(() => undefined);

      // Local and time-boxed; it must end before the tokens go (see
      // signOutFirebase), so it runs next to the end handlers below.
      const firebaseSignedOut = (async () => {
        try {
          await AuthService.signOutFirebase();
        } catch (firebaseError) {
          console.warn('Firebase sign-out failed; leaving the session anyway:', firebaseError);
        }
      })();

      // Google sign-out, then POST /auth/logout once the unregister (which
      // needs the access token the revoke invalidates) has settled.
      AuthService.finishSignOut({ refreshToken, after: pushUnregistered }).catch(
        backgroundError => {
          console.warn('Background sign-out failed:', backgroundError);
        },
      );

      // Tear down realtime connection so we don't leak the old token
      // across sessions.
      try {
        WebSocketService.disconnect();
      } catch (disconnectError) {
        console.warn('WebSocket disconnect on sign-out failed:', disconnectError);
      }

      // The handlers stop what plays or queues for this user while the
      // provider signs out; both before the tokens and the user go.
      await Promise.all([firebaseSignedOut, runSessionEndHandlers()]);
      const teardownMs = Date.now() - startedAt;
      await Promise.all([ApiClient.clearTokens(), clearCachedUser()]);
      if (__DEV__) {
        console.log(
          `[signOut] provider and end handlers ${teardownMs} ms, local clears ${Date.now() - startedAt - teardownMs} ms`,
        );
      }
      signedOut = true;
      this.endSession('none');

      // Background cleanup for the old user (audio files, images, settings).
      CacheService.clearAllCache().catch(cacheError => {
        console.warn('Cache clear on logout failed:', cacheError);
      });
      userPreferencesService.clear().catch(prefError => {
        console.warn('Preference cache clear on logout failed:', prefError);
      });

      return true;
    } catch (error) {
      const errorMsg = getErrorMessage(error, msg('auth.signOutFailed'));
      runInAction(() => {
        this.errorMessage = errorMsg;
      });
      console.error(errorMsg);
      showToast.error(msg('auth.signOutFailed'), msg('common.errorTitle'));
      return false;
    } finally {
      // Signed out: still busy until the navigator has left Profile (the
      // next session turns it off). Failed: the button is usable again.
      if (!signedOut) {
        runInAction(() => {
          this.isSigningOut = false;
        });
      }
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let authStoreInstance: AuthStore | null = null;

/** The one AuthStore of the app run (BootStore initializes it). */
export function getAuthStore(): AuthStore {
  if (!authStoreInstance) {
    authStoreInstance = new AuthStore();
  }
  return authStoreInstance;
}

export function useAuth(): AuthStore {
  return useMemo(getAuthStore, []);
}

// Export for testing or direct access
export { AuthStore };
