/**
 * BottomSheet: the window contract (Modal props, back button, bottom
 * padding), presence (the exit keeps the sheet until it ends, a reopen
 * comes back from where it is), the Android scrim hand-off to the root
 * veil, drag to dismiss, the frozen title and the size props
 * (docs/release-pass/SPEC-design.md 2.2, 5.2).
 */

import React from 'react';
import { Dimensions, Modal, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { act, configure, fireEvent, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import * as KeyboardController from 'react-native-keyboard-controller';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { PALETTE_KEYS } from '../../theme/palettes';
import { raisedFace } from '../../theme/surfaces';
import { themes } from '../../theme/theme';
import { DURATION } from '../../theme/motion';
import { BottomSheet, shouldDismissSheet } from './BottomSheet';
import { Button } from './Button';
import { VEIL_HOLD_MAX_MS } from './DialogOutlet';
import { ALONE_FADE, DISMISS_FALLBACK_MS, HANDOVER, VEIL_AT_EXIT_END, WINDOW_FALLBACK_MS } from './usePresence';
import {
  isAnyClosing,
  isAnyWindowWaiting,
  markSheetClosing,
  markWindowEntered,
  markWindowOpen,
  markWindowWaiting,
  noteWindowEnter,
  noteWindowExit,
  registerSheet,
  requestWindow,
  resetSheetPresence,
  subscribeSheetPresence,
  unregisterSheet,
  whenAllClosed,
} from './sheetPresence';

// The module object itself (a namespace import would be a copy of the mock).
const SafeArea = jest.requireMock<typeof import('react-native-safe-area-context')>('react-native-safe-area-context');

// The scrim and the handle sit beside an accessibilityViewIsModal sheet.
configure({ defaultIncludeHiddenElements: true });

const flat = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

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

const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } });

/** The jest screen (750 x 1334). */
const SCREEN_H = Dimensions.get('screen').height;
/** The size React Native first gives a new Android Modal window: the screen without both bars. */
const PROVISIONAL_H = SCREEN_H - 28 - 48;

/** The held timing that ends an enter or an exit (the one with an end callback). */
const lastEnd = (held: HeldTiming[]) => held.filter(entry => entry.callback).pop();

/** Android added the window: the Modal's onShow. */
function showWindow() {
  act(() => {
    screen.UNSAFE_getAllByType(Modal).forEach(modal => fireEvent(modal, 'show'));
    jest.advanceTimersByTime(17);
  });
}

function Sheet(props: Partial<React.ComponentProps<typeof BottomSheet>>) {
  return (
    <BottomSheet visible onClose={jest.fn()} title="Oynatma hızı" testID="sheet" {...props}>
      {props.children ?? <Text>İçerik</Text>}
    </BottomSheet>
  );
}

afterEach(() => resetSheetPresence());

