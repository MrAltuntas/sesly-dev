/**
 * Side effects that must run before the first render, imported first by
 * index.ts.
 *
 * - The native splash stays up until src/boot/splash.ts releases it, and then
 *   fades out over 200 ms (the next picture is the same dark background).
 * - react-native-screens freezes inactive tabs and stack screens two or more
 *   levels down, so they stop re-rendering on store changes.
 *
 * Nothing else: index.ts is also evaluated for FCM headless tasks, so no boot
 * work (storage, network, socket) may start here. That starts on App's first
 * render (BootStore).
 */

import * as SplashScreen from 'expo-splash-screen';
import { enableFreeze } from 'react-native-screens';

export const SPLASH_FADE_MS = 200;

function holdNativeSplash(): void {
  try {
    SplashScreen.preventAutoHideAsync().catch(error => {
      console.warn('[splash] preventAutoHideAsync failed:', error);
    });
  } catch (error) {
    console.warn('[splash] preventAutoHideAsync failed:', error);
  }
  try {
    SplashScreen.setOptions({ fade: true, duration: SPLASH_FADE_MS });
  } catch (error) {
    console.warn('[splash] setOptions failed:', error);
  }
}

holdNativeSplash();
enableFreeze(true);
