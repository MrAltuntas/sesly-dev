/**
 * Presence of a sheet or a dialog: keeps its Modal window mounted while the
 * exit runs, and drives one shared `progress` from 0 (gone) to 1 (shown)
 * (docs/release-pass/SPEC-design.md 2.2).
 *
 *   const presence = usePresence({ visible, motion: SHEET_MOTION, waitForLayout: true, onClosed });
 *   <ModalWindow visible={presence.mounted} onDismiss={presence.onDismiss} ...>
 *     <View onLayout={presence.onRootLayout}>
 *       <Animated.View onLayout={presence.onLayout} pointerEvents={presence.closing ? 'none' : 'auto'} />
 *
 * - `visible` true on a fresh mount: mounted at once; the enter starts after
 *   the first `onLayout` with `waitForLayout` (the sheet needs its height),
 *   else right after the commit.
 * - `waitForWindow`, Android: a Modal window is first laid out at the screen
 *   height without the system bars and gets its real, edge-to-edge size a
 *   moment later (ModalWindow already lays its content out at the app
 *   window's height, so the first layout is usually the real one), and
 *   Android adds the window to the screen well after the commit that
 *   mounted it (hundreds of milliseconds on a busy debug build). The enter
 *   of a fresh mount waits until the window was shown (the Modal's `onShow`,
 *   passed in as `onWindowShown`), so its motion runs on screen (RB-3: an
 *   enter started on the first layout was over before the window was
 *   drawn, so the window appeared in its end state), and until the window
 *   root (`onRootLayout`) reports the full screen height, or a second size,
 *   or `WINDOW_FALLBACK_MS` passed. A window that never reports `onShow`
 *   enters after `SHOW_FALLBACK_MS`. Until then nothing is drawn, and the
 *   window counts as waiting (sheetPresence).
 * - `visible` false: `closing` is true and the exit runs; only an exit that
 *   finished unmounts (an interrupted one never does), then `onClosed`.
 * - `visible` true again while closing: the enter runs from the current
 *   value at once (no second `onLayout` comes).
 * - Reduced motion: `travel` (translate and scale) jumps, `progress` (the
 *   opacities) fades in `DURATION.fast`.
 * - Every enter and exit tells sheetPresence its timing (`noteWindowEnter`,
 *   `noteWindowExit`), and every Android window says while it is mounted
 *   (`markWindowOpen`): a root veil held under it goes with its exit.
 *
 * `onClosed` comes when the exit is over: on iOS once the window is gone,
 * from the Modal's `onDismiss` (UIKit refuses a new presentation while one
 * is being dismissed); on Android in the same batch as the unmount, so what
 * it opens commits together with the window going, except under
 * `veilHandoff` (below), where the window stays until it shows nothing. A
 * window that `onClosed` opens again before it went never unmounted: its
 * enter starts at once.
 *
 * `veilHandoff`, Android, with a root veil mounted (sheetPresence
 * `claimVeil`): the screen never undims between this sheet and a window
 * opened from its `onClosed`, and a close never shows a frame brighter than
 * the next. Two windows draw their frames independently (a busy sheet
 * window or the app window draws a frame late, on this emulator by 100 ms
 * and more), so a frame is only safe when everything that changes in it
 * changes the same way: the scrim never moves between windows while one
 * brightens and the other darkens, except in the one hand-over below,
 * which can only come out darker (RB-4, RC-1).
 * - The exit motion keeps the whole scrim in the sheet's window, falling to
 *   `VEIL_AT_EXIT_END` of its level (`veilScale`).
 * - Then `onClosed` runs and the root veil is asked (`releaseVeil`): did a
 *   window open from it? A dialog asked for there (`requestWindow`, which
 *   `showDialog` calls) is a yes at once; else the veil looks in the commit
 *   of that batch for a window that waits for its size (a sheet opened
 *   there).
 * - No: the scrim fades out in its own window (`ALONE_FADE`) and the window
 *   goes. One window, so every frame is brighter than the last, however
 *   late it draws (SHEET-CLOSE-RESIDUAL); the veil is not touched.
 * - Yes: the root veil takes the end share at once and the scrim lets go of
 *   it from `VEIL_LAG_MS` later (`HANDOVER`), after the veil drew it, so a
 *   mismatch is darker, never brighter; then the window goes. The veil
 *   holds while the new window waits and while it is open, and fades out
 *   with the next exit (that window's), both brightening together, or once
 *   no window is up (`HandoffVeil`).
 * - A parent that drops the sheet in `onClosed` takes the window with it:
 *   with a window opened there the veil already holds the share; without,
 *   the screen just gets brighter at once.
 * - Back during its exit, or before its window went, the sheet takes its
 *   scrim back on the enter's timing.
 * - Compositing: the scrim colour has alpha `a` (`scrimAlpha`); a scrim at
 *   opacity S over the veil at v dims like one at S + v - a S v. For the
 *   target K f (K = level x drag when the exit started, f = `veilScale`)
 *   with v = K V g (V = `VEIL_AT_EXIT_END`, g = `veilShare`), the sheet's
 *   scrim is S = K (f - V g) / (1 - a K V g); `veil` is S without the drag,
 *   which the sheet applies.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dimensions, LayoutChangeEvent, Platform } from 'react-native';
import {
  Easing,
  cancelAnimation,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type DerivedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { CURVE, DURATION } from '../../theme/motion';
import {
  claimVeil,
  markWindowEntered,
  markWindowOpen,
  markWindowWaiting,
  noteWindowEnter,
  noteWindowExit,
  releaseVeil,
} from './sheetPresence';

export interface PresenceMotion {
  /** Enter duration in ms (a `DURATION` token). */
  enter: number;
  /** Exit duration in ms (a `DURATION` token). */
  exit: number;
}