describe('BottomSheet window', () => {
  it('opens a transparent Modal that does not animate (edge to edge without translucent-bar props)', () => {
    renderWithProviders(<Sheet />);
    const modal = screen.UNSAFE_getByType(Modal);
    expect(modal.props).toMatchObject({ visible: true, transparent: true, animationType: 'none' });
    expect(modal.props.statusBarTranslucent).toBeUndefined();
    expect(modal.props.navigationBarTranslucent).toBeUndefined();
  });

  it.each([
    [48, 56],
    [24, 32],
    [0, 20],
  ])('a %idp bottom inset gives a %idp bottom padding', (bottom, padding) => {
    jest.spyOn(SafeArea, 'useSafeAreaInsets').mockReturnValue({ top: 0, right: 0, bottom, left: 0 });
    renderWithProviders(<Sheet />);
    expect(flat(screen.getByTestId('sheet')).paddingBottom).toBe(padding);
  });

  it.each([
    [0, 56],
    [0.5, 34],
    [1, 12],
  ])('keyboard progress %s pads %idp: 12 with it open, never the inset on top of the keyboard', (progress, padding) => {
    jest.spyOn(SafeArea, 'useSafeAreaInsets').mockReturnValue({ top: 0, right: 0, bottom: 48, left: 0 });
    // The library mock's hook is a shared jest.fn: change it, then put it back.
    const hook = KeyboardController.useReanimatedKeyboardAnimation as unknown as jest.Mock;
    const closed = hook();
    hook.mockReturnValue({ progress: { value: progress }, height: { value: -300 * progress } });
    try {
      renderWithProviders(<Sheet />);
      expect(flat(screen.getByTestId('sheet')).paddingBottom).toBe(padding);
    } finally {
      hook.mockReturnValue(closed);
    }
  });

  it('closes on the back button, the scrim, the handle and the VoiceOver escape gesture', () => {
    const onClose = jest.fn();
    renderWithProviders(<Sheet onClose={onClose} />);
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    fireEvent.press(screen.getByTestId('sheet-scrim'));
    fireEvent.press(screen.getByTestId('sheet-handle'));
    fireEvent(screen.getByTestId('sheet'), 'accessibilityEscape');
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('takes no touches and ignores the back button while it leaves', () => {
    holdTimings();
    const onClose = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClose={onClose} />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    rerender(<Sheet onClose={onClose} visible={false} />);

    expect(screen.getByText('İçerik')).toBeOnTheScreen();
    fireEvent(screen.UNSAFE_getByType(Modal), 'requestClose');
    fireEvent.press(screen.getByTestId('sheet-scrim'));
    fireEvent.press(screen.getByTestId('sheet-handle'));
    fireEvent(screen.getByTestId('sheet'), 'accessibilityEscape');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('sheet').props.pointerEvents).toBe('none');
  });

  it('draws the system-bars view on Android only', () => {
    const { unmount } = renderWithProviders(<Sheet />);
    expect(screen.queryByTestId('modal-system-bars')).toBeNull();
    unmount();

    jest.replaceProperty(Platform, 'OS', 'android');
    renderWithProviders(<Sheet />);
    expect(screen.getByTestId('modal-system-bars')).toBeOnTheScreen();
  });
});

describe('BottomSheet presence', () => {
  it('waits for its layout before the enter, then reports onOpened', () => {
    const held = holdTimings();
    const onOpened = jest.fn();
    renderWithProviders(<Sheet onOpened={onOpened} />);
    expect(held).toHaveLength(0);

    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    expect(held).toEqual([expect.objectContaining({ toValue: 1, duration: DURATION.sheetEnter })]);
    expect(onOpened).not.toHaveBeenCalled();

    act(() => held[0].callback?.(true));
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it('keeps the content until the exit ends, then unmounts and reports onClosed once', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClosed={onClosed} />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));

    rerender(<Sheet onClosed={onClosed} visible={false} />);
    const exit = held[held.length - 1];
    expect(exit).toMatchObject({ toValue: 0, duration: DURATION.sheetExit });
    expect(screen.getByText('İçerik')).toBeOnTheScreen();
    expect(onClosed).not.toHaveBeenCalled();

    act(() => exit.callback?.(true));
    expect(screen.queryByText('İçerik')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);

    // A late end callback changes nothing.
    act(() => exit.callback?.(true));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('an interrupted exit never unmounts', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClosed={onClosed} />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    rerender(<Sheet onClosed={onClosed} visible={false} />);

    act(() => held[held.length - 1].callback?.(false));
    expect(screen.getByText('İçerik')).toBeOnTheScreen();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('shown again during the exit, it stays mounted and comes back at once', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClosed={onClosed} />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    rerender(<Sheet onClosed={onClosed} visible={false} />);
    const exit = held[held.length - 1];

    rerender(<Sheet onClosed={onClosed} visible />);
    // No second layout comes: the enter starts from the current value.
    expect(held[held.length - 1]).toMatchObject({ toValue: 1, duration: DURATION.sheetEnter });
    expect(screen.getByTestId('sheet').props.pointerEvents).toBe('auto');

    // The cancelled exit's end does not close the sheet that came back.
    act(() => exit.callback?.(true));
    expect(screen.getByText('İçerik')).toBeOnTheScreen();
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('closed before its first layout, it leaves without an exit', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClosed={onClosed} />);
    rerender(<Sheet onClosed={onClosed} visible={false} />);
    expect(held).toHaveLength(0);
    expect(screen.queryByText('İçerik')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it.each(['ios', 'android'] as const)('on %s onClosed comes once the window is gone', os => {
    jest.replaceProperty(Platform, 'OS', os);
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClosed={onClosed} />);
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(SCREEN_H));
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    rerender(<Sheet onClosed={onClosed} visible={false} />);
    // The Reanimated mock ends the exit at once.
    expect(screen.queryByText('İçerik')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  describe('on iOS, while the window is still being dismissed', () => {
    // The Modal sends no onDismiss in these tests.
    const holdDismiss = () =>
      jest
        .spyOn(Modal.prototype as unknown as { componentDidUpdate: () => void }, 'componentDidUpdate')
        .mockImplementation(() => undefined);

    it('onClosed waits for onDismiss, and comes anyway after DISMISS_FALLBACK_MS', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      holdDismiss();
      const onClosed = jest.fn();
      const { rerender } = renderWithProviders(<Sheet onClosed={onClosed} />);
      fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
      rerender(<Sheet onClosed={onClosed} visible={false} />);
      expect(onClosed).not.toHaveBeenCalled();
      expect(isAnyClosing()).toBe(true);

      act(() => jest.advanceTimersByTime(DISMISS_FALLBACK_MS));
      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(isAnyClosing()).toBe(false);
    });

    it('opened again before onDismiss, it enters at once and stays registered as open', () => {
      jest.replaceProperty(Platform, 'OS', 'ios');
      holdDismiss();
      const onClosed = jest.fn();
      const { rerender } = renderWithProviders(<Sheet onClosed={onClosed} />);
      fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
      rerender(<Sheet onClosed={onClosed} visible={false} />);

      const held = holdTimings();
      rerender(<Sheet onClosed={onClosed} visible />);
      // The last close is over; no new layout is awaited.
      expect(onClosed).toHaveBeenCalledTimes(1);
      expect(held).toEqual([expect.objectContaining({ toValue: 1 })]);

      rerender(<Sheet onClosed={onClosed} visible={false} />);
      expect(isAnyClosing()).toBe(true);
    });
  });

  it('is marked as leaving while its exit runs', () => {
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Sheet />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    expect(isAnyClosing()).toBe(false);

    rerender(<Sheet visible={false} />);
    expect(isAnyClosing()).toBe(true);
    act(() => held[held.length - 1].callback?.(true));
    expect(isAnyClosing()).toBe(false);
  });

  it('unmounted while it leaves, it is no longer marked as leaving', () => {
    holdTimings();
    const { rerender, unmount } = renderWithProviders(<Sheet />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    rerender(<Sheet visible={false} />);
    expect(isAnyClosing()).toBe(true);
    unmount();
    expect(isAnyClosing()).toBe(false);
  });

  it('under reduced motion the scrim fades in DURATION.fast', () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Sheet />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    rerender(<Sheet visible={false} />);
    expect(held.map(entry => entry.duration)).toEqual([DURATION.fast, DURATION.fast]);
  });

  it('keeps its title while hidden, never its children', () => {
    holdTimings();
    const { rerender } = renderWithProviders(
      <Sheet title="Anlatıcı">
        <Text>Kerem</Text>
      </Sheet>,
    );
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    rerender(
      <Sheet title="Başka başlık" visible={false}>
        <Text>Zeynep</Text>
      </Sheet>,
    );
    expect(screen.getByTestId('sheet-title')).toHaveTextContent('Anlatıcı');
    // A choice made in the closing tap stays visible.
    expect(screen.getByText('Zeynep')).toBeOnTheScreen();

    rerender(
      <Sheet title="Yeni" visible>
        <Text>Zeynep</Text>
      </Sheet>,
    );
    expect(screen.getByTestId('sheet-title')).toHaveTextContent('Yeni');
  });
});

describe('BottomSheet on Android: the window gets its real size first (V3-01)', () => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));

  const sheetEnter = (held: HeldTiming[]) =>
    held.filter(entry => entry.callback && entry.toValue === 1 && entry.duration === DURATION.sheetEnter);

  it('does not enter while the window has its provisional size, and waits a full screen below', () => {
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Sheet />);
    showWindow();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(PROVISIONAL_H));
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    expect(held).toHaveLength(0);
    expect(isAnyWindowWaiting()).toBe(true);

    // Never peeking out under the short window, the scrim not drawn.
    rerender(<Sheet />);
    expect(flat(screen.getByTestId('sheet')).transform).toEqual([{ translateY: SCREEN_H }]);
    expect(flat(screen.getByTestId('sheet-scrim-layer')).opacity).toBe(0);

    // The window reports the full screen: the enter starts.
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(SCREEN_H));
    expect(sheetEnter(held)).toHaveLength(1);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('a window already full on its first report enters with the sheet layout', () => {
    const held = holdTimings();
    renderWithProviders(<Sheet />);
    showWindow();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(SCREEN_H - 1));
    expect(held).toHaveLength(0);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    expect(sheetEnter(held)).toHaveLength(1);
  });

  it('a second window size opens it too (a window smaller than the screen)', () => {
    const held = holdTimings();
    renderWithProviders(<Sheet />);
    showWindow();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(PROVISIONAL_H));
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(700));
    expect(sheetEnter(held)).toHaveLength(1);
  });

  it('starts anyway after WINDOW_FALLBACK_MS when no real size comes', () => {
    const held = holdTimings();
    renderWithProviders(<Sheet />);
    showWindow();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(PROVISIONAL_H));
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));

    // The fallback counts from the mount (showWindow took one frame).
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS - 17 - 1));
    expect(held).toHaveLength(0);
    act(() => jest.advanceTimersByTime(1));
    expect(sheetEnter(held)).toHaveLength(1);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('the fallback never starts a sheet that was not laid out yet', () => {
    const held = holdTimings();
    renderWithProviders(<Sheet />);
    showWindow();
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS));
    expect(held).toHaveLength(0);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    expect(sheetEnter(held)).toHaveLength(1);
  });

  it('does not slide up before Android shows its window, then starts on onShow', () => {
    const held = holdTimings();
    renderWithProviders(<Sheet />);
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(SCREEN_H));
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(420));
    expect(held).toHaveLength(0);
    expect(isAnyWindowWaiting()).toBe(true);

    act(() => fireEvent(screen.UNSAFE_getByType(Modal), 'show'));
    expect(sheetEnter(held)).toHaveLength(1);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('closed before the window got its size, it leaves without an exit and stops waiting', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClosed={onClosed} />);
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(PROVISIONAL_H));
    rerender(<Sheet onClosed={onClosed} visible={false} />);
    expect(held).toHaveLength(0);
    expect(screen.queryByText('İçerik')).toBeNull();
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('the translate follows a later sheet height, also during the enter', () => {
    // Every timing rests half way, so the translate shows the height it uses.
    jest.spyOn(Reanimated, 'withTiming').mockImplementation((() => 0.5) as unknown as typeof Reanimated.withTiming);
    const { rerender } = renderWithProviders(<Sheet fill />);
    showWindow();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(PROVISIONAL_H));
    // 88% of the provisional window, then of the real one.
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(Math.round(0.88 * PROVISIONAL_H)));
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(SCREEN_H));
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(Math.round(0.88 * SCREEN_H)));
    rerender(<Sheet fill />);
    expect(flat(screen.getByTestId('sheet')).transform).toEqual([{ translateY: 0.5 * Math.round(0.88 * SCREEN_H) }]);

    // Content that grows during the enter: the translate keeps up.
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    rerender(<Sheet fill />);
    expect(flat(screen.getByTestId('sheet')).transform).toEqual([{ translateY: 300 }]);
  });
});

