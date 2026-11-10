/**
 * AuthService unit tests.
 *
 * Firebase Auth, Google Sign-In, Apple Authentication, expo-crypto, ApiClient
 * and UserService are mocked locally (the global mocks lack the modular
 * Firebase API, provider credentials and Google status codes). The Firebase
 * mock also exposes connectAuthEmulator / useEmulator so a dev-only emulator
 * hook in AuthService does not break these tests.
 */
import { Platform } from 'react-native';
import { statusCodes } from '@react-native-google-signin/google-signin';
import { ApiError, apiErrorFromResponse } from './ApiError';
import {
  AuthFieldError,
  EMAIL_IN_USE_DIALOG,
  isAuthCancelledError,
  isAuthFieldError,
  isEmailInUseError,
} from './authErrors';
import { OAUTH_CONFIG } from '../config/constants';
import { AuthProvider, SubscriptionTier } from '../types/enums';
import type { User } from '../models/User';
import { msg } from '../i18n/messages';
import i18n from '../i18n';

type AuthServiceInstance = typeof import('./AuthService')['default'];

// ---------------------------------------------------------------------------
// ApiClient / UserService / firebase bootstrap
// ---------------------------------------------------------------------------

const mockApiPost = jest.fn<Promise<unknown>, [string, unknown, unknown?]>();
const mockStoreTokens = jest.fn<Promise<void>, [string, string]>();
const mockClearTokens = jest.fn<Promise<void>, []>();
const mockHasValidTokens = jest.fn<Promise<boolean>, []>();
const mockGetAccessToken = jest.fn<Promise<string | null>, []>();
const mockGetRefreshToken = jest.fn<Promise<string | null>, []>();
const mockApiPostDetached = jest.fn<Promise<unknown>, [string, unknown, string | null, unknown?]>();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    // Forward the axios config only when given, so 2-arg call assertions hold.
    post: (path: string, body: unknown, config?: unknown) =>
      config === undefined ? mockApiPost(path, body) : mockApiPost(path, body, config),
    storeTokens: (a: string, r: string) => mockStoreTokens(a, r),
    clearTokens: () => mockClearTokens(),
    hasValidTokens: () => mockHasValidTokens(),
    getAccessToken: () => mockGetAccessToken(),
    getRefreshToken: () => mockGetRefreshToken(),
    postDetached: (path: string, body: unknown, accessToken: string | null, options?: unknown) =>
      mockApiPostDetached(path, body, accessToken, options),
  },
}));

const mockGetCurrentUser = jest.fn<Promise<User>, [unknown?]>();
jest.mock('./UserService', () => ({
  __esModule: true,
  default: { getCurrentUser: (config?: unknown) => mockGetCurrentUser(config) },
}));

const mockEnsureFirebase = jest.fn<Promise<unknown>, []>();
jest.mock('./firebase', () => ({
  __esModule: true,
  ensureFirebaseInitialized: () => mockEnsureFirebase(),
  initializeFirebase: () => mockEnsureFirebase(),
}));

// ---------------------------------------------------------------------------
// @react-native-firebase/auth (namespaced default + modular getAuth)
// ---------------------------------------------------------------------------

interface MockFirebaseUser {
  uid: string;
  displayName: string | null;
  getIdToken: jest.Mock<Promise<string>, []>;
  updateProfile: jest.Mock<Promise<void>, [{ displayName?: string }]>;
  delete: jest.Mock<Promise<void>, []>;
}

const mockFirebaseUser: MockFirebaseUser = {
  uid: 'firebase-uid-1',
  displayName: null,
  getIdToken: jest.fn<Promise<string>, []>(),
  updateProfile: jest.fn<Promise<void>, [{ displayName?: string }]>(),
  delete: jest.fn<Promise<void>, []>(),
};
const mockAuthState: { currentUser: MockFirebaseUser | null } = {
  currentUser: null,
};
const mockSignInWithCredential = jest.fn<Promise<{ user: MockFirebaseUser }>, [unknown]>();
const mockSignInWithEmail = jest.fn<Promise<{ user: MockFirebaseUser }>, [string, string]>();
const mockCreateUser = jest.fn<Promise<{ user: MockFirebaseUser }>, [string, string]>();
const mockFirebaseSignOut = jest.fn<Promise<void>, []>();
const mockSendResetEmail = jest.fn<Promise<void>, [string]>();
const mockSetLanguageCode = jest.fn<Promise<void>, [string | null]>(() => Promise.resolve());
const mockGoogleCredential = jest.fn<unknown, [string]>();
const mockAppleCredential = jest.fn<unknown, [string, string]>();

jest.mock('@react-native-firebase/auth', () => {
  const instance = {
    get currentUser() {
      return mockAuthState.currentUser;
    },
    signInWithCredential: (c: unknown) => mockSignInWithCredential(c),
    signInWithEmailAndPassword: (e: string, p: string) => mockSignInWithEmail(e, p),
    createUserWithEmailAndPassword: (e: string, p: string) => mockCreateUser(e, p),
    signOut: () => mockFirebaseSignOut(),
    sendPasswordResetEmail: (e: string) => mockSendResetEmail(e),
    setLanguageCode: (code: string | null) => mockSetLanguageCode(code),
    useEmulator: () => undefined,
  };
  const GoogleAuthProvider = {
    credential: (token: string) => mockGoogleCredential(token),
  };
  const AppleAuthProvider = {
    credential: (token: string, nonce: string) => mockAppleCredential(token, nonce),
  };
  const auth = Object.assign(() => instance, { GoogleAuthProvider, AppleAuthProvider });
  return {
    __esModule: true,
    default: auth,
    getAuth: () => instance,
    connectAuthEmulator: () => undefined,
    GoogleAuthProvider,
    AppleAuthProvider,
  };
});

// ---------------------------------------------------------------------------
// Google Sign-In (v13 API: signIn resolves { type, data })
// ---------------------------------------------------------------------------

const mockGoogleConfigure = jest.fn<void, [unknown]>();
const mockGoogleHasPlayServices = jest.fn<Promise<boolean>, [unknown]>();
const mockGoogleSignIn = jest.fn<Promise<unknown>, []>();
const mockGoogleSignOut = jest.fn<Promise<null>, []>();

jest.mock('@react-native-google-signin/google-signin', () => ({
  __esModule: true,
  GoogleSignin: {
    configure: (o: unknown) => mockGoogleConfigure(o),
    hasPlayServices: (o: unknown) => mockGoogleHasPlayServices(o),
    signIn: () => mockGoogleSignIn(),
    signOut: () => mockGoogleSignOut(),
  },
  statusCodes: {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    SIGN_IN_REQUIRED: 'SIGN_IN_REQUIRED',
  },
}));

// ---------------------------------------------------------------------------
// Apple + crypto
// ---------------------------------------------------------------------------

