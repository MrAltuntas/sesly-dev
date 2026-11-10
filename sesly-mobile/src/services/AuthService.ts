/**
 * Authentication Service
 * Handles Firebase Auth, Google Sign-In, and Apple Sign-In
 */

import auth, { FirebaseAuthTypes, getAuth } from '@react-native-firebase/auth';
import {
  GoogleSignin,
  statusCodes as GoogleStatusCodes,
} from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import ApiClient from './ApiClient';
import { API_ERROR_CODES, hasApiStatus, isApiError } from './ApiError';
import { OAUTH_CONFIG } from '../config/constants';
import { User, parseUserFromJSON } from '../models/User';
import { SplitName, normalizeRegistrationName } from '../utils/names';
import {
  AuthCancelledError,
  AuthErrorField,
  AuthFieldError,
  EmailInUseError,
  EMAIL_IN_USE_CODE,
  isAuthCancelledError,
  isAuthFieldError,
  isEmailInUseError,
} from './authErrors';
import { msg } from '../i18n/messages';
import { currentLanguage } from '../i18n/text';
import type { RestoreOutcome } from '../session/restoreOutcome';

type FirebaseUser = FirebaseAuthTypes.User;

/** Public endpoint of the backend's own, per-language password reset e-mail. */
export const PASSWORD_RESET_PATH = '/auth/password-reset';

/** POST /auth/logout never holds up a sign-out for longer than this. */
export const LOGOUT_REQUEST_TIMEOUT_MS = 3000;

/**
 * The one provider step a sign-out waits for (signOutFirebase): local, it
 * normally takes a few milliseconds.
 */
export const FIREBASE_SIGN_OUT_TIMEOUT_MS = 1500;

/**
 * GET /users/me during the launch restore. A timeout counts as offline: the
 * app keeps the session and retries when the connection comes back.
 */
export const RESTORE_REQUEST_TIMEOUT_MS = 8000;

export type { RestoreOutcome } from '../session/restoreOutcome';

export type RestoreResult =
  | { status: 'restored'; user: User }
  | { status: Exclude<RestoreOutcome, 'restored'> };

/**
 * How a failed GET /users/me with stored tokens ends the restore. Only a
 * definitive answer about the session (401, 403, 404: the user row is gone)
 * rejects it; anything else keeps the tokens for a retry, including a bug in
 * the app's own parsing: a user is never signed out because of it.
 */
export function classifyRestoreFailure(
  error: unknown,
): Exclude<RestoreOutcome, 'restored' | 'none'> {
  if (!isApiError(error)) {
    return 'server';
  }
  if (
    error.code === API_ERROR_CODES.SESSION_EXPIRED ||
    error.status === 401 ||
    error.status === 403 ||
    error.status === 404
  ) {
    return 'rejected';
  }
  if (error.status === 0) {
    return error.code === API_ERROR_CODES.NETWORK ? 'offline' : 'server';
  }
  if (error.status === 503) {
    return 'maintenance';
  }
  return 'server';
}

/** The field a Firebase auth code belongs to on the auth screens. */
function fieldForFirebaseCode(code: string, context: string): AuthErrorField {
  switch (code) {
    case 'auth/invalid-email':
    case 'auth/user-not-found':
    case 'auth/email-already-in-use':
      return 'email';
    case 'auth/wrong-password':
    case 'auth/weak-password':
      return 'password';
    case 'auth/invalid-credential':
      return context === 'Email login' ? 'password' : null;
    default:
      return null;
  }
}

function getErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

// ============================================================================
// Types
// ============================================================================

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

export {
  AuthCancelledError,
  EmailInUseError,
  EMAIL_IN_USE_CODE,
  EMAIL_IN_USE_DIALOG,
  isAuthCancelledError,
  isEmailInUseError,
} from './authErrors';

// ============================================================================
// Auth Service Class (Singleton)
// ============================================================================

class AuthService {
  private static instance: AuthService;
  private initialized = false;
  // BootStore and AuthStore can both ask while the first run is in flight.
  private initializing: Promise<void> | null = null;
  // The background half of the last sign-out (finishSignOut) while it runs.
  private pendingSignOut: Promise<void> | null = null;

  private constructor() { }

  public static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  // ============================================================================
  // Initialization
  // ============================================================================