describe('BottomSheet on Android: the root veil holds the scrim for a window opened from onClosed (NEW-1, LR-2, V3-07, NL-08, RB-4)', () => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));

  /** Opens on a full window and ends the enter. */
  function openSheet(held: HeldTiming[], element: React.ReactElement, withDialog = true) {
    const view = renderWithProviders(element, { withDialog });
    showWindow();
    fireEvent(screen.getByTestId('sheet-window'), 'layout', layout(SCREEN_H));
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    act(() => lastEnd(held)?.callback?.(true));
    return view;
  }

  // The mock computes animated styles in render: read them after a rerender.
  const veilOpacity = () => flat(screen.getByTestId('handoff-veil')).opacity as number;
  const scrimOpacity = () => flat(screen.getByTestId('sheet-scrim-layer')).opacity as number;

  /** Drags the sheet down by 200 of its 600dp, fast enough to close it. */
  const dragClose = () =>
    act(() =>
      fireGestureHandler(getByGestureTestId('sheet-drag'), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY: 100, velocityY: 1200 },
        { state: State.ACTIVE, translationY: 200, velocityY: 1200 },
        { state: State.END, translationY: 200, velocityY: 1200 },
      ]),
    );

  it('the veil is in the app window before any hand-off: at 0, taking no touches', () => {
    renderWithProviders(<Sheet visible={false} />, { withDialog: true });
    expect(veilOpacity()).toBe(0);
    expect(screen.getByTestId('handoff-veil').props.pointerEvents).toBe('none');
  });

  it('a plain close never touches the veil: the scrim fades out in the sheet window, then the window goes', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = openSheet(held, <Sheet onClosed={onClosed} />);
    const before = held.length;
    rerender(<Sheet onClosed={onClosed} visible={false} />);
    // The claim (the idle veil stays at 0), then the motion: the scrim to
    // its end share, the sheet out.
    expect(held.slice(before).map(entry => entry.toValue)).toEqual([0, VEIL_AT_EXIT_END, 0]);
    rerender(<Sheet onClosed={onClosed} visible={false} />);
    expect(scrimOpacity()).toBeCloseTo(VEIL_AT_EXIT_END);
    expect(veilOpacity()).toBe(0);

    const afterExit = held.length;
    act(() => {
      lastEnd(held)?.callback?.(true);
      // No effect or tick in between.
      expect(onClosed).toHaveBeenCalledTimes(1);
    });
    // Nothing opened: the scrim's own fade (the veil's own fade has nothing to do).
    expect(held.slice(afterExit).filter(entry => entry.callback)).toEqual([
      expect.objectContaining({ toValue: 0, duration: ALONE_FADE.duration }),
    ]);
    rerender(<Sheet onClosed={onClosed} visible={false} />);
    expect(scrimOpacity()).toBe(0);
    expect(veilOpacity()).toBe(0);
    expect(screen.getByText('İçerik')).toBeOnTheScreen();
    act(() => lastEnd(held)?.callback?.(true));
    expect(screen.queryByText('İçerik')).toBeNull();
  });

  it('a window opened from onClosed: the veil takes the end share, holds while it waits and is open, and leaves with its exit', () => {
    const held = holdTimings();
    const other = {};
    // The dialog or sheet opened from onClosed is up and waits for its size.
    const opensWindow = () => {
      markWindowOpen(other, true);
      markWindowWaiting(other);
    };
    const { rerender } = openSheet(held, <Sheet onClosed={opensWindow} />);
    rerender(<Sheet onClosed={opensWindow} visible={false} />);
    act(() => lastEnd(held)?.callback?.(true));
    rerender(<Sheet onClosed={opensWindow} visible={false} />);
    // The veil holds the end share; the scrim let go of it; the window went.
    expect(veilOpacity()).toBeCloseTo(VEIL_AT_EXIT_END);
    expect(scrimOpacity()).toBeCloseTo(0);
    act(() => lastEnd(held)?.callback?.(true));
    expect(screen.queryByText('İçerik')).toBeNull();
    const afterHandOver = held.length;

    // It holds past the waiting window's own fallback, and while it is open.
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS));
    act(() => {
      noteWindowEnter({ duration: DURATION.base });
      markWindowEntered(other);
    });
    act(() => jest.advanceTimersByTime(VEIL_HOLD_MAX_MS));
    expect(held).toHaveLength(afterHandOver);

    // Its exit takes the veil with it, on the exit's timing.
    act(() => noteWindowExit({ duration: DURATION.exit }));
    expect(held.slice(afterHandOver)).toEqual([expect.objectContaining({ toValue: 0, duration: DURATION.exit })]);
  });

  it('a held veil also goes once no window is up any more', () => {
    const held = holdTimings();
    const other = {};
    const opensWindow = () => {
      markWindowOpen(other, true);
      markWindowWaiting(other);
    };
    const { rerender } = openSheet(held, <Sheet onClosed={opensWindow} />);
    rerender(<Sheet onClosed={opensWindow} visible={false} />);
    act(() => lastEnd(held)?.callback?.(true));
    act(() => lastEnd(held)?.callback?.(true));
    const afterHandOver = held.length;
    act(() => {
      markWindowEntered(other);
      markWindowOpen(other, false);
    });
    expect(held.slice(afterHandOver)).toEqual([expect.objectContaining({ toValue: 0, duration: DURATION.fast })]);
  });

  it('never holds longer than VEIL_HOLD_MAX_MS for a window that never enters', () => {
    const held = holdTimings();
    const opensWindow = () => markWindowWaiting({});
    const { rerender } = openSheet(held, <Sheet onClosed={opensWindow} />);
    rerender(<Sheet onClosed={opensWindow} visible={false} />);
    act(() => lastEnd(held)?.callback?.(true));
    act(() => lastEnd(held)?.callback?.(true));
    const afterHandOver = held.length;
    act(() => jest.advanceTimersByTime(VEIL_HOLD_MAX_MS - 1));
    expect(held).toHaveLength(afterHandOver);
    act(() => jest.advanceTimersByTime(1));
    expect(held.slice(afterHandOver)).toEqual([expect.objectContaining({ toValue: 0, duration: DURATION.fast })]);
  });

  it('a dialog asked for in onClosed: the veil takes the share at once, before the batch renders', () => {
    const held = holdTimings();
    const asksForDialog = () => requestWindow();
    const { rerender } = openSheet(held, <Sheet onClosed={asksForDialog} />);
    rerender(<Sheet onClosed={asksForDialog} visible={false} />);
    const exit = lastEnd(held);
    const afterExit = held.length;
    act(() => {
      exit?.callback?.(true);
      // The scrim already lets go (HANDOVER), no fade of its own.
      expect(held.slice(afterExit)).toEqual([expect.objectContaining({ toValue: 1, duration: HANDOVER.duration })]);
    });
    rerender(<Sheet onClosed={asksForDialog} visible={false} />);
    expect(veilOpacity()).toBeCloseTo(VEIL_AT_EXIT_END);
  });

  it('a sheet opened from onClosed without asking: decided in that commit, the veil takes the share', () => {
    const held = holdTimings();
    const other = {};
    function Pair() {
      const [first, setFirst] = React.useState(true);
      const [second, setSecond] = React.useState(false);
      React.useLayoutEffect(() => {
        // The second sheet's window waits for its size in the commit.
        if (second) markWindowWaiting(other);
      }, [second]);
      return (
        <>
          <Sheet visible={first} onClosed={() => setSecond(true)} />
          <Text onPress={() => setFirst(false)}>kapat</Text>
        </>
      );
    }
    const { rerender } = openSheet(held, <Pair />);
    fireEvent.press(screen.getByText('kapat'));
    const afterExit = held.length;
    act(() => lastEnd(held)?.callback?.(true));
    // No fade of the scrim: it hands over.
    expect(held.slice(afterExit).map(entry => entry.duration)).toEqual([HANDOVER.duration]);
    rerender(<Pair />);
    expect(veilOpacity()).toBeCloseTo(VEIL_AT_EXIT_END);
  });

  it('a sheet that its parent drops in onClosed with nothing opened leaves the veil alone', () => {
    const held = holdTimings();
    function Menu() {
      const [shown, setShown] = React.useState(true);
      const [open, setOpen] = React.useState(true);
      return (
        <>
          {shown ? (
            <Sheet visible={open} onClose={() => setOpen(false)} onClosed={() => setShown(false)} />
          ) : null}
          <Text onPress={() => setOpen(false)}>kapat</Text>
        </>
      );
    }
    const { rerender } = openSheet(held, <Menu />);
    fireEvent.press(screen.getByText('kapat'));
    act(() => lastEnd(held)?.callback?.(true));
    expect(screen.queryByTestId('sheet')).toBeNull();
    rerender(<Menu />);
    expect(veilOpacity()).toBe(0);
  });

  it('a drag close hands over the scrim with its drag fade (no jump back up)', () => {
    const held = holdTimings();
    const onClose = jest.fn();
    const opensWindow = () => requestWindow();
    const { rerender } = openSheet(held, <Sheet onClose={onClose} onClosed={opensWindow} />);
    dragClose();
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<Sheet onClose={onClose} onClosed={opensWindow} visible={false} />);
    rerender(<Sheet onClose={onClose} onClosed={opensWindow} visible={false} />);
    // The end share keeps the drag fade in the sheet's own window.
    expect(scrimOpacity()).toBeCloseTo(VEIL_AT_EXIT_END * (1 - 200 / 600));
    act(() => lastEnd(held)?.callback?.(true));
    rerender(<Sheet onClose={onClose} onClosed={opensWindow} visible={false} />);
    expect(veilOpacity()).toBeCloseTo(VEIL_AT_EXIT_END * (1 - 200 / 600));
    expect(scrimOpacity()).toBeCloseTo(0);
  });

  it('mid-exit the scrim is all in the sheet window: one scrim at level x scale x drag', () => {
    const held = holdTimings();
    const onClose = jest.fn();
    const { rerender } = openSheet(held, <Sheet onClose={onClose} />);
    dragClose();
    // From here every timing rests part way: the scale at 0.7.
    const drag = 1 - 200 / 600;
    jest.spyOn(Reanimated, 'withTiming').mockImplementation(((toValue: number) =>
      Math.abs(toValue - VEIL_AT_EXIT_END) < 1e-9 ? 0.7 : toValue) as unknown as typeof Reanimated.withTiming);
    rerender(<Sheet onClose={onClose} visible={false} />);
    rerender(<Sheet onClose={onClose} visible={false} />);
    expect(veilOpacity()).toBe(0);
    expect(scrimOpacity()).toBeCloseTo(drag * 0.7, 6);
  });

  it('without a root veil (no DialogProvider) the scrim fades out with the sheet', () => {
    const held = holdTimings();
    const { rerender } = openSheet(held, <Sheet />, false);
    rerender(<Sheet visible={false} />);
    expect(held.filter(entry => entry.duration === DURATION.sheetExit).map(entry => entry.toValue)).toEqual([0, 0]);
    rerender(<Sheet visible={false} />);
    expect(scrimOpacity()).toBe(0);
    act(() => lastEnd(held)?.callback?.(true));
    expect(screen.queryByText('İçerik')).toBeNull();
    expect(screen.queryByTestId('handoff-veil')).toBeNull();
  });

  it('iOS keeps one timing for the sheet and its scrim, and has no root veil', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Sheet />, { withDialog: true });
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    rerender(<Sheet visible={false} />);
    expect(held.map(entry => entry.toValue)).toEqual([1, 0]);
    act(() => lastEnd(held)?.callback?.(true));
    expect(screen.queryByTestId('handoff-veil')).toBeNull();
  });
});

