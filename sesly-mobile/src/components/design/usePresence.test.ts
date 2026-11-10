/**
 * usePresence on its own: the Android window gate (`waitForWindow`), the
 * Android scrim handoff (`veilHandoff`: the exit moves the scrim into the
 * root veil), the enter timing a held veil fades out with, and when
 * `onClosed` and `onGone` come on each platform
 * (docs/release-pass/SPEC-design.md 2.2).
 */

import React from 'react';
import { Dimensions, Platform, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

import { DURATION } from '../../theme/motion';
import {
  isAnyWindowWaiting,
  lastWindowEnter,
  lastWindowExit,
  openWindowCount,
  resetSheetPresence,
  setVeilHost,
  subscribeSheetPresence,
  windowEnterCount,
} from './sheetPresence';
import {
  DIALOG_MOTION,
  FULL_WINDOW_TOLERANCE,
  SHEET_MOTION,
  ALONE_FADE,
  HANDOVER,
  SHOW_FALLBACK_MS,
  VEIL_AT_EXIT_END,
  VEIL_LAG_MS,
  WINDOW_FALLBACK_MS,
  scrimBesideVeil,
  usePresence,
  windowRootReady,
  type Presence,
  type UsePresenceOptions,
} from './usePresence';

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

const SCREEN_H = Dimensions.get('screen').height;
const layout = (height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height } } });
const lastEnd = (held: HeldTiming[]) => held.filter(entry => entry.callback).pop();

/** Android added the window: the Modal's `onShow`. */
function showWindow() {
  act(() => presence.onWindowShown());
}

let presence: Presence;
type HarnessProps = Omit<UsePresenceOptions, 'motion'> & { motion?: UsePresenceOptions['motion'] };

const h = React.createElement;

/** The window's root and a measured view, as BottomSheet and Dialog draw them. */
function Harness({ motion = SHEET_MOTION, ...options }: HarnessProps) {
  presence = usePresence({ motion, ...options });
  return presence.mounted
    ? h(View, { testID: 'root', onLayout: presence.onRootLayout }, h(View, { testID: 'measured', onLayout: presence.onLayout }))
    : null;
}

/** The harness element (this file has no JSX). */
const harness = (props: HarnessProps) => h(Harness, props);

afterEach(() => resetSheetPresence());

describe('windowRootReady', () => {
  it('is ready once shown, on the full screen height, on a second size or after the fallback', () => {
    const gate = (layouts: number, height: number, timedOut = false, shown = true) => ({ shown, layouts, height, timedOut });
    expect(windowRootReady(gate(0, 0), SCREEN_H)).toBe(false);
    expect(windowRootReady(gate(1, SCREEN_H - 76), SCREEN_H)).toBe(false);
    expect(windowRootReady(gate(1, SCREEN_H - FULL_WINDOW_TOLERANCE), SCREEN_H)).toBe(true);
    expect(windowRootReady(gate(1, SCREEN_H), SCREEN_H)).toBe(true);
    expect(windowRootReady(gate(2, 500), SCREEN_H)).toBe(true);
    expect(windowRootReady(gate(1, 500, true), SCREEN_H)).toBe(true);
    // Not on screen yet: no size makes it ready (RB-3).
    expect(windowRootReady(gate(1, SCREEN_H, false, false), SCREEN_H)).toBe(false);
    expect(windowRootReady(gate(2, 500, true, false), SCREEN_H)).toBe(false);
  });
});

