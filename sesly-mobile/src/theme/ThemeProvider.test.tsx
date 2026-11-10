/**
 * ThemeProvider: the palette pick is applied at once, stored on the device,
 * restored on the next launch; screens below the focused one catch up after
 * the settle delay (SPEC-design 2.4); the Android navigation bar gets a
 * colour only on Android 7 to 9. Dark only.
 */

import React from 'react';
import { Appearance, Platform, Pressable, StatusBar, Text, View } from 'react-native';
import { act, configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import changeNavigationBarColor from 'react-native-navigation-bar-color';
import {
  NavigationContainer,
  NavigatorScreenParams,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

// The global navigation mock replaces NavigationContainer and the focus
// hooks; the boundaries here run on the real navigators.
jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));
// The global safe-area mock lacks the contexts the navigators read.
jest.mock('react-native-safe-area-context', () =>
  jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

import {
  LEGACY_THEME_MODE_KEY,
  PALETTE_STORAGE_KEY,
  SETTLE_DELAY_MS,
  ScreenPalette,
  ThemeProvider,
  preloadStoredPalette,
  readStoredPalette,
  resetPaletteCache,
  usePalette,
  withScreenPalette,
} from './ThemeProvider';
import { PaletteKey, palettes } from './palettes';
import { useT } from './theme';

// Screens below the focused one are aria-hidden by the native stack.
configure({ defaultIncludeHiddenElements: true });

const barColor = changeNavigationBarColor as jest.Mock;

function Probe() {
  const { palette, setPalette } = usePalette();
  const T = useT();
  return (
    <Text testID="probe" onPress={() => void setPalette('orman')}>
      {`${palette}|${T.bg}`}
    </Text>
  );
}

const originalOS = Platform.OS;
const originalVersion = Object.getOwnPropertyDescriptor(Platform, 'Version');

function setPlatform(os: 'android' | 'ios', version: number | string) {
  (Platform as { OS: string }).OS = os;
  Object.defineProperty(Platform, 'Version', { configurable: true, get: () => version });
}

beforeEach(async () => {
  resetPaletteCache();
  await AsyncStorage.clear();
});

afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  if (originalVersion) Object.defineProperty(Platform, 'Version', originalVersion);
});

