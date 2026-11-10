/**
 * Sesly - AI Voice Cloning Storytelling App
 * React Native Application Entry Point
 *
 * The first render starts the launch (BootStore) and the splash safety
 * timer; nothing here awaits a service. The tree renders once the stored
 * language and palette are applied (`uiReady`) and the fonts are loaded (or
 * failed, or FONT_TIMEOUT_MS passed). Until then the native splash covers
 * the empty frame.
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, LogBox } from 'react-native';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useFonts } from 'expo-font';
import { observer } from 'mobx-react-lite';
import Ionicons from '@expo/vector-icons/Ionicons';
// Subpath imports: the package roots require every weight (16 Nunito files).
import { Baloo2_600SemiBold } from '@expo-google-fonts/baloo-2/600SemiBold';
import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';
import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';
import { RootNavigator } from './src/navigation/RootNavigator';
import { DialogProvider } from './src/hooks/useDialog';
import { SnackbarHost } from './src/components/design/Snackbar';
import { getBootStore } from './src/boot/BootStore';
import { startSplashSafetyTimer } from './src/boot/splash';
import { FONTS, useT } from './src/theme/theme';
import { ThemeProvider } from './src/theme/ThemeProvider';

/** The fonts are local files; past this something is broken. */
export const FONT_TIMEOUT_MS = 3000;

LogBox.ignoreLogs([
  'Non-serializable values were found in the navigation state',
  'ViewPropTypes will be removed from React Native',
]);

const App: React.FC = observer(() => {
  // Once, on the first render (both calls are idempotent).
  useState(() => {
    void getBootStore().start();
    startSplashSafetyTimer();
    return null;
  });
  const bootStore = getBootStore();

  const [fontsLoaded, fontError] = useFonts({
    // Playful typography: Baloo 2 600 for headings, Nunito 700 / 800 for
    // everything else, under the names `FONTS` in src/theme/theme.ts uses.
    [FONTS.display]: Baloo2_600SemiBold,
    [FONTS.body]: Nunito_700Bold,
    [FONTS.label]: Nunito_800ExtraBold,
    // The icon font, loaded with the text fonts so no icon pops in late.
    ...Ionicons.font,
  });
  const [fontTimeoutHit, setFontTimeoutHit] = useState(false);

  useEffect(() => {
    if (fontError) {
      console.warn('[Font] load error:', fontError);
    }
  }, [fontError]);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      return undefined;
    }
    const timer = setTimeout(() => {
      console.warn(`[Font] not loaded after ${FONT_TIMEOUT_MS} ms; rendering with system fallbacks`);
      setFontTimeoutHit(true);
    }, FONT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [fontsLoaded, fontError]);

  const fontsSettled = fontsLoaded || !!fontError || fontTimeoutHit;
  if (!bootStore.uiReady || !fontsSettled) {
    return null;
  }

  // Dark only. The palette is the one picked on the Profile screen
  // ("Renk paleti"), else the default.
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
});

/**
 * AppShell: hook-using wrapper split out so `useT` runs beneath the MobX
 * observer and inside `<ThemeProvider>`, so a palette switch recolours it.
 * KeyboardProvider keeps the app's own edge-to-edge layout. It takes no
 * statusBarTranslucent / navigationBarTranslucent / preserveEdgeToEdge: on
 * this edge-to-edge build it forces all three on by itself and a dev build
 * warns about each one passed ("values are ignored").
 */
const AppShell: React.FC = () => {
  const T = useT();

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: T.bg }}>
      <KeyboardProvider>
        <SafeAreaProvider initialMetrics={initialWindowMetrics}>
          <DialogProvider>
            <StatusBar
              barStyle="light-content"
              backgroundColor="transparent"
              translucent
            />
            <RootNavigator />
            <SnackbarHost />
          </DialogProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
};

export default App;
