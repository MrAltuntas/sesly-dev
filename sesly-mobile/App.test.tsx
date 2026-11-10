/**
 * App: starts the launch on its first render and renders once the stored
 * language and palette are applied (BootStore.uiReady) and the fonts are in
 * (or failed, or 3 s passed). It never waits for a service itself.
 *
 * RootNavigator, BootStore and expo-font are mocked; the providers are the
 * real ones except the two native wrappers, which record their props.
 */

const mockStart = jest.fn();
const mockUseFonts = jest.fn();
const mockStartSafetyTimer = jest.fn();
const mockWsConnect = jest.fn();
const mockAuthInitialize = jest.fn();
const mockKeyboardProps: Array<Record<string, unknown>> = [];
const mockSafeAreaProps: Array<Record<string, unknown>> = [];
const mockMetrics = { frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 48 } };
const mockBoot: { state: { uiReady: boolean } } = { state: { uiReady: false } };

jest.mock('./src/boot/BootStore', () => ({
  getBootStore: () => ({
    get uiReady() {
      return mockBoot.state.uiReady;
    },
    start: (...a: unknown[]) => mockStart(...a),
  }),
}));
jest.mock('./src/boot/splash', () => ({
  startSplashSafetyTimer: (...a: unknown[]) => mockStartSafetyTimer(...a),
}));
jest.mock('./src/navigation/RootNavigator', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { RootNavigator: () => React.createElement(Text, { testID: 'root-navigator' }, 'navigator') };
});
jest.mock('expo-font', () => ({
  useFonts: (...a: unknown[]) => mockUseFonts(...a),
  isLoaded: jest.fn().mockReturnValue(true),
  loadAsync: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./src/services/WebSocketService', () => ({
  __esModule: true,
  default: { connect: (...a: unknown[]) => mockWsConnect(...a), disconnect: jest.fn() },
}));
jest.mock('./src/services/AuthService', () => ({
  __esModule: true,
  default: { initialize: (...a: unknown[]) => mockAuthInitialize(...a) },
}));
jest.mock('react-native-keyboard-controller', () => {
  const React = require('react');
  return {
    KeyboardProvider: (props: Record<string, unknown> & { children: React.ReactNode }) => {
      mockKeyboardProps.push(props);
      return React.createElement(React.Fragment, null, props.children);
    },
  };
});
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    get initialWindowMetrics() {
      return mockMetrics;
    },
    SafeAreaProvider: (props: Record<string, unknown> & { children: React.ReactNode }) => {
      mockSafeAreaProps.push(props);
      return React.createElement(View, { testID: 'safe-area' }, props.children);
    },
    SafeAreaView: ({ children, ...props }: { children: React.ReactNode }) =>
      React.createElement(View, props, children),
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import { observable, runInAction } from 'mobx';
import * as fs from 'fs';
import * as path from 'path';

import App, { FONT_TIMEOUT_MS } from './App';
import { FONTS } from './src/theme/theme';