const mockAppleSignInAsync = jest.fn<Promise<unknown>, [unknown]>();
jest.mock('expo-apple-authentication', () => ({
  __esModule: true,
  signInAsync: (o: unknown) => mockAppleSignInAsync(o),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));

const mockRandomUUID = jest.fn<string, []>();
const mockDigest = jest.fn<Promise<string>, [string, string]>();
jest.mock('expo-crypto', () => ({
  __esModule: true,
  randomUUID: () => mockRandomUUID(),
  digestStringAsync: (algorithm: string, data: string) => mockDigest(algorithm, data),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
}));

import AuthService, {
  FIREBASE_SIGN_OUT_TIMEOUT_MS,
  LOGOUT_REQUEST_TIMEOUT_MS,
  PASSWORD_RESET_PATH,
  RESTORE_REQUEST_TIMEOUT_MS,
  classifyRestoreFailure,
} from './AuthService';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Shape of AuthService.createAuthResponse().user in sesly-backend.
const backendUser = {
  id: '3f6a2c1e-8b7d-4e21-9a5c-0d1e2f3a4b5c',
  email: 'ayse.yilmaz@example.com',
  firstName: 'Ayse',
  lastName: 'Yilmaz',
  emailVerified: true,
  provider: 'GOOGLE',
  profileImageUrl:
    'https://storage.googleapis.com/sesly-media/avatars/3f6a.jpg?X-Goog-Signature=abc',
  subscriptionTier: null,
  subscriptionExpiresAt: null,
  createdAt: '2026-09-01T08:30:00.000Z',
  updatedAt: '2026-09-20T12:00:00.000Z',
};

const verifyResponse = {
  accessToken: 'backend-access-token',
  refreshToken: 'backend-refresh-token',
  user: backendUser,
};

const expectedUser: User = {
  id: backendUser.id,
  email: backendUser.email,
  firstName: 'Ayse',
  lastName: 'Yilmaz',
  profileImageUrl: backendUser.profileImageUrl,
  provider: AuthProvider.GOOGLE,
  emailVerified: true,
  subscriptionTier: SubscriptionTier.FREE,
  subscriptionExpiresAt: null,
  createdAt: new Date('2026-09-01T08:30:00.000Z'),
  updatedAt: new Date('2026-09-20T12:00:00.000Z'),
};

const GOOGLE_CREDENTIAL = { providerId: 'google.com', token: 'google-id-token', secret: '' };
const APPLE_CREDENTIAL = { providerId: 'apple.com', token: 'apple-identity-token', secret: 'raw' };
const RAW_NONCE = '9b2f6c1d-7e4a-4b3c-8d2e-1f0a9b8c7d6e';
const HASHED_NONCE = 'c0ffee00sha256hexdigest';

function appleCredential(overrides: Record<string, unknown> = {}) {
  return {
    user: '001234.abcdef.1234',
    state: null,
    fullName: {
      namePrefix: null,
      givenName: '  Ayse ',
      middleName: null,
      familyName: ' Yilmaz  ',
      nameSuffix: null,
      nickname: null,
    },
    email: 'relay@privaterelay.appleid.com',
    realUserStatus: 1,
    identityToken: 'apple-identity-token',
    authorizationCode: 'apple-auth-code',
    ...overrides,
  };
}

function codedError(code: string, message = `[${code}] developer text`): Error {
  return Object.assign(new Error(message), { code });
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the call to fail');
}

const allMocks = [
  mockApiPost,
  mockApiPostDetached,
  mockStoreTokens,
  mockClearTokens,
  mockHasValidTokens,
  mockGetAccessToken,
  mockGetRefreshToken,
  mockGetCurrentUser,
  mockEnsureFirebase,
  mockFirebaseUser.getIdToken,
  mockFirebaseUser.updateProfile,
  mockSignInWithCredential,
  mockSignInWithEmail,
  mockCreateUser,
  mockFirebaseSignOut,
  mockSendResetEmail,
  mockGoogleCredential,
  mockAppleCredential,
  mockGoogleConfigure,
  mockGoogleHasPlayServices,
  mockGoogleSignIn,
  mockGoogleSignOut,
  mockAppleSignInAsync,
  mockRandomUUID,
  mockDigest,
];

beforeEach(() => {
  allMocks.forEach(mock => mock.mockReset());
  mockSetLanguageCode.mockReset().mockResolvedValue(undefined);

  mockFirebaseUser.displayName = null;
  mockAuthState.currentUser = null;
  mockFirebaseUser.getIdToken.mockResolvedValue('firebase-id-token');
  mockFirebaseUser.updateProfile.mockResolvedValue(undefined);
  mockFirebaseUser.delete.mockReset().mockResolvedValue(undefined);

  mockSignInWithCredential.mockResolvedValue({ user: mockFirebaseUser });
  mockSignInWithEmail.mockResolvedValue({ user: mockFirebaseUser });
  mockCreateUser.mockResolvedValue({ user: mockFirebaseUser });
  mockFirebaseSignOut.mockResolvedValue(undefined);
  mockSendResetEmail.mockResolvedValue(undefined);
  mockGoogleCredential.mockReturnValue(GOOGLE_CREDENTIAL);
  mockAppleCredential.mockReturnValue(APPLE_CREDENTIAL);

  mockGoogleHasPlayServices.mockResolvedValue(true);
  mockGoogleSignIn.mockResolvedValue({
    type: 'success',
    data: {
      idToken: 'google-id-token',
      serverAuthCode: 'server-auth-code',
      scopes: [],
      user: { id: 'g-1', email: backendUser.email, name: 'Ayse Yilmaz' },
    },
  });
  mockGoogleSignOut.mockResolvedValue(null);

  mockRandomUUID.mockReturnValue(RAW_NONCE);
  mockDigest.mockResolvedValue(HASHED_NONCE);
  mockAppleSignInAsync.mockResolvedValue(appleCredential());

  mockApiPost.mockResolvedValue(verifyResponse);
  mockApiPostDetached.mockResolvedValue({ message: 'Logged out successfully' });
  mockStoreTokens.mockResolvedValue(undefined);
  mockClearTokens.mockResolvedValue(undefined);
  mockHasValidTokens.mockResolvedValue(true);
  mockGetAccessToken.mockResolvedValue('stored-access');
  mockGetRefreshToken.mockResolvedValue('stored-refresh');
  mockGetCurrentUser.mockResolvedValue(expectedUser);
  mockEnsureFirebase.mockResolvedValue({ name: '[DEFAULT]' });

  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

// ===========================================================================
// initialize
// ===========================================================================

// initialize() (AuthService.ts:73) and restoreSession() (AuthService.ts:363)
// load './firebase' and './UserService' through a dynamic import(). Metro
// rewrites that itself; under Jest it is turned into require() by
// src/test-utils/babel-plugin-jest-dynamic-import.js (wired in jest.config.js).
describe('initialize', () => {
  function freshService(): AuthServiceInstance {
    let service: AuthServiceInstance | undefined;
    jest.isolateModules(() => {
      service = (require('./AuthService') as typeof import('./AuthService')).default;
    });
    if (!service) {
      throw new Error('AuthService failed to load');
    }
    return service;
  }

  it('boots Firebase and configures Google Sign-In once', async () => {
    const service = freshService();

    await service.initialize();
    await service.initialize();

    expect(mockEnsureFirebase).toHaveBeenCalledTimes(1);
    expect(mockGoogleConfigure).toHaveBeenCalledTimes(1);
    expect(mockGoogleConfigure).toHaveBeenCalledWith({
      webClientId: OAUTH_CONFIG.GOOGLE.WEB_CLIENT_ID,
      offlineAccess: true,
      forceCodeForRefreshToken: true,
    });
  });

  it('rethrows setup failures and retries on the next call', async () => {
    const service = freshService();
    mockGoogleConfigure.mockImplementationOnce(() => {
      throw new Error('RNGoogleSignin: offline use requires server web ClientID');
    });

    await expect(service.initialize()).rejects.toThrow('offline use requires');
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(mockGoogleConfigure).toHaveBeenCalledTimes(2);
  });

  it('awaits Firebase: rejects when Firebase init rejects, and configures nothing', async () => {
    const service = freshService();
    mockEnsureFirebase.mockRejectedValueOnce(new Error('No Firebase App [DEFAULT]'));

    await expect(service.initialize()).rejects.toThrow('No Firebase App');
    expect(mockGoogleConfigure).not.toHaveBeenCalled();

    // Not marked initialized: the next call tries again.
    await expect(service.initialize()).resolves.toBeUndefined();
    expect(mockEnsureFirebase).toHaveBeenCalledTimes(2);
    expect(mockGoogleConfigure).toHaveBeenCalledTimes(1);
  });

  it('does not configure Google before Firebase init has resolved', async () => {
    const service = freshService();
    let finishFirebase: () => void = () => undefined;
    mockEnsureFirebase.mockReturnValueOnce(
      new Promise(resolve => {
        finishFirebase = () => resolve({ name: '[DEFAULT]' });
      }),
    );

    const pending = service.initialize();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(mockGoogleConfigure).not.toHaveBeenCalled();

    finishFirebase();
    await pending;
    expect(mockGoogleConfigure).toHaveBeenCalledTimes(1);
  });

  it('two concurrent calls share one run and configure once', async () => {
    const service = freshService();
    let finishFirebase: () => void = () => undefined;
    mockEnsureFirebase.mockReturnValueOnce(
      new Promise(resolve => {
        finishFirebase = () => resolve({ name: '[DEFAULT]' });
      }),
    );

    const first = service.initialize();
    const second = service.initialize();
    expect(second).toBe(first);
    finishFirebase();
    await Promise.all([first, second]);

    expect(mockEnsureFirebase).toHaveBeenCalledTimes(1);
    expect(mockGoogleConfigure).toHaveBeenCalledTimes(1);
  });

  it('concurrent callers of a failing run all see the failure', async () => {
    const service = freshService();
    mockEnsureFirebase.mockRejectedValueOnce(new Error('init failed'));

    const results = await Promise.allSettled([service.initialize(), service.initialize()]);

    expect(results.map(r => r.status)).toEqual(['rejected', 'rejected']);
    expect(mockEnsureFirebase).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Google
// ===========================================================================

describe('signInWithGoogle', () => {
  it('exchanges the Firebase token of a Google sign-in for backend tokens', async () => {
    const result = await AuthService.signInWithGoogle();

    expect(mockGoogleHasPlayServices).toHaveBeenCalledWith({
      showPlayServicesUpdateDialog: true,
    });
    expect(mockGoogleCredential).toHaveBeenCalledWith('google-id-token');
    expect(mockSignInWithCredential).toHaveBeenCalledWith(GOOGLE_CREDENTIAL);
    expect(mockFirebaseUser.getIdToken).toHaveBeenCalled();
    // The backend verifies the FIREBASE id token, never the Google one.
    expect(mockApiPost).toHaveBeenCalledTimes(1);
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
    });
    expect(mockStoreTokens).toHaveBeenCalledWith(
      'backend-access-token',
      'backend-refresh-token',
    );
    expect(result).toEqual({
      user: expectedUser,
      accessToken: 'backend-access-token',
      refreshToken: 'backend-refresh-token',
    });
  });

  it('fails when Google returns no id token', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'success', data: { idToken: null } });

    await expect(AuthService.signInWithGoogle()).rejects.toThrow(
      'No ID token received from Google',
    );
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  // Regression (fixed 2026-09-28, was BUG): @react-native-google-signin/google-signin 13.x no longer rejects with
  // statusCodes.SIGN_IN_CANCELLED when the user closes the picker; signIn()
  // resolves { type: 'cancelled', data: null } (translateCancellationError).
  // AuthService.signInWithGoogle (AuthService.ts:159-164) only reads
  // data?.idToken, so a plain cancel throws 'No ID token received from Google'
  // and useAuth shows the 'Google ile giris basarisiz' error toast. The
  // SIGN_IN_CANCELLED branch of handleGoogleSignInError is dead for signIn.
  it('maps a cancelled Google picker to the Turkish cancel message', async () => {
    mockGoogleSignIn.mockResolvedValue({ type: 'cancelled', data: null });

    const error = await capture(AuthService.signInWithGoogle());

    expect((error as Error).message).toBe('Google ile giriş iptal edildi');
    // Classified as a cancel so useAuth stays silent (no error toast).
    expect(isAuthCancelledError(error)).toBe(true);
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
  });

  it('fails when Firebase returns an empty id token', async () => {
    mockFirebaseUser.getIdToken.mockResolvedValue('');

    await expect(AuthService.signInWithGoogle()).rejects.toThrow(
      'Failed to get Firebase ID token',
    );
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it.each([
    [statusCodes.SIGN_IN_CANCELLED, 'Google ile giriş iptal edildi'],
    [statusCodes.IN_PROGRESS, 'Google ile giriş devam ediyor'],
  ])('maps a thrown %s to a Turkish message', async (code, message) => {
    mockGoogleSignIn.mockRejectedValue(codedError(code));

    await expect(AuthService.signInWithGoogle()).rejects.toThrow(message);
  });

  it('maps missing Play Services to a Turkish message', async () => {
    mockGoogleHasPlayServices.mockRejectedValue(
      codedError(statusCodes.PLAY_SERVICES_NOT_AVAILABLE),
    );

    await expect(AuthService.signInWithGoogle()).rejects.toThrow(
      'Google Play Services mevcut değil',
    );
    expect(mockGoogleSignIn).not.toHaveBeenCalled();
  });

  it.each([
    [statusCodes.IN_PROGRESS, 'Google ile giriş devam ediyor'],
    [statusCodes.PLAY_SERVICES_NOT_AVAILABLE, 'Google Play Services mevcut değil'],
  ])('%s carries its copy as a form-level AuthFieldError (the store toasts it)', async (code, message) => {
    mockGoogleHasPlayServices.mockRejectedValue(codedError(code));

    const error = await capture(AuthService.signInWithGoogle());

    expect(isAuthFieldError(error)).toBe(true);
    expect((error as AuthFieldError).field).toBeNull();
    expect((error as Error).message).toBe(message);
  });

  it('maps a Firebase failure after the picker like the other sign-ins', async () => {
    mockSignInWithCredential.mockRejectedValue(codedError('auth/network-request-failed'));

    const error = await capture(AuthService.signInWithGoogle());

    expect(isAuthFieldError(error)).toBe(true);
    expect((error as Error).message).toBe(msg('common.network'));
    expect((error as Error).message).not.toContain('developer text');

    mockSignInWithCredential.mockRejectedValue(codedError('auth/user-disabled'));
    await expect(AuthService.signInWithGoogle()).rejects.toThrow(msg('auth.accountDisabled'));
  });

  it('keeps the message of other coded errors and falls back when it is empty', async () => {
    mockGoogleSignIn.mockRejectedValueOnce(codedError('DEVELOPER_ERROR', 'Developer error'));
    await expect(AuthService.signInWithGoogle()).rejects.toThrow('Developer error');

    mockGoogleSignIn.mockRejectedValueOnce(codedError('DEVELOPER_ERROR', ''));
    await expect(AuthService.signInWithGoogle()).rejects.toThrow(
      'Google ile giriş başarısız',
    );
  });

  it('maps a non-Error rejection to the generic Google failure', async () => {
    mockGoogleSignIn.mockRejectedValue('native bridge gone');

    await expect(AuthService.signInWithGoogle()).rejects.toThrow(
      'Google ile giriş başarısız',
    );
  });

  it('passes backend ApiErrors (maintenance) through untouched', async () => {
    const maintenance = apiErrorFromResponse(503, {
      statusCode: 503,
      message: 'Sesly bakimda.',
    });
    mockApiPost.mockRejectedValue(maintenance);

    const error = await capture(AuthService.signInWithGoogle());

    expect(error).toBe(maintenance);
    expect(mockStoreTokens).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Apple
// ===========================================================================

describe('signInWithApple', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'ios');
  });

  it('is rejected outside iOS before touching Apple APIs', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');

    const error = await capture(AuthService.signInWithApple());

    // An AuthFieldError, so the store's toast keeps this copy.
    expect(isAuthFieldError(error)).toBe(true);
    expect((error as Error).message).toBe(
      'Apple ile giriş yalnızca iOS cihazlarda kullanılabilir',
    );
    expect(mockRandomUUID).not.toHaveBeenCalled();
    expect(mockAppleSignInAsync).not.toHaveBeenCalled();
  });

  it('sends the hashed nonce to Apple and the raw nonce to Firebase', async () => {
    const result = await AuthService.signInWithApple();

    expect(mockDigest).toHaveBeenCalledWith('SHA-256', RAW_NONCE);
    expect(mockAppleSignInAsync).toHaveBeenCalledWith({
      requestedScopes: [0, 1],
      nonce: HASHED_NONCE,
    });
    expect(mockAppleCredential).toHaveBeenCalledWith('apple-identity-token', RAW_NONCE);
    expect(mockSignInWithCredential).toHaveBeenCalledWith(APPLE_CREDENTIAL);
    expect(result.user).toEqual(expectedUser);
    expect(mockStoreTokens).toHaveBeenCalledWith(
      'backend-access-token',
      'backend-refresh-token',
    );
  });

  it('forwards the trimmed first-authorization name and sets the display name', async () => {
    await AuthService.signInWithApple();

    expect(mockFirebaseUser.updateProfile).toHaveBeenCalledWith({
      displayName: 'Ayse Yilmaz',
    });
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
      firstName: 'Ayse',
      lastName: 'Yilmaz',
    });
  });

  it('sends only the id token on later sign-ins without a name', async () => {
    mockAppleSignInAsync.mockResolvedValue(appleCredential({ fullName: null }));

    await AuthService.signInWithApple();

    expect(mockFirebaseUser.updateProfile).not.toHaveBeenCalled();
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
    });
  });

  it('ignores whitespace-only name parts', async () => {
    mockAppleSignInAsync.mockResolvedValue(
      appleCredential({ fullName: { givenName: ' Ayse ', familyName: '   ' } }),
    );

    await AuthService.signInWithApple();

    expect(mockFirebaseUser.updateProfile).toHaveBeenCalledWith({ displayName: 'Ayse' });
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
      firstName: 'Ayse',
    });
  });

  it('does not overwrite an existing Firebase display name', async () => {
    mockFirebaseUser.displayName = 'Ayse Y.';

    await AuthService.signInWithApple();

    expect(mockFirebaseUser.updateProfile).not.toHaveBeenCalled();
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
      firstName: 'Ayse',
      lastName: 'Yilmaz',
    });
  });

  it('still signs in when updating the display name fails', async () => {
    mockFirebaseUser.updateProfile.mockRejectedValue(new Error('profile write failed'));

    await expect(AuthService.signInWithApple()).resolves.toMatchObject({
      accessToken: 'backend-access-token',
    });
  });

  it.each(['ERR_REQUEST_CANCELED', 'ERR_CANCELED'])(
    'maps %s to the Turkish cancel message',
    async code => {
      mockAppleSignInAsync.mockRejectedValue(codedError(code));

      await expect(AuthService.signInWithApple()).rejects.toThrow(
        'Apple ile giriş iptal edildi',
      );
      expect(mockSignInWithCredential).not.toHaveBeenCalled();
    },
  );

  it('fails when Apple returns no identity token', async () => {
    mockAppleSignInAsync.mockResolvedValue(appleCredential({ identityToken: null }));

    await expect(AuthService.signInWithApple()).rejects.toThrow(
      'Apple kimlik bilgisi alınamadı',
    );
    expect(mockAppleCredential).not.toHaveBeenCalled();
  });

  it('fails when Firebase returns an empty id token', async () => {
    mockFirebaseUser.getIdToken.mockResolvedValue('');

    await expect(AuthService.signInWithApple()).rejects.toThrow(
      'Firebase kimlik bilgisi alınamadı',
    );
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it.each([
    ['auth/missing-or-invalid-nonce', 'Kimlik bilgisi doğrulanamadı. Lütfen tekrar dene.'],
    ['auth/invalid-credential', 'Kimlik bilgisi doğrulanamadı. Lütfen tekrar dene.'],
  ])('maps Firebase %s to a Turkish message without a field', async (code, message) => {
    mockSignInWithCredential.mockRejectedValue(codedError(code));

    const error = await capture(AuthService.signInWithApple());

    expect((error as Error).message).toBe(message);
    expect((error as AuthFieldError).field).toBeNull();
  });

  it('passes backend ApiErrors through untouched', async () => {
    const disabled = apiErrorFromResponse(403, {
      statusCode: 403,
      message: 'Hesabiniz askiya alindi.',
    });
    mockApiPost.mockRejectedValue(disabled);

    await expect(capture(AuthService.signInWithApple())).resolves.toBe(disabled);
  });
});

