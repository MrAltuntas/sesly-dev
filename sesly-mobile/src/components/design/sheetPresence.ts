/**
 * Which bottom sheets are open or leaving, which windows are waiting for
 * their first frame, and the root veil (docs/release-pass/SPEC-design.md
 * 2.2, "Dialog outlets" and "Handoff").
 *
 * iOS presents a Modal from the root view controller, and UIKit refuses a
 * presentation while another one is being dismissed; a refused dialog
 * leaves every later dialog invisible. So on iOS a dialog never starts
 * while a sheet is leaving: `useDialog` waits with `whenAllClosed`, and the
 * root dialog host reads `presentationBlocked` through
 * `subscribeSheetPresence`. Android stacks a new window over a leaving one,
 * so nothing waits there.
 *
 *   registerSheet(key)        // the sheet opened (or came back while leaving)
 *   markSheetClosing(key)     // `visible` turned false, the exit runs
 *   unregisterSheet(key)      // the exit ended (`onClosed`) or the sheet unmounted
 *
 * Android only:
 * - A sheet or dialog whose window is up but whose enter waits for the
 *   window's real size is "waiting" (`markWindowWaiting` until
 *   `markWindowEntered`). Every enter and exit also says how it runs
 *   (`noteWindowEnter`, `noteWindowExit`).
 * - The root veil (`HandoffVeil`, mounted once by `DialogProvider`) is a
 *   scrim in the app's own window, always mounted. A leaving sheet claims
 *   it as its exit starts (`claimVeil`) and asks it after its `onClosed`
 *   (`releaseVeil`): when a window opened there (asked for at once with
 *   `requestWindow`, or waiting in that batch's commit) the sheet hands the
 *   end share of its scrim over and the veil holds it while that window
 *   waits and while it is open, then fades out with the exit of the next
 *   window that leaves (`noteWindowExit`), or once no window is open
 *   (`markWindowOpen`). Both then only brighten together, so no frame can be
 *   brighter than the next however late either window draws. So the screen
 *   never undims between a sheet and the dialog or sheet opened from its
 *   `onClosed`.
 * - The veil also measures the app window (`appWindowHeight`): a Modal
 *   window lays its content out at that height from its first frame
 *   (ModalWindow).
 *
 * `key` is any object owned by one sheet or dialog instance. Plain module
 * state, no React: BottomSheet and usePresence write it, the dialog host
 * and the veil read it.
 */

import { Platform } from 'react-native';
import type { SharedValue, WithTimingConfig } from 'react-native-reanimated';

type Listener = () => void;

/** Open sheets; the value says whether it is leaving. */
const sheets = new Map<object, boolean>();
/** Android: windows mounted and waiting for their real size before the enter. */
const waitingWindows = new Set<object>();
const listeners = new Set<Listener>();
let waiters: Listener[] = [];

function emit(): void {
  listeners.forEach(listener => listener());
  if (waiters.length > 0 && !presentationBlocked()) {
    const ready = waiters;
    waiters = [];
    ready.forEach(waiter => waiter());
  }
}

function set(key: object, closing: boolean): void {
  if (sheets.get(key) === closing) return;
  sheets.set(key, closing);
  emit();
}

/** A sheet is open (also: it came back while it was leaving). */
export function registerSheet(key: object): void {
  set(key, false);
}

/** The sheet's `visible` turned false and its exit runs. Ignored for a sheet that never opened. */
export function markSheetClosing(key: object): void {
  if (!sheets.has(key)) return;
  set(key, true);
}

/** The sheet's exit ended, or it unmounted (also while leaving). */
export function unregisterSheet(key: object): void {
  if (!sheets.delete(key)) return;
  emit();
}

/** Whether any sheet is leaving right now. */
export function isAnyClosing(): boolean {
  for (const closing of sheets.values()) {
    if (closing) return true;
  }
  return false;
}

/**
 * Whether a new window must wait: on iOS while any sheet is leaving, never
 * on Android (its windows stack).
 */
export function presentationBlocked(): boolean {
  return Platform.OS === 'ios' && isAnyClosing();
}

/**
 * Runs `callback` once a new window may be presented: at once when nothing
 * blocks it (always on Android), else after the last exit ends. Returns a
 * function that cancels a call still waiting.
 */
export function whenAllClosed(callback: () => void): () => void {
  if (!presentationBlocked()) {
    callback();
    return () => undefined;
  }
  let cancelled = false;
  const waiter = () => {
    if (!cancelled) callback();
  };
  waiters.push(waiter);
  return () => {
    cancelled = true;
    waiters = waiters.filter(entry => entry !== waiter);
  };
}

/** Android: this window is up and waits for its real size before its enter. */
export function markWindowWaiting(key: object): void {
  if (waitingWindows.has(key)) return;
  waitingWindows.add(key);
  emit();
}

/** The window's enter started, it closed before it, or it unmounted. */
export function markWindowEntered(key: object): void {
  if (!waitingWindows.delete(key)) return;
  emit();
}

