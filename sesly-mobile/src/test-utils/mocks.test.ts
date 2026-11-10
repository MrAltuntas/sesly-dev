/**
 * The shared Jest mocks (src/test-utils/mocks): the new native modules resolve
 * to their mocks and keep their implementations across tests (the global
 * afterEach clears calls only), and the navigation focus mock drives
 * useIsFocused / useFocusEffect the way a real blur and refocus would.
 */

import React, { useCallback } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import {
  KeyboardAwareScrollView,
  KeyboardController,
  KeyboardProvider,
  KeyboardStickyView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import * as SplashScreen from 'expo-splash-screen';
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
  useKeepAwake,
} from 'expo-keep-awake';
import NetInfo, { useNetInfo } from '@react-native-community/netinfo';

import { mockNavigation, setMockFocused } from './mocks/navigation';

const h = React.createElement;

describe('native module mocks', () => {
  it('resolves react-native-keyboard-controller to the library mock', () => {
    expect(require('react-native-keyboard-controller')).toBe(
      require('react-native-keyboard-controller/jest'),
    );
    expect(KeyboardAwareScrollView).toBe(ScrollView);
    expect(KeyboardStickyView).toBe(View);
    expect(jest.isMockFunction(KeyboardController.dismiss)).toBe(true);
    expect(useKeyboardState((s: { isVisible: boolean }) => s.isVisible)).toBe(false);
  });

  it('renders children through the mocked KeyboardProvider', () => {
    render(
      h(KeyboardProvider, {
        statusBarTranslucent: true,
        navigationBarTranslucent: true,
        preserveEdgeToEdge: true,
        children: h(Text, null, 'inside the provider'),
      }),
    );
    expect(screen.getByText('inside the provider')).toBeTruthy();
  });

  it('resolves expo-splash-screen to resolved jest functions', async () => {
    await expect(SplashScreen.preventAutoHideAsync()).resolves.toBe(true);
    await expect(SplashScreen.hideAsync()).resolves.toBeUndefined();
    SplashScreen.setOptions({ duration: 0, fade: false });
    SplashScreen.hide();
    expect(SplashScreen.preventAutoHideAsync).toHaveBeenCalledTimes(1);
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
    expect(SplashScreen.setOptions).toHaveBeenCalledWith({ duration: 0, fade: false });
    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });

  it('resolves expo-keep-awake to resolved jest functions', async () => {
    await expect(activateKeepAwakeAsync('voice-recording')).resolves.toBeUndefined();
    await expect(deactivateKeepAwake('voice-recording')).resolves.toBeUndefined();
    expect(activateKeepAwakeAsync).toHaveBeenCalledWith('voice-recording');
    expect(deactivateKeepAwake).toHaveBeenCalledWith('voice-recording');
    expect(jest.isMockFunction(useKeepAwake)).toBe(true);
  });

  it('resolves NetInfo to the library mock: online, with an unsubscribe', async () => {
    await expect(NetInfo.fetch()).resolves.toMatchObject({
      type: 'cellular',
      isConnected: true,
      isInternetReachable: true,
    });
    const unsubscribe = NetInfo.addEventListener(() => undefined);
    expect(typeof unsubscribe).toBe('function');
    expect(useNetInfo()).toMatchObject({ isConnected: true });
  });

  it('keeps the mock implementations after the previous test cleared the calls', async () => {
    expect(SplashScreen.preventAutoHideAsync).not.toHaveBeenCalled();
    await expect(SplashScreen.preventAutoHideAsync()).resolves.toBe(true);
    await expect(NetInfo.fetch()).resolves.toMatchObject({ isConnected: true });
    await expect(activateKeepAwakeAsync()).resolves.toBeUndefined();
  });
});

describe('navigation focus mock', () => {
  /** Shows the focus state and counts focus-effect runs and cleanups. */
  function FocusProbe({ onFocus, onBlur }: { onFocus: () => void; onBlur: () => void }) {
    const focused = useIsFocused();
    useFocusEffect(
      useCallback(() => {
        onFocus();
        return onBlur;
      }, [onFocus, onBlur]),
    );
    return h(Text, { testID: 'focus' }, focused ? 'focused' : 'blurred');
  }

  /** A memoised screen (like an observer) that a parent rerender would not reach. */
  const MemoProbe = React.memo(function MemoProbe() {
    return h(Text, { testID: 'memo-focus' }, useIsFocused() ? 'focused' : 'blurred');
  });

  it('is focused by default and runs the focus effect', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    render(h(FocusProbe, { onFocus, onBlur }));
    expect(screen.getByTestId('focus')).toHaveTextContent('focused');
    expect(onFocus).toHaveBeenCalled();
    expect(onBlur).not.toHaveBeenCalled();
    expect(mockNavigation.isFocused()).toBe(true);
  });

  it('setMockFocused(false) makes useIsFocused false without a rerender', () => {
    render(h(MemoProbe));
    expect(screen.getByTestId('memo-focus')).toHaveTextContent('focused');
    act(() => setMockFocused(false));
    expect(screen.getByTestId('memo-focus')).toHaveTextContent('blurred');
    expect(mockNavigation.isFocused()).toBe(false);
  });

  it('is focused again in the next test', () => {
    render(h(MemoProbe));
    expect(screen.getByTestId('memo-focus')).toHaveTextContent('focused');
    expect(mockNavigation.isFocused()).toBe(true);
  });

  it('runs the cleanup on blur, nothing while blurred, and the callback again on refocus', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const { rerender } = render(h(FocusProbe, { onFocus, onBlur }));
    const runsWhileFocused = onFocus.mock.calls.length;
    expect(runsWhileFocused).toBeGreaterThan(0);

    act(() => setMockFocused(false));
    expect(screen.getByTestId('focus')).toHaveTextContent('blurred');
    expect(onBlur).toHaveBeenCalledTimes(1);

    rerender(h(FocusProbe, { onFocus, onBlur }));
    expect(onFocus).toHaveBeenCalledTimes(runsWhileFocused);
    expect(onBlur).toHaveBeenCalledTimes(1);

    act(() => setMockFocused(true));
    expect(screen.getByTestId('focus')).toHaveTextContent('focused');
    expect(onFocus.mock.calls.length).toBeGreaterThan(runsWhileFocused);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('setting the same state twice notifies nobody', () => {
    const renders = jest.fn();
    function Counter() {
      renders(useIsFocused());
      return null;
    }
    render(h(Counter));
    const before = renders.mock.calls.length;
    act(() => setMockFocused(true));
    expect(renders).toHaveBeenCalledTimes(before);
  });
});
