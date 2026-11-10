import React from 'react';
import { act, render } from '@testing-library/react-native';
import { ThemeProvider } from '../theme/ThemeProvider';
import type { PaletteKey } from '../theme/palettes';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DialogProvider } from '../hooks/useDialog';

interface RenderOptions {
  /** Palette to draw with (default gece-mavisi, the app default). */
  theme?: PaletteKey;
  /** Mount the real DialogProvider so `useDialog()` works in the tree. */
  withDialog?: boolean;
}

/**
 * Renders a React Native component wrapped inside essential application providers:
 * - ThemeProvider (default palette gece-mavisi)
 * - SafeAreaProvider (for layout)
 * - GestureHandlerRootView (for gesture tracking)
 * - DialogProvider (opt-in via `withDialog`)
 */
export function renderWithProviders(component: React.ReactElement, options?: RenderOptions) {
  return render(component, {
    wrapper: ({ children }) => (
      <ThemeProvider initialPalette={options?.theme ?? 'gece-mavisi'}>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <SafeAreaProvider>
            {options?.withDialog ? <DialogProvider>{children}</DialogProvider> : children}
          </SafeAreaProvider>
        </GestureHandlerRootView>
      </ThemeProvider>
    ),
  });
}

/**
 * Screen helper: renderWithProviders, then flush the mount-time async work
 * (screens kick off loads) inside act()
 * so assertions see a settled tree and React does not log act() warnings.
 */
export async function renderScreen(component: React.ReactElement, options?: RenderOptions) {
  const result = renderWithProviders(component, options);
  await act(async () => undefined);
  return result;
}
