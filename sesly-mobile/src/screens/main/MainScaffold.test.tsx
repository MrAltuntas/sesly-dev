/**
 * MainScaffold: a navigation bar with four labelled destinations, the theme
 * each tab draws with, tab options (lazy, frozen while hidden, instant), the
 * press answer of the tabs, the pill motion, the offline banner in the
 * bottom chrome and the mini player floating above it.
 *
 * The mini player tests run on the real audio store (on a fake expo-audio
 * player whose status events are emitted by hand), so when it shows and
 * hides is the store's own rule (`showMiniPlayer`): playing, paused from the
 * dock (held for DOCK_PAUSE_HOLD_MS), paused elsewhere, finished, a sample,
 * the next queued story loading. ApiClient, NarrationService, the socket
 * service, the preferences, the sleep timer and the toasts are mocked; NetInfo
 * is driven by hand for the banner.
 */

const mockCreateAudioPlayer = jest.fn();
const mockTimer = {
  attachPlayer: jest.fn(),
  turnOff: jest.fn(),
  handleStoryFinished: jest.fn((): 'stop' | 'continue' => 'continue'),
  onPlayRequested: jest.fn(),
  isFading: false,
  store: { active: false, mode: 'duration' },
};
// A start waits on the stream token; a test can hold it to keep a start loading.
let mockTokenGate: Promise<string> = Promise.resolve('jwt');
let mockNetInfoListener: ((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void) | null =
  null;

jest.mock('@react-navigation/native', () => jest.requireActual('@react-navigation/native'));
jest.mock('react-native-safe-area-context', () =>
  jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-audio', () => ({
  __esModule: true,
  createAudioPlayer: (...a: unknown[]) => mockCreateAudioPlayer(...a),
  setAudioModeAsync: () => Promise.resolve(),
}));
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getBaseURL: () => 'https://api.sesly.test/api/v1',
    getAccessToken: () => Promise.resolve('jwt'),
    getFreshAccessToken: () => mockTokenGate,
    get: () => new Promise(() => {}),
    post: jest.fn(),
  },
}));
jest.mock('../../services/NarrationService', () => ({
  __esModule: true,
  NarrationAlreadyExistsError: class NarrationAlreadyExistsError extends Error {},
  default: {
    getNarrationById: () => new Promise(() => {}),
    getNarrationsByStory: () => Promise.resolve([]),
  },
}));
jest.mock('../../services/WebSocketService', () => ({
  __esModule: true,
  default: { registerAudioPlayerStore: jest.fn() },
}));
jest.mock('../../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    getCachedSync: () => null,
    get: () => new Promise(() => {}),
    update: () => Promise.resolve({}),
  },
}));
jest.mock('../../services/SleepTimerService', () => ({
  __esModule: true,
  get default() {
    return mockTimer;
  },
}));
// Counts the tab items' renders: each calls usePressTint once per render.
const mockTabItemRenders = { count: 0 };
jest.mock('../../components/design/usePressTint', () => {
  const actual = jest.requireActual('../../components/design/usePressTint');
  return {
    ...actual,
    usePressTint: (...args: unknown[]) => {
      mockTabItemRenders.count += 1;
      return actual.usePressTint(...args);
    },
  };
});
jest.mock('../../utils/toast', () => ({
  showToast: { info: jest.fn(), error: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: typeof mockNetInfoListener) => {
      mockNetInfoListener = listener;
      return () => {
        mockNetInfoListener = null;
      };
    },
    fetch: jest.fn(),
  },
}));

import React from 'react';
import { AccessibilityInfo, Animated, Text } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import i18n from '../../i18n';
import { SETTLE_DELAY_MS, ThemeProvider, usePalette } from '../../theme/ThemeProvider';
import type { PaletteKey } from '../../theme/palettes';
import { themes } from '../../theme/theme';
import { DURATION, EASE, PRESS_TINT } from '../../theme/motion';
import { snackbar } from '../../components/design/Snackbar';
import { MINI_PLAYER_DOCK_HEIGHT } from '../../components/design/MiniPlayerBar';
import { LAST_PLAYED_STORAGE_KEY } from '../../utils/lastPlayed';
import {
  DOCK_PAUSE_HOLD_MS,
  getAudioPlayerStore,
  type AudioPlayerStore,
  type NarrationMeta,
} from '../../hooks/useAudioPlayer';
import { playerStoryOf, resetNarrationMetaForTests } from '../../stores/narrationMeta';
import { resetNarrationDurationsForTests } from '../../utils/narrationDurations';
import { resetSessionForTests } from '../../stores/session';
import { connectivityStore } from '../../stores/ConnectivityStore';

jest.setTimeout(60000);
configure({ defaultIncludeHiddenElements: true });

// Each tab is a stand-in that reports the palette it was given.
function mockTab(name: string) {
  return function MockTab() {
    const { useT: useTheme } = require('../../theme/theme');
    const { Text: RNText } = require('react-native');
    const React = require('react');
    const palette = useTheme();
    return React.createElement(RNText, { testID: `screen-${name}` }, `${name}:${palette.name}`);
  };
}
// Keşfet, Kütüphane and Sesim note when their module is first required.
const mockLoadedTabs: string[] = [];
function mockLazyTab(name: string) {
  mockLoadedTabs.push(name);
  return { __esModule: true, default: mockTab(name) };
}
jest.mock('../home/HomeScreen', () => ({ __esModule: true, default: mockTab('Home') }));
jest.mock('../story/StoryLibraryScreen', () => mockLazyTab('Discover'));
jest.mock('../library/MyLibraryScreen', () => mockLazyTab('Library'));
jest.mock('../voice/VoiceProfilesScreen', () => mockLazyTab('Voices'));

import {
  LAZY_TABS,
  MAIN_TABS,
  MAIN_TAB_SCREEN_OPTIONS,
  MINI_PLAYER_ENTER_OFFSET,
  MINI_PLAYER_FADE_HEIGHT,
  MainScaffold,
  NAV_BAR_HEIGHT,
  TAB_PILL_ENTER_SCALE,
} from './MainScaffold';

// Read right after the imports: which tab modules importing the shell loaded.
const loadedTabsAtImport = [...mockLoadedTabs];

