/**
 * ThemeProvider: which palette the app draws with.
 *
 * The app is dark only. The user picks one of six palettes on the Profile
 * screen ("Renk paleti"); the pick is stored on the device. Without a stored
 * pick the default palette is used.
 *
 * A switch is cheap (docs/release-pass/SPEC-design.md 2.4):
 * - the root context holds `palette`, the pick, applied at once, and
 *   `settled`, which catches up `SETTLE_DELAY_MS` later inside a transition;
 * - every navigator screen is wrapped in a `ScreenPalette` boundary that
 *   gives its subtree the live pick while the screen is focused and the
 *   settled one while it is hidden;
 * - the global UI outside every boundary and the picker read a live context
 *   that holds the pick only, so the settle does not render them again.
 * So a pick re-renders only the focused screen and the global UI (AppShell,
 * the navigator theme, the snackbar host); the screens below recolour about
 * 150 ms later, unseen.
 *
 * - `usePalette()` reads and sets the palette (the Profile picker).
 * - `useT()` in `./theme` turns `usePaletteState()` into the theme and is
 *   what components call.
 * - `withScreenPalette(Component)` wraps a navigator route in its boundary.
 *
 * System bars: the native side is pinned to night mode (MainApplication.kt,
 * Info.plist), so nothing here touches the colour scheme. The Android
 * navigation bar is transparent from Android 10; only Android 7 to 9, where a
 * transparent bar is not supported, get the palette's bar colour, once per
 * committed palette.
 */