  /**
   * Firebase and Google Sign-In configuration. Single-flight: concurrent
   * callers share one run; after a failure the next call tries again.
   */
  public initialize(): Promise<void> {
    if (this.initialized) {
      return Promise.resolve();
    }
    if (!this.initializing) {
      const run = this.configure();
      this.initializing = run;
      run.then(
        () => undefined,
        () => {
          if (this.initializing === run) {
            this.initializing = null;
          }
        },
      );
    }
    return this.initializing;
  }

  private async configure(): Promise<void> {
    try {
      const { ensureFirebaseInitialized } = await import('./firebase');
      await ensureFirebaseInitialized();

      GoogleSignin.configure({
        webClientId: OAUTH_CONFIG.GOOGLE.WEB_CLIENT_ID,
        offlineAccess: true,
        forceCodeForRefreshToken: true,
      });

      console.log('AuthService initialized');
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize AuthService:', error);
      throw error;
    }
  }

  // ============================================================================
  // Email/Password Authentication
  // ============================================================================

  public async loginWithEmail(
    credentials: LoginCredentials,
  ): Promise<AuthResponse> {
    try {
      // First, sign in with Firebase
      const firebaseCredential = await getAuth().signInWithEmailAndPassword(
        credentials.email,
        credentials.password,
      );

      // Get Firebase ID token
      const idToken = await firebaseCredential.user.getIdToken();

      // Exchange Firebase token for our backend tokens
      return await this.exchangeFirebaseToken(idToken);
    } catch (error: unknown) {
      throw this.handleAuthError(error, 'Email login');
    }
  }

  public async registerWithEmail(
    credentials: RegisterCredentials,
  ): Promise<AuthResponse> {
    try {
      // Create Firebase user
      const firebaseCredential = await getAuth().createUserWithEmailAndPassword(
        credentials.email,
        credentials.password,
      );

      const names = normalizeRegistrationName(
        credentials.firstName,
        credentials.lastName,
      );

      // Update profile with name if provided
      if (names.firstName || names.lastName) {
        await firebaseCredential.user.updateProfile({
          displayName: [names.firstName, names.lastName]
            .filter(Boolean)
            .join(' '),
        });
      }

      // Get Firebase ID token
      const idToken = await firebaseCredential.user.getIdToken();

      // Backend FirebaseTokenDto accepts firstName + lastName separately.
      return await this.exchangeFirebaseToken(idToken, names, {
        // The Firebase password user was created a moment ago for an e-mail
        // that already has a Sesly account (another sign-in method): remove
        // it again so it does not linger as an orphan that blocks a retry.
        onEmailInUse: () => firebaseCredential.user.delete(),
      });
    } catch (error: unknown) {
      throw this.handleAuthError(error, 'Email registration');
    }
  }

  // ============================================================================
  // Google Sign-In
  // ============================================================================

  public async signInWithGoogle(): Promise<AuthResponse> {
    try {
      // Check if device supports Google Play Services
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

      // Get user info from Google
      const signInResult = await GoogleSignin.signIn();
      // google-signin 13.x resolves { type: 'cancelled' } when the picker is
      // closed (it no longer rejects with SIGN_IN_CANCELLED).
      if (signInResult.type === 'cancelled') {
        throw new AuthCancelledError(msg('auth.googleCancelled'));
      }
      const googleIdToken = signInResult.data?.idToken;

      if (!googleIdToken) {
        throw new Error('No ID token received from Google');
      }

      // Create Firebase credential
      const googleCredential = auth.GoogleAuthProvider.credential(googleIdToken);

      // Sign in with Firebase
      const userCredential = await getAuth().signInWithCredential(googleCredential);

      // Get Firebase ID token for backend verification
      const firebaseIdToken = await userCredential.user.getIdToken();
      if (!firebaseIdToken) {
        throw new Error('Failed to get Firebase ID token');
      }

      // Exchange Firebase token for our backend tokens
      return await this.exchangeFirebaseToken(firebaseIdToken);
    } catch (error: unknown) {
      throw this.handleGoogleSignInError(error);
    }
  }

  // ============================================================================
  // Apple Sign-In (iOS only)
  // ============================================================================