export const SHEET_MOTION: PresenceMotion = { enter: DURATION.sheetEnter, exit: DURATION.sheetExit };
export const DIALOG_MOTION: PresenceMotion = { enter: DURATION.base, exit: DURATION.exit };

const ENTER_EASING = Easing.bezier(...CURVE.standard);
const EXIT_EASING = Easing.bezier(...CURVE.exit);

/** Android (`veilHandoff`): the end share of a scrim that hands over to nothing fades out like the root veil would. */
export const ALONE_FADE = { duration: DURATION.fast, easing: Easing.linear };

/** Android (`veilHandoff`): the scrim lets go of the end share the root veil took on this timing. */
export const HANDOVER = { duration: DURATION.fast, easing: Easing.linear };

/**
 * iOS: how long to wait for the Modal's `onDismiss` before `onClosed` comes
 * anyway (a window that was never presented sends none). Far longer than a
 * dismissal without animation.
 */
export const DISMISS_FALLBACK_MS = 600;

/**
 * Android (`waitForWindow`): how long the enter waits for the window's real
 * size before it starts anyway (a window smaller than the screen that
 * reported one size only). The real size comes within a few frames.
 */
export const WINDOW_FALLBACK_MS = 450;

/**
 * Android (`waitForWindow`): how long the enter waits for the Modal's
 * `onShow` before it starts anyway. Android shows a new window well within
 * this even on a busy debug build; it only guards against an `onShow` that
 * never comes.
 */
export const SHOW_FALLBACK_MS = 1500;

/**
 * Android (`veilHandoff`): how long after the root veil took the scrim's
 * end share the sheet's scrim lets go of it, two frames at 60 Hz (see above).
 */
export const VEIL_LAG_MS = 34;

/** Android: a window root within this many dp of the screen height is the full window. */
export const FULL_WINDOW_TOLERANCE = 2;

/** Android (`veilHandoff`): the share of its level the scrim keeps when the exit ends. */
export const VEIL_AT_EXIT_END = 0.4;

/**
 * The sheet's own scrim, before its drag fade, while the root veil holds
 * `share` of the exit's end level (`veilHandoff`, the formula above): with
 * the veil at level x drag x `VEIL_AT_EXIT_END` x share, a scrim of alpha
 * `alpha` drawn at this times `drag` over it dims like one scrim at
 * level x scale x drag. 0 once the veil holds it all.
 */
