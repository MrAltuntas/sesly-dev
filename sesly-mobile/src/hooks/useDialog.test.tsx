/**
 * Where the `useDialog()` dialog renders: in the top dialog outlet (a
 * visible sheet's window, a modal screen), at the root without one, and
 * never while a sheet is leaving (docs/release-pass/SPEC-design.md 2.2,
 * "Dialog outlets"; iOS refuses a presentation over a leaving window).
 */

import React, { useState } from 'react';
import { Dimensions, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { act, configure, fireEvent, screen, within } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { renderWithProviders } from '../test-utils/render-helpers';
import { BottomSheet } from '../components/design/BottomSheet';
import {
  clearWindowRequest,
  isAnyWindowWaiting,
  isWindowRequested,
  resetSheetPresence,
} from '../components/design/sheetPresence';
import { VEIL_AT_EXIT_END, WINDOW_FALLBACK_MS } from '../components/design/usePresence';
import { parseColor } from '../theme/color';
import { DURATION } from '../theme/motion';
import { themes } from '../theme/theme';
import { DialogOutlet, DialogProvider, useDialog, withDialogOutlet } from './useDialog';

// A dialog in a sheet's window sits beside the accessibilityViewIsModal
// sheet in the test tree (on a device it is its own window).
configure({ defaultIncludeHiddenElements: true });

interface HeldTiming {
  toValue: number;
  duration?: number;
  callback?: (finished?: boolean) => void;
}

/** Holds every withTiming: nothing ends until the test calls the callback. */
function holdTimings(): HeldTiming[] {
  const held: HeldTiming[] = [];
  jest.spyOn(Reanimated, 'withTiming').mockImplementation(((
    toValue: number,
    config?: { duration?: number },
    callback?: (finished?: boolean) => void,
  ) => {
    held.push({ toValue, duration: config?.duration, callback });
    return toValue;
  }) as unknown as typeof Reanimated.withTiming);
  return held;
}

let api: ReturnType<typeof useDialog>;
function Grab() {
  api = useDialog();
  return null;
}

const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 400 } } };

afterEach(() => resetSheetPresence());

describe('dialog outlets', () => {
  it('renders the dialog at the root when no outlet is mounted', () => {
    renderWithProviders(
      <DialogProvider>
        <Grab />
        <View testID="screen" />
      </DialogProvider>,
    );
    act(() => api.showDialog({ title: 'Kök' }));
    expect(screen.getByText('Kök')).toBeOnTheScreen();
    expect(within(screen.getByTestId('screen')).queryByText('Kök')).toBeNull();
  });

  it('a dialog shown while an outlet is mounted renders inside it, not at the root', () => {
    renderWithProviders(
      <DialogProvider>
        <Grab />
        <View testID="window">
          <DialogOutlet />
        </View>
      </DialogProvider>,
    );
    act(() => api.showDialog({ title: 'İçeride' }));
    expect(within(screen.getByTestId('window')).getByText('İçeride')).toBeOnTheScreen();
    expect(screen.getAllByTestId('dialog')).toHaveLength(1);
  });

  it('nested outlets pick the last one mounted, and fall back when it goes', () => {
    function Windows() {
      const [second, setSecond] = useState(true);
      return (
        <>
          <View testID="first">
            <DialogOutlet />
          </View>
          {second ? (
            <View testID="second">
              <DialogOutlet />
            </View>
          ) : null}
          <Text onPress={() => setSecond(false)}>ikinciyi kapat</Text>
        </>
      );
    }
    renderWithProviders(
      <DialogProvider>
        <Grab />
        <Windows />
      </DialogProvider>,
    );
    act(() => api.showDialog({ title: 'Üstte' }));
    expect(within(screen.getByTestId('second')).getByText('Üstte')).toBeOnTheScreen();
    expect(within(screen.getByTestId('first')).queryByText('Üstte')).toBeNull();

    fireEvent.press(screen.getByText('ikinciyi kapat'));
    expect(within(screen.getByTestId('first')).getByText('Üstte')).toBeOnTheScreen();
    expect(screen.getAllByTestId('dialog')).toHaveLength(1);
  });

  it('an outlet outside the provider draws nothing', () => {
    renderWithProviders(
      <View testID="window">
        <DialogOutlet />
      </View>,
    );
    expect(screen.UNSAFE_queryAllByType(Modal)).toHaveLength(0);
  });

  it('withDialogOutlet gives a modal screen its own outlet', () => {
    function RecordingScreen({ label }: { label: string }) {
      const { showDialog } = useDialog();
      return <Text onPress={() => showDialog({ title: 'Kayıt hatası' })}>{label}</Text>;
    }
    const Wrapped = withDialogOutlet(RecordingScreen);
    expect(Wrapped.displayName).toBe('withDialogOutlet(RecordingScreen)');

    renderWithProviders(
      <DialogProvider>
        <View testID="modal-screen">
          <Wrapped label="kaydet" />
        </View>
      </DialogProvider>,
    );
    fireEvent.press(screen.getByText('kaydet'));
    expect(within(screen.getByTestId('modal-screen')).getByText('Kayıt hatası')).toBeOnTheScreen();
  });
});

