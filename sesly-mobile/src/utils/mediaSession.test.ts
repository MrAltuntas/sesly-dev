/**
 * Remote commands of the Android media session (utils/mediaSession.ts):
 * routing to the store, the native event subscriptions, the platform gate.
 */

const mockSeslyMedia = {
  activate: jest.fn(),
  updateMetadata: jest.fn(),
  deactivate: jest.fn(),
  isActive: jest.fn(() => false),
  addListener: jest.fn(),
};

jest.mock('../../modules/sesly-media', () => ({
  __esModule: true,
  get default() {
    return mockSeslyMedia;
  },
}));

import { Platform } from 'react-native';
import {
  MEDIA_SESSION_OPTIONS,
  MEDIA_SESSION_SKIP_SECONDS,
  bindMediaSessionCommands,
  getAndroidMediaSession,
  routeMediaSessionCommand,
  type MediaSessionCommandTarget,
  type SeslyMediaModule,
} from './mediaSession';

function makeTarget(): jest.Mocked<MediaSessionCommandTarget> {
  return {
    remotePlay: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined),
    seek: jest.fn(async (_seconds: number) => undefined),
    skipBackward: jest.fn(async (_seconds?: number) => undefined),
    skipForward: jest.fn(async (_seconds?: number) => undefined),
    releaseLockScreen: jest.fn(),
  };
}

type Listener = (event?: unknown) => void;

function makeModule() {
  const listeners = new Map<string, Listener[]>();
  const removed: string[] = [];
  const module = {
    activate: jest.fn(async () => undefined),
    updateMetadata: jest.fn(async () => undefined),
    deactivate: jest.fn(async () => undefined),
    isActive: jest.fn(() => false),
    addListener: jest.fn((event: string, listener: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return {
        remove: () => {
          removed.push(event);
          listeners.set(event, (listeners.get(event) ?? []).filter(l => l !== listener));
        },
      };
    }),
  };
  const emit = (event: string, body?: unknown) => (listeners.get(event) ?? []).forEach(l => l(body));
  return { module: module as unknown as SeslyMediaModule, raw: module, emit, removed };
}

describe('routeMediaSessionCommand', () => {
  it('play and pause run the store methods', () => {
    const target = makeTarget();

    routeMediaSessionCommand(target, { command: 'play' });
    routeMediaSessionCommand(target, { command: 'pause' });

    expect(target.remotePlay).toHaveBeenCalledTimes(1);
    expect(target.pause).toHaveBeenCalledTimes(1);
  });

  it('seekTo converts milliseconds to seconds and ignores a missing position', () => {
    const target = makeTarget();

    routeMediaSessionCommand(target, { command: 'seekTo', positionMs: 42_500 });
    routeMediaSessionCommand(target, { command: 'seekTo' });
    routeMediaSessionCommand(target, { command: 'seekTo', positionMs: Number.NaN });
    routeMediaSessionCommand(target, { command: 'seekTo', positionMs: -100 });

    expect(target.seek).toHaveBeenCalledTimes(2);
    expect(target.seek).toHaveBeenNthCalledWith(1, 42.5);
    expect(target.seek).toHaveBeenNthCalledWith(2, 0);
  });

  it('skips by the interval the session sends, 15 s without one', () => {
    const target = makeTarget();

    routeMediaSessionCommand(target, { command: 'skipForward', intervalMs: 15_000 });
    routeMediaSessionCommand(target, { command: 'skipBackward', intervalMs: 30_000 });
    routeMediaSessionCommand(target, { command: 'skipForward' });

    expect(target.skipForward).toHaveBeenNthCalledWith(1, 15);
    expect(target.skipBackward).toHaveBeenCalledWith(30);
    expect(target.skipForward).toHaveBeenNthCalledWith(2, MEDIA_SESSION_SKIP_SECONDS);
    expect(MEDIA_SESSION_SKIP_SECONDS).toBe(15);
    expect(MEDIA_SESSION_OPTIONS).toEqual({ skipBackwardMs: 15_000, skipForwardMs: 15_000 });
  });

  it('an interval of 0, below 0 or not a number falls back to 15 s (never a skip that stays put)', () => {
    const target = makeTarget();

    routeMediaSessionCommand(target, { command: 'skipForward', intervalMs: 0 });
    routeMediaSessionCommand(target, { command: 'skipBackward', intervalMs: -1 });
    routeMediaSessionCommand(target, { command: 'skipForward', intervalMs: Number.NaN });
    routeMediaSessionCommand(target, { command: 'skipBackward', intervalMs: Number.POSITIVE_INFINITY });

    expect(target.skipForward.mock.calls).toEqual([[15], [15]]);
    expect(target.skipBackward.mock.calls).toEqual([[15], [15]]);
  });

  it('stop pauses and takes the story off the lock screen', () => {
    const target = makeTarget();

    routeMediaSessionCommand(target, { command: 'stop' });

    expect(target.pause).toHaveBeenCalledTimes(1);
    expect(target.releaseLockScreen).toHaveBeenCalledTimes(1);
  });

  it('ignores unknown commands', () => {
    const target = makeTarget();

    routeMediaSessionCommand(target, { command: 'next' as never });

    Object.values(target).forEach(fn => expect(fn).not.toHaveBeenCalled());
  });

  it('a failing store method is logged, never thrown', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const target = makeTarget();
    target.pause.mockRejectedValueOnce(new Error('player gone'));
    target.remotePlay.mockImplementationOnce(() => {
      throw new Error('sync failure');
    });

    expect(() => routeMediaSessionCommand(target, { command: 'pause' })).not.toThrow();
    expect(() => routeMediaSessionCommand(target, { command: 'play' })).not.toThrow();
    await Promise.resolve();

    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('bindMediaSessionCommands', () => {
  it('routes commands, pauses on becoming noisy and releases on a session end', () => {
    const { module, emit } = makeModule();
    const target = makeTarget();

    bindMediaSessionCommands(target, module);
    emit('onCommand', { command: 'skipForward', intervalMs: 15_000 });
    emit('onBecomingNoisy');
    emit('onSessionEnded', { reason: 'serviceStopped' });

    expect(target.skipForward).toHaveBeenCalledWith(15);
    expect(target.pause).toHaveBeenCalledTimes(1);
    expect(target.releaseLockScreen).toHaveBeenCalledTimes(1);
  });

  it('the returned function removes every subscription', () => {
    const { module, emit, removed } = makeModule();
    const target = makeTarget();

    const unbind = bindMediaSessionCommands(target, module);
    unbind();
    emit('onCommand', { command: 'pause' });

    expect(removed.sort()).toEqual(['onBecomingNoisy', 'onCommand', 'onSessionEnded']);
    expect(target.pause).not.toHaveBeenCalled();
  });

  it('is a no-op without a native session', () => {
    const target = makeTarget();

    const unbind = bindMediaSessionCommands(target, null);

    expect(() => unbind()).not.toThrow();
  });
});

describe('getAndroidMediaSession', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('is the native module on Android only', () => {
    Platform.OS = 'android';
    expect(getAndroidMediaSession()).toBe(mockSeslyMedia);

    Platform.OS = 'ios';
    expect(getAndroidMediaSession()).toBeNull();
  });
});
