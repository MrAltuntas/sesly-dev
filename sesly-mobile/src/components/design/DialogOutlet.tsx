/**
 * Dialog outlets: where the one `useDialog()` dialog is drawn
 * (docs/release-pass/SPEC-design.md 2.2).
 *
 * iOS presents a Modal from the root view controller, which UIKit refuses
 * while a sheet or a `presentation: 'modal'` screen is up, and a refused
 * presentation leaves every later dialog invisible. So the dialog renders
 * inside the window that is on top: `DialogProvider` (src/hooks/useDialog)
 * keeps a last-in-first-out stack of outlets, and the dialog renders in the
 * last one mounted, or at the app root when there is none.
 *
 * Outlets sit in every BottomSheet window (while it is visible) and in the
 * screens presented as `presentation: 'modal'` (`withDialogOutlet`). On
 * Android the dialog window simply stacks above the sheet window.
 *
 * `HandoffVeil` (Android, mounted once by `DialogProvider`): the scrim in
 * the app's own window that takes a closed sheet's scrim over when a window
 * opens from the sheet's `onClosed` (sheetPresence `claimVeil`, usePresence
 * `veilHandoff`), so the screen never undims between the two. It is always
 * mounted, at opacity 0 when idle, so a hand-off only animates a value and
 * never creates a view. The sheet's exit ends with its scrim at its end
 * share in its own window, and after `onClosed` it asks the veil
 * (`releaseVeil`). A dialog asked for in `onClosed` (`requestWindow`) is a
 * yes at once; otherwise the veil decides in the commit of that batch:
 * a window opened there waits for its real size, so the sheet hands its
 * scrim over and the veil holds it, then fades out on that window's own
 * enter timing (the new scrim rises over it as it goes); with nothing
 * waiting the answer is no, and the sheet fades its scrim out in its own
 * window, where no frame can mix two windows drawn at different times
 * (RB-4, RC-1). It holds `VEIL_HOLD_MAX_MS` at most and never takes
 * touches. It also reports the app window's height (ModalWindow lays its
 * content out at that height).
 */

import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { DURATION } from '../../theme/motion';
import { useT } from '../../theme/theme';
import { OptionsDialog } from './Dialog';
import type { DialogOptions } from './Dialog';
import {
  clearWindowRequest,
  isAnyWindowWaiting,
  isWindowRequested,
  lastWindowExit,
  openWindowCount,
  setAppWindowHeight,
  setVeilHost,
  subscribeSheetPresence,
  windowExitCount,
  type VeilFade,
} from './sheetPresence';
import { SHOW_FALLBACK_MS, WINDOW_FALLBACK_MS } from './usePresence';

export interface DialogHost {
  visible: boolean;
  options: DialogOptions;
  onClose: () => void;
  /** Id of the outlet the dialog renders in; null: the app root. */
  top: number | null;
  /** Adds an outlet on top of the stack; returns its removal. */
  registerOutlet: (id: number) => () => void;
}

/** Provided by `DialogProvider`; null outside it (an outlet then draws nothing). */
export const DialogHostContext = createContext<DialogHost | null>(null);
DialogHostContext.displayName = 'DialogHost';

let nextOutletId = 1;

/** A place the dialog can render in: mount one inside every window that can be on top. */
export const DialogOutlet: React.FC = () => {
  const host = useContext(DialogHostContext);
  const [id] = useState(() => nextOutletId++);
  const register = host?.registerOutlet;

  // Registered before paint, so a dialog never flashes in the window below.
  useLayoutEffect(() => register?.(id), [register, id]);

  if (!host || host.top !== id) return null;
  return <OptionsDialog visible={host.visible} options={host.options} onClose={host.onClose} />;
};

/**
 * Wraps a screen presented as `presentation: 'modal'` so its dialogs open in
 * the screen's own window (RootNavigator).
 */
