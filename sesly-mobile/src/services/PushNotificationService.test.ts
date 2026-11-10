jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: { post: jest.fn(), postDetached: jest.fn() },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as messaging from '@react-native-firebase/messaging';
import ApiClient from './ApiClient';
import pushService, {
  PUSH_PROMPTED_STORAGE_KEY,
  ensurePushPermission,
  getDevicePlatform,
  registerBackgroundMessageHandler,
  resolvePushPermissionStatus,
} from './PushNotificationService';
import { AppState, AppStateStatus, Linking, PermissionsAndroid, Platform } from 'react-native';
import { NotificationType, parsePushPayload } from '../models/Notification';

const m = messaging as unknown as Record<string, jest.Mock>;
const post = ApiClient.post as jest.Mock;
const postDetached = ApiClient.postDetached as jest.Mock;
/** The JWT the sign-out read before it cleared the stored tokens. */
const JWT = 'captured-jwt';
const UNREGISTER_OPTIONS = { timeout: 4000 };

const NOT_DETERMINED = -1;
const DENIED = 0;
const AUTHORIZED = 1;
const PROVISIONAL = 2;

/** Let chained promise callbacks run (fake timers are on globally). */
const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
};

beforeEach(async () => {
  pushService.dispose();
  await AsyncStorage.clear();
  m.getMessaging.mockImplementation(() => ({}));
  m.getToken.mockResolvedValue('tok-1');
  m.deleteToken.mockResolvedValue(undefined);
  m.hasPermission.mockResolvedValue(AUTHORIZED);
  m.requestPermission.mockResolvedValue(AUTHORIZED);
  m.onMessage.mockImplementation(() => jest.fn());
  m.onNotificationOpenedApp.mockImplementation(() => jest.fn());
  m.onTokenRefresh.mockImplementation(() => jest.fn());
  m.getInitialNotification.mockResolvedValue(null);
  post.mockReset().mockResolvedValue({});
  postDetached.mockReset().mockResolvedValue({});
});

describe('resolvePushPermissionStatus', () => {
  it('maps iOS authorization statuses', () => {
    expect(resolvePushPermissionStatus(AUTHORIZED, 'ios', 0, false)).toBe('granted');
    expect(resolvePushPermissionStatus(PROVISIONAL, 'ios', 0, false)).toBe('granted');
    expect(resolvePushPermissionStatus(DENIED, 'ios', 0, true)).toBe('denied');
    expect(resolvePushPermissionStatus(NOT_DETERMINED, 'ios', 0, false)).toBe('undetermined');
    expect(resolvePushPermissionStatus(null, 'ios', 0, false)).toBe('undetermined');
  });

  it('treats Android 13+ "off" as undetermined until the in-context prompt', () => {
    expect(resolvePushPermissionStatus(AUTHORIZED, 'android', 34, false)).toBe('granted');
    expect(resolvePushPermissionStatus(DENIED, 'android', 34, false)).toBe('undetermined');
    expect(resolvePushPermissionStatus(DENIED, 'android', 34, true)).toBe('denied');
  });

  it('treats "off" below Android 13 as a user denial (no runtime prompt exists)', () => {
    expect(resolvePushPermissionStatus(DENIED, 'android', 30, false)).toBe('denied');
    expect(resolvePushPermissionStatus(AUTHORIZED, 'android', 30, false)).toBe('granted');
  });
});

describe('parsePushPayload', () => {
  it('parses the NARRATION_READY contract', () => {
    const payload = parsePushPayload({
      notification: { title: 'Masalın hazır', body: 'Dinlemeye başla' },
      data: {
        type: 'NARRATION_READY',
        notificationId: 'n-1',
        narrationId: 'nar-1',
        storyId: 's-1',
      },
    });
    expect(payload).toEqual({
      type: NotificationType.NARRATION_READY,
      notificationId: 'n-1',
      data: {
        type: 'NARRATION_READY',
        notificationId: 'n-1',
        narrationId: 'nar-1',
        storyId: 's-1',
      },
      title: 'Masalın hazır',
      body: 'Dinlemeye başla',
    });
  });

  it('reads BROADCAST and unknown types as SYSTEM and drops non-string data', () => {
    const payload = parsePushPayload({
      data: { type: 'BROADCAST', notificationId: 'n-2', extra: { nested: true } },
    });
    expect(payload?.type).toBe(NotificationType.SYSTEM);
    expect(payload?.data).toEqual({ type: 'BROADCAST', notificationId: 'n-2' });
    expect(payload?.title).toBeNull();
  });

  it('returns null for empty messages', () => {
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload({ data: {} })).toBeNull();
  });
});