describe('usePresence window gate (Android)', () => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));

  it('a dialog-like presence waits for its root, then enters on a full first layout with no fallback wait', () => {
    const held = holdTimings();
    render(harness({ visible: true, motion: DIALOG_MOTION, waitForWindow: true }));
    showWindow();
    expect(held).toHaveLength(0);
    expect(isAnyWindowWaiting()).toBe(true);

    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    expect(held).toEqual([expect.objectContaining({ toValue: 1, duration: DURATION.base })]);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('enters only once the window was shown, so its motion runs on screen (RB-3)', () => {
    const held = holdTimings();
    render(harness({ visible: true, motion: DIALOG_MOTION, waitForWindow: true }));
    // The real size is there, but Android has not added the window yet.
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS));
    expect(held).toHaveLength(0);
    expect(isAnyWindowWaiting()).toBe(true);

    showWindow();
    expect(held).toEqual([expect.objectContaining({ toValue: 1, duration: DURATION.base })]);
    expect(isAnyWindowWaiting()).toBe(false);
    expect(windowEnterCount()).toBe(1);
    // A second onShow changes nothing.
    showWindow();
    expect(held).toHaveLength(1);
  });

  it('a window that never reports onShow enters after SHOW_FALLBACK_MS', () => {
    const held = holdTimings();
    render(harness({ visible: true, motion: DIALOG_MOTION, waitForWindow: true }));
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    act(() => jest.advanceTimersByTime(SHOW_FALLBACK_MS - 1));
    expect(held).toHaveLength(0);
    act(() => jest.advanceTimersByTime(1));
    expect(held).toEqual([expect.objectContaining({ toValue: 1 })]);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('onShow is ignored without waitForWindow and on iOS (they never wait for it)', () => {
    const held = holdTimings();
    const { unmount } = render(harness({ visible: true, motion: DIALOG_MOTION }));
    showWindow();
    expect(held).toHaveLength(1);
    unmount();
  });

  it('closed before it was shown, it leaves without an exit and its show fallback never fires', () => {
    const held = holdTimings();
    const { rerender } = render(harness({ visible: true, motion: DIALOG_MOTION, waitForWindow: true }));
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    rerender(harness({ visible: false, motion: DIALOG_MOTION, waitForWindow: true }));
    act(() => jest.advanceTimersByTime(SHOW_FALLBACK_MS));
    expect(held).toHaveLength(0);
    expect(windowEnterCount()).toBe(0);
    expect(screen.queryByTestId('root')).toBeNull();
  });

  it('without waitForWindow, or on iOS, it enters right after the commit', () => {
    const held = holdTimings();
    const { unmount } = render(harness({ visible: true, motion: DIALOG_MOTION }));
    expect(held).toHaveLength(1);
    unmount();

    jest.replaceProperty(Platform, 'OS', 'ios');
    render(harness({ visible: true, motion: DIALOG_MOTION, waitForWindow: true }));
    expect(held).toHaveLength(2);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('unmounted while it waits, it stops waiting and its fallback never fires', () => {
    const held = holdTimings();
    const { unmount } = render(harness({ visible: true, waitForWindow: true }));
    expect(isAnyWindowWaiting()).toBe(true);
    unmount();
    expect(isAnyWindowWaiting()).toBe(false);
    act(() => jest.advanceTimersByTime(WINDOW_FALLBACK_MS));
    expect(held).toHaveLength(0);
  });

  it('a fresh window after a close waits again', () => {
    const held = holdTimings();
    const { rerender } = render(harness({ visible: true, motion: DIALOG_MOTION, waitForWindow: true }));
    showWindow();
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    rerender(harness({ visible: false, motion: DIALOG_MOTION, waitForWindow: true }));
    act(() => lastEnd(held)?.callback?.(true));
    expect(screen.queryByTestId('root')).toBeNull();

    const count = held.length;
    rerender(harness({ visible: true, motion: DIALOG_MOTION, waitForWindow: true }));
    expect(held).toHaveLength(count);
    expect(isAnyWindowWaiting()).toBe(true);
  });
});

describe('usePresence onClosed and onGone', () => {
  it('Android: onClosed in the batch that ends the exit, onGone once the window went', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const held = holdTimings();
    const calls: string[] = [];
    const callbacks = { onGone: () => calls.push('gone'), onClosed: () => calls.push('closed') };
    const { rerender } = render(harness({ visible: true, motion: DIALOG_MOTION, ...callbacks }));
    rerender(harness({ visible: false, motion: DIALOG_MOTION, ...callbacks }));
    act(() => {
      lastEnd(held)?.callback?.(true);
      expect(calls).toEqual(['closed']);
    });
    expect(calls).toEqual(['closed', 'gone']);
    expect(screen.queryByTestId('root')).toBeNull();
  });

  it('Android: opened again by its own onClosed, it never unmounted and enters at once', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const held = holdTimings();
    const onGone = jest.fn();
    function Reopening() {
      const [visible, setVisible] = React.useState(true);
      const [closes, setCloses] = React.useState(0);
      return h(
        React.Fragment,
        null,
        harness({
          visible,
          waitForLayout: true,
          waitForWindow: true,
          onGone,
          onClosed: () => {
            if (closes === 0) setVisible(true);
            setCloses(n => n + 1);
          },
        }),
        h(View, { testID: 'close', onTouchEnd: () => setVisible(false) }),
      );
    }
    render(h(Reopening));
    showWindow();
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    fireEvent(screen.getByTestId('measured'), 'layout', layout(400));
    act(() => lastEnd(held)?.callback?.(true));

    fireEvent(screen.getByTestId('close'), 'touchEnd');
    act(() => lastEnd(held)?.callback?.(true));
    // No second layout comes: the enter started without one.
    expect(lastEnd(held)).toMatchObject({ toValue: 1, duration: DURATION.sheetEnter });
    expect(screen.getByTestId('root')).toBeOnTheScreen();
    expect(isAnyWindowWaiting()).toBe(false);
    expect(onGone).not.toHaveBeenCalled();
  });

  it('iOS: both once the window was dismissed; a reopen first never reports it gone', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const held = holdTimings();
    const onGone = jest.fn();
    const onClosed = jest.fn();
    const { rerender } = render(harness({ visible: true, motion: DIALOG_MOTION, onGone: onGone, onClosed: onClosed }));
    rerender(harness({ visible: false, motion: DIALOG_MOTION, onGone: onGone, onClosed: onClosed }));
    act(() => lastEnd(held)?.callback?.(true));
    expect(onClosed).not.toHaveBeenCalled();

    // Opened again before the Modal's onDismiss came.
    rerender(harness({ visible: true, motion: DIALOG_MOTION, onGone: onGone, onClosed: onClosed }));
    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(onGone).not.toHaveBeenCalled();
    act(() => presence.onDismiss());
    expect(onGone).not.toHaveBeenCalled();

    rerender(harness({ visible: false, motion: DIALOG_MOTION, onGone: onGone, onClosed: onClosed }));
    act(() => lastEnd(held)?.callback?.(true));
    act(() => presence.onDismiss());
    expect(onGone).toHaveBeenCalledTimes(1);
    expect(onClosed).toHaveBeenCalledTimes(2);
  });
});