// ─── The fake native player ───

type StatusListener = (status: Record<string, unknown>) => void;

class FakeAudioPlayer {
  playing = false;
  currentTime = 0;
  volume = 1;
  isLoaded = true;
  isBuffering = false;
  shouldCorrectPitch = false;
  currentStatus: Record<string, unknown> | undefined = undefined;
  statusListener: StatusListener | null = null;
  replace = jest.fn();
  play = jest.fn();
  pause = jest.fn();
  seekTo = jest.fn(async () => undefined);
  setPlaybackRate = jest.fn();
  remove = jest.fn();
  release = jest.fn();
  setActiveForLockScreen = jest.fn();
  updateLockScreenMetadata = jest.fn();
  clearLockScreenControls = jest.fn();
  addListener = jest.fn((event: string, listener: StatusListener) => {
    if (event === 'playbackStatusUpdate') this.statusListener = listener;
    return { remove: jest.fn() };
  });

  emit(status: Record<string, unknown>): void {
    act(() => {
      this.statusListener?.({
        currentTime: 0,
        duration: 0,
        playing: false,
        didJustFinish: false,
        ...status,
      });
    });
  }
}

let audio: AudioPlayerStore;
let player: FakeAudioPlayer;

function metaFor(narrationId: string, title: string): NarrationMeta {
  return {
    narrationId,
    storyId: `story-${narrationId}`,
    voiceProfileId: null,
    story: playerStoryOf({ id: `story-${narrationId}`, title }),
    voiceProfile: null,
    narratorName: 'Zeynep',
    ownVoice: false,
    estimateMs: 0,
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A story started with autoplay and sounding, at 134 s of 362 s (4 min left). */
async function playStory(narrationId = 'nar-1', title = 'Bremen Mızıkacıları') {
  await act(async () => {
    await audio.startNarration({ narrationId, meta: metaFor(narrationId, title) }, { autoplay: true });
    await flush();
  });
  player.currentTime = 134;
  player.emit({ currentTime: 134, duration: 362, playing: true, playbackState: 'ready' });
}

/** Lets the dock's exit run to its end. */
function finishExit() {
  act(() => {
    jest.advanceTimersByTime(DURATION.exit + 50);
  });
}

const navigationSpy = jest.fn();

// The Profile picker's setter, captured for the palette switch tests.
const mockPicker: { setPalette: ((key: PaletteKey) => Promise<void>) | null } = { setPalette: null };
function PickerProbe() {
  mockPicker.setPalette = usePalette().setPalette;
  return null;
}

function Shell({ mode }: { mode: PaletteKey }) {
  return (
    <ThemeProvider initialPalette={mode}>
      <PickerProbe />
      <NavigationContainer
        onStateChange={state => navigationSpy(state?.routes[state.index ?? 0]?.name)}
        // The player route is outside this test; unknown routes are reported, not thrown.
        onUnhandledAction={action => navigationSpy('unhandled', action.payload)}
      >
        <MainScaffold />
      </NavigationContainer>
    </ThemeProvider>
  );
}

async function renderShell(mode: PaletteKey = 'gece-mavisi') {
  const view = render(<Shell mode={mode} />);
  await act(async () => undefined);
  return view;
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

type TreeNode = { type: unknown; props: { testID?: string; style?: unknown } };
/** The named host views under a node, in order, with their styles: what lays the chrome out. */
const hostTree = (node: TreeNode & { findAll(test: (n: TreeNode) => boolean): TreeNode[] }) =>
  node
    .findAll(n => n !== node && typeof n.type === 'string' && typeof n.props.testID === 'string')
    .map(n => ({ testID: n.props.testID, style: flatStyle(n) }));

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  mockCreateAudioPlayer.mockImplementation(() => new FakeAudioPlayer());
  audio = getAudioPlayerStore();
  await audio.setupPlayer();
  player = (audio as unknown as { player: FakeAudioPlayer }).player;
});

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  // React Native's mock is a plain jest.fn: a test that turns reduced motion on would leak it.
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  navigationSpy.mockReset();
  mockTokenGate = Promise.resolve('jwt');
  audio.setStoryEndHandler(null);
  resetSessionForTests();
  await audio.unloadForSignOut();
  resetNarrationMetaForTests();
  resetNarrationDurationsForTests();
  await AsyncStorage.clear();
  connectivityStore.stop();
  connectivityStore.start();
  mockNetInfoListener?.({ isConnected: true, isInternetReachable: true });
});

afterEach(() => {
  act(() => snackbar.setBottomInset(0));
  connectivityStore.stop();
});