/** Whether any window is up but still waiting for its enter. */
export function isAnyWindowWaiting(): boolean {
  return waitingWindows.size > 0;
}

let windowRequested = false;

/**
 * A window will open in the batch that runs now (`showDialog`): a root veil
 * given back in this batch holds for it instead of fading at once. Cleared
 * when an enter starts and when the veil decided.
 */
export function requestWindow(): void {
  windowRequested = true;
}

/** Whether a window was asked for since the last enter or veil decision. */
export function isWindowRequested(): boolean {
  return windowRequested;
}

/** The veil decided (or an enter started): the request is answered. */
export function clearWindowRequest(): void {
  windowRequested = false;
}

/** How an enter runs, and so how the root veil fades out under it. */
export type VeilFade = Pick<WithTimingConfig, 'duration' | 'easing'>;

let enters = 0;
let lastEnter: VeilFade | null = null;

/**
 * A window's enter starts now with this timing. Called before
 * `markWindowEntered`, so a veil that held for the window reads it.
 */
export function noteWindowEnter(fade: VeilFade): void {
  enters += 1;
  lastEnter = fade;
  windowRequested = false;
}

let exits = 0;
let lastExit: VeilFade | null = null;

/** A window's exit starts now with this timing: a veil held under it fades out with it. */
export function noteWindowExit(fade: VeilFade): void {
  exits += 1;
  lastExit = fade;
  emit();
}

/** How many exits started so far. */
export function windowExitCount(): number {
  return exits;
}

/** The timing of the last exit that started, or null before the first. */
export function lastWindowExit(): VeilFade | null {
  return lastExit;
}

/** Android: sheet and dialog windows that are mounted (from the open until the window went). */
const openWindows = new Set<object>();

/** A sheet's or a dialog's window is up (true) or went (false). */
export function markWindowOpen(key: object, open: boolean): void {
  const had = openWindows.has(key);
  if (open === had) return;
  if (open) openWindows.add(key);
  else openWindows.delete(key);
  emit();
}

/** How many sheet and dialog windows are up. */
export function openWindowCount(): number {
  return openWindows.size;
}

/** How many enters started so far (the veil compares two counts). */
export function windowEnterCount(): number {
  return enters;
}

/** The timing of the last enter that started, or null before the first. */
export function lastWindowEnter(): VeilFade | null {
  return lastEnter;
}

/** The root veil (Android), as `HandoffVeil` registers it. */
export interface VeilHost {
  /** The veil's opacity: a leaving sheet animates it during its exit. */
  opacity: SharedValue<number>;
  /**
   * A sheet's exit starts on `fade`: the veil's own hold or decision stops,
   * and what it still shows fades out with that exit.
   */
  claim: (fade: VeilFade) => void;
  /**
   * That sheet's exit ended and its `onClosed` ran, its scrim still at its
   * end share: the veil decides from here, and tells `decide` whether a
   * window opened from `onClosed` (the sheet then hands its share over) or
   * not (the sheet fades it out in its own window).
   */
  release: (decide?: (handOff: boolean) => void) => void;
}

let veilHost: VeilHost | null = null;

/** The root veil registers here (Android). Returns its removal. */
export function setVeilHost(host: VeilHost): () => void {
  veilHost = host;
  return () => {
    if (veilHost === host) veilHost = null;
  };
}

/** Whether a root veil can take a leaving sheet's scrim. */
export function hasVeilHost(): boolean {
  return veilHost !== null;
}

/**
 * A sheet's exit starts: it takes the root veil over and moves its scrim
 * into it. Returns the veil's opacity to animate, or null without a veil.
 */
export function claimVeil(fade: VeilFade): SharedValue<number> | null {
  if (!veilHost) return null;
  veilHost.claim(fade);
  return veilHost.opacity;
}

/**
 * The claiming sheet's exit ended (or the sheet unmounted): the veil holds
 * while a window opened from `onClosed` waits, then fades out, and answers
 * `decide` (see `VeilHost.release`). False without a veil (nothing answers).
 */
export function releaseVeil(decide?: (handOff: boolean) => void): boolean {
  if (!veilHost) return false;
  veilHost.release(decide);
  return true;
}

let appHeight = 0;

/** The root veil measured the app window (dp). */
export function setAppWindowHeight(height: number): void {
  if (!(height > 0) || height === appHeight) return;
  appHeight = height;
  emit();
}

/** The app window's height in dp, 0 until the root veil measured it (iOS: always 0). */
export function appWindowHeight(): number {
  return appHeight;
}

/** Called on every change (for `useSyncExternalStore`). Returns the unsubscribe. */
export function subscribeSheetPresence(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Test helper: forget every sheet, waiting window, waiter, enter and the
 * measured app window (the veil host stays with its provider).
 */
export function resetSheetPresence(): void {
  sheets.clear();
  waitingWindows.clear();
  waiters = [];
  enters = 0;
  lastEnter = null;
  exits = 0;
  lastExit = null;
  openWindows.clear();
  windowRequested = false;
  appHeight = 0;
  listeners.forEach(listener => listener());
}