// ===========================================================================
// Email / password
// ===========================================================================

describe('loginWithEmail', () => {
  const credentials = { email: 'ayse.yilmaz@example.com', password: 'gizli-sifre' };

  it('signs in with Firebase and exchanges the id token', async () => {
    const result = await AuthService.loginWithEmail(credentials);

    expect(mockSignInWithEmail).toHaveBeenCalledWith(
      'ayse.yilmaz@example.com',
      'gizli-sifre',
    );
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
    });
    expect(result.user).toEqual(expectedUser);
  });

  it('maps auth/invalid-credential to the wrong email or password message', async () => {
    mockSignInWithEmail.mockRejectedValue(codedError('auth/invalid-credential'));

    await expect(AuthService.loginWithEmail(credentials)).rejects.toThrow(
      'E-posta veya şifre hatalı',
    );
  });

  it.each([
    ['auth/too-many-requests', 'Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.', null],
    ['auth/invalid-email', 'Geçersiz e-posta adresi', 'email'],
    ['auth/user-disabled', 'Bu hesap devre dışı bırakılmış', null],
    ['auth/user-not-found', 'Kullanıcı bulunamadı', 'email'],
    ['auth/wrong-password', 'Hatalı şifre', 'password'],
    ['auth/invalid-credential', 'E-posta veya şifre hatalı', 'password'],
    ['auth/network-request-failed', 'İnternet bağlantısı kurulamadı', null],
    ['auth/internal-error', 'Kimlik doğrulama hatası. Lütfen tekrar dene.', null],
  ])('maps Firebase %s to a Turkish message on field %p', async (code, message, field) => {
    mockSignInWithEmail.mockRejectedValue(
      codedError(code, `[${code}] An internal error has occurred.`),
    );

    const error = await capture(AuthService.loginWithEmail(credentials));

    expect(error).toBeInstanceOf(AuthFieldError);
    expect((error as Error).message).toBe(message);
    expect((error as AuthFieldError).field).toBe(field);
  });

  it('a backend failure after Firebase passes through as an ApiError (no field)', async () => {
    const forbidden = apiErrorFromResponse(403, { message: 'Hesabın askıya alındı.' });
    mockApiPost.mockRejectedValue(forbidden);

    const error = await capture(AuthService.loginWithEmail(credentials));

    expect(error).toBe(forbidden);
    expect(isAuthFieldError(error)).toBe(false);
  });

  it('maps a non-Error rejection to the generic Turkish message', async () => {
    mockSignInWithEmail.mockRejectedValue({ reason: 'bridge' });

    const error = await capture(AuthService.loginWithEmail(credentials));

    expect(error).toBeInstanceOf(AuthFieldError);
    expect((error as AuthFieldError).message).toBe('Bilinmeyen bir hata oluştu');
    expect((error as AuthFieldError).field).toBeNull();
  });
});