describe('usePresence veil handoff (Android)', () => {
  /** The alpha of `T.scrim` in every palette. */
  const SCRIM_ALPHA = 0.72;

  let calls: string[];
  /** What the fake veil was asked, answered by the test. */
  let question: ((handOff: boolean) => void) | null;
  let host: { opacity: SharedValue<number>; claim: jest.Mock; release: jest.Mock };
  let removeHost: () => void;
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
    calls = [];
    question = null;
    host = {
      opacity: { value: 0 } as SharedValue<number>,
      claim: jest.fn(() => calls.push('claim')),
      release: jest.fn((decide?: (handOff: boolean) => void) => {
        calls.push('release');
        question = decide ?? null;
      }),
    };
    removeHost = setVeilHost(host);
  });
  afterEach(() => removeHost());

  const sheet = (extra: Partial<HarnessProps> = {}) =>
    harness({ visible: true, waitForLayout: true, waitForWindow: true, veilHandoff: true, ...extra });

  function openSheet(held: HeldTiming[], extra: Partial<HarnessProps> = {}) {
    const view = render(sheet(extra));
    showWindow();
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    fireEvent(screen.getByTestId('measured'), 'layout', layout(400));
    act(() => lastEnd(held)?.callback?.(true));
    return view;
  }

  it('the motion keeps the whole scrim in the sheet window; the veil is claimed but not touched', () => {
    const held = holdTimings();
    const { rerender } = openSheet(held);
    const before = held.length;
    rerender(sheet({ visible: false }));
    // Scale and progress, on the exit timing; nothing moves into the veil yet.
    const exit = held.slice(before);
    expect(exit.map(entry => entry.toValue)).toEqual([VEIL_AT_EXIT_END, 0]);
    expect(exit.every(entry => entry.duration === DURATION.sheetExit)).toBe(true);
    expect(host.claim).toHaveBeenCalledWith(expect.objectContaining({ duration: DURATION.sheetExit }));
    expect(host.opacity.value).toBe(0);
    // A held veil under it leaves with this exit.
    expect(lastWindowExit()).toMatchObject({ duration: DURATION.sheetExit });

    // The mock derives values in render: once more after the exit started.
    rerender(sheet({ visible: false }));
    // The end share of the scrim, still all in the sheet's own window.
    expect(presence.veil.value).toBeCloseTo(VEIL_AT_EXIT_END);
  });

  it('nothing opened from onClosed: the scrim fades out in its own window, then the window goes', () => {
    const held = holdTimings();
    const callbacks = { onGone: () => calls.push('gone'), onClosed: () => calls.push('closed') };
    const { rerender } = openSheet(held, callbacks);
    rerender(sheet({ ...callbacks, visible: false }));
    act(() => lastEnd(held)?.callback?.(true));
    // onClosed first, then the veil is asked; the window stays meanwhile.
    expect(calls).toEqual(['claim', 'closed', 'release']);
    expect(screen.getByTestId('root')).toBeOnTheScreen();

    const before = held.length;
    act(() => question?.(false));
    expect(held.slice(before)).toEqual([expect.objectContaining({ toValue: 0, duration: ALONE_FADE.duration })]);
    expect(host.opacity.value).toBe(0);
    rerender(sheet({ ...callbacks, visible: false }));
    expect(presence.veil.value).toBe(0);
    act(() => lastEnd(held)?.callback?.(true));
    expect(screen.queryByTestId('root')).toBeNull();
    expect(calls).toEqual(['claim', 'closed', 'release', 'gone']);
  });

  it('a window opened from onClosed: the veil takes the share at once, the scrim lets go of it after, then the window goes', () => {
    const held = holdTimings();
    const delays: number[] = [];
    jest.spyOn(Reanimated, 'withDelay').mockImplementation(((delay: number, animation: unknown) => {
      delays.push(delay);
      return animation;
    }) as unknown as typeof Reanimated.withDelay);
    const drag = 0.5;
    const props = { veilFactor: () => drag, scrimAlpha: SCRIM_ALPHA };
    const { rerender } = openSheet(held, props);
    rerender(sheet({ ...props, visible: false }));
    act(() => lastEnd(held)?.callback?.(true));

    const before = held.length;
    act(() => question?.(true));
    // The veil holds the end share (with the drag fade) at once.
    expect(host.opacity.value).toBeCloseTo(drag * VEIL_AT_EXIT_END);
    // The scrim lets go of it VEIL_LAG_MS later, on HANDOVER.
    expect(delays).toEqual([VEIL_LAG_MS]);
    expect(held.slice(before)).toEqual([expect.objectContaining({ toValue: 1, duration: HANDOVER.duration })]);
    rerender(sheet({ ...props, visible: false }));
    expect(presence.veil.value).toBeCloseTo(0);
    expect(screen.getByTestId('root')).toBeOnTheScreen();
    act(() => lastEnd(held)?.callback?.(true));
    expect(screen.queryByTestId('root')).toBeNull();
  });

  it('a close during the enter never darkens the scrim again (the level stays where the enter left it)', () => {
    // The enter rests half way: level and scale at 0.5.
    jest.spyOn(Reanimated, 'withTiming').mockImplementation(((toValue: number) =>
      toValue === 1 ? 0.5 : toValue) as unknown as typeof Reanimated.withTiming);
    const { rerender } = render(sheet());
    showWindow();
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    fireEvent(screen.getByTestId('measured'), 'layout', layout(400));
    rerender(sheet());
    expect(presence.veil.value).toBeCloseTo(0.25);

    // The exit runs to its end: the scrim keeps its end share of that level.
    holdTimings();
    rerender(sheet({ visible: false }));
    rerender(sheet({ visible: false }));
    expect(presence.veil.value).toBeCloseTo(0.5 * VEIL_AT_EXIT_END);
  });

  it('without a root veil the scrim fades out with the exit and nothing is claimed', () => {
    removeHost();
    const held = holdTimings();
    const { rerender } = openSheet(held);
    const before = held.length;
    rerender(sheet({ visible: false }));
    expect(held.slice(before).map(entry => entry.toValue)).toEqual([0, 0]);
    rerender(sheet({ visible: false }));
    expect(presence.veil.value).toBe(0);
    act(() => lastEnd(held)?.callback?.(true));
    expect(calls).toEqual([]);
    expect(screen.queryByTestId('root')).toBeNull();
  });

  it('a window closed before its enter claims nothing', () => {
    const held = holdTimings();
    const { rerender } = render(sheet());
    rerender(sheet({ visible: false }));
    expect(held).toHaveLength(0);
    expect(calls).toEqual([]);
    expect(isAnyWindowWaiting()).toBe(false);
  });

  it('back during its exit, the scrim comes back on the enter timing and nothing is released', () => {
    const held = holdTimings();
    const onClosed = jest.fn();
    const { rerender } = openSheet(held, { onClosed });
    rerender(sheet({ onClosed, visible: false }));
    const exitEnd = lastEnd(held);
    const before = held.length;

    rerender(sheet({ onClosed }));
    // Scale, level, share, root veil, progress.
    const back = held.slice(before);
    expect(back.map(entry => entry.toValue)).toEqual([1, 1, 0, 0, 1]);
    expect(back.every(entry => entry.duration === DURATION.sheetEnter)).toBe(true);

    // The interrupted exit's late end changes nothing.
    act(() => exitEnd?.callback?.(true));
    expect(calls).toEqual(['claim']);
    expect(onClosed).not.toHaveBeenCalled();
  });

  it('opened again before the veil answered, it enters at once and ignores the late answer', () => {
    const held = holdTimings();
    function Reopening() {
      const [visible, setVisible] = React.useState(true);
      return h(
        React.Fragment,
        null,
        sheet({ visible, onClosed: () => setVisible(true) }),
        h(View, { testID: 'close', onTouchEnd: () => setVisible(false) }),
      );
    }
    render(h(Reopening));
    showWindow();
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    fireEvent(screen.getByTestId('measured'), 'layout', layout(400));
    act(() => lastEnd(held)?.callback?.(true));
    fireEvent(screen.getByTestId('close'), 'touchEnd');
    act(() => lastEnd(held)?.callback?.(true));
    expect(lastEnd(held)).toMatchObject({ toValue: 1, duration: DURATION.sheetEnter });
    const before = held.length;
    act(() => question?.(false));
    expect(held).toHaveLength(before);
    expect(screen.getByTestId('root')).toBeOnTheScreen();
  });

  it('unmounted during its exit, it gives the veil back', () => {
    const held = holdTimings();
    const { rerender, unmount } = openSheet(held);
    rerender(sheet({ visible: false }));
    unmount();
    expect(calls).toEqual(['claim', 'release']);
  });

  it('under reduced motion the exit takes DURATION.fast', () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const held = holdTimings();
    const { rerender } = openSheet(held);
    const before = held.length;
    rerender(sheet({ visible: false }));
    expect(held.slice(before).map(entry => entry.duration)).toEqual([DURATION.fast, DURATION.fast]);
  });

  it('every Android window says while it is mounted', () => {
    const held = holdTimings();
    const { rerender } = openSheet(held);
    expect(openWindowCount()).toBe(1);
    rerender(sheet({ visible: false }));
    act(() => lastEnd(held)?.callback?.(true));
    act(() => question?.(false));
    act(() => lastEnd(held)?.callback?.(true));
    expect(openWindowCount()).toBe(0);
  });
});