describe('dialogs and sheets', () => {
  function Screen() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <BottomSheet visible={open} onClose={() => setOpen(false)} testID="sheet">
          <Text>Anlatıcılar</Text>
        </BottomSheet>
        <Text onPress={() => setOpen(false)}>sayfayi kapat</Text>
      </>
    );
  }

  it('a dialog over an open sheet opens in the sheet window', () => {
    renderWithProviders(
      <DialogProvider>
        <Grab />
        <Screen />
      </DialogProvider>,
    );
    fireEvent(screen.getByTestId('sheet'), 'layout', layout);
    act(() => api.showDialog({ title: 'Sınır doldu' }));
    // The outlet sits in the sheet's window, after the sheet itself.
    expect(screen.getByText('Sınır doldu')).toBeOnTheScreen();
    expect(screen.getAllByTestId('dialog')).toHaveLength(1);
    expect(within(screen.getByTestId('sheet')).queryByText('Sınır doldu')).toBeNull();
  });

  it('a dialog shown while a sheet is leaving renders nothing until its onClosed', () => {
    const held = holdTimings();
    renderWithProviders(
      <DialogProvider>
        <Grab />
        <Screen />
      </DialogProvider>,
    );
    fireEvent(screen.getByTestId('sheet'), 'layout', layout);
    const enter = held[held.length - 1];
    act(() => enter.callback?.(true));

    fireEvent.press(screen.getByText('sayfayi kapat'));
    const exit = held[held.length - 1];
    expect(exit.toValue).toBe(0);
    act(() => api.showDialog({ title: 'Bildirildi' }));
    expect(screen.queryByText('Bildirildi')).toBeNull();
    expect(screen.queryByTestId('dialog')).toBeNull();

    act(() => exit.callback?.(true));
    expect(screen.queryByText('Anlatıcılar')).toBeNull();
    expect(screen.getByText('Bildirildi')).toBeOnTheScreen();
  });

  it('a dialog shown in the tap that closes the sheet never opens its window while the sheet leaves', () => {
    const held = holdTimings();
    function CloseAndAsk() {
      const [open, setOpen] = useState(true);
      const { showDialog } = useDialog();
      return (
        <>
          <BottomSheet visible={open} onClose={() => setOpen(false)} testID="sheet">
            <Text>Anlatıcılar</Text>
          </BottomSheet>
          <Text
            onPress={() => {
              setOpen(false);
              showDialog({ title: 'Sınır doldu' });
            }}
          >
            kapat ve sor
          </Text>
        </>
      );
    }
    renderWithProviders(
      <DialogProvider>
        <CloseAndAsk />
      </DialogProvider>,
    );
    fireEvent(screen.getByTestId('sheet'), 'layout', layout);
    act(() => held[held.length - 1].callback?.(true));

    fireEvent.press(screen.getByText('kapat ve sor'));
    // No commit opened the dialog (its enter never started), in the sheet's
    // window or at the root: iOS would refuse it during the dismissal.
    const dialogEnter = (entry: HeldTiming) => entry.toValue === 1 && entry.duration === DURATION.base;
    expect(held.some(dialogEnter)).toBe(false);
    expect(screen.queryByTestId('dialog')).toBeNull();

    act(() => held.filter(entry => entry.toValue === 0).pop()?.callback?.(true));
    expect(screen.queryByText('Anlatıcılar')).toBeNull();
    expect(screen.getByText('Sınır doldu')).toBeOnTheScreen();
    expect(held.some(dialogEnter)).toBe(true);
  });

  it('hideDialog cancels a dialog still waiting for a sheet', () => {
    const held = holdTimings();
    renderWithProviders(
      <DialogProvider>
        <Grab />
        <Screen />
      </DialogProvider>,
    );
    fireEvent(screen.getByTestId('sheet'), 'layout', layout);
    fireEvent.press(screen.getByText('sayfayi kapat'));
    const exit = held[held.length - 1];
    act(() => api.showDialog({ title: 'Bekleyen' }));
    act(() => api.hideDialog());

    act(() => exit.callback?.(true));
    expect(screen.queryByText('Bekleyen')).toBeNull();
  });

  it('a dialog in a sheet that starts leaving waits for the root until the sheet is gone', () => {
    const held = holdTimings();
    renderWithProviders(
      <DialogProvider>
        <Grab />
        <Screen />
      </DialogProvider>,
    );
    fireEvent(screen.getByTestId('sheet'), 'layout', layout);
    act(() => api.showDialog({ title: 'Taşınan' }));
    expect(screen.getByText('Taşınan')).toBeOnTheScreen();

    fireEvent.press(screen.getByText('sayfayi kapat'));
    // The sheet's outlet went with `visible`; the root holds it back.
    expect(screen.queryByText('Taşınan')).toBeNull();

    const sheetExit = held.filter(entry => entry.toValue === 0).pop();
    act(() => sheetExit?.callback?.(true));
    expect(screen.getByText('Taşınan')).toBeOnTheScreen();
  });
});