describe('navigation bar', () => {
  it('has four labelled destinations in the order of the mockups', async () => {
    await renderShell();
    expect(MAIN_TABS.map(tab => tab.name)).toEqual(['Stories', 'Discover', 'Library', 'Voices']);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(tab => tab.props.accessibilityLabel)).toEqual([
      'Masallar',
      'Keşfet',
      'Kütüphane',
      'Sesim',
    ]);
    for (const icon of ['book', 'compass', 'books', 'mic']) {
      expect(screen.getByTestId(`icon-${icon}`)).toBeTruthy();
    }
    expect(NAV_BAR_HEIGHT).toBe(66);
  });

  it('starts on Masallar and switches tabs', async () => {
    await renderShell();
    expect(screen.getByRole('tab', { name: 'Masallar' })).toBeSelected();
    expect(screen.getByTestId('screen-Home')).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: 'Keşfet' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Keşfet' })).toBeSelected());
    expect(screen.getByTestId('screen-Discover')).toBeTruthy();

    fireEvent.press(screen.getByRole('tab', { name: 'Kütüphane' }));
    await waitFor(() => expect(screen.getByTestId('screen-Library')).toBeTruthy());

    fireEvent.press(screen.getByRole('tab', { name: 'Sesim' }));
    await waitFor(() => expect(screen.getByTestId('screen-Voices')).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Masallar' })).not.toBeSelected();
  });

  it.each(['gece-mavisi', 'kitaplik', 'orijinal'] as const)('the bar and its raised pill use the %s palette', async scheme => {
    await renderShell(scheme);
    const T = themes[scheme];
    expect(flatStyle(screen.getByText('Masallar')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Keşfet')).color).toBe(T.text3);
    // A 56 x 32 pill on a 2dp lip behind the selected icon only, no border
    // (a partial border on a rounded view clips its corners on Android).
    expect(flatStyle(screen.getByTestId('tab-indicator-Stories'))).toMatchObject({ width: 56, height: 32 });
    expect(flatStyle(screen.getByTestId('tab-indicator-face-Stories'))).toMatchObject({
      backgroundColor: T.surface2,
      borderRadius: 16,
    });
    expect(flatStyle(screen.getByTestId('tab-indicator-face-Stories')).borderBottomWidth).toBeUndefined();
    expect(flatStyle(screen.getByTestId('tab-indicator-lip-Stories'))).toMatchObject({ backgroundColor: T.lip, top: 2 });
    expect(screen.queryByTestId('tab-indicator-lip-Discover')).toBeNull();
    expect(screen.queryByTestId('tab-indicator-face-Discover')).toBeNull();
    expect(flatStyle(screen.getByTestId('tab-indicator-Discover')).backgroundColor).toBeUndefined();
    expect(flatStyle(screen.getByTestId('main-nav-bar'))).toMatchObject({
      backgroundColor: T.bar,
      borderTopColor: T.barLine,
    });
  });

  it('every tab follows the app theme', async () => {
    await renderShell('gece-mavisi');
    expect(screen.getByTestId('screen-Home')).toHaveTextContent('Home:gece-mavisi');

    fireEvent.press(screen.getByRole('tab', { name: 'Keşfet' }));
    await waitFor(() => expect(screen.getByTestId('screen-Discover')).toHaveTextContent('Discover:gece-mavisi'));
    fireEvent.press(screen.getByRole('tab', { name: 'Kütüphane' }));
    await waitFor(() => expect(screen.getByTestId('screen-Library')).toHaveTextContent('Library:gece-mavisi'));
    fireEvent.press(screen.getByRole('tab', { name: 'Sesim' }));
    await waitFor(() => expect(screen.getByTestId('screen-Voices')).toHaveTextContent('Voices:gece-mavisi'));
  });

  it('labels are translated', async () => {
    await i18n.changeLanguage('en');
    await renderShell();
    expect(screen.getAllByRole('tab').map(tab => tab.props.accessibilityLabel)).toEqual([
      'Stories',
      'Discover',
      'Library',
      'My voice',
    ]);
  });

  it('tells the snackbar how much room the bottom chrome takes', async () => {
    await renderShell();
    const chrome = screen.getByTestId('main-bottom-chrome');
    act(() => {
      fireEvent(chrome, 'layout', { nativeEvent: { layout: { height: 144.4 } } });
    });
    expect(snackbar.getState().bottomInset).toBe(144);
  });

  it('tab items: paddings 6 / 6, gap 4, no press delay', async () => {
    await renderShell();
    expect(flatStyle(screen.getByTestId('tab-Discover'))).toMatchObject({
      paddingTop: 6,
      paddingBottom: 6,
      minHeight: NAV_BAR_HEIGHT,
    });
    expect(flatStyle(screen.getByTestId('tab-content-Discover')).gap).toBe(4);
    // The Pressable elements themselves (composite), not their host views.
    type Instance = { type: unknown; props: { testID?: string; onPress?: unknown; unstable_pressDelay?: number } };
    const tabs: Instance[] = screen.UNSAFE_root.findAll(
      (node: Instance) =>
        typeof node.type !== 'string' && /^tab-[A-Z]\w+$/.test(node.props.testID ?? '') && 'onPress' in node.props,
      { deep: true },
    );
    const pressDelays = new Map(tabs.map(node => [node.props.testID, node.props.unstable_pressDelay]));
    expect(pressDelays).toEqual(
      new Map([
        ['tab-Stories', 0],
        ['tab-Discover', 0],
        ['tab-Library', 0],
        ['tab-Voices', 0],
      ]),
    );
  });
});

describe('tab options and lazy tabs', () => {
  it('tabs are lazy, frozen while hidden and switch without animation', () => {
    expect(MAIN_TAB_SCREEN_OPTIONS).toEqual({
      headerShown: false,
      lazy: true,
      freezeOnBlur: true,
      animation: 'none',
    });
  });

  it('only Home loads with the shell; a tab module loads on its first visit', async () => {
    expect(loadedTabsAtImport).toEqual([]);
    await renderShell();
    fireEvent.press(screen.getByRole('tab', { name: 'Kütüphane' }));
    await waitFor(() => expect(screen.getByTestId('screen-Library')).toBeTruthy());
    expect(mockLoadedTabs).toContain('Library');
  });

  it('a lazy tab getter returns one component, inside its palette boundary', () => {
    for (const getter of [LAZY_TABS.Discover, LAZY_TABS.Library, LAZY_TABS.Voices]) {
      const first = getter();
      expect(getter()).toBe(first);
      expect((first as { displayName?: string }).displayName).toMatch(/^ScreenPalette\(/);
    }
  });

  it('a visited tab behind the shown one catches up with a pick only when shown', async () => {
    await renderShell('gece-mavisi');
    fireEvent.press(screen.getByRole('tab', { name: 'Keşfet' }));
    await waitFor(() => expect(screen.getByTestId('screen-Discover')).toHaveTextContent('Discover:gece-mavisi'));
    fireEvent.press(screen.getByRole('tab', { name: 'Masallar' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Masallar' })).toBeSelected());
    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    await act(async () => {
      await mockPicker.setPalette?.('kitaplik');
    });
    // The shown tab and the bar follow the pick at once.
    expect(screen.getByTestId('screen-Home')).toHaveTextContent('Home:kitaplik');
    expect(flatStyle(screen.getByTestId('main-nav-bar')).backgroundColor).toBe(themes.kitaplik.bar);
    // The hidden tab did not render for it.
    expect(screen.getByTestId('screen-Discover')).toHaveTextContent('Discover:gece-mavisi');

    fireEvent.press(screen.getByRole('tab', { name: 'Keşfet' }));
    await waitFor(() => expect(screen.getByTestId('screen-Discover')).toHaveTextContent('Discover:kitaplik'));
    await act(async () => {
      jest.advanceTimersByTime(SETTLE_DELAY_MS);
    });
  });
});

describe('tab press and pill motion', () => {
  const timingTargets = (spy: jest.SpyInstance) =>
    spy.mock.calls.map(([, config]) => (config as { toValue: number }).toValue);

  it('an unfocused tab dims on press and never sinks', async () => {
    await renderShell();
    const timing = jest.spyOn(Animated, 'timing');

    fireEvent(screen.getByTestId('tab-Discover'), 'pressIn');

    // The tint (to PRESS_TINT) runs; the sink (to 1) does not.
    expect(timingTargets(timing)).toEqual([PRESS_TINT]);
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    const face = flatStyle(screen.getByTestId('tab-indicator-Discover'));
    expect(face.transform).toEqual([{ translateY: 0 }]);

    // Release: the tint goes back to 1, the press value stays at rest (0).
    fireEvent(screen.getByTestId('tab-Discover'), 'pressOut');
    expect(timingTargets(timing).slice(1).sort()).toEqual([0, 1]);
  });

  it('the focused pill sinks onto its lip and does not dim', async () => {
    await renderShell();
    const timing = jest.spyOn(Animated, 'timing');

    fireEvent(screen.getByTestId('tab-Stories'), 'pressIn');

    // Only the sink runs (0 to 1 of the press value); no tint toward PRESS_TINT.
    expect(timingTargets(timing)).toEqual([1]);
    expect(timing.mock.calls[0][1]).toMatchObject({ useNativeDriver: true });
  });

  /** A responder event Pressability accepts (no touches: the event is the touch). */
  const touch = (timestamp = 0) => ({
    persist: () => undefined,
    currentTarget: { measure: () => undefined },
    nativeEvent: { timestamp, pageX: 10, pageY: 10, locationX: 10, locationY: 10, touches: [], changedTouches: [] },
  });

  /** The tint value of a tab (the opacity of its content), read off the Animated.View's own props. */
  const tintOf = (name: string): Animated.Value => {
    type Node = { props: { testID?: string; style?: unknown } };
    const styles = screen.UNSAFE_root.findAll((node: Node) => node.props.testID === `tab-content-${name}`).flatMap(
      (node: Node) => [node.props.style].flat(4),
    ) as { opacity?: unknown }[];
    const tint = styles.find(style => style?.opacity instanceof Animated.Value)?.opacity;
    if (!(tint instanceof Animated.Value)) throw new Error(`no tint on tab-content-${name}`);
    return tint;
  };

  /** The value JS holds for an Animated.Value: what the view is committed with. */
  const jsValue = (value: Animated.Value) => (value as unknown as { __getValue(): number }).__getValue();

  /**
   * The native driver for one value, as React Native 0.83 runs it (the full
   * model is in usePressTint.test.ts). Here a native-driven animation never
   * moves the JS value, so this stands in: an animation ends on native and
   * sends its value; JS handles the event when it is free and writes the
   * value back to the node, which Fabric commits to the view, also for an
   * animation JS has stopped. `setValue` stops the running one and sets the
   * node. Every other value runs on the real Animated.timing.
   */
  function nativeDriverFor(value: Animated.Value) {
    const realTiming = Animated.timing;
    const events: number[] = [];
    let nativeValue = jsValue(value);
    let running: { toValue: number } | null = null;
    const stopRunning = () => {
      if (!running) return;
      running = null;
      events.push(nativeValue);
    };
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((
      target: Animated.Value,
      config: Animated.TimingAnimationConfig,
    ) => {
      if (target !== value) return realTiming(target, config);
      let mine: { toValue: number } | null = null;
      return {
        start: () => {
          stopRunning();
          mine = { toValue: config.toValue as number };
          running = mine;
        },
        stop: () => {
          if (mine && running === mine) stopRunning();
        },
        reset: () => undefined,
      };
    }) as unknown as typeof Animated.timing);
    const realSetValue = value.setValue.bind(value);
    jest.spyOn(value, 'setValue').mockImplementation((next: number) => {
      stopRunning();
      nativeValue = next;
      realSetValue(next);
    });
    return {
      timing,
      /** The tint's own runs, as [toValue, duration]. */
      runs: () =>
        timing.mock.calls
          .filter(([target]) => target === value)
          .map(([, config]) => [(config as { toValue: number }).toValue, (config as { duration: number }).duration]),
      /** Instant native returns to rest: a timing to 1 in duration 0 on the native driver. */
      rests: () =>
        timing.mock.calls.filter(
          ([target, config]) =>
            target === value &&
            (config as { toValue: number }).toValue === 1 &&
            (config as { duration: number }).duration === 0 &&
            (config as { useNativeDriver: boolean }).useNativeDriver === true,
        ),
      /** A native frame: the running animation reaches its target and sends its end event. */
      frame() {
        if (!running) return;
        nativeValue = running.toValue;
        running = null;
        events.push(nativeValue);
      },
      /** JS is free again: it handles the queued end events in order. */
      deliver() {
        act(() => {
          for (const next of events.splice(0)) {
            (value as unknown as { __onAnimatedValueUpdateReceived(v: number): void }).__onAnimatedValueUpdateReceived(
              next,
            );
          }
        });
      },
    };
  }

  // V5R-01: the tab a short tap focused stayed at PRESS_TINT after a slow switch.
  it.each([
    ['still running when the tab is focused', 'running'],
    ['ended on native, its end event still waiting for JS (the slow switch)', 'pending'],
    ['ended and drawn', 'drawn'],
  ] as const)(
    'a short tap that focuses a tab, press-in %s: undimmed at once, and its late press-out changes nothing',
    async (_label, pressIn) => {
      await renderShell();
      const tint = tintOf('Discover');
      const driver = nativeDriverFor(tint);
      const tab = screen.getByTestId('tab-Discover');

      fireEvent(tab, 'responderGrant', touch());
      expect(driver.timing).toHaveBeenLastCalledWith(
        tint,
        expect.objectContaining({ toValue: PRESS_TINT, duration: DURATION.pressIn, useNativeDriver: true }),
      );
      if (pressIn !== 'running') driver.frame();
      if (pressIn === 'drawn') {
        driver.deliver();
        expect(jsValue(tint)).toBe(PRESS_TINT);
      }

      // Release at once: onPress navigates now, Pressability holds the
      // press-out for its 130 ms minimum press duration.
      fireEvent(tab, 'responderRelease', touch());
      await act(async () => undefined);
      expect(screen.getByRole('tab', { name: 'Keşfet' })).toBeSelected();

      // Focused: back to rest at once with a native timing to 1, not setValue.
      expect(driver.rests()).toHaveLength(1);
      expect(tint.setValue).not.toHaveBeenCalled();

      // The late press-out finds the tab at rest: nothing more moves the tint.
      await act(async () => {
        jest.advanceTimersByTime(130);
      });
      expect(driver.runs()).toEqual([
        [PRESS_TINT, DURATION.pressIn],
        [1, 0],
      ]);

      // JS is free: whatever the press-in sent is handled before the reset's 1.
      driver.frame();
      driver.deliver();
      expect(jsValue(tint)).toBe(1);
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(jsValue(tint)).toBe(1);
      expect(jsValue(tintOf('Stories'))).toBe(1);
    },
  );

  it('a held press that focuses on release returns through its own press-out', async () => {
    await renderShell();
    const tint = tintOf('Library');
    const driver = nativeDriverFor(tint);
    const tab = screen.getByTestId('tab-Library');

    fireEvent(tab, 'responderGrant', touch());
    driver.frame();
    act(() => jest.advanceTimersByTime(400));
    // Held past the minimum press duration: the press-out comes first, then onPress.
    fireEvent(tab, 'responderRelease', touch(400));
    await act(async () => undefined);
    expect(screen.getByRole('tab', { name: 'Kütüphane' })).toBeSelected();
    // The return already runs toward 1: becoming focused adds no reset.
    expect(driver.runs()).toEqual([
      [PRESS_TINT, DURATION.pressIn],
      [1, DURATION.pressOut],
    ]);
    driver.frame();
    driver.deliver();
    expect(jsValue(tint)).toBe(1);
  });

  it('pressing the focused tab never dims it, and a tab focused without a press starts no tint motion', async () => {
    await renderShell();
    const stories = nativeDriverFor(tintOf('Stories'));
    fireEvent(screen.getByTestId('tab-Stories'), 'responderGrant', touch());
    fireEvent(screen.getByTestId('tab-Stories'), 'responderRelease', touch());
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(stories.runs()).toEqual([]);

    // onPress alone, as a navigation from another screen would focus it.
    const voices = tintOf('Voices');
    fireEvent.press(screen.getByRole('tab', { name: 'Sesim' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Sesim' })).toBeSelected());
    expect(stories.timing.mock.calls.filter(([target]) => target === voices)).toEqual([]);
    expect(jsValue(voices)).toBe(1);
  });

  it('a newly focused pill fades and grows in over DURATION.base; the first one does not move', async () => {
    const realTiming = Animated.timing;
    // Where each DURATION.base motion starts from, read when it is started.
    const pillStarts: number[] = [];
    const timing = jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
      if (config.duration === DURATION.base) {
        pillStarts.push((value as unknown as { __getValue(): number }).__getValue());
      }
      return realTiming(value, config);
    });
    await renderShell();
    // Nothing animates for the tab focused on mount.
    expect(pillStarts).toEqual([]);

    fireEvent.press(screen.getByRole('tab', { name: 'Keşfet' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Keşfet' })).toBeSelected());

    const pillRuns = timing.mock.calls.filter(([, config]) => config.duration === DURATION.base);
    expect(pillRuns).toHaveLength(2);
    for (const [, config] of pillRuns) {
      expect(config).toMatchObject({ toValue: 1, useNativeDriver: true });
    }
    // From clear (opacity 0) and small (TAB_PILL_ENTER_SCALE) to rest.
    expect(TAB_PILL_ENTER_SCALE).toBe(0.9);
    expect([...pillStarts].sort()).toEqual([0, TAB_PILL_ENTER_SCALE]);
    // The face and the lip share the motion; the old tab has no pill left.
    const face = flatStyle(screen.getByTestId('tab-indicator-face-Discover'));
    const lip = flatStyle(screen.getByTestId('tab-indicator-lip-Discover'));
    expect(face.opacity).toBe(lip.opacity);
    expect(face.transform).toEqual(lip.transform);
    expect(screen.queryByTestId('tab-indicator-face-Stories')).toBeNull();
  });
});

describe('mini player: when it shows', () => {
  it('is absent when nothing was played', async () => {
    await renderShell();
    expect(screen.queryByTestId('mini-player')).toBeNull();
    expect(screen.queryByTestId('mini-player-overlay')).toBeNull();
  });

  it('shows nothing after a restart even with a remembered story', async () => {
    await AsyncStorage.setItem(
      LAST_PLAYED_STORAGE_KEY,
      JSON.stringify({ ...metaFor('nar-9', 'Karga ile Testi'), userId: null, updatedAt: 1 }),
    );
    await AsyncStorage.setItem('narration_position:nar-9', '180000');
    await renderShell();
    await act(async () => {
      await flush();
      jest.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('mini-player')).toBeNull();
    expect(screen.queryByText('Karga ile Testi')).toBeNull();
  });

  it('shows the playing story with narrator and time left, pauses in place and opens the player', async () => {
    await renderShell();
    await playStory();

    expect(screen.getByTestId('mini-player')).toBeTruthy();
    expect(screen.getByText('Bremen Mızıkacıları')).toBeTruthy();
    expect(screen.getByText('Zeynep anlatıyor, 4 dk kaldı')).toBeTruthy();

    fireEvent.press(screen.getByTestId('mini-player-open'));
    // The player opens in the frame after the press (LR-4: the sunk card is drawn first).
    act(() => {
      jest.advanceTimersByTime(16);
    });
    expect(navigationSpy).toHaveBeenCalledWith('unhandled', {
      name: 'AudioPlayer',
      params: { narrationId: 'nar-1' },
    });

    player.pause.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Duraklat' }));
      await flush();
    });
    expect(player.pause).toHaveBeenCalled();
    expect(audio.isPlaying).toBe(false);
  });

  it('spins its button while the story starts (intent to play, stream not ready yet)', async () => {
    let release: (token: string) => void = () => undefined;
    mockTokenGate = new Promise(resolve => {
      release = resolve;
    });
    await renderShell();
    let start: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      start = audio.startNarration({ narrationId: 'nar-1', meta: metaFor('nar-1', 'Uykulu Ay') }, { autoplay: true });
      await flush();
    });
    // A first start from nothing: nothing is loaded yet, so nothing docks.
    expect(audio.loadPhase).toBe('loading');
    expect(screen.queryByTestId('mini-player')).toBeNull();

    await act(async () => {
      release('jwt');
      await start;
      await flush();
    });
    expect(screen.getByText('Uykulu Ay')).toBeTruthy();
    // Loaded and meant to play, the stream still waiting for data: shown and busy.
    player.emit({ currentTime: 0, duration: 0, playing: false, isBuffering: true, playbackState: 'buffering' });
    expect(audio.isBusy).toBe(true);
    expect(screen.getByText('Uykulu Ay')).toBeTruthy();
    expect(screen.getByTestId('mini-player-busy')).toBeTruthy();

    player.emit({ currentTime: 1, duration: 300, playing: true, playbackState: 'ready' });
    expect(screen.queryByTestId('mini-player-busy')).toBeNull();
    expect(screen.getByTestId('icon-pause')).toBeTruthy();
  });

  it('hides when paused outside the dock (player screen, lock screen, headset)', async () => {
    await renderShell();
    await playStory();
    expect(screen.getByTestId('mini-player')).toBeTruthy();

    await act(async () => {
      await audio.pause();
    });
    // It leaves: still drawn during the exit, no longer touchable nor reachable by a screen reader.
    expect(screen.getByTestId('mini-player')).toBeTruthy();
    const leavingOverlay = screen.getByTestId('mini-player-overlay');
    expect(leavingOverlay.props.pointerEvents).toBe('none');
    expect(leavingOverlay.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(leavingOverlay.props.accessibilityElementsHidden).toBe(true);
    expect(screen.queryByRole('button', { name: 'Duraklat', includeHiddenElements: false })).toBeNull();
    finishExit();
    expect(screen.queryByTestId('mini-player')).toBeNull();
    expect(screen.queryByTestId('main-bottom-fade')).toBeNull();
  });

  it('stays 5 s after a pause from its own button, then hides', async () => {
    await renderShell();
    await playStory();

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Duraklat' }));
      await flush();
    });
    // Held: paused copy and a play button to take it back.
    expect(audio.dockHold).toBe(true);
    expect(screen.getByText('Duraklatıldı, 4 dk kaldı')).toBeTruthy();
    // Shown (also while held): a screen reader reaches its play button.
    expect(screen.getByRole('button', { name: 'Oynat', includeHiddenElements: false })).toBeTruthy();
    expect(screen.getByTestId('mini-player-overlay').props.pointerEvents).toBe('box-none');

    act(() => {
      jest.advanceTimersByTime(DOCK_PAUSE_HOLD_MS - 1);
    });
    expect(screen.getByTestId('mini-player')).toBeTruthy();
    expect(screen.getByTestId('mini-player-overlay').props.pointerEvents).toBe('box-none');

    act(() => {
      jest.advanceTimersByTime(1);
    });
    finishExit();
    expect(screen.queryByTestId('mini-player')).toBeNull();
  });

  it('a play inside the 5 s keeps it, and it stays while playing', async () => {
    await renderShell();
    await playStory();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Duraklat' }));
      await flush();
    });
    act(() => {
      jest.advanceTimersByTime(2000);
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Oynat' }));
      await flush();
    });
    expect(audio.isPlaying).toBe(true);
    player.emit({ currentTime: 136, duration: 362, playing: true, playbackState: 'ready' });

    act(() => {
      jest.advanceTimersByTime(DOCK_PAUSE_HOLD_MS + DURATION.exit + 100);
    });
    expect(screen.getByTestId('mini-player')).toBeTruthy();
    expect(screen.getByText('Zeynep anlatıyor, 4 dk kaldı')).toBeTruthy();
  });

  it('hides after the story finished', async () => {
    await renderShell();
    await playStory();

    player.emit({ currentTime: 362, duration: 362, playing: false, didJustFinish: true, playbackState: 'ready' });
    expect(audio.storyEnded).toBe(true);
    finishExit();
    expect(screen.queryByTestId('mini-player')).toBeNull();
  });

  it('hides while a sample plays, and the exit keeps drawing the story, not the sample', async () => {
    await renderShell();
    await playStory();

    await act(async () => {
      await audio.playFromUrl('https://cdn.sesly.test/sample.mp3', { key: 'sample-achird' });
      await flush();
    });
    expect(audio.source).toBe('sample');
    // Leaving: the last story drawn, never an empty or untitled card.
    expect(screen.getByText('Bremen Mızıkacıları')).toBeTruthy();
    finishExit();
    expect(screen.queryByTestId('mini-player')).toBeNull();
  });

  it('stays visible while the next queued story loads', async () => {
    await renderShell();
    await playStory('nar-1', 'Bremen Mızıkacıları');

    let release: (token: string) => void = () => undefined;
    mockTokenGate = new Promise(resolve => {
      release = resolve;
    });
    let next: Promise<boolean> = Promise.resolve(false);
    audio.setStoryEndHandler(() => {
      next = audio.startNarration(
        { narrationId: 'nar-2', meta: metaFor('nar-2', 'Deniz Feneri') },
        { autoplay: true, fromQueue: true },
      );
      return 'advance';
    });

    player.emit({ currentTime: 362, duration: 362, playing: false, didJustFinish: true, playbackState: 'ready' });
    await act(async () => {
      await flush();
    });
    expect(audio.loadPhase).toBe('loading');
    // No exit while the next one loads: the card stays touchable.
    act(() => {
      jest.advanceTimersByTime(DURATION.exit + 50);
    });
    expect(screen.getByTestId('mini-player')).toBeTruthy();
    expect(screen.getByTestId('mini-player-overlay').props.pointerEvents).toBe('box-none');

    await act(async () => {
      release('jwt');
      await next;
      await flush();
    });
    expect(screen.getByText('Deniz Feneri')).toBeTruthy();
    expect(screen.getByTestId('mini-player-overlay').props.pointerEvents).toBe('box-none');
  });

  it('comes back when a story plays again after it left', async () => {
    await renderShell();
    await playStory();
    await act(async () => {
      await audio.pause();
    });
    finishExit();
    expect(screen.queryByTestId('mini-player')).toBeNull();

    await act(async () => {
      await audio.play();
    });
    expect(screen.getByTestId('mini-player')).toBeTruthy();
    expect(screen.getByTestId('mini-player-overlay').props.pointerEvents).toBe('box-none');
  });
});

describe('mini player: layout, inset and motion', () => {
  it('floats over the tab scene: the bottom chrome keeps its height when it appears', async () => {
    await renderShell();
    const chrome = screen.getByTestId('main-bottom-chrome');
    act(() => {
      fireEvent(chrome, 'layout', { nativeEvent: { layout: { height: 130.2 } } });
    });
    const chromeBefore = hostTree(chrome);

    await playStory();
    // Not inside the chrome: the tab bar's layout (and so the scene) is the same.
    expect(within(chrome).queryByTestId('mini-player')).toBeNull();
    expect(within(chrome).queryByTestId('main-bottom-fade')).toBeNull();
    expect(hostTree(chrome)).toEqual(chromeBefore);
    expect(flatStyle(chrome).paddingTop ?? 0).toBe(0);
    // An absolute overlay on the measured chrome, across the screen.
    expect(flatStyle(screen.getByTestId('mini-player-overlay'))).toMatchObject({
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 130,
      overflow: 'hidden',
    });
    // The content fades out behind it, then the card 4dp above the bar.
    expect(flatStyle(screen.getByTestId('main-bottom-fade')).height).toBe(MINI_PLAYER_FADE_HEIGHT);
    expect(MINI_PLAYER_FADE_HEIGHT).toBe(24);
  });

  it('the snackbar inset grows by MINI_PLAYER_DOCK_HEIGHT while it shows', async () => {
    await renderShell();
    act(() => {
      fireEvent(screen.getByTestId('main-bottom-chrome'), 'layout', { nativeEvent: { layout: { height: 130 } } });
    });
    expect(snackbar.getState().bottomInset).toBe(130);

    await playStory();
    expect(snackbar.getState().bottomInset).toBe(130 + MINI_PLAYER_DOCK_HEIGHT);

    await act(async () => {
      await audio.pause();
    });
    expect(snackbar.getState().bottomInset).toBe(130);
  });

  it('a push over the shell hands the snackbar back without re-rendering the tab bar', async () => {
    const Stack = createNativeStackNavigator<RootStackParamList>();
    const ref = createNavigationContainerRef<RootStackParamList>();
    const PlayerProbe = () => <Text testID="player-probe">player</Text>;
    render(
      <ThemeProvider initialPalette="gece-mavisi">
        <NavigationContainer ref={ref}>
          <Stack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: false }}>
            <Stack.Screen name="Main" component={MainScaffold} />
            <Stack.Screen name="AudioPlayer" component={PlayerProbe} />
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>,
    );
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    act(() => {
      fireEvent(screen.getByTestId('main-bottom-chrome'), 'layout', { nativeEvent: { layout: { height: 130 } } });
    });
    await playStory();
    expect(snackbar.getState().bottomInset).toBe(130 + MINI_PLAYER_DOCK_HEIGHT);
    const renders = mockTabItemRenders.count;

    await act(async () => {
      ref.navigate('AudioPlayer', { narrationId: 'nar-1' });
      jest.runOnlyPendingTimers();
    });
    // The player owns the bottom edge: no inset; the shell's tab bar did not render for it.
    expect(snackbar.getState().bottomInset).toBe(0);
    expect(mockTabItemRenders.count).toBe(renders);

    await act(async () => {
      ref.goBack();
      jest.runOnlyPendingTimers();
    });
    expect(snackbar.getState().bottomInset).toBe(130 + MINI_PLAYER_DOCK_HEIGHT);
    expect(mockTabItemRenders.count).toBe(renders);
  });

  it('rises 24dp into place while it fades in, and sinks out on the exit curve', async () => {
    const realTiming = Animated.timing;
    // Where each motion starts from, read when it is started.
    const starts: { from: number; to: number; duration?: number; easing?: unknown; native?: boolean }[] = [];
    jest.spyOn(Animated, 'timing').mockImplementation((value, config) => {
      starts.push({
        from: (value as unknown as { __getValue(): number }).__getValue(),
        to: config.toValue as number,
        duration: config.duration,
        easing: config.easing,
        native: config.useNativeDriver,
      });
      return realTiming(value, config);
    });
    await renderShell();
    await playStory();
    act(() => {
      jest.advanceTimersByTime(DURATION.enter + 50);
    });

    const enter = starts.filter(run => run.duration === DURATION.enter);
    expect(enter).toEqual(
      expect.arrayContaining([
        // translateY 24 to 0 and opacity 0 to 1, decelerating, on the native driver.
        { from: MINI_PLAYER_ENTER_OFFSET, to: 0, duration: DURATION.enter, easing: EASE.standard, native: true },
        { from: 0, to: 1, duration: DURATION.enter, easing: EASE.standard, native: true },
      ]),
    );
    expect(MINI_PLAYER_ENTER_OFFSET).toBe(24);

    // (The jest native driver does not write the running value back, so only
    // where the exit goes is read here.)
    starts.length = 0;
    await act(async () => {
      await audio.pause();
    });
    expect(starts.map(({ from: _from, ...run }) => run)).toEqual(
      expect.arrayContaining([
        { to: MINI_PLAYER_ENTER_OFFSET, duration: DURATION.exit, easing: EASE.exit, native: true },
        { to: 0, duration: DURATION.exit, easing: EASE.exit, native: true },
      ]),
    );
    expect(starts).toHaveLength(2);
  });

  it('mounted while already shown (back from the player) it is drawn at rest, with no motion', async () => {
    await playStory();
    const timing = jest.spyOn(Animated, 'timing');
    await renderShell();

    expect(screen.getByTestId('mini-player')).toBeTruthy();
    const motion = flatStyle(screen.getByTestId('mini-player-motion'));
    expect(motion.opacity).toBe(1);
    expect(motion.transform).toEqual([{ translateY: 0 }]);
    const dockRuns = timing.mock.calls.filter(
      ([, config]) => config.duration === DURATION.enter || config.duration === DURATION.exit,
    );
    expect(dockRuns).toEqual([]);
  });

  it('under reduced motion it only fades, in place', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timing = jest.spyOn(Animated, 'timing');
    await renderShell();
    await act(async () => {
      await flush();
    });
    await playStory();

    // Opacity cross-fades in DURATION.fast; nothing moves.
    const runs = timing.mock.calls.map(([, config]) => config);
    expect(runs).toContainEqual(expect.objectContaining({ toValue: 1, duration: DURATION.fast }));
    expect(runs.some(config => config.toValue === 0 && config.duration === DURATION.enter)).toBe(false);
    expect(flatStyle(screen.getByTestId('mini-player-motion')).transform).toEqual([{ translateY: 0 }]);

    timing.mockClear();
    await act(async () => {
      await audio.pause();
    });
    const exits = timing.mock.calls.map(([, config]) => config);
    expect(exits).toEqual([expect.objectContaining({ toValue: 0, duration: DURATION.fast })]);
    expect(flatStyle(screen.getByTestId('mini-player-motion')).transform).toEqual([{ translateY: 0 }]);
    finishExit();
    expect(screen.queryByTestId('mini-player')).toBeNull();
  });

  it('a change while the player covers the shell lands at once: no motion on the way back', async () => {
    const Stack = createNativeStackNavigator<RootStackParamList>();
    const ref = createNavigationContainerRef<RootStackParamList>();
    const PlayerProbe = () => <Text testID="player-probe">player</Text>;
    render(
      <ThemeProvider initialPalette="gece-mavisi">
        <NavigationContainer ref={ref}>
          {/* The screen directly below the top one stays live (Fabric). */}
          <Stack.Navigator screenOptions={{ headerShown: false, freezeOnBlur: false }}>
            <Stack.Screen name="Main" component={MainScaffold} />
            <Stack.Screen name="AudioPlayer" component={PlayerProbe} />
          </Stack.Navigator>
        </NavigationContainer>
      </ThemeProvider>,
    );
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    await playStory();
    act(() => {
      jest.advanceTimersByTime(DURATION.enter + 50);
    });

    // The card opens the player on the loaded story.
    await act(async () => {
      fireEvent.press(screen.getByTestId('mini-player-open'));
      jest.runOnlyPendingTimers();
    });
    expect(ref.getCurrentRoute()).toMatchObject({ name: 'AudioPlayer', params: { narrationId: 'nar-1' } });
    expect(screen.getByTestId('player-probe')).toBeTruthy();

    const timing = jest.spyOn(Animated, 'timing');
    const dockRuns = () =>
      timing.mock.calls
        .filter(([, config]) => config.duration === DURATION.enter || config.duration === DURATION.exit)
        .map(([, config]) => ({ to: config.toValue, duration: config.duration }));

    // Paused in the player: gone at once, under it.
    await act(async () => {
      await audio.pause();
    });
    expect(screen.queryByTestId('mini-player')).toBeNull();
    expect(dockRuns()).toEqual([]);

    // Played again in the player, then back: the card is there at rest.
    await act(async () => {
      await audio.play();
    });
    player.emit({ currentTime: 140, duration: 362, playing: true, playbackState: 'ready' });
    await act(async () => {
      ref.goBack();
      jest.runOnlyPendingTimers();
    });
    // The focused route is the shell's first tab again.
    expect(ref.getCurrentRoute()?.name).toBe('Stories');
    expect(screen.getByTestId('mini-player')).toBeTruthy();
    const motion = flatStyle(screen.getByTestId('mini-player-motion'));
    expect(motion.opacity).toBe(1);
    expect(motion.transform).toEqual([{ translateY: 0 }]);
    expect(dockRuns()).toEqual([]);

    // Back on the shell, a pause made elsewhere (the lock screen) animates it out again.
    await act(async () => {
      await audio.pause();
    });
    expect(dockRuns()).toEqual([
      { to: 0, duration: DURATION.exit },
      { to: MINI_PLAYER_ENTER_OFFSET, duration: DURATION.exit },
    ]);
  });
});