function setUiReady(ready: boolean): void {
  runInAction(() => {
    mockBoot.state.uiReady = ready;
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  mockBoot.state = observable({ uiReady: false });
  mockStart.mockReset().mockResolvedValue(undefined);
  mockUseFonts.mockReset().mockReturnValue([true, null]);
  mockStartSafetyTimer.mockReset();
  mockKeyboardProps.length = 0;
  mockSafeAreaProps.length = 0;
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('App', () => {
  it('renders nothing until the UI is ready, then the navigator', () => {
    render(<App />);
    expect(screen.toJSON()).toBeNull();

    act(() => setUiReady(true));

    expect(screen.getByTestId('root-navigator')).toBeOnTheScreen();
  });

  it('renders nothing until the fonts are in', () => {
    let setLoaded: (loaded: boolean) => void = () => undefined;
    mockUseFonts.mockImplementation(() => {
      const [loaded, set] = React.useState(false);
      setLoaded = set;
      return [loaded, null];
    });
    setUiReady(true);
    render(<App />);
    expect(screen.toJSON()).toBeNull();

    act(() => setLoaded(true));

    expect(screen.getByTestId('root-navigator')).toBeOnTheScreen();
    // The font cap is cleared once the fonts are in.
    act(() => {
      jest.advanceTimersByTime(FONT_TIMEOUT_MS);
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('renders after 3000 ms when the fonts never load', () => {
    mockUseFonts.mockReturnValue([false, null]);
    setUiReady(true);
    render(<App />);

    act(() => {
      jest.advanceTimersByTime(FONT_TIMEOUT_MS - 1);
    });
    expect(screen.toJSON()).toBeNull();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('root-navigator')).toBeOnTheScreen();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('[Font] not loaded after 3000 ms'));
  });

  it('the font cap does not lift the UI gate', () => {
    mockUseFonts.mockReturnValue([false, null]);
    render(<App />);

    act(() => {
      jest.advanceTimersByTime(FONT_TIMEOUT_MS * 2);
    });
    expect(screen.toJSON()).toBeNull();

    act(() => setUiReady(true));
    expect(screen.getByTestId('root-navigator')).toBeOnTheScreen();
  });

  it('renders at once with system fonts when a font fails', () => {
    mockUseFonts.mockReturnValue([false, new Error('font missing')]);
    setUiReady(true);
    render(<App />);

    expect(screen.getByTestId('root-navigator')).toBeOnTheScreen();
    expect(console.warn).toHaveBeenCalledWith('[Font] load error:', expect.any(Error));
  });

  it('starts the launch and the splash safety timer once across re-renders', () => {
    let setLoaded: (loaded: boolean) => void = () => undefined;
    mockUseFonts.mockImplementation(() => {
      const [loaded, set] = React.useState(false);
      setLoaded = set;
      return [loaded, null];
    });
    render(<App />);
    act(() => setUiReady(true));
    act(() => setLoaded(true));
    expect(screen.getByTestId('root-navigator')).toBeOnTheScreen();

    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStartSafetyTimer).toHaveBeenCalledTimes(1);
  });

  it('never connects the socket nor initialises auth itself', async () => {
    mockAuthInitialize.mockReturnValue(new Promise(() => undefined));
    setUiReady(true);
    render(<App />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });

    expect(screen.getByTestId('root-navigator')).toBeOnTheScreen();
    expect(mockWsConnect).not.toHaveBeenCalled();
    expect(mockAuthInitialize).not.toHaveBeenCalled();
  });

  it('registers one file per font family plus the icon font', () => {
    render(<App />);
    const fonts = mockUseFonts.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(fonts)).toEqual(expect.arrayContaining([FONTS.display, FONTS.body, FONTS.label, 'ionicons']));
    expect(Object.keys(fonts)).toHaveLength(4);
  });

  it('wraps the tree in the keyboard provider around the safe area with initial metrics', () => {
    setUiReady(true);
    render(<App />);

    // Edge to edge, the provider forces these on by itself and a dev build
    // warns about each one passed, so none is passed.
    const keyboardProps = mockKeyboardProps.at(-1) ?? {};
    expect(keyboardProps).not.toHaveProperty('statusBarTranslucent');
    expect(keyboardProps).not.toHaveProperty('navigationBarTranslucent');
    expect(keyboardProps).not.toHaveProperty('preserveEdgeToEdge');
    expect(mockSafeAreaProps.at(-1)?.initialMetrics).toBe(mockMetrics);
    // The safe area is inside the keyboard provider, the navigator inside both.
    expect(screen.getByTestId('safe-area')).toContainElement(screen.getByTestId('root-navigator'));
  });

  it('has no console.log on the render path', () => {
    const source = fs.readFileSync(path.join(__dirname, 'App.tsx'), 'utf8');
    expect(source).not.toMatch(/console\.log\(/);
  });
});