describe('showDialog and the root veil', () => {
  it('asks for a window when a dialog opens, not when an open one only swaps its content', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    renderWithProviders(
      <DialogProvider>
        <Grab />
      </DialogProvider>,
    );
    act(() => api.showDialog({ title: 'Bir' }));
    // The window waits to be shown, so the request still stands.
    expect(isWindowRequested()).toBe(true);
    clearWindowRequest();
    act(() => api.showDialog({ title: 'İki' }));
    expect(isWindowRequested()).toBe(false);
    act(() => api.hideDialog());
    act(() => api.showDialog({ title: 'Üç' }));
    expect(isWindowRequested()).toBe(true);
  });
});

describe('on Android, a dialog opened from a sheet (V3-07, NL-08)', () => {
  const SCREEN_H = Dimensions.get('screen').height;
  const full = { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: SCREEN_H } } };
  const opacityOf = (testID: string) => {
    const node = screen.queryByTestId(testID);
    if (!node) return null;
    return (StyleSheet.flatten(node.props.style) as { opacity?: number }).opacity ?? 1;
  };

  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));

  /** Android added the windows: each Modal's onShow (and a frame goes by). */
  const showWindows = () =>
    act(() => {
      screen.UNSAFE_getAllByType(Modal).forEach(modal => fireEvent(modal, 'show'));
      jest.advanceTimersByTime(17);
    });

  const TITLE = 'Baştan hazırlansın mı?';

  /** The options sheet of a story: the picked action shows its dialog from onClosed. */
  function OptionsThenAsk({ onClosed }: { onClosed: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <BottomSheet visible={open} onClose={() => setOpen(false)} onClosed={onClosed} testID="sheet">
          <Text>Seçenekler</Text>
        </BottomSheet>
        <Text onPress={() => setOpen(false)}>baştan hazırla</Text>
      </>
    );
  }

  function renderHandoff(held: HeldTiming[]) {
    const onClosed = jest.fn(() => api.showDialog({ title: TITLE }));
    const tree = () => (
      <DialogProvider>
        <Grab />
        <OptionsThenAsk onClosed={onClosed} />
      </DialogProvider>
    );
    const view = renderWithProviders(tree());
    showWindows();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', full);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout);
    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));
    // The mock computes animated styles in render: render again to read them.
    const restyle = () => view.rerender(tree());
    return { onClosed, restyle };
  }

  it('the dialog commits in the batch that ends the sheet exit, with no tick in between', () => {
    const held = holdTimings();
    const { onClosed } = renderHandoff(held);
    fireEvent.press(screen.getByText('baştan hazırla'));
    const exit = held.filter(entry => entry.callback).pop();
    expect(exit).toMatchObject({ toValue: 0, duration: DURATION.sheetExit });

    act(() => {
      exit?.callback?.(true);
      // onClosed ran inside the exit's end, not from a later effect.
      expect(onClosed).toHaveBeenCalledTimes(1);
    });
    // The dialog's window is up (waiting to be shown) after that one batch.
    expect(screen.getByText(TITLE)).toBeOnTheScreen();
    expect(isAnyWindowWaiting()).toBe(true);

    showWindows();
    fireEvent(screen.getByTestId('dialog-window'), 'layout', full);
    expect(held.some(entry => entry.toValue === 1 && entry.duration === DURATION.base)).toBe(true);
  });

  /** The sheet's and the dialog's windows over the root veil in the app's, as one scrim's opacity. */
  const dimmed = () => {
    const alpha = parseColor(themes['gece-mavisi'].scrim).a;
    const layers = ['handoff-veil', 'sheet-scrim-layer', 'dialog-scrim-layer'].map(id => opacityOf(id) ?? 0);
    return (1 - layers.reduce((light, opacity) => light * (1 - alpha * opacity), 1)) / alpha;
  };
  const dialogEnters = (entry: HeldTiming) => entry.toValue === 1 && entry.duration === DURATION.base && !!entry.callback;
  const veilFades = (entry: HeldTiming) => entry.toValue === 0 && !entry.callback;

  it('the screen never undims: the veil holds the scrim while the dialog waits and while it is open, and leaves with its exit', () => {
    const held = holdTimings();
    const { restyle } = renderHandoff(held);
    restyle();
    expect(dimmed()).toBeCloseTo(1);
    // The veil was mounted, idle, before any hand-off.
    expect(opacityOf('handoff-veil')).toBe(0);

    fireEvent.press(screen.getByText('baştan hazırla'));
    restyle();
    // The exit ended (the mock ends it at once): the end share of the scrim
    // is still in the sheet's own window.
    expect(opacityOf('sheet-scrim-layer')).toBeCloseTo(VEIL_AT_EXIT_END);
    expect(opacityOf('handoff-veil')).toBe(0);
    expect(dimmed()).toBeCloseTo(VEIL_AT_EXIT_END);

    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));
    restyle();
    // onClosed asked for the dialog: the veil took the share and the scrim
    // let go of it; the dialog waits and draws nothing yet.
    expect(opacityOf('handoff-veil')).toBeCloseTo(VEIL_AT_EXIT_END);
    expect(opacityOf('sheet-scrim-layer')).toBeCloseTo(0);
    expect(dimmed()).toBeCloseTo(VEIL_AT_EXIT_END);
    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));
    expect(screen.queryByText('Seçenekler')).toBeNull();
    expect(isAnyWindowWaiting()).toBe(true);
    expect(opacityOf('dialog-scrim-layer')).toBe(0);
    const beforeDialog = held.length;

    // The dialog's first window layout has the full height, but Android has
    // not shown its window yet: nothing starts, the veil holds (RB-1, RB-3).
    fireEvent(screen.getByTestId('dialog-window'), 'layout', full);
    expect(held).toHaveLength(beforeDialog);
    restyle();
    expect(dimmed()).toBeCloseTo(VEIL_AT_EXIT_END);

    // Shown: it enters over the veil, which stays (the screen only darkens).
    showWindows();
    const later = held.slice(beforeDialog);
    expect(later.filter(dialogEnters)).toHaveLength(1);
    expect(later.filter(veilFades)).toHaveLength(0);
    restyle();
    expect(opacityOf('handoff-veil')).toBeCloseTo(VEIL_AT_EXIT_END);
    expect(dimmed()).toBeGreaterThan(1);
    expect(screen.getByText(TITLE)).toBeOnTheScreen();

    // Its exit takes the veil with it, on the dialog's exit timing.
    const beforeExit = held.length;
    act(() => api.hideDialog());
    expect(held.slice(beforeExit).filter(entry => veilFades(entry) && entry.duration === DURATION.exit)).toHaveLength(1);
    restyle();
    expect(opacityOf('handoff-veil')).toBe(0);
  });

  it('a dialog whose window never reports its full size enters after WINDOW_FALLBACK_MS, the veil held until then and after', () => {
    const held = holdTimings();
    const { restyle } = renderHandoff(held);
    fireEvent.press(screen.getByText('baştan hazırla'));
    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));
    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));
    const beforeDialog = held.length;
    showWindows();
    fireEvent(screen.getByTestId('dialog-window'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height: SCREEN_H - 76 } },
    });

    // The size fallback counts from the mount (the window was shown a frame in).
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS - 17 - 1));
    expect(held).toHaveLength(beforeDialog);
    restyle();
    expect(opacityOf('handoff-veil')).toBeCloseTo(VEIL_AT_EXIT_END);

    act(() => jest.advanceTimersByTime(1));
    const later = held.slice(beforeDialog);
    expect(later.filter(dialogEnters)).toHaveLength(1);
    expect(later.filter(veilFades)).toHaveLength(0);
  });

  it('showDialog from onClosed: the veil takes the share in that batch, before it renders', () => {
    const held = holdTimings();
    const { restyle } = renderHandoff(held);
    fireEvent.press(screen.getByText('baştan hazırla'));
    const exit = held.filter(entry => entry.callback).pop();
    const atRelease = held.length;
    act(() => {
      exit?.callback?.(true);
      // Inside the batch, before it renders: the scrim lets go (HANDOVER), no fade.
      expect(held.slice(atRelease).map(entry => entry.toValue)).toEqual([1]);
    });
    restyle();
    expect(opacityOf('handoff-veil')).toBeCloseTo(VEIL_AT_EXIT_END);
    expect(held.filter(entry => entry.toValue === 0 && entry.duration === DURATION.fast)).toEqual([]);
    expect(isAnyWindowWaiting()).toBe(true);
  });

  it('a plain close (nothing opened from onClosed) leaves the veil alone: the scrim fades in its own window', () => {
    const held = holdTimings();
    function JustClose() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <BottomSheet visible={open} onClose={() => setOpen(false)} testID="sheet">
            <Text>Seçenekler</Text>
          </BottomSheet>
          <Text onPress={() => setOpen(false)}>kapat</Text>
        </>
      );
    }
    const tree = () => (
      <DialogProvider>
        <JustClose />
      </DialogProvider>
    );
    const view = renderWithProviders(tree());
    showWindows();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', full);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout);
    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));

    fireEvent.press(screen.getByText('kapat'));
    const afterClose = held.length;
    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));
    // The scrim's own fade, in DURATION.fast.
    expect(held.slice(afterClose).filter(entry => entry.callback)).toEqual([
      expect.objectContaining({ toValue: 0, duration: DURATION.fast }),
    ]);
    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));
    expect(screen.queryByText('Seçenekler')).toBeNull();
    // The mock computes animated styles in render: render again to read them.
    view.rerender(tree());
    expect(opacityOf('handoff-veil')).toBe(0);
    expect(screen.queryByTestId('dialog')).toBeNull();
  });

  it('a dialog shown in the tap that closes a sheet opens at once (Android stacks windows)', () => {
    const held = holdTimings();
    function CloseAndAsk() {
      const [open, setOpen] = useState(true);
      const { showDialog } = useDialog();
      return (
        <>
          <BottomSheet visible={open} onClose={() => setOpen(false)} testID="sheet">
            <Text>Anlatıcılar</Text>
          </BottomSheet>
          <Text
            onPress={() => {
              setOpen(false);
              showDialog({ title: 'Sınır doldu' });
            }}
          >
            kapat ve sor
          </Text>
        </>
      );
    }
    renderWithProviders(
      <DialogProvider>
        <CloseAndAsk />
      </DialogProvider>,
    );
    showWindows();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', full);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout);
    act(() => held.filter(entry => entry.callback).pop()?.callback?.(true));

    fireEvent.press(screen.getByText('kapat ve sor'));
    expect(screen.getByText('Anlatıcılar')).toBeOnTheScreen();
    expect(screen.getByText('Sınır doldu')).toBeOnTheScreen();
  });
});
