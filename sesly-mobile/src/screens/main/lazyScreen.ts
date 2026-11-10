/**
 * lazyScreen: a navigator route whose screen module is required on first use
 * (the root stack in RootNavigator and the Keşfet, Kütüphane and Sesim tabs
 * here). Metro runs every statically imported module before the first frame,
 * so only the launch path (Onboarding, Login, Main with the Home tab,
 * ForceUpdate, NoInternet) is imported; everything else loads when its route
 * is first rendered or preloaded.
 *
 *   <Stack.Screen name="Profile" getComponent={lazyScreen(() => require(...).default)} />
 *
 * React Navigation calls `getComponent` on every render of the route, so the
 * component is built once (inside its palette boundary, `withScreenPalette`)
 * and the same one is returned on every later call.
 */

import type React from 'react';
import { withScreenPalette } from '../../theme/ThemeProvider';

export type ScreenGetter<P extends object> = () => React.ComponentType<P>;

export function lazyScreen<P extends object>(load: () => React.ComponentType<P>): ScreenGetter<P> {
  let screen: React.ComponentType<P> | undefined;
  return () => {
    screen ??= withScreenPalette(load());
    return screen;
  };
}
