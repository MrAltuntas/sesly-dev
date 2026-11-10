/**
 * The native sleep deadline wrapper (utils/sleepDeadline.ts): when there is
 * one, what it forwards, and that nothing it does can throw into the timer.
 */

import { Platform } from 'react-native';
import { createSeslyMediaMock } from '../test-utils/mocks/native-modules';
import { getNativeSleepDeadline } from './sleepDeadline';
import type { SeslyMediaModule } from './mediaSession';

const asModule = (mock: unknown) => mock as SeslyMediaModule;

describe('getNativeSleepDeadline', () => {
  const originalOS = Platform.OS;
  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('is null without the native module (iOS, Jest)', () => {
    expect(getNativeSleepDeadline(null)).toBeNull();
    // The default argument: no SeslyMedia in Jest, and none off Android.
    Platform.OS = 'ios';
    expect(getNativeSleepDeadline()).toBeNull();
    Platform.OS = 'android';
    expect(getNativeSleepDeadline()).toBeNull();
  });

  it('is null on a binary built before the native timer (no armSleepTimer)', () => {
    const { module } = createSeslyMediaMock({ sleepTimer: false });
    expect(getNativeSleepDeadline(asModule(module))).toBeNull();
    const { module: half } = createSeslyMediaMock();
    delete (half as Partial<typeof half>).disarmSleepTimer;
    expect(getNativeSleepDeadline(asModule(half))).toBeNull();
  });

  it('forwards arm and disarm', () => {
    const { module } = createSeslyMediaMock();
    const deadline = getNativeSleepDeadline(asModule(module));
    const player = { id: 'player' };

    deadline?.arm(player, 1_700_000_000_000, 60_000);
    deadline?.arm(player, 1_700_000_000_000, -5);
    deadline?.disarm(true);

    expect(module.armSleepTimer).toHaveBeenNthCalledWith(1, player, 1_700_000_000_000, 60_000);
    // A negative fade is no fade.
    expect(module.armSleepTimer).toHaveBeenNthCalledWith(2, player, 1_700_000_000_000, 0);
    expect(module.disarmSleepTimer).toHaveBeenCalledWith(true);
  });

  it('arm answers whether the native timer took the deadline', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { module } = createSeslyMediaMock();
    const deadline = getNativeSleepDeadline(asModule(module));

    await expect(deadline?.arm({}, 1, 0)).resolves.toBe(true);
    module.armSleepTimer.mockImplementationOnce(() => Promise.reject(new Error('not a media3 player')));
    await expect(deadline?.arm({}, 1, 0)).resolves.toBe(false);
    module.armSleepTimer.mockImplementationOnce(() => {
      throw new Error('released');
    });
    await expect(deadline?.arm({}, 1, 0)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('forwards the fired event and unsubscribes', () => {
    const { module, emit } = createSeslyMediaMock();
    const deadline = getNativeSleepDeadline(asModule(module));
    const listener = jest.fn();

    const unsubscribe = deadline?.onFired(listener);
    emit('onSleepTimerFired', { paused: true, firedAtMs: 42 });
    expect(listener).toHaveBeenCalledWith({ paused: true, firedAtMs: 42 });

    unsubscribe?.();
    emit('onSleepTimerFired', { paused: false, firedAtMs: 43 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('swallows and logs every failure: thrown, rejected, or in the listener', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { module, emit } = createSeslyMediaMock();
    module.armSleepTimer.mockImplementationOnce(() => {
      throw new Error('not a media3 player');
    });
    module.disarmSleepTimer.mockImplementationOnce(() => Promise.reject(new Error('gone')));
    const deadline = getNativeSleepDeadline(asModule(module));

    expect(() => deadline?.arm({}, 1, 0)).not.toThrow();
    expect(() => deadline?.disarm(false)).not.toThrow();
    await Promise.resolve();

    deadline?.onFired(() => {
      throw new Error('handler broke');
    });
    expect(() => emit('onSleepTimerFired', { paused: true, firedAtMs: 1 })).not.toThrow();

    module.addListener.mockImplementationOnce(() => {
      throw new Error('no events');
    });
    const unsubscribe = deadline?.onFired(jest.fn());
    expect(() => unsubscribe?.()).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});