describe('ThemeProvider', () => {
  it('starts on gece-mavisi when nothing is stored', async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => undefined);
    expect(screen.getByTestId('probe')).toHaveTextContent(`gece-mavisi|${palettes['gece-mavisi'].bg}`);
  });

  it('restores the stored palette', async () => {
    await AsyncStorage.setItem(PALETTE_STORAGE_KEY, 'murekkep');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('murekkep|#121314'));
  });

  it('a pick preloaded at start-up is drawn on the very first frame (no default flash)', async () => {
    await AsyncStorage.setItem(PALETTE_STORAGE_KEY, 'erik');
    await expect(preloadStoredPalette()).resolves.toBe('erik');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(`erik|${palettes.erik.bg}`);
  });

  it('a value the boot snapshot already read is used without reading storage again', async () => {
    await AsyncStorage.setItem(PALETTE_STORAGE_KEY, 'murekkep');
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    const preload = preloadStoredPalette('kitaplik');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    // The cache is filled before the promise settles: the first frame has it.
    expect(screen.getByTestId('probe')).toHaveTextContent(`kitaplik|${palettes.kitaplik.bg}`);
    await expect(preload).resolves.toBe('kitaplik');
    await act(async () => undefined);
    expect(screen.getByTestId('probe')).toHaveTextContent(`kitaplik|${palettes.kitaplik.bg}`);
    expect(getItem).not.toHaveBeenCalled();
  });

  it('a pre-read value that is not a palette (or nothing stored) gives the default, still without storage', async () => {
    const getItem = jest.spyOn(AsyncStorage, 'getItem');
    await expect(preloadStoredPalette(null)).resolves.toBe('gece-mavisi');
    await expect(preloadStoredPalette('acik')).resolves.toBe('gece-mavisi');
    expect(getItem).not.toHaveBeenCalled();
  });

  it('ignores a value that is not a palette (the old light theme, garbage)', async () => {
    await AsyncStorage.setItem(PALETTE_STORAGE_KEY, 'acik');
    await expect(readStoredPalette()).resolves.toBe('gece-mavisi');
    await AsyncStorage.setItem(PALETTE_STORAGE_KEY, 'purple');
    await expect(readStoredPalette()).resolves.toBe('gece-mavisi');
  });

  it('falls back to the default when storage fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(readStoredPalette()).resolves.toBe('gece-mavisi');
    expect(warn).toHaveBeenCalled();
  });

  it('a pick recolours at once and is stored, and a remount keeps it', async () => {
    const first = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => undefined);
    await act(async () => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(`orman|${palettes.orman.bg}`);
    await expect(AsyncStorage.getItem(PALETTE_STORAGE_KEY)).resolves.toBe('orman');
    first.unmount();

    // The next mount draws the pick on its first frame (module cache).
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('orman|#0C1710');
  });

  it('a failed persist keeps the picked palette and only warns', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    render(
      <ThemeProvider initialPalette="erik">
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(`orman|${palettes.orman.bg}`);
    expect(warn).toHaveBeenCalledWith('[ThemeProvider] setPalette persist failed:', expect.any(Error));
    await expect(AsyncStorage.getItem(PALETTE_STORAGE_KEY)).resolves.toBeNull();
  });

  it('a pick made before the stored value arrives wins', async () => {
    await AsyncStorage.setItem(PALETTE_STORAGE_KEY, 'murekkep');
    let release: (value: string | null) => void = () => undefined;
    jest
      .spyOn(AsyncStorage, 'getItem')
      .mockImplementationOnce(() => new Promise<string | null>(resolve => (release = resolve)));
    const first = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(`gece-mavisi|${palettes['gece-mavisi'].bg}`);
    await act(async () => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    await act(async () => {
      release('murekkep');
    });
    expect(screen.getByTestId('probe')).toHaveTextContent(`orman|${palettes.orman.bg}`);
    first.unmount();

    // The late read did not overwrite the cache either.
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(`orman|${palettes.orman.bg}`);
  });

  it('initialPalette wins and skips storage', async () => {
    await AsyncStorage.setItem(PALETTE_STORAGE_KEY, 'murekkep');
    render(
      <ThemeProvider initialPalette="erik">
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => undefined);
    expect(screen.getByTestId('probe')).toHaveTextContent('erik|#1D1322');
  });

  it('forgets the stored pick of the removed light / dark setting', async () => {
    await AsyncStorage.setItem(LEGACY_THEME_MODE_KEY, 'light');
    render(
      <ThemeProvider initialPalette="erik">
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => undefined);
    await expect(AsyncStorage.getItem(LEGACY_THEME_MODE_KEY)).resolves.toBeNull();
  });

  it('leaves the native colour scheme to the native night mode', async () => {
    const spy = jest.spyOn(Appearance, 'setColorScheme');
    render(
      <ThemeProvider initialPalette="erik">
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    act(() => jest.advanceTimersByTime(SETTLE_DELAY_MS));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('system bars', () => {
  it('Android 10 and later: the navigation bar is never painted, on mount or on a switch', async () => {
    setPlatform('android', 31);
    render(
      <ThemeProvider initialPalette="kitaplik">
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    act(() => jest.advanceTimersByTime(SETTLE_DELAY_MS));
    expect(barColor).not.toHaveBeenCalled();
  });

  it('Android 7 to 9: exactly one bar colour per committed palette', async () => {
    setPlatform('android', 28);
    render(
      <ThemeProvider initialPalette="kitaplik">
        <Probe />
      </ThemeProvider>,
    );
    expect(barColor).toHaveBeenCalledTimes(1);
    expect(barColor).toHaveBeenLastCalledWith(palettes.kitaplik.bar, false, false);

    await act(async () => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    expect(barColor).toHaveBeenCalledTimes(2);
    expect(barColor).toHaveBeenLastCalledWith(palettes.orman.bar, false, false);

    // The settle of the hidden screens is not another palette.
    act(() => jest.advanceTimersByTime(SETTLE_DELAY_MS));
    expect(barColor).toHaveBeenCalledTimes(2);
  });

  it('iOS: the navigation bar is left alone, on mount or on a switch', async () => {
    setPlatform('ios', '17.0');
    render(
      <ThemeProvider initialPalette="kitaplik">
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => {
      fireEvent.press(screen.getByTestId('probe'));
    });
    expect(barColor).not.toHaveBeenCalled();
  });

  it('withScreenPalette is a boundary only: no status bar of its own, no bar call', () => {
    setPlatform('android', 31);
    const Screen = withScreenPalette(Probe);
    render(
      <ThemeProvider initialPalette="kitaplik">
        <Screen />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent(`kitaplik|${palettes.kitaplik.bg}`);
    // The root StatusBar in App.tsx is the only one.
    expect(screen.UNSAFE_queryAllByType(StatusBar)).toHaveLength(0);
    expect(barColor).not.toHaveBeenCalled();
    expect(Screen.displayName).toBe('ScreenPalette(Probe)');
  });
});

// ─────────────────────────────────────────────────────────────
// Switch cost: a pick renders the focused screen only, the rest settles once
// ─────────────────────────────────────────────────────────────

describe('switch cost', () => {
  const PROBES = 50;
  const renders = { below: 0, tab: 0, outside: 0, picker: 0 };

  function Cell({ id, counter }: { id: string; counter: keyof typeof renders }) {
    const T = useT();
    renders[counter] += 1;
    return <Text testID={id}>{T.name}</Text>;
  }

  /** A screen of 50 `useT` consumers that counts their renders. */
  function makeProbeScreen(prefix: string, counter: keyof typeof renders) {
    const ProbeScreen = () => (
      <View>
        {Array.from({ length: PROBES }, (_, i) => (
          <Cell key={i} id={`${prefix}-${i}`} counter={counter} />
        ))}
      </View>
    );
    return ProbeScreen;
  }

  type TabParams = { Home: undefined; Other: undefined };
  type StackParams = {
    Below: undefined;
    Main: NavigatorScreenParams<TabParams> | undefined;
    Top: undefined;
    Next: undefined;
  };

  let pickNext: PaletteKey = 'orman';

  function TopScreen() {
    const { setPalette } = usePalette();
    const T = useT();
    renders.picker += 1;
    return (
      <View>
        <Text testID="top-probe">{T.name}</Text>
        <Pressable testID="pick" onPress={() => void setPalette(pickNext)} />
      </View>
    );
  }

  /** Outside every boundary: global UI such as AppShell. */
  function Outside() {
    const T = useT();
    renders.outside += 1;
    return <Text testID="outside-probe">{T.name}</Text>;
  }

  const BelowRoute = withScreenPalette(makeProbeScreen('below', 'below'));
  const NextRoute = withScreenPalette(() => <Text testID="next-probe">next</Text>);
  const TopRoute = withScreenPalette(TopScreen);

  const pick = async (key: PaletteKey) => {
    pickNext = key;
    await act(async () => {
      fireEvent.press(screen.getByTestId('pick'));
    });
  };
  const settle = (ms = SETTLE_DELAY_MS) => act(() => jest.advanceTimersByTime(ms));
  const shows = (id: string) => screen.getByTestId(id).props.children as string;
  // A frozen tab keeps a hidden copy of its last frame next to the live one.
  const visible = (id: string) =>
    screen.getByTestId(id, { includeHiddenElements: false }).props.children as string;

  beforeEach(() => {
    renders.below = 0;
    renders.tab = 0;
    renders.outside = 0;
    renders.picker = 0;
    pickNext = 'orman';
  });

  function renderStack() {
    const ref = createNavigationContainerRef<StackParams>();
    const Stack = createNativeStackNavigator<StackParams>();
    render(
      <ThemeProvider initialPalette="gece-mavisi">
        <Outside />
        <NavigationContainer ref={ref}>
          <Stack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: true }}>
            <Stack.Screen name="Below" component={BelowRoute} />
            <Stack.Screen name="Top" component={TopRoute} />
            <Stack.Screen name="Next" component={NextRoute} />
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>,
    );
    act(() => ref.navigate('Top'));
    expect(screen.getByTestId('top-probe')).toBeOnTheScreen();
    return ref;
  }

  it('a screen below gets no render at the tap and one per consumer after the settle', async () => {
    renderStack();
    const before = renders.below;
    expect(before).toBe(PROBES);

    await pick('orman');
    expect(shows('top-probe')).toBe('orman');
    expect(shows('below-0')).toBe('gece-mavisi');
    expect(renders.below - before).toBe(0);

    settle(SETTLE_DELAY_MS - 1);
    expect(renders.below - before).toBe(0);
    settle(1);
    expect(shows('below-0')).toBe('orman');
    expect(shows(`below-${PROBES - 1}`)).toBe('orman');
    expect(renders.below - before).toBe(PROBES);
  });

  it('three quick picks settle once, on the last one', async () => {
    renderStack();
    const before = renders.below;

    await pick('orman');
    settle(100);
    await pick('erik');
    settle(100);
    await pick('kitaplik');
    expect(shows('top-probe')).toBe('kitaplik');
    // 200 ms after the first pick and still nothing below.
    expect(renders.below - before).toBe(0);
    expect(shows('below-0')).toBe('gece-mavisi');

    settle();
    expect(shows('below-0')).toBe('kitaplik');
    expect(renders.below - before).toBe(PROBES);
    settle(1000);
    expect(renders.below - before).toBe(PROBES);
  });

  it('going back before the settle shows the new palette at once', async () => {
    const ref = renderStack();
    const before = renders.below;

    await pick('erik');
    expect(shows('below-0')).toBe('gece-mavisi');
    act(() => ref.goBack());
    expect(shows('below-0')).toBe('erik');
    expect(renders.below - before).toBe(PROBES);

    // The settle has nothing left to do for the focused screen.
    settle();
    expect(renders.below - before).toBe(PROBES);
  });

  it('a screen that drew the pick keeps it when it is hidden before the settle', async () => {
    const ref = renderStack();
    await pick('erik');
    expect(shows('top-probe')).toBe('erik');

    // Leaving Profile right after a pick: the screen going away must not
    // flip back to the old palette while the settle is still pending.
    act(() => ref.navigate('Next'));
    expect(screen.getByTestId('next-probe')).toBeOnTheScreen();
    expect(shows('top-probe')).toBe('erik');
    settle();
    expect(shows('top-probe')).toBe('erik');
    // Two screens down, Below is frozen and catches up when it is shown.
    act(() => ref.navigate('Below'));
    expect(visible('below-0')).toBe('erik');
  });

  it('a probe outside every boundary follows a switch live', async () => {
    renderStack();
    expect(shows('outside-probe')).toBe('gece-mavisi');
    await pick('murekkep');
    expect(shows('outside-probe')).toBe('murekkep');
  });

  it('the global UI and the picker render once per pick, not again at the settle', async () => {
    renderStack();
    const outside = renders.outside;
    const picker = renders.picker;

    await pick('erik');
    expect(renders.outside - outside).toBe(1);
    expect(renders.picker - picker).toBe(1);

    // Only the hidden screens have something to catch up.
    settle();
    expect(shows('below-0')).toBe('erik');
    expect(renders.outside - outside).toBe(1);
    expect(renders.picker - picker).toBe(1);
  });

  it('a live boundary follows a pick at once even while its screen is hidden', async () => {
    const LiveBelow = withScreenPalette(() => (
      <ScreenPalette live>
        <Cell id="live-cell" counter="below" />
      </ScreenPalette>
    ));
    const ref = createNavigationContainerRef<StackParams>();
    const Stack = createNativeStackNavigator<StackParams>();
    render(
      <ThemeProvider initialPalette="gece-mavisi">
        <NavigationContainer ref={ref}>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Below" component={LiveBelow} />
            <Stack.Screen name="Top" component={TopRoute} />
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>,
    );
    act(() => ref.navigate('Top'));
    await pick('orman');
    expect(shows('live-cell')).toBe('orman');
  });

  /** The app's shape: a tab shell in its own boundary (MainScaffold), Top pushed over it. */
  function renderTabsUnderTop() {
    const ref = createNavigationContainerRef<StackParams>();
    const Stack = createNativeStackNavigator<StackParams>();
    const Tab = createBottomTabNavigator<TabParams>();
    const HomeTab = withScreenPalette(makeProbeScreen('home', 'below'));
    const OtherTab = withScreenPalette(makeProbeScreen('other', 'tab'));
    const MainTabs = () => (
      <ScreenPalette>
        <Tab.Navigator screenOptions={{ headerShown: false, lazy: true, freezeOnBlur: true }}>
          <Tab.Screen name="Home" component={HomeTab} />
          <Tab.Screen name="Other" component={OtherTab} />
        </Tab.Navigator>
      </ScreenPalette>
    );
    render(
      <ThemeProvider initialPalette="gece-mavisi">
        <NavigationContainer ref={ref}>
          <Stack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: true }}>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Top" component={TopRoute} />
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>,
    );
    // Visit the other tab once, then go back to Home and open Top.
    act(() => ref.navigate('Main', { screen: 'Other' }));
    expect(renders.tab).toBe(PROBES);
    act(() => ref.navigate('Main', { screen: 'Home' }));
    act(() => ref.navigate('Top'));
    // react-native-screens freezes a blurred screen one tick later, as on a device.
    act(() => jest.runOnlyPendingTimers());
    return ref;
  }

  it('going back to the tab shell before the settle recolours its focused tab at once', async () => {
    const ref = renderTabsUnderTop();
    const home = renders.below;
    const other = renders.tab;

    await pick('orman');
    expect(renders.below - home).toBe(0);
    act(() => ref.goBack());
    // The focused tab learns of the focus through its parent and takes the pick.
    expect(visible('home-0')).toBe('orman');
    expect(renders.below - home).toBe(PROBES);
    expect(renders.tab - other).toBe(0);

    settle();
    expect(renders.below - home).toBe(PROBES);
  });

  it('an inactive visited tab gets no render at the tap and catches up when shown', async () => {
    const ref = renderTabsUnderTop();
    const home = renders.below;
    const other = renders.tab;

    await pick('erik');
    expect(shows('top-probe')).toBe('erik');
    expect(renders.tab - other).toBe(0);
    expect(renders.below - home).toBe(0);
    expect(shows('other-0')).toBe('gece-mavisi');

    settle();
    // The focused tab of the screen below catches up with the settle.
    expect(renders.below - home).toBe(PROBES);
    // The frozen tab renders its catch-up when it is shown again.
    act(() => ref.navigate('Main', { screen: 'Other' }));
    expect(visible('other-0')).toBe('erik');
    act(() => ref.navigate('Main', { screen: 'Home' }));
    expect(visible('home-0')).toBe('erik');
  });
});
