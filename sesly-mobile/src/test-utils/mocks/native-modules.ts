import React from 'react';

// 1. react-native-encrypted-storage
jest.mock('react-native-encrypted-storage', () => ({
  setItem: jest.fn(() => Promise.resolve()),
  getItem: jest.fn(() => Promise.resolve(null)),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

// 2. @react-native-async-storage/async-storage
const mockAsyncStorageStore: Record<string, string> = {};
const mockAsyncStorage = {
  setItem: jest.fn((key: string, value: string) => {
    mockAsyncStorageStore[key] = value;
    return Promise.resolve();
  }),
  getItem: jest.fn((key: string) => {
    return Promise.resolve(mockAsyncStorageStore[key] || null);
  }),
  removeItem: jest.fn((key: string) => {
    delete mockAsyncStorageStore[key];
    return Promise.resolve();
  }),
  clear: jest.fn(() => {
    Object.keys(mockAsyncStorageStore).forEach(k => delete mockAsyncStorageStore[k]);
    return Promise.resolve();
  }),
  multiGet: jest.fn((keys: string[]) => {
    return Promise.resolve(keys.map(k => [k, mockAsyncStorageStore[k] || null]));
  }),
  multiSet: jest.fn((kvPairs: [string, string][]) => {
    kvPairs.forEach(([k, v]) => {
      mockAsyncStorageStore[k] = v;
    });
    return Promise.resolve();
  }),
  getAllKeys: jest.fn(() => Promise.resolve(Object.keys(mockAsyncStorageStore))),
  multiRemove: jest.fn((keys: string[]) => {
    keys.forEach(k => delete mockAsyncStorageStore[k]);
    return Promise.resolve();
  }),
};
jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// 3. @react-native-firebase/app
jest.mock('@react-native-firebase/app', () => ({
  initializeApp: jest.fn(),
  apps: [{ name: '[DEFAULT]' }],
}));

// 4. @react-native-firebase/auth
jest.mock('@react-native-firebase/auth', () => () => ({
  currentUser: {
    uid: 'mock-uid',
    email: 'mock@example.com',
    getIdToken: jest.fn().mockResolvedValue('mock-firebase-id-token'),
  },
  signInWithEmailAndPassword: jest.fn().mockResolvedValue({}),
  createUserWithEmailAndPassword: jest.fn().mockResolvedValue({}),
  signOut: jest.fn().mockResolvedValue(undefined),
  onAuthStateChanged: jest.fn((callback) => {
    callback({ uid: 'mock-uid', email: 'mock@example.com' });
    return jest.fn(); // unsubscribe function
  }),
}));

// 5. @react-native-firebase/messaging (modular API used by
// PushNotificationService, plus the legacy namespaced default export).
jest.mock('@react-native-firebase/messaging', () => {
  const AuthorizationStatus = {
    NOT_DETERMINED: -1,
    DENIED: 0,
    AUTHORIZED: 1,
    PROVISIONAL: 2,
    EPHEMERAL: 3,
  };
  const messagingInstance = {};
  const modular = {
    AuthorizationStatus,
    getMessaging: jest.fn(() => messagingInstance),
    getToken: jest.fn().mockResolvedValue('mock-fcm-token'),
    getAPNSToken: jest.fn().mockResolvedValue('mock-apns-token'),
    deleteToken: jest.fn().mockResolvedValue(undefined),
    hasPermission: jest.fn().mockResolvedValue(AuthorizationStatus.AUTHORIZED),
    requestPermission: jest.fn().mockResolvedValue(AuthorizationStatus.AUTHORIZED),
    onMessage: jest.fn(() => jest.fn()),
    onNotificationOpenedApp: jest.fn(() => jest.fn()),
    onTokenRefresh: jest.fn(() => jest.fn()),
    getInitialNotification: jest.fn().mockResolvedValue(null),
    setBackgroundMessageHandler: jest.fn(),
  };
  return {
    __esModule: true,
    ...modular,
    default: () => ({
      requestPermission: jest.fn().mockResolvedValue(true),
      getToken: jest.fn().mockResolvedValue('mock-fcm-token'),
      onMessage: jest.fn(() => jest.fn()),
      onNotificationOpenedApp: jest.fn(() => jest.fn()),
      getInitialNotification: jest.fn().mockResolvedValue(null),
    }),
  };
});

// 6. @react-native-google-signin/google-signin
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn().mockResolvedValue(true),
    signIn: jest.fn().mockResolvedValue({
      user: { id: 'google-id', email: 'google@example.com' },
      idToken: 'google-id-token',
    }),
    signOut: jest.fn().mockResolvedValue(undefined),
  },
}));

