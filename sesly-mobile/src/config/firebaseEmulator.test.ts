/**
 * Release safety of the dev-only Firebase Auth emulator hook: it may only
 * connect in a __DEV__ build with FIREBASE_AUTH_EMULATOR_HOST set, once.
 */
import { LogBox } from 'react-native';

const mockConnectAuthEmulator = jest.fn();
const mockAuthInstance = { name: 'auth' };
jest.mock('@react-native-firebase/auth', () => ({
  __esModule: true,
  default: () => mockAuthInstance,
  getAuth: () => mockAuthInstance,
  connectAuthEmulator: (...a: unknown[]) => mockConnectAuthEmulator(...a),
}));

let mockExtra: Record<string, unknown> | undefined;
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExtra === undefined ? null : { extra: mockExtra };
    },
  },
}));

type EmulatorModule = typeof import('./firebaseEmulator');

const globals = globalThis as unknown as { __DEV__: boolean };
const initialDev = globals.__DEV__;

/** A fresh copy, so the module's "connected" latch starts clear. */
function load(): EmulatorModule {
  let mod: EmulatorModule | undefined;
  jest.isolateModules(() => {
    mod = require('./firebaseEmulator') as EmulatorModule;
  });
  if (!mod) throw new Error('firebaseEmulator did not load');
  return mod;
}

beforeEach(() => {
  mockConnectAuthEmulator.mockReset();
  mockExtra = undefined;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  globals.__DEV__ = initialDev;
});

describe('connectFirebaseEmulatorsIfConfigured', () => {
  it('does nothing when __DEV__ is false, even with FIREBASE_AUTH_EMULATOR_HOST set', () => {
    globals.__DEV__ = false;
    mockExtra = { FIREBASE_AUTH_EMULATOR_HOST: '10.0.2.2:9099', E2E: '1' };

    const { connectFirebaseEmulatorsIfConfigured } = load();
    connectFirebaseEmulatorsIfConfigured();
    connectFirebaseEmulatorsIfConfigured();

    expect(mockConnectAuthEmulator).not.toHaveBeenCalled();
  });

  it('connects once with http://<host> in a dev build', () => {
    globals.__DEV__ = true;
    mockExtra = { FIREBASE_AUTH_EMULATOR_HOST: '10.0.2.2:9099' };

    const { connectFirebaseEmulatorsIfConfigured } = load();
    connectFirebaseEmulatorsIfConfigured();
    connectFirebaseEmulatorsIfConfigured();

    expect(mockConnectAuthEmulator).toHaveBeenCalledTimes(1);
    expect(mockConnectAuthEmulator).toHaveBeenCalledWith(mockAuthInstance, 'http://10.0.2.2:9099');
  });

  it.each([
    ['no expo config', undefined],
    ['no host', {}],
    ['an empty host', { FIREBASE_AUTH_EMULATOR_HOST: '' }],
    ['a host that is not a string', { FIREBASE_AUTH_EMULATOR_HOST: 9099 }],
  ])('does nothing in a dev build with %s', (_label, extra) => {
    globals.__DEV__ = true;
    mockExtra = extra as Record<string, unknown> | undefined;

    load().connectFirebaseEmulatorsIfConfigured();

    expect(mockConnectAuthEmulator).not.toHaveBeenCalled();
  });
});

describe('silenceLogBoxForE2EIfConfigured', () => {
  it('silences LogBox only with extra.E2E in a dev build', () => {
    const ignoreAll = jest.spyOn(LogBox, 'ignoreAllLogs').mockImplementation(() => undefined);

    globals.__DEV__ = true;
    mockExtra = {};
    load().silenceLogBoxForE2EIfConfigured();
    expect(ignoreAll).not.toHaveBeenCalled();

    globals.__DEV__ = false;
    mockExtra = { E2E: '1' };
    load().silenceLogBoxForE2EIfConfigured();
    expect(ignoreAll).not.toHaveBeenCalled();

    globals.__DEV__ = true;
    mockExtra = { E2E: '1' };
    load().silenceLogBoxForE2EIfConfigured();
    expect(ignoreAll).toHaveBeenCalledWith(true);
  });
});
