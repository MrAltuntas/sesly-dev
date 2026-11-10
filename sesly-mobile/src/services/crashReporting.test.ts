/**
 * Crash reporting: collection per build type, the Sesly user id (never an
 * email), non-fatals with a short breadcrumb free of personal fields, the
 * Hermes rejection tracker of release builds and the hidden test crash of
 * development builds. The Crashlytics module is the global mock
 * (test-utils/mocks/native-modules).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as crashlytics from '@react-native-firebase/crashlytics';
import {
  TEST_CRASH_KEY,
  TEST_CRASH_TAPS,
  TEST_CRASH_WINDOW_MS,
  createTestCrashTrigger,
  describeContext,
  initCrashReporting,
  recordNonFatal,
  resetCrashReportingForTests,
  sendTestCrashReport,
  setCrashUser,
  trackUnhandledRejections,
  triggerTestCrash,
} from './crashReporting';
import { resetSessionForTests, setSessionUserId } from '../stores/session';

const lib = crashlytics as unknown as Record<string, jest.Mock>;

type DevGlobal = { __DEV__: boolean; HermesInternal?: unknown };
const g = globalThis as unknown as DevGlobal;
const originalDev = g.__DEV__;
const originalHermes = g.HermesInternal;

beforeEach(() => {
  resetCrashReportingForTests();
  resetSessionForTests();
});

afterEach(() => {
  g.__DEV__ = originalDev;
  g.HermesInternal = originalHermes;
  resetCrashReportingForTests();
  resetSessionForTests();
});

describe('initCrashReporting', () => {
  it('turns collection off in development and follows the signed-in user', () => {
    initCrashReporting();
    expect(lib.getCrashlytics).toHaveBeenCalled();
    expect(lib.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), false);

    setSessionUserId('user-1');
    expect(lib.setUserId).toHaveBeenLastCalledWith(expect.anything(), 'user-1');
    setSessionUserId(null);
    expect(lib.setUserId).toHaveBeenLastCalledWith(expect.anything(), '');

    // Once only.
    initCrashReporting();
    expect(lib.setCrashlyticsCollectionEnabled).toHaveBeenCalledTimes(1);
  });

  it('turns collection on in release builds and tracks unhandled rejections', () => {
    g.__DEV__ = false;
    const enable = jest.fn();
    g.HermesInternal = { enablePromiseRejectionTracker: enable };
    initCrashReporting();
    expect(lib.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), true);
    expect(enable).toHaveBeenCalledWith(expect.objectContaining({ allRejections: true }));

    const { onUnhandled, onHandled } = enable.mock.calls[0][0];
    onUnhandled(7, new Error('lost promise'));
    expect(lib.log).toHaveBeenCalledWith(expect.anything(), 'app: kind=unhandledRejection id=7');
    expect(lib.recordError).toHaveBeenCalledWith(expect.anything(), new Error('lost promise'), 'app_error');
    onUnhandled(8, undefined);
    expect(lib.recordError).toHaveBeenLastCalledWith(
      expect.anything(),
      new Error('Unhandled promise rejection'),
      'app_error',
    );
    expect(onHandled(7)).toBeUndefined();
  });
});

describe('trackUnhandledRejections', () => {
  it("leaves development to React Native's own tracker, and needs Hermes", () => {
    const enable = jest.fn();
    g.HermesInternal = { enablePromiseRejectionTracker: enable };
    expect(trackUnhandledRejections()).toBe(false);
    g.__DEV__ = false;
    g.HermesInternal = undefined;
    expect(trackUnhandledRejections()).toBe(false);
    expect(enable).not.toHaveBeenCalled();
  });
});

describe('recordNonFatal', () => {
  it('writes a short breadcrumb and records the error under its area', () => {
    recordNonFatal(new Error('validate failed'), 'purchase', {
      step: 'validate',
      status: 503,
      code: 'STORE_UNAVAILABLE',
      product: 'pro_monthly',
      missing: undefined,
    });
    expect(lib.log).toHaveBeenCalledWith(
      expect.anything(),
      'purchase: step=validate status=503 code=STORE_UNAVAILABLE product=pro_monthly',
    );
    expect(lib.recordError).toHaveBeenCalledWith(expect.anything(), new Error('validate failed'), 'purchase_error');
  });

  it('turns any thrown value into an Error and works without context', () => {
    recordNonFatal('plain text', 'narration');
    expect(lib.log).toHaveBeenCalledWith(expect.anything(), 'narration');
    expect(lib.recordError).toHaveBeenCalledWith(expect.anything(), new Error('plain text'), 'narration_error');
    recordNonFatal({ code: 'x' }, 'narration');
    expect(lib.recordError).toHaveBeenLastCalledWith(expect.anything(), new Error('{"code":"x"}'), 'narration_error');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    recordNonFatal(circular, 'narration');
    expect(lib.recordError).toHaveBeenLastCalledWith(expect.anything(), new Error('[object Object]'), 'narration_error');
  });

  it('never throws when the module fails', () => {
    lib.recordError.mockImplementationOnce(() => {
      throw new Error('native gone');
    });
    expect(() => recordNonFatal(new Error('x'), 'app')).not.toThrow();
    lib.setUserId.mockRejectedValueOnce(new Error('async failure'));
    expect(() => setCrashUser('user-2')).not.toThrow();
  });

  it('does nothing when Crashlytics cannot start', () => {
    lib.getCrashlytics.mockImplementationOnce(() => {
      throw new Error('no native module');
    });
    recordNonFatal(new Error('x'), 'app');
    expect(lib.recordError).not.toHaveBeenCalled();
  });
});

describe('describeContext', () => {
  it('drops personal fields and long values', () => {
    expect(
      describeContext({
        email: 'a@b.c',
        userName: 'Ayşe',
        purchaseToken: 'secret',
        receipt: 'r',
        code: 'X'.repeat(100),
        ok: true,
        nothing: null,
      }),
    ).toBe(`code=${'X'.repeat(80)} ok=true`);
    expect(describeContext(undefined)).toBe('');
  });
});

describe('the test crash', () => {
  it('development: marks the crash, crashes, and the next start sends that one report', async () => {
    expect(triggerTestCrash()).toBe(true);
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(TEST_CRASH_KEY, '1');
    expect(lib.crash).toHaveBeenCalledTimes(1);

    // The next start (collection stays off in development).
    initCrashReporting();
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(lib.setCrashlyticsCollectionEnabled).toHaveBeenCalledWith(expect.anything(), false);
    expect(lib.sendUnsentReports).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(TEST_CRASH_KEY)).toBeNull();

    // Only once, and never for another crash.
    await expect(sendTestCrashReport()).resolves.toBe(false);
    expect(lib.sendUnsentReports).toHaveBeenCalledTimes(1);
  });

  it('a marker that cannot be read sends nothing', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage'));
    await expect(sendTestCrashReport()).resolves.toBe(false);
    expect(lib.sendUnsentReports).not.toHaveBeenCalled();
  });

  it('release: never', () => {
    g.__DEV__ = false;
    expect(triggerTestCrash()).toBe(false);
    expect(lib.crash).not.toHaveBeenCalled();
    const trigger = createTestCrashTrigger(() => 0);
    for (let i = 0; i < TEST_CRASH_TAPS; i += 1) expect(trigger.tap()).toBe(false);
  });

  it('seven taps within three seconds, not slower', () => {
    let now = 0;
    const trigger = createTestCrashTrigger(() => now);
    for (let i = 0; i < TEST_CRASH_TAPS - 1; i += 1) {
      expect(trigger.tap()).toBe(false);
      now += TEST_CRASH_WINDOW_MS; // each tap too late for the window
    }
    expect(trigger.tap()).toBe(false);

    now = 100_000;
    const results = Array.from({ length: TEST_CRASH_TAPS }, () => {
      now += 100;
      return trigger.tap();
    });
    expect(results.slice(0, -1).every(result => result === false)).toBe(true);
    expect(results[results.length - 1]).toBe(true);
  });
});
