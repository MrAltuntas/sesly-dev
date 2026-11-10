/**
 * sheetPresence: what blocks a new window (a leaving sheet, on iOS only),
 * which windows wait for their real size (Android), the enters a root veil
 * fades out with, the root veil a leaving sheet moves its scrim into, and
 * the app window's height (docs/release-pass/SPEC-design.md 2.2, "Dialog
 * outlets" and "Handoff").
 */

import { Platform } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import {
  appWindowHeight,
  claimVeil,
  clearWindowRequest,
  isWindowRequested,
  lastWindowExit,
  markWindowOpen,
  noteWindowExit,
  openWindowCount,
  requestWindow,
  windowExitCount,
  hasVeilHost,
  isAnyClosing,
  isAnyWindowWaiting,
  lastWindowEnter,
  markSheetClosing,
  markWindowEntered,
  markWindowWaiting,
  noteWindowEnter,
  presentationBlocked,
  registerSheet,
  releaseVeil,
  resetSheetPresence,
  setAppWindowHeight,
  setVeilHost,
  subscribeSheetPresence,
  unregisterSheet,
  whenAllClosed,
  windowEnterCount,
} from './sheetPresence';

afterEach(() => resetSheetPresence());

describe('presentationBlocked and whenAllClosed', () => {
  it('on iOS a leaving sheet blocks a new window until its exit ended', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const sheet = {};
    const done = jest.fn();
    registerSheet(sheet);
    expect(presentationBlocked()).toBe(false);
    markSheetClosing(sheet);
    expect(presentationBlocked()).toBe(true);

    whenAllClosed(done);
    expect(done).not.toHaveBeenCalled();
    unregisterSheet(sheet);
    expect(done).toHaveBeenCalledTimes(1);
    expect(presentationBlocked()).toBe(false);
  });

  it('on Android nothing waits: the new window stacks over the leaving sheet', () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const sheet = {};
    const done = jest.fn();
    registerSheet(sheet);
    markSheetClosing(sheet);
    expect(isAnyClosing()).toBe(true);
    expect(presentationBlocked()).toBe(false);

    const cancel = whenAllClosed(done);
    expect(done).toHaveBeenCalledTimes(1);
    // Nothing is left waiting to cancel or to run twice.
    cancel();
    unregisterSheet(sheet);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('windows waiting for their real size', () => {
  it('are counted until each entered, and every change reaches the subscribers', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSheetPresence(listener);
    const dialog = {};
    const sheet = {};

    markWindowWaiting(dialog);
    markWindowWaiting(dialog);
    markWindowWaiting(sheet);
    expect(isAnyWindowWaiting()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    markWindowEntered(dialog);
    expect(isAnyWindowWaiting()).toBe(true);
    markWindowEntered(sheet);
    markWindowEntered(sheet);
    expect(isAnyWindowWaiting()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(4);
    unsubscribe();
  });

  it('a waiting window does not block a dialog, and the reset forgets it', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    markWindowWaiting({});
    expect(presentationBlocked()).toBe(false);
    const done = jest.fn();
    whenAllClosed(done);
    expect(done).toHaveBeenCalledTimes(1);

    resetSheetPresence();
    expect(isAnyWindowWaiting()).toBe(false);
  });
});

describe('enters', () => {
  it('are counted with the timing of the last one, and the reset forgets them', () => {
    expect(windowEnterCount()).toBe(0);
    expect(lastWindowEnter()).toBeNull();
    noteWindowEnter({ duration: 280 });
    noteWindowEnter({ duration: 200 });
    expect(windowEnterCount()).toBe(2);
    expect(lastWindowEnter()).toEqual({ duration: 200 });

    resetSheetPresence();
    expect(windowEnterCount()).toBe(0);
    expect(lastWindowEnter()).toBeNull();
  });
});

describe('the veil host', () => {
  const makeHost = () => ({
    opacity: { value: 0 } as SharedValue<number>,
    claim: jest.fn(),
    release: jest.fn(),
  });

  const EXIT = { duration: 200 };

  it('a leaving sheet claims its opacity and releases it while registered; without one nothing happens', () => {
    expect(hasVeilHost()).toBe(false);
    expect(claimVeil(EXIT)).toBeNull();
    expect(releaseVeil()).toBe(false);

    const host = makeHost();
    const remove = setVeilHost(host);
    expect(hasVeilHost()).toBe(true);
    expect(claimVeil(EXIT)).toBe(host.opacity);
    // The claim passes the exit's timing (a held veil leaves with it).
    expect(host.claim).toHaveBeenCalledWith(EXIT);
    // The release passes the sheet's question on.
    const decide = jest.fn();
    expect(releaseVeil(decide)).toBe(true);
    expect(host.release).toHaveBeenCalledWith(decide);

    // A newer host replaces it; the old removal leaves the newer one.
    const newer = makeHost();
    const removeNewer = setVeilHost(newer);
    remove();
    expect(hasVeilHost()).toBe(true);
    expect(claimVeil(EXIT)).toBe(newer.opacity);
    removeNewer();
    expect(hasVeilHost()).toBe(false);
  });
});

describe('window requests, exits and open windows', () => {
  it('a request lasts until an enter or the veil answers it', () => {
    expect(isWindowRequested()).toBe(false);
    requestWindow();
    expect(isWindowRequested()).toBe(true);
    noteWindowEnter({ duration: 200 });
    expect(isWindowRequested()).toBe(false);
    requestWindow();
    clearWindowRequest();
    expect(isWindowRequested()).toBe(false);
  });

  it('counts exits with their timing and tells the subscribers', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSheetPresence(listener);
    expect(windowExitCount()).toBe(0);
    expect(lastWindowExit()).toBeNull();
    noteWindowExit({ duration: 160 });
    expect(windowExitCount()).toBe(1);
    expect(lastWindowExit()).toEqual({ duration: 160 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('keeps the open windows by key, telling the subscribers once per change', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSheetPresence(listener);
    const a = {};
    const b = {};
    markWindowOpen(a, true);
    markWindowOpen(a, true);
    markWindowOpen(b, true);
    expect(openWindowCount()).toBe(2);
    markWindowOpen(a, false);
    markWindowOpen(a, false);
    expect(openWindowCount()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(3);
    resetSheetPresence();
    expect(openWindowCount()).toBe(0);
    expect(windowExitCount()).toBe(0);
    unsubscribe();
  });
});

describe('the app window height', () => {
  it('keeps a measured height, tells the subscribers once per change and ignores zero', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeSheetPresence(listener);
    expect(appWindowHeight()).toBe(0);

    setAppWindowHeight(0);
    expect(listener).not.toHaveBeenCalled();
    setAppWindowHeight(915);
    setAppWindowHeight(915);
    expect(appWindowHeight()).toBe(915);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();

    resetSheetPresence();
    expect(appWindowHeight()).toBe(0);
  });
});