describe('frame by frame: what a close puts on screen (NEW-1, LR-2, V3-07, NL-08, RB-4, RC-1)', () => {
  const ALPHA = 0.72;
  const V = VEIL_AT_EXIT_END;
  /** A scrim at `top` over one at `bottom` (same colour), as one scrim's opacity. */
  const dim = (top: number, bottom: number) => (1 - (1 - ALPHA * top) * (1 - ALPHA * bottom)) / ALPHA;
  const steps = (count: number) => Array.from({ length: count + 1 }, (_, index) => index / count);
  /** Each window may show any earlier frame of its own: a window that draws late repeats its last one. */
  const late = (frames: number[], lag: number) => frames.map((_, index) => frames[Math.max(0, index - lag)]);
  const nonIncreasing = (frames: number[]) =>
    frames.slice(1).every((frame, index) => frame <= frames[index] + 1e-9);

  it.each([0, 1, 3, 6])('a plain close is one window: never a frame darker than the one before (window %s frames late)', lag => {
    // The motion to the end share, then the fade out in the same window.
    const scrim = [
      ...steps(12).map(e => 1 - (1 - V) * e),
      ...steps(6).map(t => V * (1 - t)),
      ...Array.from({ length: 6 }, () => 0),
    ];
    const shown = late(scrim, lag).map(level => dim(level, 0));
    expect(nonIncreasing(shown)).toBe(true);
    expect(shown[shown.length - 1]).toBe(0);
  });

  it.each([
    [0, 0],
    [0, 2],
    [2, 0],
    [1, 3],
    [4, 1],
  ])('the hand-over can only darken (sheet window %s and app window %s frames late)', (sheetLag, appLag) => {
    const frameMs = 1000 / 60;
    const lagFrames = Math.ceil(VEIL_LAG_MS / frameMs);
    const rampFrames = Math.round(HANDOVER.duration / frameMs);
    // The veil steps to the end share at frame 0; the scrim holds it until
    // lagFrames later, then lets go of it over the ramp.
    const total = lagFrames + rampFrames + 6;
    const veil = Array.from({ length: total }, () => V);
    const share = Array.from({ length: total }, (_, index) => Math.min(Math.max((index - lagFrames) / rampFrames, 0), 1));
    const scrim = share.map(g => scrimBesideVeil(1, V, g, 1, ALPHA));
    // Before the hand-over both windows show the end share once (scrim at V, veil at 0).
    const sheetFrames = [V, ...late(scrim, sheetLag)];
    const appFrames = [0, ...late(veil, appLag)];
    const shown = sheetFrames.map((top, index) => dim(top, appFrames[index]));
    shown.forEach(frame => expect(frame).toBeGreaterThanOrEqual(V - 1e-9));
    expect(shown[shown.length - 1]).toBeCloseTo(V, 9);
  });

  it('a dialog from onClosed: the veil holds under it and leaves with its exit, so both only brighten', () => {
    const rise = steps(10);
    const enter = rise.map(p => dim(p, V));
    // While the dialog enters over the held veil the screen only darkens,
    // however late the dialog window draws.
    expect(nonIncreasing(late(enter, 4).map(value => -value))).toBe(true);
    enter.forEach(value => expect(value).toBeGreaterThanOrEqual(dim(0, V) - 1e-9));
    // The exit: both fall together; a window drawing late repeats a darker frame, never a brighter one.
    const dialogOut = rise.map(p => 1 - p);
    const veilOut = rise.map(p => V * (1 - p));
    [
      [0, 0],
      [3, 0],
      [0, 3],
    ].forEach(([dialogLag, veilLag]) => {
      const a = late(dialogOut, dialogLag);
      const b = late(veilOut, veilLag);
      const shown = a.map((top, index) => dim(top, b[index]));
      expect(nonIncreasing(shown)).toBe(true);
    });
  });
});

describe('usePresence enters and the root veil', () => {
  beforeEach(() => jest.replaceProperty(Platform, 'OS', 'android'));

  it('an enter notes its timing before its window stops waiting', () => {
    holdTimings();
    const seen: unknown[] = [];
    const unsubscribe = subscribeSheetPresence(() => {
      if (!isAnyWindowWaiting()) seen.push(lastWindowEnter());
    });
    render(harness({ visible: true, motion: DIALOG_MOTION, waitForWindow: true }));
    showWindow();
    expect(seen).toEqual([]);
    fireEvent(screen.getByTestId('root'), 'layout', layout(SCREEN_H));
    expect(windowEnterCount()).toBe(1);
    expect(seen).toEqual([expect.objectContaining({ duration: DURATION.base })]);
    unsubscribe();
  });
});
