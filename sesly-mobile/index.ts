// First: holds the native splash and enables screen freezing (no boot work,
// see the module).
import './src/setup/entry';
import { registerRootComponent } from 'expo';

import { registerBackgroundMessageHandler } from './src/services/PushNotificationService';
import {
  connectFirebaseEmulatorsIfConfigured,
  silenceLogBoxForE2EIfConfigured,
} from './src/config/firebaseEmulator';
import { initCrashReporting } from './src/services/crashReporting';
import App from './App';

// Crashlytics first, so a crash during start is reported: collection in
// release builds only, the global JS error handler, unhandled promise
// rejections and the Sesly user id. No network or storage work.
initCrashReporting();

// Dev-only: route Firebase Auth to a local emulator when configured (e2e).
connectFirebaseEmulatorsIfConfigured();
silenceLogBoxForE2EIfConfigured();

// RNFirebase requires the background / quit-state message handler to be set
// before the root component is registered (Android headless task, iOS
// background launch). Keep this above registerRootComponent.
registerBackgroundMessageHandler();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