// 7. expo-audio (SDK 55 API: the surface the app imports). Suites that need
// to drive a player/recorder (useAudioPlayer, useVoiceRecording tests) mock
// the module locally with controllable fakes.
jest.mock('expo-audio', () => {
  const makePlayer = () => ({
    id: 'mock-player',
    playing: false,
    currentTime: 0,
    duration: 0,
    isLoaded: true,
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn().mockResolvedValue(undefined),
    replace: jest.fn(),
    remove: jest.fn(),
    release: jest.fn(),
    setPlaybackRate: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    setActiveForLockScreen: jest.fn(),
    updateLockScreenMetadata: jest.fn(),
    clearLockScreenControls: jest.fn(),
  });
  const makeRecorder = () => ({
    uri: 'file:///mock-recording.wav',
    isRecording: false,
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    release: jest.fn(),
    getStatus: jest.fn(() => ({ durationMillis: 0, metering: -160, isRecording: false })),
  });
  return {
    createAudioPlayer: jest.fn(() => makePlayer()),
    useAudioPlayer: jest.fn(() => makePlayer()),
    useAudioPlayerStatus: jest.fn(() => ({
      playing: false,
      currentTime: 0,
      duration: 0,
      isLoaded: true,
      didJustFinish: false,
    })),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    requestRecordingPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
    getRecordingPermissionsAsync: jest.fn().mockResolvedValue({ granted: true, status: 'granted' }),
    AudioModule: { AudioRecorder: jest.fn(() => makeRecorder()) },
    AudioQuality: { MIN: 0, LOW: 32, MEDIUM: 64, HIGH: 96, MAX: 127 },
    IOSOutputFormat: { LINEARPCM: 'lpcm', MPEG4AAC: 'aac ' },
  };
});

// 8. expo-file-system
jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-document-directory/',
  cacheDirectory: 'file:///mock-cache-directory/',
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn().mockResolvedValue('mock-content'),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, isDirectory: false }),
  downloadAsync: jest.fn().mockResolvedValue({ uri: 'file:///mock-downloaded-file.mp3' }),
}));

// 9. expo-font
jest.mock('expo-font', () => ({
  loadAsync: jest.fn().mockResolvedValue(true),
  isLoaded: jest.fn().mockReturnValue(true),
}));

// 10. expo-constants
jest.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {
        apiUrl: 'http://localhost:3000',
      },
    },
  },
}));

// 11. expo-image
jest.mock('expo-image', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: any) => React.createElement(View, props),
  };
});

// 12. react-native-gesture-handler: the library's own Jest setup (native
// module, buttons and Pressable mocked; GestureDetector and the gesture
// builders real, so `fireGestureHandler(getByGestureTestId(...))` from
// 'react-native-gesture-handler/jest-utils' drives a gesture's callbacks).
require('react-native-gesture-handler/jestSetup');

// 13. react-native-reanimated: the library mock (animations end at once and
// call their callback synchronously), plus the hooks it lacks. Its
// useSharedValue makes a new value on every render; here one value lives
// as long as the component, as in the app.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const Reanimated = require('react-native-reanimated/mock');
  Reanimated.default.call = () => {};
  Reanimated.useReducedMotion = () => false;
  const makeSharedValue = Reanimated.useSharedValue;
  Reanimated.useSharedValue = (initial: unknown) => React.useState(() => makeSharedValue(initial))[0];
  return Reanimated;
});

// 13b. react-native-worklets: the library mock, except that `scheduleOnRN`
// runs at once (the mock queues a microtask, which fake timers hold). With
// Reanimated's synchronous callbacks a sheet's or dialog's exit then ends
// inside the act() that started it.
jest.mock('react-native-worklets', () => ({
  ...require('react-native-worklets/lib/module/mock'),
  scheduleOnRN: (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
    fn(...args);
  },
}));

// 13c. modules/sesly-system-bars: the Modal's system-bars view, on Android
// only like the real module (Platform.OS read at the call).
jest.mock('../../../modules/sesly-system-bars', () => ({
  getModalSystemBars: () => {
    const { Platform, View } = require('react-native');
    return Platform.OS === 'android' ? View : null;
  },
}));

// 13d. Modal: React Native's mock, plus iOS's `onDismiss` once `visible`
// turns false (the real iOS Modal sends it when its window is gone).
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const Base = jest.requireActual('react-native/jest/mocks/Modal').default;
  class Modal extends Base {
    componentDidUpdate(prev: { visible?: boolean }) {
      super.componentDidUpdate?.(prev);
      const { Platform } = require('react-native');
      if (Platform.OS === 'ios' && prev.visible !== false && this.props.visible === false) {
        this.props.onDismiss?.();
      }
    }
  }
  return { __esModule: true, default: Modal };
});

// 14. react-native-safe-area-context
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: any) => React.createElement(View, {}, children),
    SafeAreaView: ({ children, ...props }: any) => React.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

// 15. react-native-navigation-bar-color
jest.mock('react-native-navigation-bar-color', () => jest.fn(() => Promise.resolve()));

// 16. (react-native-permissions removed: the app never used it)

// 17. socket.io-client
jest.mock('socket.io-client', () => {
  const mockSocket = {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  };
  return jest.fn(() => mockSocket);
});