  public async signInWithApple(): Promise<AuthResponse> {
    if (Platform.OS !== 'ios') {
      throw new AuthFieldError(msg('auth.appleIosOnly'), null);
    }

    try {
      // Apple gets SHA256(rawNonce); Firebase gets rawNonce and verifies the
      // hash against the identity token's `nonce` claim.
      // randomUUID is CSPRNG-backed (Hermes has no global crypto.getRandomValues).
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );

      // Start Apple authentication request
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashedNonce,
      });

      const { identityToken } = credential;

      if (!identityToken) {
        throw new Error(msg('auth.appleNoCredential'));
      }

      // Create Firebase credential from the Apple token + raw nonce
      const appleCredential = auth.AppleAuthProvider.credential(
        identityToken,
        rawNonce,
      );

      // Sign in with Firebase
      const userCredential = await getAuth().signInWithCredential(appleCredential);

      // Like the Google flow: the backend verifies a FIREBASE ID token, not
      // the raw Apple identity token.
      const firebaseIdToken = await userCredential.user.getIdToken();
      if (!firebaseIdToken) {
        throw new Error(msg('auth.noCredential'));
      }

      // Apple returns the full name only on the very first authorization;
      // forward it so the backend can store it.
      const names: SplitName = {};
      const given = credential.fullName?.givenName?.trim();
      const family = credential.fullName?.familyName?.trim();
      if (given) names.firstName = given;
      if (family) names.lastName = family;

      if ((names.firstName || names.lastName) && !userCredential.user.displayName) {
        try {
          await userCredential.user.updateProfile({
            displayName: [names.firstName, names.lastName].filter(Boolean).join(' '),
          });
        } catch (profileError) {
          console.warn('Apple display name update skipped:', profileError);
        }
      }

      return await this.exchangeFirebaseToken(firebaseIdToken, names);
    } catch (error: unknown) {
      throw this.handleAuthError(error, 'Apple Sign-In');
    }
  }

  /**
   * Revokes the Sign in with Apple tokens before the account is deleted
   * (App Store Review Guideline 5.1.1(v)). Apple's authorization code lives
   * five minutes, so the user confirms with Apple once more here; the fresh
   * credential signs in to Firebase (revokeToken needs a current user) and
   * Firebase revokes the code with the Apple key set on its Apple provider.
   *
   * Does nothing off iOS. Throws AuthCancelledError when the user closes the
   * Apple sheet (the caller stops the deletion); any other failure throws too,
   * and the caller decides whether to delete anyway.
   */
  public async revokeAppleSignIn(): Promise<void> {
    if (Platform.OS !== 'ios') return;
    try {
      const rawNonce = Crypto.randomUUID();
      const hashedNonce = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        rawNonce,
      );
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [],
        nonce: hashedNonce,
      });
      const { identityToken, authorizationCode } = credential;
      if (!identityToken || !authorizationCode) {
        throw new Error(msg('auth.appleNoCredential'));
      }
      const firebaseAuth = getAuth();
      await firebaseAuth.signInWithCredential(
        auth.AppleAuthProvider.credential(identityToken, rawNonce),
      );
      await firebaseAuth.revokeToken(authorizationCode);
    } catch (error: unknown) {
      throw this.handleAuthError(error, 'Apple revoke');
    }
  }

  // ============================================================================
  // Token Exchange with Backend
  // ============================================================================

  private async exchangeFirebaseToken(
    idToken: string,
    names?: SplitName,
    options?: {
      /** Runs on EMAIL_IN_USE while the Firebase user is still signed in. */
      onEmailInUse?: () => Promise<void>;
    },
  ): Promise<AuthResponse> {
    try {
      // A sign-out moments ago may still be revoking its session: POST
      // /auth/logout bumps the account's token version, which would also
      // invalidate the tokens issued here for the same account. Everything
      // in it is time-boxed and it never rejects.
      if (this.pendingSignOut) {
        await this.pendingSignOut;
      }
      const response = await ApiClient.post<unknown>('/auth/firebase/verify', {
        idToken,
        ...(names?.firstName ? { firstName: names.firstName } : {}),
        ...(names?.lastName ? { lastName: names.lastName } : {}),
      });

      // Parse response with strict type checking
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid response from authentication server');
      }

      const data = response as Record<string, unknown>;

      if (typeof data.accessToken !== 'string' || !data.accessToken) {
        throw new Error('No access token in response');
      }
      if (typeof data.refreshToken !== 'string' || !data.refreshToken) {
        throw new Error('No refresh token in response');
      }

      const user = parseUserFromJSON(data.user);

      // Store tokens
      await ApiClient.storeTokens(data.accessToken, data.refreshToken);

      return {
        user,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
      };
    } catch (error) {
      console.error('Token exchange failed:', error);
      // 409 EMAIL_IN_USE: the address belongs to an account created with a
      // different sign-in method. Drop the half-open Firebase session so the
      // user is not left "signed in" to Firebase without a backend session.
      if (isApiError(error) && error.code === EMAIL_IN_USE_CODE) {
        if (options?.onEmailInUse) {
          try {
            await options.onEmailInUse();
          } catch (cleanupError) {
            console.warn('EMAIL_IN_USE cleanup failed:', cleanupError);
          }
        }
        await this.signOutProviders();
        throw new EmailInUseError();
      }
      // Backend errors (maintenance, disabled account, ...) already carry a
      // Turkish message; keep them intact.
      if (isApiError(error)) {
        throw error;
      }
      throw new Error(msg('auth.backendFailed'));
    }
  }

  // ============================================================================
  // Logout
  // ============================================================================

  public async logout(): Promise<void> {
    // Revoke the backend session while the refresh token is still stored.
    // Best effort: offline, timeout or 401 never block the local sign-out.
    await this.revokeBackendSession();

    let firebaseError: unknown = null;
    try {
      await getAuth().signOut();
    } catch (error) {
      // RN Firebase rejects with auth/no-current-user when nobody is signed
      // in to Firebase (e.g. a restored backend-only session): nothing to do.
      if (getErrorCode(error) !== 'auth/no-current-user') {
        firebaseError = error;
      }
    }

    // Sign out from Google if signed in
    try {
      await GoogleSignin.signOut();
    } catch (googleSignOutError) {
      // Ignore error if user was not signed in with Google
      console.log('Google sign out skipped or failed:', googleSignOutError);
    }

    // Always drop the backend session locally, even when Firebase failed:
    // otherwise the next launch silently restores the session.
    await ApiClient.clearTokens();

    if (firebaseError) {
      console.error('Logout failed:', firebaseError);
      throw firebaseError;
    }
    console.log('User logged out successfully');
  }

  // ============================================================================
  // Sign-out without waiting on the network (AuthStore.signOut)
  // ============================================================================

  /**
   * The one provider step a sign-out waits for, before it clears the stored
   * tokens: a Firebase user left signed in could mint new backend tokens for
   * the old account through ApiClient's silent refresh once they are gone.
   * Local and normally a few milliseconds; time-boxed by
   * FIREBASE_SIGN_OUT_TIMEOUT_MS (the call stays issued, so a sign-in that
   * follows still runs after it) and never throws: a failure does not keep
   * the user signed in.
   */
  public async signOutFirebase(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<void>(resolve => {
        timer = setTimeout(() => {
          console.warn('Firebase sign-out is slow; the sign-out goes on without it');
          resolve();
        }, FIREBASE_SIGN_OUT_TIMEOUT_MS);
      });
      await Promise.race([getAuth().signOut(), timeout]);
    } catch (error) {
      // auth/no-current-user: a backend-only session, nothing to sign out.
      if (getErrorCode(error) !== 'auth/no-current-user') {
        console.warn('Firebase sign-out failed; leaving the session anyway:', error);
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * The rest of a sign-out, after the local session is already gone; the
   * caller does not wait for it and it never rejects. The Google sign-out is
   * issued at once (before any new sign-in can start), then, once `after`
   * settled (the push unregister: it needs the access token this revoke
   * invalidates), POST /auth/logout with the refresh token the sign-out read
   * before clearing it, outside the ApiClient interceptors. It never touches
   * the stored tokens (the caller cleared them, and a session started
   * meanwhile keeps its own), and a sign-in started meanwhile waits for it
   * before its token exchange (see exchangeFirebaseToken).
   */
  public finishSignOut(options: {
    refreshToken: string | null;
    after?: Promise<unknown>;
  }): Promise<void> {
    const run = this.runFinishSignOut(options);
    this.pendingSignOut = run;
    void run.then(() => {
      if (this.pendingSignOut === run) {
        this.pendingSignOut = null;
      }
    });
    return run;
  }

  private async runFinishSignOut({
    refreshToken,
    after,
  }: {
    refreshToken: string | null;
    after?: Promise<unknown>;
  }): Promise<void> {
    let google: Promise<void> = Promise.resolve();
    try {
      google = GoogleSignin.signOut().then(
        () => undefined,
        (error: unknown) => console.log('Google sign out skipped or failed:', error),
      );
    } catch (error) {
      console.log('Google sign out skipped or failed:', error);
    }
    if (after) {
      try {
        await after;
      } catch (error) {
        console.warn('Sign-out step before the backend logout failed:', error);
      }
    }
    await this.revokeRefreshToken(refreshToken, () =>
      ApiClient.postDetached('/auth/logout', { refreshToken }, null, {
        timeout: LOGOUT_REQUEST_TIMEOUT_MS,
      }),
    );
    await google;
  }

  /**
   * POST /auth/logout with body { refreshToken }. The endpoint is public and
   * proven by the refresh token, so it also works after the 1 h access token
   * expired. The backend bumps the account's token version: every access and
   * refresh token issued so far stops working (this device and any stolen
   * copy). Skipped when no refresh token is stored (session already gone).
   * Time-boxed to LOGOUT_REQUEST_TIMEOUT_MS; never throws.
   */
  private async revokeBackendSession(): Promise<void> {
    let refreshToken: string | null;
    try {
      refreshToken = await ApiClient.getRefreshToken();
    } catch (error) {
      console.warn('Backend logout skipped or failed:', error);
      return;
    }
    await this.revokeRefreshToken(refreshToken, () =>
      ApiClient.post('/auth/logout', { refreshToken }, { timeout: LOGOUT_REQUEST_TIMEOUT_MS }),
    );
  }

  /** Runs `send` for a refresh token, time-boxed to LOGOUT_REQUEST_TIMEOUT_MS; never throws. */
  private async revokeRefreshToken(
    refreshToken: string | null,
    send: () => Promise<unknown>,
  ): Promise<void> {
    if (!refreshToken) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Backend logout timed out')),
          LOGOUT_REQUEST_TIMEOUT_MS,
        );
      });
      await Promise.race([send(), timeout]);
    } catch (error) {
      console.warn('Backend logout skipped or failed:', error);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /** Best-effort Firebase + Google sign-out (never throws). */
  private async signOutProviders(): Promise<void> {
    try {
      await getAuth().signOut();
    } catch (error) {
      console.log('Firebase sign out skipped or failed:', error);
    }
    try {
      await GoogleSignin.signOut();
    } catch (error) {
      console.log('Google sign out skipped or failed:', error);
    }
  }

  // ============================================================================
  // Password Reset
  // ============================================================================

  /**
   * POST /auth/password-reset { email, lang }: the backend sends its own
   * reset e-mail in the UI language (Firebase's template has one text for
   * every language). The answer is the same whether the address has an
   * account or not, so a success means "sent if the account exists". 429
   * (per IP or per address) and 400 get the app's own copy; anything else
   * keeps the ApiError message (offline, server, maintenance).
   */
  public async sendPasswordResetEmail(email: string): Promise<void> {
    try {
      await ApiClient.post(PASSWORD_RESET_PATH, { email, lang: currentLanguage() });
    } catch (error) {
      if (hasApiStatus(error, 429)) {
        throw new AuthFieldError(msg('auth.tooManyAttempts'), null);
      }
      if (hasApiStatus(error, 400)) {
        throw new AuthFieldError(msg('auth.invalidEmail'), 'email');
      }
      throw this.handleAuthError(error, 'Password reset');
    }
  }

  // ============================================================================
  // Session Restoration
  // ============================================================================

  /**
   * Checks the stored session with GET /users/me (RESTORE_REQUEST_TIMEOUT_MS).
   * Never throws: the result says how it ended, and only `rejected` clears
   * the stored tokens (see classifyRestoreFailure).
   */
  public async restoreSession(): Promise<RestoreResult> {
    try {
      const hasTokens = await ApiClient.hasValidTokens();
      if (!hasTokens) {
        return { status: 'none' };
      }

      // Imported here to avoid a circular dependency.
      const { default: UserService } = await import('./UserService');
      const user = await UserService.getCurrentUser({
        timeout: RESTORE_REQUEST_TIMEOUT_MS,
      });
      return { status: 'restored', user };
    } catch (error) {
      const outcome = classifyRestoreFailure(error);
      if (outcome === 'rejected') {
        // Expected after a long absence or a deleted account; not an error.
        console.warn('Stored session rejected; signing in again is required.');
        await ApiClient.clearTokens();
      } else {
        console.warn(`Session restore ended as ${outcome}; keeping the tokens:`, error);
      }
      return { status: outcome };
    }
  }
  // ============================================================================
  // Current User
  // ============================================================================

  public getCurrentFirebaseUser(): FirebaseUser | null {
    return getAuth().currentUser;
  }

  // ============================================================================
  // Error Handling
  // ============================================================================

  /**
   * Maps a sign-in, registration or reset failure to an error the auth
   * screens show once, under the right field (AuthFieldError.field).
   * ApiError, EmailInUseError and AuthCancelledError pass through unchanged
   * (callers branch on their status and code; their field is null).
   */
  private handleAuthError(error: unknown, context: string): Error {
    if (
      isApiError(error) ||
      isEmailInUseError(error) ||
      isAuthCancelledError(error) ||
      isAuthFieldError(error)
    ) {
      return error;
    }

    if (error instanceof Error) {
      console.error(`${context} error:`, error.message);

      // Firebase Auth errors
      const code = getErrorCode(error);
      if (code !== null) {
        const field = fieldForFirebaseCode(code, context);

        switch (code) {
          case 'ERR_REQUEST_CANCELED':
          case 'ERR_CANCELED':
            return new AuthCancelledError(msg('auth.appleCancelled'));
          case 'auth/invalid-credential':
            // Newer Firebase SDKs report a wrong email/password this way.
            return new AuthFieldError(
              context === 'Email login'
                ? msg('auth.wrongCredentials')
                : msg('auth.credentialRejected'),
              field,
            );
          case 'auth/missing-or-invalid-nonce':
            return new AuthFieldError(msg('auth.credentialRejected'), field);
          case 'auth/too-many-requests':
            return new AuthFieldError(msg('auth.tooManyAttempts'), field);
          case 'auth/invalid-email':
            return new AuthFieldError(msg('auth.invalidEmail'), field);
          case 'auth/user-disabled':
            return new AuthFieldError(msg('auth.accountDisabled'), field);
          case 'auth/user-not-found':
            return new AuthFieldError(msg('auth.userNotFound'), field);
          case 'auth/wrong-password':
            return new AuthFieldError(msg('auth.wrongPassword'), field);
          case 'auth/email-already-in-use':
            return new AuthFieldError(msg('auth.emailInUse'), field);
          case 'auth/weak-password':
            return new AuthFieldError(msg('auth.weakPassword'), field);
          case 'auth/network-request-failed':
            return new AuthFieldError(msg('common.network'), field);
          default:
            // Raw Firebase messages are English developer text.
            return new AuthFieldError(msg('auth.genericFailure'), field);
        }
      }

      // The app's own errors (no code) already carry msg() copy.
      return new AuthFieldError(error.message || msg('common.unknown'), null);
    }

    console.error(`${context} unknown error:`, error);
    return new AuthFieldError(msg('common.unknown'), null);
  }

  /**
   * The store's toast shows the copy of an AuthFieldError (or ApiError) and
   * the generic Google copy for anything else, so the known cases carry
   * their msg() copy as an AuthFieldError.
   */
  private handleGoogleSignInError(error: unknown): Error {
    if (
      isApiError(error) ||
      isEmailInUseError(error) ||
      isAuthCancelledError(error) ||
      isAuthFieldError(error)
    ) {
      return error;
    }
    if (error instanceof Error) {
      console.error('Google Sign-In error:', error.message);

      const code = getErrorCode(error);
      if (code !== null && code.startsWith('auth/')) {
        // Firebase after the Google picker (network, disabled account).
        return this.handleAuthError(error, 'Google Sign-In');
      }
      if (code !== null) {
        switch (code) {
          case GoogleStatusCodes.SIGN_IN_CANCELLED:
            return new AuthCancelledError(msg('auth.googleCancelled'));
          case GoogleStatusCodes.IN_PROGRESS:
            return new AuthFieldError(msg('auth.googleInProgress'), null);
          case GoogleStatusCodes.PLAY_SERVICES_NOT_AVAILABLE:
            return new AuthFieldError(msg('auth.noPlayServices'), null);
          default:
            return new Error(error.message || msg('auth.googleFailed'));
        }
      }

      return error;
    }

    console.error('Google Sign-In unknown error:', error);
    return new Error(msg('auth.googleFailed'));
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default AuthService.getInstance();