export function scrimBesideVeil(level: number, scale: number, share: number, drag: number, alpha: number): number {
  'worklet';
  const held = VEIL_AT_EXIT_END * share;
  return (level * Math.max(0, scale - held)) / (1 - alpha * level * drag * held);
}

export interface UsePresenceOptions {
  visible: boolean;
  motion: PresenceMotion;
  /** The enter of a fresh mount waits for `onLayout`. */
  waitForLayout?: boolean;
  /** Android: the enter of a fresh mount also waits for the window's real size (`onRootLayout`). */
  waitForWindow?: boolean;
  /** Android: the exit moves the last of the scrim (`veil`) into the root veil; see above. */
  veilHandoff?: boolean;
  /**
   * What the scrim is multiplied with besides `veil` (the sheet's drag
   * fade), read once as the exit starts.
   */
  veilFactor?: () => number;
  /** The alpha of the scrim colour (`veilHandoff`): the scrim and the root veil dim as one. Default 1. */
  scrimAlpha?: number;
  /** The enter starts (before its first frame). */
  onEnter?: () => void;
  /** The enter finished. */
  onOpened?: () => void;
  /**
   * The window's content is gone: on iOS just before `onClosed` (never when
   * the window was opened again before its close was confirmed), on Android
   * after the commit that unmounted it (never when it was opened again in
   * the same batch).
   */
  onGone?: () => void;
  /** The exit finished and the window is gone (Android `veilHandoff`: goes just after). */
  onClosed?: () => void;
}

export interface Presence {
  /** The Modal's `visible`: true from the open until the exit finished. */
  mounted: boolean;
  /** `visible` is false and the exit runs: no touches, no back button. */
  closing: boolean;
  /** 0 gone, 1 shown: opacities (scrim, dialog card). */
  progress: SharedValue<number>;
  /** The scrim's opacity: `progress`, except under `veilHandoff` on Android. */
  veil: DerivedValue<number>;
  /** 0 or 1 at once: translate and scale under reduced motion. */
  travel: SharedValue<number>;
  /** Reduced motion: read `travel` instead of `progress` for translate and scale. */
  reduced: boolean;
  /** For `onLayout` of the measured view (`waitForLayout`). */
  onLayout: () => void;
  /** For `onLayout` of the window's root view (`waitForWindow`). */
  onRootLayout: (event: LayoutChangeEvent) => void;
  /** For the Modal's `onDismiss` (iOS). */
  onDismiss: () => void;
  /** For the Modal's `onShow` (`waitForWindow`, Android). */
  onWindowShown: () => void;
}

type Phase = 'closed' | 'waiting' | 'opening' | 'open' | 'closing';

/** What the window root reported since the window was mounted. */
export interface WindowGate {
  /** The window is on screen: its `onShow` came, or `SHOW_FALLBACK_MS` passed. */
  shown: boolean;
  layouts: number;
  height: number;
  timedOut: boolean;
}

const freshGate = (): WindowGate => ({ shown: false, layouts: 0, height: 0, timedOut: false });

/**
 * Whether the window is on screen with its real size: it was shown, and its
 * root reported the full screen height, or a second size (the first one was
 * the provisional one), or the size fallback passed.
 */
export function windowRootReady(gate: WindowGate, screenHeight: number): boolean {
  if (!gate.shown) return false;
  if (gate.timedOut || gate.layouts > 1) return true;
  return gate.layouts === 1 && gate.height >= screenHeight - FULL_WINDOW_TOLERANCE;
}

