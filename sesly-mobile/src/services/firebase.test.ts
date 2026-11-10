/**
 * Firebase app bootstrap: an existing default app is reused, otherwise one is
 * created from FIREBASE_CONFIG, and AuthService waits for it.
 */
import { FIREBASE_CONFIG } from '../config/constants';

const mockGetApps = jest.fn<unknown[], []>();
const mockGetApp = jest.fn<unknown, []>();
const mockInitializeApp = jest.fn<Promise<unknown>, [unknown]>();
jest.mock('@react-native-firebase/app', () => ({
  __esModule: true,
  getApps: () => mockGetApps(),
  getApp: () => mockGetApp(),
  initializeApp: (config: unknown) => mockInitializeApp(config),
}));

import { ensureFirebaseInitialized, initializeFirebase } from './firebase';

const existingApp = { name: '[DEFAULT]', source: 'native' };
const createdApp = { name: '[DEFAULT]', source: 'js' };

beforeEach(() => {
  mockGetApps.mockReset().mockReturnValue([]);
  mockGetApp.mockReset().mockReturnValue(existingApp);
  mockInitializeApp.mockReset().mockResolvedValue(createdApp);
});

describe('initializeFirebase', () => {
  it('returns getApp() when an app already exists (native config files)', async () => {
    mockGetApps.mockReturnValue([existingApp]);

    await expect(initializeFirebase()).resolves.toBe(existingApp);
    expect(mockInitializeApp).not.toHaveBeenCalled();
  });

  it('initializes the app from FIREBASE_CONFIG otherwise', async () => {
    await expect(initializeFirebase()).resolves.toBe(createdApp);
    expect(mockInitializeApp).toHaveBeenCalledWith(FIREBASE_CONFIG);
  });

  it('propagates an initializeApp rejection to the caller', async () => {
    mockInitializeApp.mockRejectedValue(new Error('missing google-services.json'));

    await expect(ensureFirebaseInitialized()).rejects.toThrow('google-services.json');
  });

  it('ensureFirebaseInitialized is the same entry point', () => {
    expect(ensureFirebaseInitialized).toBe(initializeFirebase);
  });
});