import React, {
  createContext,
  startTransition,
  use,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import { NavigationContext } from '@react-navigation/native';
import { DEFAULT_PALETTE, PALETTE_KEYS, PaletteKey, isPaletteKey, palettes } from './palettes';

export const PALETTE_STORAGE_KEY = '@sesly/palette';

/** Where the removed light / dark / system setting was stored. */
export const LEGACY_THEME_MODE_KEY = '@sesly/themeMode';

/** How long hidden screens wait after a pick before they recolour (ms). */
export const SETTLE_DELAY_MS = 150;

/** First Android API level with a transparent navigation bar (Android 10). */
const TRANSPARENT_NAV_BAR_API = 29;

interface PaletteContextValue {
  palette: PaletteKey;
  /** Apply a palette now and store it on the device. */
  setPalette: (next: PaletteKey) => Promise<void>;
}

interface RootPaletteValue extends PaletteContextValue {
  /** The pick as hidden screens draw it: catches up `SETTLE_DELAY_MS` after a pick. */
  settled: PaletteKey;
}

/** What `useT()` needs: the palette the calling component draws with. */
export interface PaletteState {
  readonly palette: PaletteKey;
}

const RootPaletteContext = createContext<RootPaletteValue>({
  palette: DEFAULT_PALETTE,
  settled: DEFAULT_PALETTE,
  setPalette: async () => undefined,
});
RootPaletteContext.displayName = 'RootPaletteContext';

/**
 * The live pick without `settled`, for the readers that never draw a hidden
 * screen: the global UI outside every boundary and the picker. It changes on
 * a pick only, so the settle re-renders the screen boundaries and nothing
 * else.
 */
const LivePaletteContext = createContext<PaletteContextValue>({
  palette: DEFAULT_PALETTE,
  setPalette: async () => undefined,
});
LivePaletteContext.displayName = 'LivePaletteContext';

/**
 * The palette of the enclosing screen boundary, null outside every boundary.
 * Only `ScreenPalette` provides it, never the provider itself: a value at the
 * provider level would turn every consumer into a screen consumer and stop
 * the global UI from following a pick.
 */
const ScreenPaletteContext = createContext<PaletteKey | null>(null);
ScreenPaletteContext.displayName = 'ScreenPaletteContext';

/** One stable state object per palette, so a boundary hands out no new objects. */
const SCREEN_STATES = PALETTE_KEYS.reduce(
  (all, key) => ({ ...all, [key]: Object.freeze({ palette: key }) }),
  {} as Record<PaletteKey, PaletteState>,
);

/**
 * Module-level cache of the stored palette so a remounted provider draws the
 * right palette on its first render.
 */
let cachedPalette: PaletteKey | null = null;

/** Test hook: forget the cached pick. */
export function resetPaletteCache(): void {
  cachedPalette = null;
}

export async function readStoredPalette(): Promise<PaletteKey> {
  try {
    const raw = await AsyncStorage.getItem(PALETTE_STORAGE_KEY);
    if (isPaletteKey(raw)) return raw;
  } catch (err) {
    console.warn('[ThemeProvider] readStoredPalette failed:', err);
  }
  return DEFAULT_PALETTE;
}

/**
 * Read the stored pick into the cache before the first render (App
 * initialisation), so a user who chose a palette never sees the default one
 * flash first. `preRead` is the stored value when the boot snapshot already
 * read it (null when nothing is stored): storage is then not read again and
 * the cache is filled before this returns.
 */
export function preloadStoredPalette(preRead?: string | null): Promise<PaletteKey> {
  if (preRead !== undefined) {
    cachedPalette = isPaletteKey(preRead) ? preRead : DEFAULT_PALETTE;
    return Promise.resolve(cachedPalette);
  }
  return readStoredPalette().then(stored => {
    cachedPalette = stored;
    return stored;
  });
}

/** Android 7 to 9: the bar cannot be transparent, so it takes a palette colour. */
function needsNavigationBarColor(): boolean {
  return Platform.OS === 'android' && Number(Platform.Version) < TRANSPARENT_NAV_BAR_API;
}

function paintNavigationBar(color: string): void {
  try {
    // Second argument: true when the bar is LIGHT and needs dark icons.
    changeNavigationBarColor(color, false, false);
  } catch (e) {
    console.warn('[ThemeProvider] changeNavigationBarColor failed:', e);
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Start with this palette and skip storage (tests, previews). */
  initialPalette?: PaletteKey;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, initialPalette }) => {
  const [palette, setPaletteState] = useState<PaletteKey>(
    () => initialPalette ?? cachedPalette ?? DEFAULT_PALETTE,
  );
  const [settled, setSettled] = useState<PaletteKey>(palette);
  /** A pick was made: a stored value that arrives later must not undo it. */
  const picked = useRef(false);

  useEffect(() => {
    let cancelled = false;
    if (initialPalette == null && cachedPalette == null) {
      readStoredPalette().then(stored => {
        if (picked.current) return;
        cachedPalette = stored;
        if (cancelled) return;
        // Restoring is not a switch: every screen takes it at once.
        setPaletteState(stored);
        setSettled(stored);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [initialPalette]);

  // A discrete update in the press handler: the focused screen recolours in
  // this commit. Never a transition: React renders pending transition lanes
  // together, so a transition pick would wait for the hidden screens' settle.
  const setPalette = useCallback(async (next: PaletteKey) => {
    picked.current = true;
    cachedPalette = next;
    setPaletteState(next);
    try {
      await AsyncStorage.setItem(PALETTE_STORAGE_KEY, next);
    } catch (err) {
      console.warn('[ThemeProvider] setPalette persist failed:', err);
    }
  }, []);

  // The screens below catch up once, after the last of several quick picks.
  useEffect(() => {
    if (settled === palette) return;
    const id = setTimeout(() => startTransition(() => setSettled(palette)), SETTLE_DELAY_MS);
    return () => clearTimeout(id);
  }, [palette, settled]);

  useEffect(() => {
    // The Sistem / Açık / Koyu pick of the old light theme means nothing now.
    AsyncStorage.removeItem(LEGACY_THEME_MODE_KEY).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (needsNavigationBarColor()) paintNavigationBar(palettes[palette].bar);
  }, [palette]);

  const root = useMemo(() => ({ palette, settled, setPalette }), [palette, settled, setPalette]);
  const live = useMemo(() => ({ palette, setPalette }), [palette, setPalette]);

  return (
    <RootPaletteContext.Provider value={root}>
      <LivePaletteContext.Provider value={live}>{children}</LivePaletteContext.Provider>
    </RootPaletteContext.Provider>
  );
};

/** The palette and its setter (the Profile picker): always the live pick. */
export function usePalette(): PaletteContextValue {
  return useContext(LivePaletteContext);
}

/**
 * Internal: what `useT()` reads. Inside a screen boundary the screen's
 * palette, without subscribing to the root (a hidden screen does not render
 * on a pick); outside every boundary the live pick.
 */
export function usePaletteState(): PaletteState {
  const screen = useContext(ScreenPaletteContext);
  if (screen !== null) return SCREEN_STATES[screen];
  return use(LivePaletteContext);
}

// ─────────────────────────────────────────────────────────────
// Screen boundaries
// ─────────────────────────────────────────────────────────────

/**
 * Whether the enclosing navigator screen is focused, true outside a
 * navigator. Like `useIsFocused()`, which throws without a navigation context.
 */
function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation) return () => undefined;
      const offFocus = navigation.addListener('focus', onChange);
      const offBlur = navigation.addListener('blur', onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation],
  );
  const isFocused = useCallback(() => navigation?.isFocused() ?? true, [navigation]);
  return useSyncExternalStore(subscribe, isFocused, isFocused);
}

interface ScreenPaletteProps {
  children: React.ReactNode;
  /** Follow every pick at once, also while the screen is hidden. */
  live?: boolean;
}

/**
 * The palette boundary of one screen: its `useT()` consumers get the live
 * pick while the screen is focused (or `live`), the settled one while it is
 * hidden. Going back to a screen inside the settle window shows the new
 * palette at once, because it is focused again. A screen that already drew
 * the pick keeps it when it is hidden before the settle (leaving Profile
 * right after a pick), so it never flips back to the old colours.
 */
export const ScreenPalette: React.FC<ScreenPaletteProps> = ({ children, live = false }) => {
  const root = use(RootPaletteContext);
  const focused = useScreenFocused();
  const drawn = useRef<PaletteKey | null>(null);
  const palette =
    live || focused || drawn.current === root.palette ? root.palette : root.settled;
  useLayoutEffect(() => {
    drawn.current = palette;
  });
  return <ScreenPaletteContext.Provider value={palette}>{children}</ScreenPaletteContext.Provider>;
};

/** Screen wrapper for a navigator route: puts the screen in its own palette boundary. */
export function withScreenPalette<P extends object>(Component: React.ComponentType<P>): React.FC<P> {
  const Screen: React.FC<P> = props => (
    <ScreenPalette>
      <Component {...props} />
    </ScreenPalette>
  );
  Screen.displayName = `ScreenPalette(${Component.displayName ?? Component.name ?? 'Screen'})`;
  return Screen;
}
