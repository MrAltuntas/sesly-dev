/**
 * session.ts: the Firebase-free bridge between AuthStore and per-user state
 * (audio, queue, sleep timer).
 */
import {
  getSessionUserId,
  onSessionUserChange,
  registerSessionEndHandler,
  resetSessionForTests,
  runSessionEndHandlers,
  setSessionUserId,
} from './session';

beforeEach(() => {
  resetSessionForTests();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('session user id', () => {
  it('starts with nobody and follows setSessionUserId', () => {
    expect(getSessionUserId()).toBeNull();

    setSessionUserId('user-1');
    expect(getSessionUserId()).toBe('user-1');

    setSessionUserId(null);
    expect(getSessionUserId()).toBeNull();
  });

  it('treats an empty id as nobody', () => {
    setSessionUserId('user-1');
    setSessionUserId('');
    expect(getSessionUserId()).toBeNull();
  });

  it('notifies on a change only, not when the same id is set again', () => {
    const listener = jest.fn();
    onSessionUserChange(listener);

    setSessionUserId('user-1');
    setSessionUserId('user-1');
    setSessionUserId('user-2');
    setSessionUserId(null);
    setSessionUserId(null);

    expect(listener.mock.calls).toEqual([['user-1'], ['user-2'], [null]]);
  });

  it('stops notifying after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = onSessionUserChange(listener);

    setSessionUserId('user-1');
    unsubscribe();
    setSessionUserId('user-2');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps notifying the other listeners when one throws', () => {
    const broken = jest.fn(() => {
      throw new Error('listener bug');
    });
    const healthy = jest.fn();
    onSessionUserChange(broken);
    onSessionUserChange(healthy);

    expect(() => setSessionUserId('user-1')).not.toThrow();

    expect(broken).toHaveBeenCalledWith('user-1');
    expect(healthy).toHaveBeenCalledWith('user-1');
    expect(getSessionUserId()).toBe('user-1');
  });

  it('a listener that unsubscribes while being notified does not skip the next one', () => {
    const second = jest.fn();
    const unsubscribeFirst = onSessionUserChange(() => unsubscribeFirst());
    onSessionUserChange(second);

    setSessionUserId('user-1');
    setSessionUserId('user-2');

    expect(second).toHaveBeenCalledTimes(2);
  });
});

describe('session end handlers', () => {
  it('run in registration order, each awaited before the next', async () => {
    const order: string[] = [];
    registerSessionEndHandler(async () => {
      await Promise.resolve();
      order.push('audio:start');
      await Promise.resolve();
      order.push('audio:end');
    });
    registerSessionEndHandler(() => {
      order.push('timer');
    });
    registerSessionEndHandler(async () => {
      order.push('queue');
    });

    await runSessionEndHandlers();

    expect(order).toEqual(['audio:start', 'audio:end', 'timer', 'queue']);
  });

  it('one failing handler (sync or async) does not stop the others and nothing throws', async () => {
    const later = jest.fn();
    registerSessionEndHandler(() => {
      throw new Error('sync failure');
    });
    registerSessionEndHandler(async () => {
      throw new Error('async failure');
    });
    registerSessionEndHandler(later);

    await expect(runSessionEndHandlers()).resolves.toBeUndefined();

    expect(later).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(2);
  });

  it('an unregistered handler no longer runs', async () => {
    const kept = jest.fn();
    const dropped = jest.fn();
    registerSessionEndHandler(kept);
    const unregister = registerSessionEndHandler(dropped);

    unregister();
    await runSessionEndHandlers();

    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
  });

  it('runs every time a session ends, and with no handlers resolves', async () => {
    await expect(runSessionEndHandlers()).resolves.toBeUndefined();

    const handler = jest.fn();
    registerSessionEndHandler(handler);
    await runSessionEndHandlers();
    await runSessionEndHandlers();

    expect(handler).toHaveBeenCalledTimes(2);
  });
});