describe('PushNotificationService registration', () => {
  it('registers the FCM token when a session starts with permission granted', async () => {
    await pushService.onSessionStarted();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/notifications/register', {
      token: 'tok-1',
      platform: getDevicePlatform(),
    });
    expect(m.requestPermission).not.toHaveBeenCalled();
  });

  it('never prompts or registers on session start without permission', async () => {
    m.hasPermission.mockResolvedValue(NOT_DETERMINED);
    await pushService.onSessionStarted();
    expect(m.requestPermission).not.toHaveBeenCalled();
    expect(m.getToken).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('does not re-register the same token twice in one run', async () => {
    await pushService.onSessionStarted();
    await pushService.onSessionStarted();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('swallows register failures (login must never break on push)', async () => {
    post.mockRejectedValueOnce(new Error('network'));
    await expect(pushService.onSessionStarted()).resolves.toBeUndefined();
  });

  it('re-registers when FCM rotates the token', async () => {
    pushService.initialize();
    const listener = m.onTokenRefresh.mock.calls[0][1] as (token: string) => void;
    await pushService.onSessionStarted();
    post.mockClear();

    listener('tok-2');
    await flush();

    expect(post).toHaveBeenCalledWith('/notifications/register', {
      token: 'tok-2',
      platform: getDevicePlatform(),
    });
  });
});

describe('PushNotificationService sign-out', () => {
  it('unregisters with the registered token, then deletes it', async () => {
    await pushService.onSessionStarted();
    post.mockClear();

    await pushService.unregisterDevice(JWT);

    expect(postDetached).toHaveBeenCalledWith(
      '/notifications/unregister',
      { token: 'tok-1' },
      JWT,
      UNREGISTER_OPTIONS,
    );
    expect(post).not.toHaveBeenCalled();
    expect(m.deleteToken).toHaveBeenCalledTimes(1);
    expect(postDetached.mock.invocationCallOrder[0]).toBeLessThan(
      m.deleteToken.mock.invocationCallOrder[0],
    );
  });

  it('still deletes the token when unregister fails, and never throws', async () => {
    await pushService.onSessionStarted();
    postDetached.mockRejectedValueOnce(new Error('offline'));

    await expect(pushService.unregisterDevice(JWT)).resolves.toBeUndefined();
    expect(m.deleteToken).toHaveBeenCalledTimes(1);
  });

  it('takes the session state at the call: the sign-out does not wait, the bridge then has nothing left to do', async () => {
    await pushService.onSessionStarted();
    m.getToken.mockClear();

    const pending = pushService.unregisterDevice(JWT);
    // The navigator's bridge reacts to the cleared user while the unregister runs.
    pushService.onSessionEnded();
    await pending;
    await flush();

    expect(postDetached).toHaveBeenCalledTimes(1);
    expect(postDetached).toHaveBeenCalledWith(
      '/notifications/unregister',
      { token: 'tok-1' },
      JWT,
      UNREGISTER_OPTIONS,
    );
    expect(m.getToken).not.toHaveBeenCalled();
    expect(m.deleteToken).toHaveBeenCalledTimes(1);
  });

  it('without a captured JWT it makes no backend call and only deletes the token', async () => {
    await pushService.onSessionStarted();
    post.mockClear();

    await pushService.unregisterDevice(null);

    expect(postDetached).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(m.deleteToken).toHaveBeenCalledTimes(1);
  });

  it('a new session registers only after the old unregister and token delete have finished', async () => {
    await pushService.onSessionStarted();
    post.mockClear();
    let answerUnregister: (value: unknown) => void = () => undefined;
    postDetached.mockReturnValueOnce(
      new Promise(resolve => {
        answerUnregister = resolve;
      }),
    );
    const signOut = pushService.unregisterDevice(JWT);
    await flush();

    // Signed in again while the old unregister is still out.
    m.getToken.mockResolvedValue('tok-2');
    const started = pushService.onSessionStarted();
    await flush();
    expect(post).not.toHaveBeenCalled();

    answerUnregister({});
    await signOut;
    await started;

    expect(post).toHaveBeenCalledWith('/notifications/register', {
      token: 'tok-2',
      platform: getDevicePlatform(),
    });
    expect(m.deleteToken.mock.invocationCallOrder[0]).toBeLessThan(post.mock.invocationCallOrder[0]);
  });

  it('does not touch the token on a cold start without a session', () => {
    pushService.onSessionEnded();
    expect(m.deleteToken).not.toHaveBeenCalled();
  });

  it('deletes the token locally when the session expires (no JWT left)', async () => {
    await pushService.onSessionStarted();
    post.mockClear();

    pushService.onSessionEnded();
    await flush();

    expect(post).not.toHaveBeenCalled();
    expect(m.deleteToken).toHaveBeenCalledTimes(1);
  });
});

describe('ensurePushPermission (in-context prompt)', () => {
  it('prompts once, and never again after that', async () => {
    m.hasPermission.mockResolvedValue(NOT_DETERMINED);
    m.requestPermission.mockResolvedValue(DENIED);

    await expect(ensurePushPermission()).resolves.toBe(false);
    await expect(ensurePushPermission()).resolves.toBe(false);

    expect(m.requestPermission).toHaveBeenCalledTimes(1);
    await expect(AsyncStorage.getItem(PUSH_PROMPTED_STORAGE_KEY)).resolves.toBe('1');
  });

  it('does not prompt when the user already denied', async () => {
    m.hasPermission.mockResolvedValue(DENIED);
    await expect(ensurePushPermission()).resolves.toBe(false);
    expect(m.requestPermission).not.toHaveBeenCalled();
  });

  it('registers right away when the prompt is granted during a session', async () => {
    m.hasPermission.mockResolvedValue(NOT_DETERMINED);
    await pushService.onSessionStarted();
    expect(post).not.toHaveBeenCalled();

    // The OS reports the new state once the user taps "Allow".
    m.requestPermission.mockImplementation(async () => {
      m.hasPermission.mockResolvedValue(AUTHORIZED);
      return AUTHORIZED;
    });
    const granted = await ensurePushPermission();
    await flush();

    expect(granted).toBe(true);
    expect(post).toHaveBeenCalledWith('/notifications/register', {
      token: 'tok-1',
      platform: getDevicePlatform(),
    });
  });
});

describe('PushNotificationService incoming messages', () => {
  const opened = {
    messageId: 'm-1',
    notification: { title: 'Sesin hazır', body: 'Dinle' },
    data: { type: 'VOICE_READY', notificationId: 'n-9', voiceProfileId: 'v-1' },
  };

  it('delivers a cold-start tap once the handlers are attached', async () => {
    m.getInitialNotification.mockResolvedValue(opened);
    pushService.initialize();
    await flush();

    const onNotificationOpened = jest.fn();
    pushService.setHandlers({ onNotificationOpened });

    expect(onNotificationOpened).toHaveBeenCalledTimes(1);
    expect(onNotificationOpened.mock.calls[0][0]).toMatchObject({
      type: NotificationType.VOICE_READY,
      notificationId: 'n-9',
    });
  });

  it('acts once when the same tap is reported twice', () => {
    pushService.initialize();
    const onNotificationOpened = jest.fn();
    pushService.setHandlers({ onNotificationOpened });
    const listener = m.onNotificationOpenedApp.mock.calls[0][1] as (msg: unknown) => void;

    listener(opened);
    listener(opened);

    expect(onNotificationOpened).toHaveBeenCalledTimes(1);
  });

  it('passes foreground messages to the foreground handler', () => {
    pushService.initialize();
    const onForegroundMessage = jest.fn();
    pushService.setHandlers({ onForegroundMessage });
    const listener = m.onMessage.mock.calls[0][1] as (msg: unknown) => void;

    listener(opened);

    expect(onForegroundMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: NotificationType.VOICE_READY, title: 'Sesin hazır' }),
    );
  });

  it('keeps working when Firebase messaging is not configured', async () => {
    m.getMessaging.mockImplementation(() => {
      throw new Error('No Firebase App');
    });
    expect(() => pushService.initialize()).not.toThrow();
    await expect(pushService.onSessionStarted()).resolves.toBeUndefined();
    await expect(pushService.unregisterDevice(JWT)).resolves.toBeUndefined();
    expect(post).not.toHaveBeenCalled();
    expect(postDetached).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Extended coverage: risky branches not covered above
// ============================================================================

/** Generous microtask drain for the multi-step async register chain. */
const drain = async () => {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
};

const tap = (overrides: Record<string, unknown> = {}) => ({
  messageId: 'm-10',
  notification: { title: 'Masalın hazır', body: 'Dinlemeye başla' },
  data: { type: 'NARRATION_READY', notificationId: 'n-10', narrationId: 'nar-1', storyId: 's-1' },
  ...overrides,
});

describe('PushNotificationService extended', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('initialize', () => {
    it('is idempotent', () => {
      pushService.initialize();
      pushService.initialize();
      expect(m.onMessage).toHaveBeenCalledTimes(1);
      expect(m.getInitialNotification).toHaveBeenCalledTimes(1);
    });

    it('survives a failing listener setup and a failing getInitialNotification', async () => {
      m.onMessage.mockImplementation(() => {
        throw new Error('native module missing');
      });
      m.getInitialNotification.mockRejectedValue(new Error('no activity'));
      const addListener = jest.spyOn(AppState, 'addEventListener');

      expect(() => pushService.initialize()).not.toThrow();
      await flush();

      // The AppState hook is still attached so a later grant registers.
      expect(addListener).toHaveBeenCalledWith('change', expect.any(Function));
      expect(console.warn).toHaveBeenCalledWith(
        '[Push] getInitialNotification failed:',
        expect.any(Error),
      );
    });
  });

  describe('opened and foreground messages', () => {
    it('keeps a tap pending until a handler with onNotificationOpened arrives', () => {
      pushService.initialize();
      const listener = m.onNotificationOpenedApp.mock.calls[0][1] as (msg: unknown) => void;

      listener(tap());
      const onForegroundMessage = jest.fn();
      pushService.setHandlers({ onForegroundMessage });
      const onNotificationOpened = jest.fn();
      pushService.setHandlers({ onNotificationOpened });

      expect(onNotificationOpened).toHaveBeenCalledTimes(1);
      expect(onNotificationOpened.mock.calls[0][0]).toMatchObject({
        notificationId: 'n-10',
        data: { narrationId: 'nar-1', storyId: 's-1' },
      });

      // Delivered once only.
      const later = jest.fn();
      pushService.setHandlers({ onNotificationOpened: later });
      expect(later).not.toHaveBeenCalled();
    });

    it('drops a pending tap when the session ends before the UI mounts', async () => {
      await pushService.onSessionStarted();
      pushService.initialize();
      const listener = m.onNotificationOpenedApp.mock.calls[0][1] as (msg: unknown) => void;
      listener(tap());

      pushService.onSessionEnded();
      const onNotificationOpened = jest.fn();
      pushService.setHandlers({ onNotificationOpened });

      expect(onNotificationOpened).not.toHaveBeenCalled();
    });

    it('dedupes by notificationId when the messageId is missing', () => {
      pushService.initialize();
      const onNotificationOpened = jest.fn();
      pushService.setHandlers({ onNotificationOpened });
      const listener = m.onNotificationOpenedApp.mock.calls[0][1] as (msg: unknown) => void;

      listener(tap({ messageId: undefined }));
      listener(tap({ messageId: undefined }));
      listener(tap({ messageId: undefined, data: { type: 'VOICE_READY', notificationId: 'n-11' } }));

      expect(onNotificationOpened).toHaveBeenCalledTimes(2);
    });

    it('ignores empty messages and survives throwing handlers', () => {
      pushService.initialize();
      const onForegroundMessage = jest.fn(() => {
        throw new Error('toast crashed');
      });
      const onNotificationOpened = jest.fn(() => {
        throw new Error('navigation not ready');
      });
      pushService.setHandlers({ onForegroundMessage, onNotificationOpened });
      const foreground = m.onMessage.mock.calls[0][1] as (msg: unknown) => void;
      const opened = m.onNotificationOpenedApp.mock.calls[0][1] as (msg: unknown) => void;

      foreground({ data: {} });
      opened({ data: {} });
      expect(onForegroundMessage).not.toHaveBeenCalled();
      expect(onNotificationOpened).not.toHaveBeenCalled();

      expect(() => foreground(tap())).not.toThrow();
      expect(() => opened(tap())).not.toThrow();
      expect(onForegroundMessage).toHaveBeenCalledTimes(1);
      expect(onNotificationOpened).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith('[Push] handler failed:', expect.any(Error));
    });

    it('the setHandlers unsubscribe only clears its own handlers', () => {
      pushService.initialize();
      const foreground = m.onMessage.mock.calls[0][1] as (msg: unknown) => void;

      const first = jest.fn();
      const unsubscribeFirst = pushService.setHandlers({ onForegroundMessage: first });
      const second = jest.fn();
      const unsubscribeSecond = pushService.setHandlers({ onForegroundMessage: second });

      unsubscribeFirst(); // stale: must not remove the newer handlers
      foreground(tap());
      expect(second).toHaveBeenCalledTimes(1);
      expect(first).not.toHaveBeenCalled();

      unsubscribeSecond();
      foreground(tap({ messageId: 'm-11' }));
      expect(second).toHaveBeenCalledTimes(1);
    });
  });

  describe('token refresh and app state', () => {
    it('ignores FCM token rotation while signed out', async () => {
      pushService.initialize();
      const listener = m.onTokenRefresh.mock.calls[0][1] as (token: string) => void;

      listener('tok-2');
      await drain();

      expect(post).not.toHaveBeenCalled();
    });

    it('ignores a rotation to the already registered token', async () => {
      pushService.initialize();
      const listener = m.onTokenRefresh.mock.calls[0][1] as (token: string) => void;
      await pushService.onSessionStarted();
      post.mockClear();

      listener('tok-1');
      listener('');
      await drain();

      expect(post).not.toHaveBeenCalled();
    });

    it('registers a rotated token after an in-flight registration settles', async () => {
      pushService.initialize();
      const listener = m.onTokenRefresh.mock.calls[0][1] as (token: string) => void;
      let resolveFirst: (value: unknown) => void = () => {};
      post.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveFirst = resolve;
          }),
      );

      const started = pushService.onSessionStarted();
      await drain();
      expect(post).toHaveBeenCalledTimes(1);

      listener('tok-2');
      await drain();
      expect(post).toHaveBeenCalledTimes(1); // waits for the in-flight call

      resolveFirst({});
      await started;
      await drain();

      expect(post.mock.calls.map(call => call[1].token)).toEqual(['tok-1', 'tok-2']);
    });

    it('a concurrent session start waits for the in-flight registration instead of duplicating it', async () => {
      await Promise.all([pushService.onSessionStarted(), pushService.onSessionStarted()]);
      expect(post).toHaveBeenCalledTimes(1);
    });

    it('registers on foreground when permission was granted from system settings', async () => {
      let appStateHandler: ((next: AppStateStatus) => void) | null = null;
      jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _type: string,
        handler: (next: AppStateStatus) => void,
      ) => {
        appStateHandler = handler;
        return { remove: jest.fn() };
      }) as unknown as typeof AppState.addEventListener);
      m.hasPermission.mockResolvedValue(DENIED);
      pushService.initialize();
      await pushService.onSessionStarted();
      expect(post).not.toHaveBeenCalled();

      m.hasPermission.mockResolvedValue(AUTHORIZED);
      appStateHandler!('background');
      await drain();
      expect(post).not.toHaveBeenCalled();

      appStateHandler!('active');
      await drain();
      expect(post).toHaveBeenCalledWith('/notifications/register', {
        token: 'tok-1',
        platform: getDevicePlatform(),
      });

      // Already registered: coming back again does nothing.
      post.mockClear();
      appStateHandler!('active');
      await drain();
      expect(post).not.toHaveBeenCalled();
    });

    it('does not register on foreground without a session', async () => {
      let appStateHandler: ((next: AppStateStatus) => void) | null = null;
      jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _type: string,
        handler: (next: AppStateStatus) => void,
      ) => {
        appStateHandler = handler;
        return { remove: jest.fn() };
      }) as unknown as typeof AppState.addEventListener);
      pushService.initialize();

      appStateHandler!('active');
      await drain();

      expect(m.getToken).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('registration robustness', () => {
    it('gives up on a hanging register call after 5s and retries on the next session start', async () => {
      post.mockReturnValueOnce(new Promise(() => {}));

      const started = pushService.onSessionStarted();
      await drain();
      expect(post).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(5000);
      await expect(started).resolves.toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith('[Push] register failed:', expect.any(Error));

      await pushService.onSessionStarted();
      expect(post).toHaveBeenCalledTimes(2);
    });

    it('does not register when the session ended while the token was being fetched', async () => {
      let resolveToken: (token: string) => void = () => {};
      m.getToken.mockImplementationOnce(
        () =>
          new Promise<string>(resolve => {
            resolveToken = resolve;
          }),
      );

      const started = pushService.onSessionStarted();
      await drain();
      pushService.onSessionEnded();
      resolveToken('tok-1');
      await started;

      expect(post).not.toHaveBeenCalled();
    });

    // Regression (fixed 2026-09-28, was BUG): PushNotificationService.ts:253-257 onSessionEnded (hadToken check) + :411-412
    // registerIfPermitted (`if (this.sessionActive) this.registeredToken = token`). When the session expires
    // while POST /notifications/register is in flight, onSessionEnded sees no
    // registeredToken and skips deleteLocalToken; the POST then succeeds on the backend
    // but the token is never recorded or deleted. The device stays registered for the
    // signed-out user and keeps receiving their pushes until the next login re-registers.
    it('deletes the FCM token when the session ends during an in-flight register', async () => {
      let resolveRegister: (value: unknown) => void = () => {};
      post.mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolveRegister = resolve;
          }),
      );

      const started = pushService.onSessionStarted();
      await drain();
      expect(post).toHaveBeenCalledTimes(1);

      pushService.onSessionEnded();
      resolveRegister({});
      await started;
      await drain();

      expect(m.deleteToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('unregisterDevice without a registered token', () => {
    it('looks the token up when permission is granted and unregisters it', async () => {
      m.getToken.mockResolvedValue('tok-9');

      await pushService.unregisterDevice(JWT);

      expect(postDetached).toHaveBeenCalledWith(
        '/notifications/unregister',
        { token: 'tok-9' },
        JWT,
        UNREGISTER_OPTIONS,
      );
      expect(m.deleteToken).toHaveBeenCalledTimes(1);
    });

    it('skips the lookup and the backend call without permission, but still deletes locally', async () => {
      m.hasPermission.mockResolvedValue(DENIED);

      await pushService.unregisterDevice(JWT);

      expect(m.getToken).not.toHaveBeenCalled();
      expect(postDetached).not.toHaveBeenCalled();
      expect(m.deleteToken).toHaveBeenCalledTimes(1);
    });

    it('never throws when the token lookup or deleteToken fails', async () => {
      m.getToken.mockRejectedValue(new Error('SERVICE_NOT_AVAILABLE'));
      m.deleteToken.mockRejectedValue(new Error('offline'));

      await expect(pushService.unregisterDevice(JWT)).resolves.toBeUndefined();

      expect(postDetached).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        '[Push] token lookup for unregister failed:',
        expect.any(Error),
      );
      expect(console.warn).toHaveBeenCalledWith('[Push] deleteToken failed:', expect.any(Error));
    });

    it('time-boxes a hanging unregister call (4s) so sign-out is never blocked', async () => {
      await pushService.onSessionStarted();
      postDetached.mockReturnValueOnce(new Promise(() => {}));

      const signOut = pushService.unregisterDevice(JWT);
      await drain();
      await jest.advanceTimersByTimeAsync(4000);
      await drain();

      await expect(signOut).resolves.toBeUndefined();
      expect(m.deleteToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('requestPermissionFromSettings', () => {
    it('returns granted and retries registration when already allowed', async () => {
      post.mockRejectedValueOnce(new Error('offline'));
      await pushService.onSessionStarted(); // first attempt fails, nothing recorded
      expect(post).toHaveBeenCalledTimes(1);

      await expect(pushService.requestPermissionFromSettings()).resolves.toBe('granted');
      await drain();

      expect(post).toHaveBeenCalledTimes(2);
      expect(m.requestPermission).not.toHaveBeenCalled();
    });

    it('prompts when undetermined and registers on grant', async () => {
      m.hasPermission.mockResolvedValue(NOT_DETERMINED);
      await pushService.onSessionStarted();
      m.requestPermission.mockImplementation(async () => {
        m.hasPermission.mockResolvedValue(AUTHORIZED);
        return PROVISIONAL;
      });

      await expect(pushService.requestPermissionFromSettings()).resolves.toBe('granted');
      await drain();

      expect(m.requestPermission).toHaveBeenCalledTimes(1);
      await expect(AsyncStorage.getItem(PUSH_PROMPTED_STORAGE_KEY)).resolves.toBe('1');
      expect(post).toHaveBeenCalledWith('/notifications/register', expect.any(Object));
    });

    it('returns denied when the prompt is declined', async () => {
      m.hasPermission.mockResolvedValue(NOT_DETERMINED);
      m.requestPermission.mockResolvedValue(DENIED);
      const openSettings = jest.spyOn(Linking, 'openSettings');

      await expect(pushService.requestPermissionFromSettings()).resolves.toBe('denied');
      expect(openSettings).not.toHaveBeenCalled();
    });

    it('opens the system settings page when already denied', async () => {
      m.hasPermission.mockResolvedValue(DENIED);
      const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);

      await expect(pushService.requestPermissionFromSettings()).resolves.toBe('denied');

      expect(openSettings).toHaveBeenCalledTimes(1);
      expect(m.requestPermission).not.toHaveBeenCalled();
    });

    it('survives openSettings failing', async () => {
      m.hasPermission.mockResolvedValue(DENIED);
      jest.spyOn(Linking, 'openSettings').mockRejectedValue(new Error('no settings app'));

      await expect(pushService.requestPermissionFromSettings()).resolves.toBe('denied');
      expect(console.warn).toHaveBeenCalledWith('[Push] openSettings failed:', expect.any(Error));
    });

    it('treats a failing iOS permission request as not granted', async () => {
      m.hasPermission.mockResolvedValue(NOT_DETERMINED);
      m.requestPermission.mockRejectedValue(new Error('APNs unavailable'));

      await expect(pushService.requestPermissionFromSettings()).resolves.toBe('denied');
      await expect(ensurePushPermission()).resolves.toBe(false);
    });
  });

  describe('permission status edge cases (iOS)', () => {
    it('ensurePermission resolves true without prompting when already granted', async () => {
      post.mockRejectedValueOnce(new Error('offline'));
      await pushService.onSessionStarted(); // registration failed earlier

      await expect(ensurePushPermission()).resolves.toBe(true);
      await drain();

      expect(m.requestPermission).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledTimes(2); // retried in the background
    });

    it('reads undetermined when hasPermission throws', async () => {
      m.hasPermission.mockRejectedValue(new Error('native crash'));
      await expect(pushService.getPermissionStatus()).resolves.toBe('undetermined');
    });

    it('treats unreadable AsyncStorage as not prompted and tolerates a failing write', async () => {
      m.hasPermission.mockResolvedValue(NOT_DETERMINED);
      m.requestPermission.mockResolvedValue(DENIED);
      const storage = AsyncStorage as unknown as Record<string, jest.Mock>;
      storage.getItem.mockRejectedValueOnce(new Error('disk'));
      storage.getItem.mockRejectedValueOnce(new Error('disk'));
      storage.setItem.mockRejectedValueOnce(new Error('disk full'));

      await expect(ensurePushPermission()).resolves.toBe(false);
      expect(m.requestPermission).toHaveBeenCalledTimes(1);
    });

    it('ensurePermission never throws', async () => {
      jest
        .spyOn(pushService, 'getPermissionStatus')
        .mockRejectedValue(new Error('unexpected'));
      await expect(ensurePushPermission()).resolves.toBe(false);
      expect(console.warn).toHaveBeenCalledWith(
        '[Push] ensurePermission failed:',
        expect.any(Error),
      );
    });

    it('requestPermissionFromSettings never throws', async () => {
      jest
        .spyOn(pushService, 'getPermissionStatus')
        .mockRejectedValue(new Error('unexpected'));
      await expect(pushService.requestPermissionFromSettings()).resolves.toBe('denied');
    });

    it('cannot prompt on iOS without Firebase messaging', async () => {
      m.getMessaging.mockImplementation(() => {
        throw new Error('No Firebase App');
      });
      await expect(ensurePushPermission()).resolves.toBe(false);
      expect(m.requestPermission).not.toHaveBeenCalled();
    });
  });

  describe('Android', () => {
    const originalOS = Platform.OS;
    const originalVersion = Object.getOwnPropertyDescriptor(Platform, 'Version');

    const setAndroid = (apiLevel: number | string) => {
      (Platform as { OS: string }).OS = 'android';
      Object.defineProperty(Platform, 'Version', {
        configurable: true,
        get: () => apiLevel,
      });
    };

    afterEach(() => {
      (Platform as { OS: string }).OS = originalOS;
      if (originalVersion) {
        Object.defineProperty(Platform, 'Version', originalVersion);
      }
    });

    it('reports the android platform when registering', async () => {
      setAndroid(34);
      await pushService.onSessionStarted();
      expect(getDevicePlatform()).toBe('android');
      expect(post).toHaveBeenCalledWith('/notifications/register', {
        token: 'tok-1',
        platform: 'android',
      });
    });

    it('asks POST_NOTIFICATIONS on Android 13+ and registers on grant', async () => {
      setAndroid(34);
      m.hasPermission.mockResolvedValue(DENIED);
      const request = jest
        .spyOn(PermissionsAndroid, 'request')
        .mockImplementation(async () => {
          m.hasPermission.mockResolvedValue(AUTHORIZED);
          return PermissionsAndroid.RESULTS.GRANTED;
        });
      await pushService.onSessionStarted();

      await expect(ensurePushPermission()).resolves.toBe(true);
      await drain();

      expect(request).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      expect(m.requestPermission).not.toHaveBeenCalled();
      expect(post).toHaveBeenCalledWith('/notifications/register', {
        token: 'tok-1',
        platform: 'android',
      });
    });

    it('does not re-prompt on Android 13+ after a denial', async () => {
      setAndroid('33');
      m.hasPermission.mockResolvedValue(DENIED);
      const request = jest
        .spyOn(PermissionsAndroid, 'request')
        .mockResolvedValue(PermissionsAndroid.RESULTS.DENIED);

      await expect(ensurePushPermission()).resolves.toBe(false);
      await expect(ensurePushPermission()).resolves.toBe(false);

      expect(request).toHaveBeenCalledTimes(1);
      await expect(pushService.getPermissionStatus()).resolves.toBe('denied');
    });

    it('below Android 13 never shows a runtime prompt', async () => {
      setAndroid(30);
      m.hasPermission.mockResolvedValue(DENIED);
      const request = jest.spyOn(PermissionsAndroid, 'request');

      // Off below 13 is a user choice: reported as denied, no prompt.
      await expect(ensurePushPermission()).resolves.toBe(false);
      expect(request).not.toHaveBeenCalled();
    });

    it('falls back to PermissionsAndroid.check when messaging is unavailable', async () => {
      setAndroid(34);
      m.getMessaging.mockImplementation(() => {
        throw new Error('No Firebase App');
      });
      const check = jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);

      await expect(pushService.getPermissionStatus()).resolves.toBe('granted');
      expect(check).toHaveBeenCalledWith(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);

      check.mockResolvedValue(false);
      await AsyncStorage.setItem(PUSH_PROMPTED_STORAGE_KEY, '1');
      await expect(pushService.getPermissionStatus()).resolves.toBe('denied');

      check.mockRejectedValue(new Error('no activity'));
      await expect(pushService.getPermissionStatus()).resolves.toBe('undetermined');
    });

    it('assumes enabled below Android 13 when hasPermission fails', async () => {
      setAndroid(29);
      m.hasPermission.mockRejectedValue(new Error('native crash'));
      await expect(pushService.getPermissionStatus()).resolves.toBe('granted');
    });

    it('treats a throwing PermissionsAndroid.request as not granted', async () => {
      setAndroid(34);
      m.hasPermission.mockResolvedValue(DENIED);
      jest.spyOn(PermissionsAndroid, 'request').mockRejectedValue(new Error('no activity'));

      await expect(ensurePushPermission()).resolves.toBe(false);
    });
  });

  describe('dispose', () => {
    it('unsubscribes every FCM listener and the AppState hook, ignoring throwing ones', () => {
      const unsubscribeMessage = jest.fn(() => {
        throw new Error('already removed');
      });
      const unsubscribeOpened = jest.fn();
      const unsubscribeToken = jest.fn();
      const remove = jest.fn();
      m.onMessage.mockImplementation(() => unsubscribeMessage);
      m.onNotificationOpenedApp.mockImplementation(() => unsubscribeOpened);
      m.onTokenRefresh.mockImplementation(() => unsubscribeToken);
      jest
        .spyOn(AppState, 'addEventListener')
        .mockImplementation((() => ({ remove })) as unknown as typeof AppState.addEventListener);
      pushService.initialize();

      expect(() => pushService.dispose()).not.toThrow();

      expect(unsubscribeMessage).toHaveBeenCalledTimes(1);
      expect(unsubscribeOpened).toHaveBeenCalledTimes(1);
      expect(unsubscribeToken).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);

      // Can be initialized again after dispose.
      pushService.initialize();
      expect(m.onMessage).toHaveBeenCalledTimes(2);
    });
  });

  describe('registerBackgroundMessageHandler', () => {
    it('registers a background handler that tolerates messages without data', async () => {
      registerBackgroundMessageHandler();

      expect(m.setBackgroundMessageHandler).toHaveBeenCalledTimes(1);
      const handler = m.setBackgroundMessageHandler.mock.calls[0][1] as (
        msg: unknown,
      ) => Promise<void>;
      await expect(handler({ data: { type: 'VOICE_READY' } })).resolves.toBeUndefined();
      await expect(handler({})).resolves.toBeUndefined();
      expect(console.log).toHaveBeenCalledWith('[Push] background message:', 'VOICE_READY');
      expect(console.log).toHaveBeenCalledWith('[Push] background message:', 'unknown');
    });

    it('never throws when Firebase is not configured', () => {
      m.getMessaging.mockImplementation(() => {
        throw new Error('No Firebase App');
      });
      expect(() => registerBackgroundMessageHandler()).not.toThrow();
      expect(m.setBackgroundMessageHandler).not.toHaveBeenCalled();
    });
  });
});