describe('registerWithEmail', () => {
  it('deletes the just-created Firebase user before signing out on EMAIL_IN_USE', async () => {
    const order: string[] = [];
    mockFirebaseUser.delete.mockImplementation(async () => {
      order.push('delete');
    });
    mockFirebaseSignOut.mockImplementation(async () => {
      order.push('signOut');
    });
    mockApiPost.mockRejectedValue(apiErrorFromResponse(409, { code: 'EMAIL_IN_USE' }));

    const error = await capture(
      AuthService.registerWithEmail({ email: 'ayse@example.com', password: 'gizli-sifre' }),
    );

    expect(isEmailInUseError(error)).toBe(true);
    expect(order).toEqual(['delete', 'signOut']);
  });

  it('still reports EMAIL_IN_USE when deleting the Firebase user fails', async () => {
    mockFirebaseUser.delete.mockRejectedValue(codedError('auth/requires-recent-login'));
    mockApiPost.mockRejectedValue(apiErrorFromResponse(409, { code: 'EMAIL_IN_USE' }));

    const error = await capture(
      AuthService.registerWithEmail({ email: 'ayse@example.com', password: 'gizli-sifre' }),
    );

    expect(isEmailInUseError(error)).toBe(true);
    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
  });

  it('splits a single full-name field and forwards first and last name', async () => {
    await AuthService.registerWithEmail({
      email: 'ayse@example.com',
      password: 'gizli-sifre',
      firstName: '  Ayse Nur   Yilmaz ',
    });

    expect(mockCreateUser).toHaveBeenCalledWith('ayse@example.com', 'gizli-sifre');
    expect(mockFirebaseUser.updateProfile).toHaveBeenCalledWith({
      displayName: 'Ayse Nur Yilmaz',
    });
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
      firstName: 'Ayse',
      lastName: 'Nur Yilmaz',
    });
  });

  it('keeps separately entered first and last names', async () => {
    await AuthService.registerWithEmail({
      email: 'ayse@example.com',
      password: 'gizli-sifre',
      firstName: ' Ayse Nur ',
      lastName: ' Yilmaz ',
    });

    expect(mockFirebaseUser.updateProfile).toHaveBeenCalledWith({
      displayName: 'Ayse Nur Yilmaz',
    });
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
      firstName: 'Ayse Nur',
      lastName: 'Yilmaz',
    });
  });

  it('skips the profile update and name fields without a name', async () => {
    await AuthService.registerWithEmail({
      email: 'ayse@example.com',
      password: 'gizli-sifre',
      firstName: '   ',
    });

    expect(mockFirebaseUser.updateProfile).not.toHaveBeenCalled();
    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', {
      idToken: 'firebase-id-token',
    });
  });

  it.each([
    ['auth/email-already-in-use', 'Bu e-posta adresi zaten kullanılıyor', 'email'],
    ['auth/weak-password', 'Şifre çok zayıf (minimum 6 karakter)', 'password'],
    // Only the e-mail login puts invalid-credential under the password.
    ['auth/invalid-credential', 'Kimlik bilgisi doğrulanamadı. Lütfen tekrar dene.', null],
    ['auth/operation-not-allowed', 'Kimlik doğrulama hatası. Lütfen tekrar dene.', null],
  ])('maps Firebase %s to a Turkish message on field %p', async (code, message, field) => {
    mockCreateUser.mockRejectedValue(codedError(code));

    const error = await capture(
      AuthService.registerWithEmail({ email: 'a@example.com', password: 'x' }),
    );

    expect(error).toBeInstanceOf(AuthFieldError);
    expect((error as Error).message).toBe(message);
    expect((error as AuthFieldError).field).toBe(field);
    expect(mockApiPost).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Token exchange
// ===========================================================================

describe('backend token exchange', () => {
  const login = () =>
    AuthService.loginWithEmail({ email: 'ayse@example.com', password: 'gizli-sifre' });
  const GENERIC = 'Sunucuyla oturum açılamadı. Lütfen tekrar dene.';

  it.each([
    ['no body', null],
    ['a non-object body', 'ok'],
    ['no access token', { ...verifyResponse, accessToken: '' }],
    ['no refresh token', { accessToken: 'a', user: backendUser }],
    ['an invalid user', { ...verifyResponse, user: { email: 'x@example.com' } }],
  ])('rejects %s with a generic Turkish error and stores nothing', async (_label, body) => {
    mockApiPost.mockResolvedValue(body);

    await expect(login()).rejects.toThrow(GENERIC);
    expect(mockStoreTokens).not.toHaveBeenCalled();
  });

  it('reports a token storage failure with the generic Turkish error', async () => {
    mockStoreTokens.mockRejectedValue(new Error('Failed to store authentication tokens'));

    await expect(login()).rejects.toThrow(GENERIC);
  });

  it('passes backend ApiErrors through untouched', async () => {
    const maintenance = apiErrorFromResponse(503, {});
    mockApiPost.mockRejectedValue(maintenance);

    const error = await capture(login());

    expect(error).toBe(maintenance);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isMaintenance).toBe(true);
  });

  it.each([
    ['email login', () => login()],
    ['Google', () => AuthService.signInWithGoogle()],
  ])(
    'maps 409 EMAIL_IN_USE (%s) to EmailInUseError and signs out of Firebase',
    async (_label, run) => {
      mockApiPost.mockRejectedValue(
        apiErrorFromResponse(409, { code: 'EMAIL_IN_USE', message: 'Email in use' }),
      );

      const error = await capture(run());

      expect(isEmailInUseError(error)).toBe(true);
      expect((error as Error).message).toBe(EMAIL_IN_USE_DIALOG.message);
      expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
      expect(mockGoogleSignOut).toHaveBeenCalledTimes(1);
      expect(mockStoreTokens).not.toHaveBeenCalled();
    },
  );

  it('still throws EmailInUseError when the Firebase sign-out fails', async () => {
    mockApiPost.mockRejectedValue(apiErrorFromResponse(409, { code: 'EMAIL_IN_USE' }));
    mockFirebaseSignOut.mockRejectedValue(codedError('auth/no-current-user'));

    const error = await capture(login());

    expect(isEmailInUseError(error)).toBe(true);
  });

  it('keeps other 409 answers as ApiErrors', async () => {
    const conflict = apiErrorFromResponse(409, { code: 'SOMETHING_ELSE', message: 'Çakışma' });
    mockApiPost.mockRejectedValue(conflict);

    await expect(login()).rejects.toBe(conflict);
    expect(mockFirebaseSignOut).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Session restore
// ===========================================================================

describe('restoreSession', () => {
  it('none: no backend call and nothing cleared when no tokens are stored', async () => {
    mockHasValidTokens.mockResolvedValue(false);

    await expect(AuthService.restoreSession()).resolves.toEqual({ status: 'none' });
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it('a failure while reading the tokens keeps them (server), it never signs out', async () => {
    mockHasValidTokens.mockRejectedValue(new Error('keystore locked'));

    await expect(AuthService.restoreSession()).resolves.toEqual({ status: 'server' });
    expect(mockClearTokens).not.toHaveBeenCalled();
  });
});

// Everything after `await import('./UserService')`; see the note above
// describe('initialize') for how the dynamic import runs under Jest.
describe('restoreSession after fetching the current user', () => {
  it('restored: returns the user and asks with the restore timeout', async () => {
    await expect(AuthService.restoreSession()).resolves.toEqual({
      status: 'restored',
      user: expectedUser,
    });
    expect(mockGetCurrentUser).toHaveBeenCalledWith({ timeout: RESTORE_REQUEST_TIMEOUT_MS });
    expect(RESTORE_REQUEST_TIMEOUT_MS).toBe(8000);
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404])('rejected: clears the tokens when the server answers %i', async status => {
    mockGetCurrentUser.mockRejectedValue(apiErrorFromResponse(status, {}));

    await expect(AuthService.restoreSession()).resolves.toEqual({ status: 'rejected' });
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });

  it('rejected: clears the tokens on SESSION_EXPIRED from the refresh path', async () => {
    mockGetCurrentUser.mockRejectedValue(
      new ApiError({ message: 'Oturum doldu', status: 401, code: 'SESSION_EXPIRED' }),
    );

    await expect(AuthService.restoreSession()).resolves.toEqual({ status: 'rejected' });
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['offline', 'no response', apiErrorFromResponse(undefined, null)],
    ['offline', 'the 8 s timeout', new ApiError({ message: 'x', status: 0, code: 'NETWORK_ERROR' })],
    ['maintenance', 'a 503', apiErrorFromResponse(503, { message: 'Bakim' })],
    ['server', 'a 500', apiErrorFromResponse(500, {})],
    ['server', 'a 502', apiErrorFromResponse(502, {})],
    ['server', 'a 429', apiErrorFromResponse(429, {})],
    ['server', 'a 400', apiErrorFromResponse(400, {})],
    ['server', 'status 0 UNKNOWN_ERROR', new ApiError({ message: 'x', status: 0, code: 'UNKNOWN_ERROR' })],
    ['server', 'a parse error', new Error('Invalid user data: missing or invalid id')],
  ])('%s and the tokens kept on %s', async (outcome, _label, error) => {
    mockGetCurrentUser.mockRejectedValue(error);

    await expect(AuthService.restoreSession()).resolves.toEqual({ status: outcome });
    expect(mockGetCurrentUser).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it('never reads the tokens again after the user arrived', async () => {
    await AuthService.restoreSession();

    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(mockGetRefreshToken).not.toHaveBeenCalled();
  });
});

describe('classifyRestoreFailure', () => {
  it('maps every failure the restore can see', () => {
    const api = (status: number, code: string | null = null) =>
      new ApiError({ message: 'x', status, code });

    expect(classifyRestoreFailure(api(401))).toBe('rejected');
    expect(classifyRestoreFailure(api(403))).toBe('rejected');
    expect(classifyRestoreFailure(api(404))).toBe('rejected');
    expect(classifyRestoreFailure(api(0, 'SESSION_EXPIRED'))).toBe('rejected');
    expect(classifyRestoreFailure(api(0, 'NETWORK_ERROR'))).toBe('offline');
    expect(classifyRestoreFailure(api(0, 'UNKNOWN_ERROR'))).toBe('server');
    expect(classifyRestoreFailure(api(503))).toBe('maintenance');
    expect(classifyRestoreFailure(api(500))).toBe('server');
    expect(classifyRestoreFailure(api(429))).toBe('server');
    expect(classifyRestoreFailure(new TypeError('x is undefined'))).toBe('server');
    expect(classifyRestoreFailure('weird')).toBe('server');
  });
});

// ===========================================================================
// Logout, password reset, current user
// ===========================================================================

describe('logout', () => {
  it('signs out of Firebase and Google and clears backend tokens', async () => {
    await AuthService.logout();

    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
    expect(mockGoogleSignOut).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });

  describe('backend session revocation (POST /auth/logout)', () => {
    it('posts the stored refresh token with a short timeout before anything is cleared', async () => {
      mockApiPost.mockResolvedValue({ message: 'Logged out successfully' });

      await AuthService.logout();

      expect(mockApiPost).toHaveBeenCalledTimes(1);
      expect(mockApiPost).toHaveBeenCalledWith(
        '/auth/logout',
        { refreshToken: 'stored-refresh' },
        { timeout: LOGOUT_REQUEST_TIMEOUT_MS },
      );
      const postedAt = mockApiPost.mock.invocationCallOrder[0];
      expect(postedAt).toBeLessThan(mockFirebaseSignOut.mock.invocationCallOrder[0]);
      expect(postedAt).toBeLessThan(mockClearTokens.mock.invocationCallOrder[0]);
      expect(LOGOUT_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    });

    it('skips the call when no refresh token is stored (session already expired)', async () => {
      mockGetRefreshToken.mockResolvedValue(null);

      await expect(AuthService.logout()).resolves.toBeUndefined();

      expect(mockApiPost).not.toHaveBeenCalled();
      expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
      expect(mockClearTokens).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['401 (already revoked / expired refresh token)', apiErrorFromResponse(401, { message: 'Invalid refresh token' })],
      ['offline', new Error('Network Error')],
    ])('a failing call (%s) never blocks the sign-out', async (_label, error) => {
      mockApiPost.mockRejectedValue(error);

      await expect(AuthService.logout()).resolves.toBeUndefined();

      expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
      expect(mockGoogleSignOut).toHaveBeenCalledTimes(1);
      expect(mockClearTokens).toHaveBeenCalledTimes(1);
    });

    it('a failing token read never blocks the sign-out', async () => {
      mockGetRefreshToken.mockRejectedValue(new Error('keystore locked'));

      await expect(AuthService.logout()).resolves.toBeUndefined();

      expect(mockApiPost).not.toHaveBeenCalled();
      expect(mockClearTokens).toHaveBeenCalledTimes(1);
    });

    it('a hanging call is abandoned after LOGOUT_REQUEST_TIMEOUT_MS', async () => {
      jest.useFakeTimers();
      try {
        mockApiPost.mockReturnValue(new Promise<unknown>(() => undefined));

        let settled = false;
        const pending = AuthService.logout().then(() => {
          settled = true;
        });

        await jest.advanceTimersByTimeAsync(LOGOUT_REQUEST_TIMEOUT_MS - 1);
        expect(settled).toBe(false);
        expect(mockClearTokens).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1);
        await pending;

        expect(settled).toBe(true);
        expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
        expect(mockClearTokens).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('ignores a Google sign-out failure', async () => {
    mockGoogleSignOut.mockRejectedValue(codedError('SIGN_IN_REQUIRED'));

    await expect(AuthService.logout()).resolves.toBeUndefined();
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });

  it('rethrows a Firebase sign-out failure after clearing local tokens', async () => {
    mockFirebaseSignOut.mockRejectedValue(codedError('auth/internal-error'));

    await expect(AuthService.logout()).rejects.toThrow('auth/internal-error');
    expect(mockClearTokens).toHaveBeenCalledTimes(1);
  });

  // Regression (fixed 2026-09-28, was BUG): RN Firebase signOut() rejects with auth/no-current-user when no
  // Firebase user is signed in (ReactNativeFirebaseAuthModule.signOut ->
  // promiseNoUser(promise, true)). AuthService.logout (AuthService.ts:316)
  // awaits it before ApiClient.clearTokens(), so the backend JWTs stay in
  // EncryptedStorage: useAuth.signOut shows 'Cikis yapilamadi' and the next
  // launch restores the session. Local tokens should be cleared regardless.
  it('clears backend tokens even when Firebase has no current user', async () => {
    mockFirebaseSignOut.mockRejectedValue(
      codedError('auth/no-current-user', '[auth/no-current-user] No user currently signed in.'),
    );

    await expect(AuthService.logout()).resolves.toBeUndefined();

    expect(mockClearTokens).toHaveBeenCalledTimes(1);
    expect(mockGoogleSignOut).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// Sign-out without waiting on the network (AuthStore.signOut, LA-4)
// ===========================================================================

describe('signOutFirebase (the one provider step a sign-out waits for)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('signs out of Firebase only: no Google, no network, no token change', async () => {
    await expect(AuthService.signOutFirebase()).resolves.toBeUndefined();

    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
    expect(mockGoogleSignOut).not.toHaveBeenCalled();
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockApiPostDetached).not.toHaveBeenCalled();
    expect(mockClearTokens).not.toHaveBeenCalled();
    expect(mockGetRefreshToken).not.toHaveBeenCalled();
  });

  it.each([
    ['no current user', codedError('auth/no-current-user')],
    ['an internal error', codedError('auth/internal-error')],
  ])('never throws (%s)', async (_label, error) => {
    mockFirebaseSignOut.mockRejectedValue(error);

    await expect(AuthService.signOutFirebase()).resolves.toBeUndefined();
  });

  it('gives up waiting after FIREBASE_SIGN_OUT_TIMEOUT_MS', async () => {
    mockFirebaseSignOut.mockReturnValue(new Promise<void>(() => undefined));
    let settled = false;
    const pending = AuthService.signOutFirebase().then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(FIREBASE_SIGN_OUT_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await pending;

    expect(settled).toBe(true);
    expect(FIREBASE_SIGN_OUT_TIMEOUT_MS).toBeLessThanOrEqual(2000);
  });
});

describe('finishSignOut (the background half of a sign-out)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  function gate() {
    let open!: () => void;
    const promise = new Promise<void>(resolve => {
      open = resolve;
    });
    return { promise, open };
  }

  it('signs out of Google at once and revokes the captured refresh token once `after` settled, detached', async () => {
    const unregister = gate();

    const run = AuthService.finishSignOut({ refreshToken: 'captured-refresh', after: unregister.promise });
    await jest.advanceTimersByTimeAsync(0);

    // Issued before anything else could start, the revoke still waits.
    expect(mockGoogleSignOut).toHaveBeenCalledTimes(1);
    expect(mockApiPostDetached).not.toHaveBeenCalled();

    unregister.open();
    await run;

    expect(mockApiPostDetached).toHaveBeenCalledTimes(1);
    // No bearer: the endpoint is proven by the refresh token, and the
    // session's own token is never borrowed.
    expect(mockApiPostDetached).toHaveBeenCalledWith(
      '/auth/logout',
      { refreshToken: 'captured-refresh' },
      null,
      { timeout: LOGOUT_REQUEST_TIMEOUT_MS },
    );
    // The stored tokens are none of its business.
    expect(mockClearTokens).not.toHaveBeenCalled();
    expect(mockGetRefreshToken).not.toHaveBeenCalled();
    expect(mockApiPost).not.toHaveBeenCalled();
    expect(mockFirebaseSignOut).not.toHaveBeenCalled();
  });

  it('skips the revoke without a refresh token', async () => {
    await AuthService.finishSignOut({ refreshToken: null });

    expect(mockApiPostDetached).not.toHaveBeenCalled();
    expect(mockGoogleSignOut).toHaveBeenCalledTimes(1);
  });

  it('never rejects: a failing `after`, Google sign-out or revoke is only logged', async () => {
    mockGoogleSignOut.mockRejectedValue(codedError('SIGN_IN_REQUIRED'));
    mockApiPostDetached.mockRejectedValue(apiErrorFromResponse(401, { message: 'Invalid refresh token' }));

    await expect(
      AuthService.finishSignOut({
        refreshToken: 'captured-refresh',
        after: Promise.reject(new Error('push down')),
      }),
    ).resolves.toBeUndefined();

    expect(mockApiPostDetached).toHaveBeenCalledTimes(1);
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it('a hanging revoke is abandoned after LOGOUT_REQUEST_TIMEOUT_MS', async () => {
    mockApiPostDetached.mockReturnValue(new Promise<unknown>(() => undefined));
    let settled = false;
    const run = AuthService.finishSignOut({ refreshToken: 'captured-refresh' }).then(() => {
      settled = true;
    });

    await jest.advanceTimersByTimeAsync(LOGOUT_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await run;

    expect(settled).toBe(true);
  });

  it('a sign-in started meanwhile exchanges its token only after the revoke, and keeps its tokens', async () => {
    const revoke = gate();
    mockApiPostDetached.mockReturnValue(revoke.promise);
    mockApiPost.mockResolvedValue(verifyResponse);

    const background = AuthService.finishSignOut({ refreshToken: 'old-refresh' });
    const signIn = AuthService.loginWithEmail({ email: 'ayse@example.com', password: 'secret-pass' });
    await jest.advanceTimersByTimeAsync(0);

    // The revoke would invalidate tokens issued now for the same account.
    expect(mockApiPost).not.toHaveBeenCalledWith('/auth/firebase/verify', expect.anything());

    revoke.open();
    await background;
    const response = await signIn;

    expect(mockApiPost).toHaveBeenCalledWith('/auth/firebase/verify', { idToken: 'firebase-id-token' });
    expect(mockApiPostDetached.mock.invocationCallOrder[0]).toBeLessThan(
      mockApiPost.mock.invocationCallOrder[0],
    );
    expect(response.accessToken).toBe('backend-access-token');
    expect(mockStoreTokens).toHaveBeenCalledWith('backend-access-token', 'backend-refresh-token');
    expect(mockClearTokens).not.toHaveBeenCalled();
  });

  it('a sign-in after the background work finished does not wait', async () => {
    await AuthService.finishSignOut({ refreshToken: 'old-refresh' });

    await expect(
      AuthService.loginWithEmail({ email: 'ayse@example.com', password: 'secret-pass' }),
    ).resolves.toMatchObject({ accessToken: 'backend-access-token' });
  });
});

describe('sendPasswordResetEmail', () => {
  it('asks the backend (POST /auth/password-reset) with the UI language, never Firebase', async () => {
    mockApiPost.mockResolvedValue({ accepted: true });

    await AuthService.sendPasswordResetEmail('ayse@example.com');

    expect(mockApiPost).toHaveBeenCalledWith(PASSWORD_RESET_PATH, { email: 'ayse@example.com', lang: 'tr' });
    expect(PASSWORD_RESET_PATH).toBe('/auth/password-reset');
    expect(mockSendResetEmail).not.toHaveBeenCalled();
    expect(mockSetLanguageCode).not.toHaveBeenCalled();
  });

  it('sends lang en when the app is in English', async () => {
    mockApiPost.mockResolvedValue({ accepted: true });
    await i18n.changeLanguage('en');
    try {
      await AuthService.sendPasswordResetEmail('emma@example.com');
    } finally {
      await i18n.changeLanguage('tr');
    }
    expect(mockApiPost).toHaveBeenCalledWith('/auth/password-reset', { email: 'emma@example.com', lang: 'en' });
  });

  it('429 (per IP or per address): the friendly too-many message on the form line', async () => {
    mockApiPost.mockRejectedValue(
      apiErrorFromResponse(429, { code: 'RATE_LIMITED', message: 'Çok fazla istek gönderdin.' }),
    );

    const error = await capture(AuthService.sendPasswordResetEmail('ayse@example.com'));

    expect(error).toBeInstanceOf(AuthFieldError);
    expect((error as Error).message).toBe('Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar dene.');
    expect((error as AuthFieldError).field).toBeNull();
  });

  it('429 in English', async () => {
    mockApiPost.mockRejectedValue(apiErrorFromResponse(429, { code: 'RATE_LIMITED', message: 'x' }));
    await i18n.changeLanguage('en');
    let error: unknown;
    try {
      error = await capture(AuthService.sendPasswordResetEmail('ayse@example.com'));
    } finally {
      await i18n.changeLanguage('tr');
    }
    expect((error as Error).message).toBe(msg('auth.tooManyAttempts', { lng: 'en' }));
    expect((error as Error).message).toBe('Too many attempts. Try again in a while.');
  });

  it('400: an invalid address under the email field', async () => {
    mockApiPost.mockRejectedValue(apiErrorFromResponse(400, { message: 'Geçerli bir e-posta adresi gir.' }));

    const error = await capture(AuthService.sendPasswordResetEmail('ayse@'));

    expect(error).toBeInstanceOf(AuthFieldError);
    expect((error as Error).message).toBe('Geçersiz e-posta adresi');
    expect((error as AuthFieldError).field).toBe('email');
  });

  it('offline and maintenance pass through as ApiErrors (their own copy)', async () => {
    const offline = new ApiError({ message: 'İnternet bağlantısı kurulamadı', status: 0, code: 'NETWORK_ERROR' });
    mockApiPost.mockRejectedValue(offline);
    await expect(capture(AuthService.sendPasswordResetEmail('ayse@example.com'))).resolves.toBe(offline);

    const maintenance = apiErrorFromResponse(503, { code: 'MAINTENANCE', message: 'Bakımdayız' });
    mockApiPost.mockRejectedValue(maintenance);
    await expect(capture(AuthService.sendPasswordResetEmail('ayse@example.com'))).resolves.toBe(maintenance);
  });
});

describe('current Firebase user', () => {
  it('is null without a signed-in user, else the signed-in user', () => {
    expect(AuthService.getCurrentFirebaseUser()).toBeNull();

    mockAuthState.currentUser = mockFirebaseUser;
    expect(AuthService.getCurrentFirebaseUser()).toBe(mockFirebaseUser);
  });
});