export function withDialogOutlet<P extends object>(Screen: React.ComponentType<P>): React.FC<P> {
  const WithDialogOutlet: React.FC<P> = props => (
    <>
      <Screen {...props} />
      <DialogOutlet />
    </>
  );
  WithDialogOutlet.displayName = `withDialogOutlet(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return WithDialogOutlet;
}

/** The veil's fade with no enter to fade with: `DURATION.fast`, linear. */
const OWN_FADE: VeilFade = { duration: DURATION.fast, easing: Easing.linear };

/**
 * The longest the veil holds for a waiting window. A window's own fallbacks
 * start its enter within `SHOW_FALLBACK_MS` (no `onShow`) or
 * `WINDOW_FALLBACK_MS` (no real size) of its mount, so this only guards
 * against one that never enters (a sheet that never lays out).
 */
export const VEIL_HOLD_MAX_MS = SHOW_FALLBACK_MS + WINDOW_FALLBACK_MS;

/** The root veil (Android): see above. */
export const HandoffVeil: React.FC = () => {
  const T = useT();
  const opacity = useSharedValue(0);
  /** Bumped by every release: the commit of the batch the sheet's `onClosed` ran in decides. */
  const [releases, setReleases] = useState(0);
  /** The exit count at the release: a later exit is the one to fade with. */
  const exitsAtRelease = useRef(0);
  /** The released sheet's question: hand its scrim over, or fade it out itself. Answered once. */
  const decide = useRef<((handOff: boolean) => void) | null>(null);
  /** Ends the hold or the decision of the last release (a new exit claimed the veil). */
  const stop = useRef<(() => void) | null>(null);

  // Before paint, so a sheet closing right after the mount finds the host.
  useLayoutEffect(() => {
    const answer = (handOff: boolean) => {
      const asked = decide.current;
      decide.current = null;
      asked?.(handOff);
    };
    return setVeilHost({
      opacity,
      claim: fade => {
        stop.current?.();
        stop.current = null;
        answer(false);
        // What the veil still holds leaves with this exit, brightening with it.
        opacity.value = withTiming(0, fade);
      },
      release: question => {
        stop.current?.();
        stop.current = null;
        answer(false);
        exitsAtRelease.current = windowExitCount();
        decide.current = question ?? null;
        // A dialog asked for in `onClosed` (or a window already waiting):
        // the sheet hands its scrim over now, not after the batch rendered.
        if (isWindowRequested() || isAnyWindowWaiting()) answer(true);
        setReleases(count => count + 1);
      },
    });
  }, [opacity]);

  // In the commit of the batch the sheet's `onClosed` ran in, as a layout
  // effect after every window's own (the veil is the provider's last
  // child): a window opened there already counts as waiting.
  useLayoutEffect(() => {
    if (releases === 0) return undefined;
    let over = false;
    let handedOver = false;
    let holdTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;
    const answer = (handOff: boolean) => {
      const asked = decide.current;
      decide.current = null;
      if (asked) handedOver = handOff;
      asked?.(handOff);
    };
    const end = () => {
      over = true;
      unsubscribe?.();
      unsubscribe = null;
      if (holdTimer) clearTimeout(holdTimer);
      holdTimer = null;
    };
    const fadeOut = (fade: VeilFade) => {
      end();
      opacity.value = withTiming(0, fade);
    };
    const settle = () => {
      if (over) return;
      if (decide.current) answer(isAnyWindowWaiting());
      if (!handedOver) {
        // Nothing opened: the sheet fades its scrim out in its own window.
        fadeOut(OWN_FADE);
        return;
      }
      // Held for the window opened from `onClosed`, while it waits and while
      // it is open: the next exit takes the veil with it (both brighten
      // together), or it goes once no window is up.
      if (windowExitCount() > exitsAtRelease.current) {
        fadeOut(lastWindowExit() ?? OWN_FADE);
        return;
      }
      if (!isAnyWindowWaiting() && openWindowCount() === 0) {
        fadeOut(OWN_FADE);
        return;
      }
      if (isAnyWindowWaiting() && !holdTimer) {
        holdTimer = setTimeout(() => fadeOut(OWN_FADE), VEIL_HOLD_MAX_MS);
      } else if (!isAnyWindowWaiting() && holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
    if (decide.current === null) handedOver = true;
    unsubscribe = subscribeSheetPresence(settle);
    stop.current = end;
    settle();
    // Decided: a window asked for and not opened in this batch is not waited for.
    clearWindowRequest();
    return end;
  }, [releases, opacity]);

  const onLayout = (event: LayoutChangeEvent) => setAppWindowHeight(event.nativeEvent.layout.height);
  const veilStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      pointerEvents="none"
      testID="handoff-veil"
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, { backgroundColor: T.scrim }, veilStyle]}
    />
  );
};