describe('BottomSheet drag to dismiss', () => {
  const pan = (translationY: number, velocityY: number) =>
    act(() =>
      fireGestureHandler(getByGestureTestId('sheet-drag'), [
        { state: State.BEGAN, translationY: 0, velocityY: 0 },
        { state: State.ACTIVE, translationY: translationY / 2, velocityY },
        { state: State.ACTIVE, translationY, velocityY },
        { state: State.END, translationY, velocityY },
      ]),
    );

  it.each([
    [139, 0, 600, false],
    [141, 0, 600, true],
    [10, 1001, 600, true],
    [91, 0, 300, true],
  ])('shouldDismissSheet(%i, %i, %i) is %s', (ty, vy, h, expected) => {
    expect(shouldDismissSheet(ty, vy, h)).toBe(expected);
  });

  it('a long or fast drag closes, a short one springs back', () => {
    const spring = jest.spyOn(Reanimated, 'withSpring');
    const onClose = jest.fn();
    renderWithProviders(<Sheet onClose={onClose} />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));

    pan(40, 0);
    expect(onClose).not.toHaveBeenCalled();
    expect(spring).toHaveBeenCalledWith(0, expect.objectContaining({ damping: 37 }));

    pan(200, 1200);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a dismissing drag leaves the sheet where the finger let go, fading the scrim', () => {
    const { rerender } = renderWithProviders(<Sheet />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    pan(200, 1200);
    // The parent keeps it open here; the mock computes animated styles in render.
    rerender(<Sheet />);
    expect(flat(screen.getByTestId('sheet')).transform).toEqual([{ translateY: 200 }]);
    expect(flat(screen.getByTestId('sheet-scrim-layer')).opacity).toBeCloseTo(1 - 200 / 600);
  });

  it('dragging up never lifts the sheet, and an upward fling does not close it', () => {
    const onClose = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClose={onClose} />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    pan(-80, -1200);
    expect(onClose).not.toHaveBeenCalled();
    rerender(<Sheet onClose={onClose} />);
    expect(flat(screen.getByTestId('sheet')).transform).toEqual([{ translateY: 0 }]);
    expect(flat(screen.getByTestId('sheet-scrim-layer')).opacity).toBe(1);
  });

  it('a short downward flick closes', () => {
    const onClose = jest.fn();
    renderWithProviders(<Sheet onClose={onClose} />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    pan(30, 1500);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a sheet closed by a drag comes back without the drag offset', () => {
    const spring = jest.spyOn(Reanimated, 'withSpring');
    const held = holdTimings();
    const { rerender } = renderWithProviders(<Sheet />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    act(() => held[0].callback?.(true));
    pan(200, 1200);
    rerender(<Sheet visible={false} />);

    // Opened again during the exit: the offset springs back.
    spring.mockClear();
    rerender(<Sheet />);
    expect(spring).toHaveBeenCalledWith(0, expect.objectContaining({ damping: 37 }));
    rerender(<Sheet />);
    expect(flat(screen.getByTestId('sheet')).transform).toEqual([{ translateY: 0 }]);

    // Closed by a drag to the end, then opened: it starts from its own height again.
    pan(200, 1200);
    rerender(<Sheet visible={false} />);
    act(() => held[held.length - 1].callback?.(true));
    expect(screen.queryByText('İçerik')).toBeNull();
    rerender(<Sheet />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    act(() => held[held.length - 1].callback?.(true));
    rerender(<Sheet />);
    expect(flat(screen.getByTestId('sheet')).transform).toEqual([{ translateY: 0 }]);
    expect(flat(screen.getByTestId('sheet-scrim-layer')).opacity).toBe(1);
  });

  it('no drag while the sheet leaves', () => {
    holdTimings();
    const onClose = jest.fn();
    const { rerender } = renderWithProviders(<Sheet onClose={onClose} />);
    fireEvent(screen.getByTestId('sheet'), 'layout', layout(600));
    rerender(<Sheet onClose={onClose} visible={false} />);
    pan(300, 2000);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('BottomSheet sizes and content', () => {
  it('hugs its content up to 88% by default', () => {
    renderWithProviders(<Sheet />);
    const style = flat(screen.getByTestId('sheet'));
    expect(style.maxHeight).toBe('88%');
    expect(style.height).toBeUndefined();
    expect(style).toMatchObject({ borderTopLeftRadius: 32, borderTopRightRadius: 32 });
  });

  it.each([
    ['loading', <Text key="l">Yükleniyor...</Text>],
    ['error', <Text key="e">Belge yüklenemedi.</Text>],
    ['success', <Text key="s">{'Uzun bir metin. '.repeat(200)}</Text>],
  ])('fill gives 88%% from the first frame (%s content)', (_state, content) => {
    renderWithProviders(<Sheet fill>{content}</Sheet>);
    expect(flat(screen.getByTestId('sheet')).height).toBe('88%');
  });

  it('a height prop fixes the height', () => {
    renderWithProviders(<Sheet height={412} />);
    const style = flat(screen.getByTestId('sheet'));
    expect(style.height).toBe(412);
    expect(style.maxHeight).toBe('88%');
  });

  it('scrollable puts the children in a ScrollView that keeps taps', () => {
    const { rerender } = renderWithProviders(
      <Sheet>
        <TextInput testID="field" />
      </Sheet>,
    );
    expect(screen.UNSAFE_queryAllByType(ScrollView)).toHaveLength(0);

    rerender(
      <Sheet scrollable>
        <TextInput testID="field" />
      </Sheet>,
    );
    const scroll = screen.getByTestId('sheet-scroll');
    expect(scroll.props).toMatchObject({ keyboardShouldPersistTaps: 'handled', bounces: false });
    expect(screen.getByTestId('field')).toBeOnTheScreen();
  });

  it('draws the handle and header geometry of the spec', () => {
    renderWithProviders(<Sheet />);
    const handleArea = flat(screen.getByTestId('sheet-handle'));
    expect(handleArea.height).toBe(24);
    const handle = flat(screen.getByTestId('sheet-handle').children[0] as never);
    expect(handle).toMatchObject({ width: 40, height: 5, backgroundColor: themes['gece-mavisi'].line });
  });

  it.each(PALETTE_KEYS)('a secondary Button inside draws one step up from the sheet (%s)', key => {
    renderWithProviders(
      <Sheet>
        <Button variant="secondary" label="Vazgeç" testID="sheet-button" />
      </Sheet>,
      { theme: key },
    );
    const T = themes[key];
    expect(flat(screen.getByTestId('sheet')).backgroundColor).toBe(T.surface);
    expect(flat(screen.getByTestId('sheet-button-face')).backgroundColor).toBe(raisedFace(T, 'surface'));
  });
});

describe('sheetPresence', () => {
  it('whenAllClosed runs at once with no sheet leaving, else after the last exit', () => {
    const a = {};
    const b = {};
    const done = jest.fn();
    whenAllClosed(done);
    expect(done).toHaveBeenCalledTimes(1);

    registerSheet(a);
    registerSheet(b);
    markSheetClosing(a);
    markSheetClosing(b);
    whenAllClosed(done);
    unregisterSheet(a);
    expect(done).toHaveBeenCalledTimes(1);
    unregisterSheet(b);
    expect(done).toHaveBeenCalledTimes(2);
  });

  it('a sheet that comes back is no longer leaving; a waiter can be cancelled', () => {
    const sheet = {};
    const done = jest.fn();
    registerSheet(sheet);
    markSheetClosing(sheet);
    const cancel = whenAllClosed(done);
    registerSheet(sheet);
    // Open again: nothing is leaving, the waiter runs.
    expect(isAnyClosing()).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);

    markSheetClosing(sheet);
    const other = jest.fn();
    whenAllClosed(other)();
    cancel();
    unregisterSheet(sheet);
    expect(other).not.toHaveBeenCalled();
  });

  it('ignores a sheet that never opened and tells subscribers about changes', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSheetPresence(listener);
    markSheetClosing({});
    expect(isAnyClosing()).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    const sheet = {};
    registerSheet(sheet);
    registerSheet(sheet);
    markSheetClosing(sheet);
    unregisterSheet(sheet);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    registerSheet(sheet);
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
