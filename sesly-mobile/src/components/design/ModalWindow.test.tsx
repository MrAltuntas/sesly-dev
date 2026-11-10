/**
 * ModalWindow: the one Modal of the app, the Android-only system-bars view
 * and the Android content height (docs/release-pass/SPEC-design.md 2.1
 * step 3, 2.2, 5.6).
 */

import React from 'react';
import { Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { DialogProvider } from '../../hooks/useDialog';
import { ModalWindow } from './ModalWindow';
import { resetSheetPresence, setAppWindowHeight } from './sheetPresence';

function renderWindow(props: Partial<React.ComponentProps<typeof ModalWindow>> = {}) {
  return render(
    <ModalWindow visible onRequestClose={jest.fn()} {...props}>
      <Text>Pencere</Text>
    </ModalWindow>,
  );
}

describe('ModalWindow', () => {
  it('is transparent and does not animate, with no translucent-bar props (no-ops edge to edge)', () => {
    renderWindow();
    const props = screen.UNSAFE_getByType(Modal).props;
    expect(props).toMatchObject({ visible: true, transparent: true, animationType: 'none' });
    // React Native lays every Modal window out under both bars on an
    // edge-to-edge build and ignores these two (ReactModalHostView).
    expect(props.statusBarTranslucent).toBeUndefined();
    expect(props.navigationBarTranslucent).toBeUndefined();
  });

  it('puts its content in a gesture handler root of its own', () => {
    renderWindow();
    const root = screen.UNSAFE_getByType(GestureHandlerRootView);
    expect(root.props.style).toEqual({ flex: 1 });
    expect(screen.getByText('Pencere')).toBeOnTheScreen();
  });

  it('draws the zero-size system-bars view on Android, before the gesture root', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    renderWindow();
    const bars = screen.getByTestId('modal-system-bars');
    expect(bars.props.style).toEqual({ position: 'absolute', width: 0, height: 0 });
    const modal = screen.UNSAFE_getByType(Modal);
    const children = React.Children.toArray(modal.props.children) as React.ReactElement[];
    expect(children).toHaveLength(2);
    expect(children[1].type).toBe(GestureHandlerRootView);
  });

  it('has no system-bars view on iOS', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    renderWindow();
    expect(screen.queryByTestId('modal-system-bars')).toBeNull();
    expect(React.Children.toArray(screen.UNSAFE_getByType(Modal).props.children)).toHaveLength(1);
  });

  describe('the content height on Android (V3-07: a window needs no second layout to enter)', () => {
    // The windows are still mounted here, and they follow the height.
    afterEach(() => act(() => resetSheetPresence()));

    it('lays its content out at least as tall as the app window once the root veil measured it', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      renderWindow();
      // Not measured yet: it simply fills the window.
      expect(screen.UNSAFE_getByType(GestureHandlerRootView).props.style).toEqual({ flex: 1 });

      act(() => setAppWindowHeight(915));
      expect(StyleSheet.flatten(screen.UNSAFE_getByType(GestureHandlerRootView).props.style)).toEqual({
        flex: 1,
        minHeight: 915,
      });
    });

    it('takes the height the root veil of DialogProvider measures', () => {
      jest.replaceProperty(Platform, 'OS', 'android');
      render(
        <DialogProvider>
          <ModalWindow visible onRequestClose={jest.fn()}>
            <Text>Pencere</Text>
          </ModalWindow>
        </DialogProvider>,
      );
      fireEvent(screen.getByTestId('handoff-veil'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 412, height: 915 } },
      });
      expect(StyleSheet.flatten(screen.UNSAFE_getByType(GestureHandlerRootView).props.style).minHeight).toBe(915);
    });

    it('never on iOS, whose Modal is full screen from its first layout', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      setAppWindowHeight(915);
      renderWindow();
      expect(screen.UNSAFE_getByType(GestureHandlerRootView).props.style).toEqual({ flex: 1 });
    });
  });

  it('passes the onShow of the Modal through (usePresence waits for it on Android, RB-3)', () => {
    const onShow = jest.fn();
    renderWindow({ onShow });
    expect(onShow).not.toHaveBeenCalled();
    fireEvent(screen.UNSAFE_getByType(Modal), 'show');
    expect(onShow).toHaveBeenCalledTimes(1);
  });

  it('passes the back button and the iOS dismissal through', () => {
    const onRequestClose = jest.fn();
    const onDismiss = jest.fn();
    const { rerender } = renderWindow({ onRequestClose, onDismiss });
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    expect(onRequestClose).toHaveBeenCalledTimes(1);

    rerender(
      <ModalWindow visible={false} onRequestClose={onRequestClose} onDismiss={onDismiss}>
        <Text>Pencere</Text>
      </ModalWindow>,
    );
    expect(screen.queryByText('Pencere')).toBeNull();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('getModalSystemBars (modules/sesly-system-bars)', () => {
  function loadModule(os: 'ios' | 'android', { built = true } = {}) {
    const requireNativeViewManager = jest.fn(() => View);
    const requireOptionalNativeModule = jest.fn(() => (built ? { ViewPrototypes: {} } : null));
    let getModalSystemBars: () => unknown = () => undefined;
    // React Native stays the shared copy; only the module and expo-modules-core are fresh.
    jest.replaceProperty(Platform, 'OS', os);
    jest.isolateModules(() => {
      jest.doMock('expo-modules-core', () => ({ requireNativeViewManager, requireOptionalNativeModule }));
      ({ getModalSystemBars } = jest.requireActual('../../../modules/sesly-system-bars'));
    });
    return { getModalSystemBars, requireNativeViewManager, requireOptionalNativeModule };
  }

  it('is null on iOS and never asks for the native view', () => {
    const { getModalSystemBars, requireNativeViewManager, requireOptionalNativeModule } = loadModule('ios');
    expect(getModalSystemBars()).toBeNull();
    expect(requireNativeViewManager).not.toHaveBeenCalled();
    expect(requireOptionalNativeModule).not.toHaveBeenCalled();
  });

  it('resolves the native view once on Android', () => {
    const { getModalSystemBars, requireNativeViewManager } = loadModule('android');
    expect(getModalSystemBars()).toBe(View);
    expect(getModalSystemBars()).toBe(View);
    expect(requireNativeViewManager).toHaveBeenCalledTimes(1);
    expect(requireNativeViewManager).toHaveBeenCalledWith('SeslySystemBars');
  });

  it('is null in a build without the native module, and does not ask again', () => {
    const { getModalSystemBars, requireNativeViewManager, requireOptionalNativeModule } = loadModule('android', {
      built: false,
    });
    expect(getModalSystemBars()).toBeNull();
    expect(getModalSystemBars()).toBeNull();
    expect(requireOptionalNativeModule).toHaveBeenCalledTimes(1);
    expect(requireOptionalNativeModule).toHaveBeenCalledWith('SeslySystemBars');
    expect(requireNativeViewManager).not.toHaveBeenCalled();
  });
});

describe('modules/sesly-system-bars config', () => {
  // Read from disk: a prebuild or a stray iOS entry would break the native build.
  const fs = jest.requireActual<typeof import('fs')>('fs');
  const path = jest.requireActual<typeof import('path')>('path');
  const root = path.resolve(__dirname, '../../../modules/sesly-system-bars');

  it('the build is edge to edge, so a Modal window needs no translucent-bar props', () => {
    const app = path.resolve(__dirname, '../../..');
    const gradle = fs.readFileSync(path.join(app, 'android/gradle.properties'), 'utf8');
    expect(gradle).toMatch(/^edgeToEdgeEnabled=true$/m);
    expect(fs.readFileSync(path.join(app, 'app.config.js'), 'utf8')).toMatch(/edgeToEdgeEnabled:\s*true/);
  });

  it('lists only Android, with the module class the Kotlin source defines', () => {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'expo-module.config.json'), 'utf8'));
    expect(config).toEqual({
      platforms: ['android'],
      android: { modules: ['expo.modules.seslysystembars.SeslySystemBarsModule'] },
    });
    const kotlin = path.join(root, 'android/src/main/java/expo/modules/seslysystembars');
    const moduleSource = fs.readFileSync(path.join(kotlin, 'SeslySystemBarsModule.kt'), 'utf8');
    expect(moduleSource).toContain('Name("SeslySystemBars")');
    expect(moduleSource).toContain('View(ModalSystemBarsView::class)');
    const viewSource = fs.readFileSync(path.join(kotlin, 'ModalSystemBarsView.kt'), 'utf8');
    expect(viewSource).toContain('isNavigationBarContrastEnforced = false');
    expect(viewSource).toContain('removeOnPreDrawListener');
  });
});