describe('offline banner', () => {
  const netInfo = (isConnected: boolean | null, isInternetReachable: boolean | null) => {
    act(() => {
      mockNetInfoListener?.({ isConnected, isInternetReachable });
    });
  };

  it('is the first row of the bottom chrome only while offline', async () => {
    await renderShell();
    const chrome = screen.getByTestId('main-bottom-chrome');
    expect(within(chrome).queryByTestId('offline-banner')).toBeNull();

    netInfo(false, false);
    expect(within(chrome).getByTestId('offline-banner')).toBeTruthy();
    expect(screen.getByText('Çevrimdışısın')).toBeTruthy();
    // The first row, above the tab bar, inside the measured chrome.
    const rows = hostTree(chrome).map(node => node.testID);
    expect(rows[0]).toBe('offline-banner');
    expect(rows.indexOf('offline-banner')).toBeLessThan(rows.indexOf('main-nav-bar'));

    netInfo(true, true);
    expect(within(chrome).queryByTestId('offline-banner')).toBeNull();
  });

  it('the mini player floats above the chrome, banner included', async () => {
    await renderShell();
    netInfo(false, false);
    act(() => {
      fireEvent(screen.getByTestId('main-bottom-chrome'), 'layout', { nativeEvent: { layout: { height: 158 } } });
    });
    await playStory();
    expect(flatStyle(screen.getByTestId('mini-player-overlay')).bottom).toBe(158);
    expect(snackbar.getState().bottomInset).toBe(158 + MINI_PLAYER_DOCK_HEIGHT);
  });
});