// 18. expo-localization: the device is Turkish unless a test says otherwise.
// Tests change `mockDeviceLocale.locales` or set `.error` (missing native
// module); it resets after each test.
export const mockDeviceLocale: {
  locales: { languageCode: string | null; languageTag: string }[];
  error: Error | null;
} = {
  locales: [{ languageCode: 'tr', languageTag: 'tr-TR' }],
  error: null,
};
jest.mock('expo-localization', () => ({
  getLocales: () => {
    if (mockDeviceLocale.error) throw mockDeviceLocale.error;
    return mockDeviceLocale.locales;
  },
}));
afterEach(() => {
  mockDeviceLocale.locales = [{ languageCode: 'tr', languageTag: 'tr-TR' }];
  mockDeviceLocale.error = null;
});

// 19. expo-linear-gradient: a plain view is enough for layout assertions.
jest.mock('expo-linear-gradient', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { LinearGradient: (props: any) => React.createElement(View, props) };
});

// 20. react-native-keyboard-controller: the library's own Jest mock
// (KeyboardProvider as a host element, KeyboardAwareScrollView as ScrollView,
// KeyboardStickyView as View, hooks as jest.fn).
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);

// 21. expo-splash-screen: the native splash is held and released at boot.
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn().mockResolvedValue(true),
  hideAsync: jest.fn().mockResolvedValue(undefined),
  hide: jest.fn(),
  setOptions: jest.fn(),
}));

// 22. expo-keep-awake: the screen stays on during a voice take.
jest.mock('expo-keep-awake', () => ({
  ExpoKeepAwakeTag: 'ExpoKeepAwakeDefaultTag',
  KeepAwakeEventState: { RELEASE: 'release' },
  isAvailableAsync: jest.fn().mockResolvedValue(true),
  activateKeepAwake: jest.fn().mockResolvedValue(undefined),
  activateKeepAwakeAsync: jest.fn().mockResolvedValue(undefined),
  deactivateKeepAwake: jest.fn().mockResolvedValue(undefined),
  useKeepAwake: jest.fn(),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// 23. @react-native-community/netinfo: the library's Jest mock (online on
// cellular; fetch / refresh resolve, addEventListener returns an
// unsubscribe). Suites that drive connectivity mock it locally.
jest.mock('@react-native-community/netinfo', () =>
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

// 25. expo-iap: a store that connects and sells nothing (no products, no
// purchases). Suites that drive purchases (PurchaseStore) mock it locally
// with a controllable fake.
jest.mock('expo-iap', () => ({
  initConnection: jest.fn(async () => true),
  endConnection: jest.fn(async () => true),
  fetchProducts: jest.fn(async () => []),
  getAvailablePurchases: jest.fn(async () => []),
  requestPurchase: jest.fn(async () => null),
  finishTransaction: jest.fn(async () => undefined),
  restorePurchases: jest.fn(async () => undefined),
  deepLinkToSubscriptions: jest.fn(async () => undefined),
  purchaseUpdatedListener: jest.fn(() => ({ remove: jest.fn() })),
  purchaseErrorListener: jest.fn(() => ({ remove: jest.fn() })),
}));

// 26. @react-native-firebase/crashlytics (modular API used by
// services/crashReporting).
jest.mock('@react-native-firebase/crashlytics', () => {
  const instance = {};
  return {
    __esModule: true,
    getCrashlytics: jest.fn(() => instance),
    setCrashlyticsCollectionEnabled: jest.fn(async () => null),
    setUserId: jest.fn(async () => null),
    setAttributes: jest.fn(async () => null),
    log: jest.fn(),
    recordError: jest.fn(),
    crash: jest.fn(),
    sendUnsentReports: jest.fn(),
  };
});

// 24. modules/sesly-media is null in Jest (no native module), like on iOS.
// Suites that drive the Android session or the native sleep timer build a
// fake with this: every function of the module as a jest.fn (the sleep timer
// ones too, unless `sleepTimer: false`, an older binary) and `emit` for its
// events.
export function createSeslyMediaMock(options: { sleepTimer?: boolean } = {}) {
  type Listener = (event?: unknown) => void;
  const listeners = new Map<string, Listener[]>();
  const module = {
    activate: jest.fn(async (..._args: unknown[]) => undefined),
    updateMetadata: jest.fn(async (..._args: unknown[]) => undefined),
    deactivate: jest.fn(async () => undefined),
    isActive: jest.fn(() => false),
    armSleepTimer: jest.fn(async (..._args: unknown[]) => undefined),
    disarmSleepTimer: jest.fn(async (..._args: unknown[]) => undefined),
    isSleepTimerArmed: jest.fn(() => false),
    addListener: jest.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return {
        remove: () => listeners.set(event, (listeners.get(event) ?? []).filter(l => l !== listener)),
      };
    }),
  };
  if (options.sleepTimer === false) {
    const old = module as Partial<typeof module>;
    delete old.armSleepTimer;
    delete old.disarmSleepTimer;
    delete old.isSleepTimerArmed;
  }
  const emit = (event: string, body?: unknown) => (listeners.get(event) ?? []).forEach(l => l(body));
  return { module, emit };
}