export function usePresence({
  visible,
  motion,
  waitForLayout = false,
  waitForWindow = false,
  veilHandoff = false,
  veilFactor,
  scrimAlpha = 1,
  onEnter,
  onOpened,
  onGone,
  onClosed,
}: UsePresenceOptions): Presence {
  // One platform per instance (a hook type never changes between renders).
  const [android] = useState(() => Platform.OS === 'android');
  const gateOn = android && waitForWindow;
  const handoffOn = android && veilHandoff;
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const travel = useSharedValue(0);
  // Under `veilHandoff` the scrim is level times scale, less the share the
  // root veil holds: the level follows the enter and stays where it is
  // during the exit, the scale falls, so a close during the enter never
  // darkens the scrim again.
  const veilLevel = useSharedValue(0);
  const veilScale = useSharedValue(1);
  const veilShare = useSharedValue(0);
  const veilDrag = useSharedValue(1);
  const alpha = Math.min(Math.max(scrimAlpha, 0), 1);
  const handoffVeil = useDerivedValue(
    () => scrimBesideVeil(veilLevel.value, veilScale.value, veilShare.value, veilDrag.value, alpha),
    [alpha],
  );
  const [mounted, setMounted] = useState(visible);
  // Derived during render, so the window opens in the same commit as `visible`.
  if (visible && !mounted) setMounted(true);

  const key = useRef({}).current;
  const phase = useRef<Phase>('closed');
  /** Bumped by every enter and exit: a stale end callback is ignored. */
  const run = useRef(0);
  const measured = useRef(false);
  /** The root veil this sheet's exit animates, until its window goes. */
  const claimed = useRef<SharedValue<number> | null>(null);
  /** `veilShare` may be above 0 (an exit moved part of the scrim out). */
  const sharing = useRef(false);
  const gate = useRef<WindowGate>(freshGate());
  const gateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The exit finished; `onClosed` waits for the window to go. */
  const closedPending = useRef(false);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ motion, reduced, waitForLayout, gateOn, handoffOn, veilFactor, onEnter, onOpened, onGone, onClosed });
  latest.current = { motion, reduced, waitForLayout, gateOn, handoffOn, veilFactor, onEnter, onOpened, onGone, onClosed };

  const stopWaiting = useCallback(() => {
    if (gateTimer.current) {
      clearTimeout(gateTimer.current);
      gateTimer.current = null;
    }
    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    markWindowEntered(key);
  }, [key]);

  const finishOpen = useCallback((id: number) => {
    if (id !== run.current || phase.current !== 'opening') return;
    phase.current = 'open';
    latest.current.onOpened?.();
  }, []);

  const fireClosed = useCallback((gone: boolean) => {
    if (!closedPending.current) return;
    closedPending.current = false;
    if (fallback.current) {
      clearTimeout(fallback.current);
      fallback.current = null;
    }
    if (gone) latest.current.onGone?.();
    latest.current.onClosed?.();
  }, []);

  /** Android hand-off: the closed window shows nothing any more, so it goes. */
  const windowGone = useCallback((id: number) => {
    if (id !== run.current || phase.current !== 'closed') return;
    setMounted(false);
  }, []);

  /**
   * A window opened from `onClosed`: the root veil takes the scrim's end
   * share at once (before a parent that drops the sheet in `onClosed` can
   * take its window away), and the scrim lets go of it in `HANDOVER` from
   * `VEIL_LAG_MS` later, after the veil drew it: a mismatch is darker,
   * never brighter.
   */
  const handOver = useCallback(
    (id: number) => {
      const root = claimed.current;
      claimed.current = null;
      if (!root) return;
      root.value = veilLevel.value * veilDrag.value * VEIL_AT_EXIT_END;
      veilShare.value = withDelay(
        VEIL_LAG_MS,
        withTiming(1, HANDOVER, done => {
          'worklet';
          if (done) scheduleOnRN(windowGone, id);
        }),
      );
    },
    [veilDrag, veilLevel, veilShare, windowGone],
  );

  /** Nothing opened from `onClosed`: the scrim fades out in its own window, so no frame mixes two windows. */
  const fadeOutAlone = useCallback(
    (id: number) => {
      claimed.current = null;
      veilScale.value = withTiming(0, ALONE_FADE, done => {
        'worklet';
        if (done) scheduleOnRN(windowGone, id);
      });
    },
    [veilScale, windowGone],
  );

  const finishClose = useCallback(
    (id: number) => {
      if (id !== run.current || phase.current !== 'closing') return;
      phase.current = 'closed';
      measured.current = false;
      closedPending.current = true;
      if (Platform.OS === 'ios') {
        fallback.current = setTimeout(() => fireClosed(true), DISMISS_FALLBACK_MS);
        setMounted(false);
        return;
      }
      gate.current = freshGate();
      stopWaiting();
      if (!claimed.current) {
        // Android, no hand-off: the window goes, and what `onClosed` opens
        // commits in this same batch. Nothing the leaving window draws
        // changes before it is gone (`onGone` and the scrim's reset follow
        // the unmount, below).
        setMounted(false);
        fireClosed(false);
        return;
      }
      // Android hand-off: the scrim still shows its end share in the sheet's
      // window. `onClosed` runs first, then the root veil says whether a
      // window opened from it (asked for there, or waiting in that batch's
      // commit): the veil takes the share over, else the scrim fades out in
      // its own window. Either way the window goes once it shows nothing.
      fireClosed(false);
      const given = releaseVeil(handOff => {
        if (id !== run.current || phase.current !== 'closed') return;
        if (handOff) handOver(id);
        else fadeOutAlone(id);
      });
      if (!given) fadeOutAlone(id);
    },
    [fadeOutAlone, fireClosed, handOver, stopWaiting],
  );

  // Android: the window's content is up from the first commit that mounted
  // it until a commit unmounted it. A window opened again in the batch that
  // closed it never unmounted, and no new layout comes for it.
  const contentUp = useRef(false);
  useEffect(() => {
    if (!android) return;
    markWindowOpen(key, mounted);
    if (mounted) {
      contentUp.current = true;
      return;
    }
    if (!contentUp.current) return;
    contentUp.current = false;
    veilLevel.value = 0;
    veilScale.value = 1;
    veilShare.value = 0;
    veilDrag.value = 1;
    sharing.current = false;
    latest.current.onGone?.();
  }, [android, key, mounted, veilDrag, veilLevel, veilScale, veilShare]);

  const enter = useCallback(() => {
    const id = ++run.current;
    phase.current = 'opening';
    const { motion: m, reduced: r, handoffOn: withVeil } = latest.current;
    const config = { duration: r ? DURATION.fast : m.enter, easing: ENTER_EASING };
    latest.current.onEnter?.();
    travel.value = 1;
    // The scrim first: Reanimated's test mock ends `progress` at once.
    if (withVeil) {
      veilScale.value = withTiming(1, config);
      veilLevel.value = withTiming(1, config);
      // Back during its exit or before its window went: the scrim takes
      // back what the root veil took of it, on this enter's timing.
      if (sharing.current) {
        sharing.current = false;
        veilShare.value = withTiming(0, config);
      }
      const root = claimed.current;
      claimed.current = null;
      if (root) root.value = withTiming(0, config);
    }
    progress.value = withTiming(1, config, finished => {
      'worklet';
      if (finished) scheduleOnRN(finishOpen, id);
    });
    // Last: the window no longer waits, with its enter noted first.
    noteWindowEnter(config);
    stopWaiting();
  }, [finishOpen, progress, stopWaiting, travel, veilLevel, veilScale, veilShare]);

  const exit = useCallback(() => {
    const id = ++run.current;
    phase.current = 'closing';
    const { motion: m, reduced: r, handoffOn: withVeil, veilFactor: factor } = latest.current;
    const config = { duration: r ? DURATION.fast : m.exit, easing: EXIT_EASING };
    travel.value = 0;
    if (withVeil) {
      // The level stays where the enter left it.
      const level = veilLevel.value;
      veilLevel.value = level;
      const root = claimVeil(config);
      claimed.current = root;
      if (root) {
        // The motion keeps the whole scrim in the sheet's window, falling to
        // its end share; who takes that share is decided after `onClosed`.
        veilDrag.value = factor?.() ?? 1;
        sharing.current = true;
        veilScale.value = withTiming(VEIL_AT_EXIT_END, config);
      } else {
        veilScale.value = withTiming(0, config);
      }
    }
    progress.value = withTiming(0, config, finished => {
      'worklet';
      if (finished) scheduleOnRN(finishClose, id);
    });
    // A root veil held under this window fades out with it.
    noteWindowExit(config);
  }, [finishClose, progress, travel, veilDrag, veilLevel, veilScale]);

  const ready = useCallback(() => {
    const { waitForLayout: needsLayout, gateOn: needsWindow } = latest.current;
    if (needsLayout && !measured.current) return false;
    return !needsWindow || windowRootReady(gate.current, Dimensions.get('screen').height);
  }, []);

  const tryEnter = useCallback(() => {
    if (phase.current === 'waiting' && ready()) enter();
  }, [enter, ready]);

  const startWaiting = useCallback(() => {
    phase.current = 'waiting';
    if (!latest.current.gateOn || gateTimer.current) return;
    markWindowWaiting(key);
    gateTimer.current = setTimeout(() => {
      gateTimer.current = null;
      gate.current.timedOut = true;
      tryEnter();
    }, WINDOW_FALLBACK_MS);
    if (!gate.current.shown) {
      showTimer.current = setTimeout(() => {
        showTimer.current = null;
        gate.current.shown = true;
        tryEnter();
      }, SHOW_FALLBACK_MS);
    }
  }, [key, tryEnter]);

  // Android: in the commit, so a window that waits is known before paint
  // and the enter of one that does not starts with its first frame.
  const useVisibleEffect = android ? useLayoutEffect : useEffect;
  useVisibleEffect(() => {
    if (visible) {
      if (phase.current === 'closing') enter();
      else if (phase.current === 'closed') {
        // Reopened before the last window was confirmed gone (iOS keeps its
        // content until `onDismiss`): that close is over, and no new layout
        // comes for content that never unmounted.
        const windowStillUp = closedPending.current || contentUp.current;
        fireClosed(false);
        if (!windowStillUp && !ready()) startWaiting();
        else enter();
      }
      return;
    }
    if (phase.current === 'waiting') {
      // Never laid out, so never seen: close without an exit.
      stopWaiting();
      phase.current = 'closing';
      finishClose(run.current);
    } else if (phase.current === 'opening' || phase.current === 'open') {
      exit();
    }
    // `waitForLayout` and `waitForWindow` are fixed per component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const values = useRef({ progress, veilLevel, veilScale, veilShare });
  values.current = { progress, veilLevel, veilScale, veilShare };
  useEffect(
    () => () => {
      // Unmounted: drop every pending end and callback.
      run.current += 1;
      closedPending.current = false;
      markWindowOpen(key, false);
      if (fallback.current) clearTimeout(fallback.current);
      stopWaiting();
      cancelAnimation(values.current.progress);
      cancelAnimation(values.current.veilLevel);
      cancelAnimation(values.current.veilScale);
      cancelAnimation(values.current.veilShare);
      // Gone during its exit: the root veil fades out what it took so far.
      if (claimed.current) {
        claimed.current = null;
        releaseVeil();
      }
    },
    [key, stopWaiting],
  );

  const onLayout = useCallback(() => {
    measured.current = true;
    tryEnter();
  }, [tryEnter]);

  const onRootLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const g = gate.current;
      g.layouts += 1;
      g.height = event.nativeEvent.layout.height;
      tryEnter();
    },
    [tryEnter],
  );

  const onDismiss = useCallback(() => {
    if (Platform.OS === 'ios') fireClosed(true);
  }, [fireClosed]);

  // Android added the window to the screen. The enter starts now: the
  // event reaches JS after the window was added, and the enter's first
  // frame runs on the UI thread a frame later still, when the window has
  // drawn (a JS frame wait here cost hundreds of milliseconds on a busy
  // debug JS thread).
  const onWindowShown = useCallback(() => {
    if (!latest.current.gateOn) return;
    if (gate.current.shown) return;
    gate.current.shown = true;
    tryEnter();
  }, [tryEnter]);

  return {
    mounted,
    closing: mounted && !visible,
    progress,
    veil: handoffOn ? handoffVeil : progress,
    travel,
    reduced,
    onLayout,
    onRootLayout,
    onDismiss,
    onWindowShown,
  };
}
