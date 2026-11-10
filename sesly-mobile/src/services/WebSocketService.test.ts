const mockIo = jest.fn();
jest.mock('socket.io-client', () => ({
  io: (...args: unknown[]) => mockIo(...args),
}));

const mockGetAccessToken = jest.fn();
const mockOnTokensRefreshed = jest.fn();
const mockRefreshSession = jest.fn();
jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
    onTokensRefreshed: (...args: unknown[]) => mockOnTokensRefreshed(...args),
    refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
  },
}));

const mockRefreshUnreadCount = jest.fn();
const mockPrependNotification = jest.fn();
jest.mock('../hooks/useNotifications', () => ({
  getNotificationsStore: () => ({
    refreshUnreadCount: (...args: unknown[]) => mockRefreshUnreadCount(...args),
    prependNotification: (...args: unknown[]) => mockPrependNotification(...args),
  }),
}));

import { AppState, AppStateStatus } from 'react-native';
import {
  parseVoiceStatusPayload,
  VoiceStatusEvent,
  VoiceStatusListener,
  WebSocketService,
} from './WebSocketService';
import { VoiceProfileStatus } from '../types/enums';
import { API_CONFIG } from '../config/constants';
import { NotificationType } from '../models/Notification';

describe('parseVoiceStatusPayload', () => {
  it('parses READY with voiceProfileId', () => {
    expect(
      parseVoiceStatusPayload({ voiceProfileId: 'v-1', status: 'READY' }),
    ).toEqual({
      voiceProfileId: 'v-1',
      status: VoiceProfileStatus.READY,
      errorMessage: null,
    });
  });

  it('parses the new FAILED payload with errorMessage', () => {
    expect(
      parseVoiceStatusPayload({
        voiceProfileId: 'v-2',
        status: 'FAILED',
        errorMessage: 'Ses kaydı çok kısa.',
      }),
    ).toEqual({
      voiceProfileId: 'v-2',
      status: VoiceProfileStatus.FAILED,
      errorMessage: 'Ses kaydı çok kısa.',
    });
  });

  it('accepts the legacy FAILED payload without an id (reason field)', () => {
    expect(
      parseVoiceStatusPayload({ status: 'FAILED', reason: 'timeout' }),
    ).toEqual({
      voiceProfileId: null,
      status: VoiceProfileStatus.FAILED,
      errorMessage: 'timeout',
    });
  });

  it('rejects non-final payloads without an id and garbage', () => {
    expect(parseVoiceStatusPayload({ status: 'READY' })).toBeNull();
    expect(parseVoiceStatusPayload(null)).toBeNull();
    expect(parseVoiceStatusPayload({ voiceProfileId: 'v-1' })).toBeNull();
  });

  it('accepts the id alias and coerces lower-case / training statuses', () => {
    expect(parseVoiceStatusPayload({ id: 'v-3', status: 'training' })).toEqual({
      voiceProfileId: 'v-3',
      status: VoiceProfileStatus.PROCESSING,
      errorMessage: null,
    });
    expect(parseVoiceStatusPayload({ id: 'v-3', status: 'processing' })?.status).toBe(
      VoiceProfileStatus.PROCESSING,
    );
    expect(parseVoiceStatusPayload({ id: 'v-3', status: 'weird' })?.status).toBe(
      VoiceProfileStatus.PENDING,
    );
    expect(parseVoiceStatusPayload({ id: 'v-3', status: 'PENDING' })?.status).toBe(
      VoiceProfileStatus.PENDING,
    );
  });
});

// ============================================================================
// Service harness
// ============================================================================

type Handler = (...args: unknown[]) => void;

interface FakeSocket {
  id: string;
  connected: boolean;
  on: jest.Mock;
  connect: jest.Mock;
  disconnect: jest.Mock;
  removeAllListeners: jest.Mock;
}

function createFakeSocket(): { socket: FakeSocket; handlers: Record<string, Handler> } {
  const handlers: Record<string, Handler> = {};
  const socket: FakeSocket = {
    id: 'sock-1',
    connected: false,
    on: jest.fn((event: string, cb: Handler) => {
      handlers[event] = cb;
      return socket;
    }),
    connect: jest.fn(() => socket),
    disconnect: jest.fn(() => socket),
    removeAllListeners: jest.fn(() => socket),
  };
  return { socket, handlers };
}

/** Let chained promise callbacks run (fake timers are on globally). */
const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

type ServiceInstance = ReturnType<typeof WebSocketService.getInstance>;

describe('WebSocketService', () => {
  let service: ServiceInstance;
  let fake: ReturnType<typeof createFakeSocket>;
  let appStateHandler: ((next: AppStateStatus) => void) | null;
  let appStateRemove: jest.Mock;
  let tokenListener: ((token: string) => void) | null;
  let tokenUnsubscribe: jest.Mock;

  const fire = (event: string, ...args: unknown[]) => {
    const handler = fake.handlers[event];
    if (!handler) throw new Error(`no handler registered for ${event}`);
    handler(...args);
  };

  const connectService = async () => {
    await service.connect();
    expect(mockIo).toHaveBeenCalled();
  };

  beforeEach(() => {
    // Fresh instance per test: listeners / timers / socket never leak.
    (WebSocketService as unknown as { instance: unknown }).instance = undefined;
    service = WebSocketService.getInstance();

    fake = createFakeSocket();
    mockIo.mockReset();
    mockIo.mockImplementation(() => fake.socket);
    mockGetAccessToken.mockReset();
    mockGetAccessToken.mockResolvedValue('access-1');
    mockRefreshSession.mockReset();
    mockRefreshSession.mockResolvedValue('access-2');
    tokenListener = null;
    tokenUnsubscribe = jest.fn();
    mockOnTokensRefreshed.mockReset();
    mockOnTokensRefreshed.mockImplementation((listener: (token: string) => void) => {
      tokenListener = listener;
      return tokenUnsubscribe;
    });
    mockRefreshUnreadCount.mockReset();
    mockRefreshUnreadCount.mockResolvedValue(undefined);
    mockPrependNotification.mockReset();

    appStateHandler = null;
    appStateRemove = jest.fn();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_type: string, handler: (next: AppStateStatus) => void) => {
        appStateHandler = handler;
        return { remove: appStateRemove };
      }) as unknown as typeof AppState.addEventListener);

    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    service.disconnect();
    jest.clearAllTimers();
  });

  // ==========================================================================
  // connect()
  // ==========================================================================

  describe('connect', () => {
    it('skips entirely without a stored token', async () => {
      mockGetAccessToken.mockResolvedValue(null);

      await service.connect();

      expect(mockIo).not.toHaveBeenCalled();
      expect(AppState.addEventListener).not.toHaveBeenCalled();
      expect(mockOnTokensRefreshed).not.toHaveBeenCalled();
      expect(service.isConnected()).toBe(false);
    });

    it('connects to the /notifications namespace over websocket only', async () => {
      await service.connect();

      expect(mockIo).toHaveBeenCalledTimes(1);
      const [url, options] = mockIo.mock.calls[0];
      expect(url).toBe(`${API_CONFIG.WEBSOCKET_URL}/notifications`);
      expect(options).toMatchObject({
        transports: ['websocket'],
        reconnection: true,
        autoConnect: true,
      });
      expect(typeof options.auth).toBe('function');
    });

    it('reads the latest token for every handshake via the auth callback', async () => {
      await service.connect();
      const auth = mockIo.mock.calls[0][1].auth as (cb: (data: object) => void) => void;

      const first = jest.fn();
      mockGetAccessToken.mockResolvedValue('access-2');
      auth(first);
      await flush();
      expect(first).toHaveBeenCalledWith({ token: 'access-2' });

      const second = jest.fn();
      mockGetAccessToken.mockResolvedValue('access-3');
      auth(second);
      await flush();
      expect(second).toHaveBeenCalledWith({ token: 'access-3' });
    });

    it('sends an empty token when the token is gone or storage fails', async () => {
      await service.connect();
      const auth = mockIo.mock.calls[0][1].auth as (cb: (data: object) => void) => void;

      const noToken = jest.fn();
      mockGetAccessToken.mockResolvedValue(null);
      auth(noToken);
      await flush();
      expect(noToken).toHaveBeenCalledWith({ token: '' });

      const failed = jest.fn();
      mockGetAccessToken.mockRejectedValue(new Error('keystore locked'));
      auth(failed);
      await flush();
      expect(failed).toHaveBeenCalledWith({ token: '' });
    });

    it('reuses a disconnected socket instead of creating a new one', async () => {
      await connectService();
      fake.socket.connected = false;

      await service.connect();

      expect(mockIo).toHaveBeenCalledTimes(1);
      expect(fake.socket.connect).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the existing socket is already connected', async () => {
      await connectService();
      fake.socket.connected = true;

      await service.connect();

      expect(mockIo).toHaveBeenCalledTimes(1);
      expect(fake.socket.connect).not.toHaveBeenCalled();
      expect(service.isConnected()).toBe(true);
    });

    it('attaches the AppState and token-refresh hooks only once', async () => {
      await connectService();
      await service.connect();
      await service.connect();

      expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
      expect(AppState.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockOnTokensRefreshed).toHaveBeenCalledTimes(1);
    });

    it('logs connection lifecycle events without side effects', async () => {
      await connectService();
      fire('connect');
      fire('connect_error', new Error('jwt expired'));
      fire('connect_error', 'plain string');
      fire('reconnect_attempt', 2);
      expect(mockRefreshSession).not.toHaveBeenCalled();
      expect(fake.socket.connect).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // ensureConnected / AppState / token refresh
  // ==========================================================================

  describe('ensureConnected and lifecycle hooks', () => {
    it('ensureConnected is a no-op without a socket', () => {
      expect(() => service.ensureConnected()).not.toThrow();
    });

    it('AppState active reconnects a dropped socket, other states do not', async () => {
      await connectService();
      expect(appStateHandler).not.toBeNull();

      fake.socket.connected = false;
      appStateHandler!('background');
      appStateHandler!('inactive');
      expect(fake.socket.connect).not.toHaveBeenCalled();

      appStateHandler!('active');
      expect(fake.socket.connect).toHaveBeenCalledTimes(1);

      fake.socket.connected = true;
      appStateHandler!('active');
      expect(fake.socket.connect).toHaveBeenCalledTimes(1);
    });

    it('onTokensRefreshed reconnects a dropped socket', async () => {
      await connectService();
      expect(tokenListener).not.toBeNull();
      fake.socket.connected = false;

      tokenListener!('access-9');

      expect(fake.socket.connect).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // Server-initiated disconnect recovery
  // ==========================================================================

  describe('server disconnect recovery', () => {
    it('refreshes the session after 1s and reconnects with the new token', async () => {
      await connectService();

      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(999);
      expect(mockRefreshSession).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1);
      await flush();
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      expect(fake.socket.connect).toHaveBeenCalledTimes(1);
    });

    it('does not reconnect when the refresh yields no token', async () => {
      mockRefreshSession.mockResolvedValue(null);
      await connectService();

      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(1000);
      await flush();

      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      expect(fake.socket.connect).not.toHaveBeenCalled();
    });

    it.each(['transport close', 'ping timeout', 'io client disconnect', 'transport error'])(
      'ignores the "%s" reason (socket.io retries those itself)',
      async reason => {
        await connectService();
        fire('disconnect', reason);
        await jest.advanceTimersByTimeAsync(20_000);
        expect(mockRefreshSession).not.toHaveBeenCalled();
        expect(fake.socket.connect).not.toHaveBeenCalled();
      },
    );

    it('backs off 1s, 3s, 8s and stops after 3 retries inside 60s', async () => {
      await connectService();

      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(1000);
      await flush();
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);

      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(2999);
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      await flush();
      expect(mockRefreshSession).toHaveBeenCalledTimes(2);

      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(7999);
      expect(mockRefreshSession).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1);
      await flush();
      expect(mockRefreshSession).toHaveBeenCalledTimes(3);

      // Fourth server disconnect inside the window: give up for now.
      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(30_000);
      await flush();
      expect(mockRefreshSession).toHaveBeenCalledTimes(3);
      expect(fake.socket.connect).toHaveBeenCalledTimes(3);
    });

    it('allows retries again once old attempts leave the 60s window', async () => {
      await connectService();
      for (const wait of [1000, 3000, 8000]) {
        fire('disconnect', 'io server disconnect');
        await jest.advanceTimersByTimeAsync(wait);
        await flush();
      }
      expect(mockRefreshSession).toHaveBeenCalledTimes(3);

      await jest.advanceTimersByTimeAsync(61_000);
      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(1000);
      await flush();
      expect(mockRefreshSession).toHaveBeenCalledTimes(4);
    });

    it('onTokensRefreshed resets the retry counter', async () => {
      await connectService();
      for (const wait of [1000, 3000, 8000]) {
        fire('disconnect', 'io server disconnect');
        await jest.advanceTimersByTimeAsync(wait);
        await flush();
      }
      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(10_000);
      expect(mockRefreshSession).toHaveBeenCalledTimes(3);

      fake.socket.connected = false;
      fake.socket.connect.mockClear();
      tokenListener!('access-new');
      expect(fake.socket.connect).toHaveBeenCalledTimes(1);

      // Counter reset: the first backoff step (1s) applies again.
      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(1000);
      await flush();
      expect(mockRefreshSession).toHaveBeenCalledTimes(4);
    });

    it('drops the pending reconnect when the service is torn down meanwhile', async () => {
      await connectService();
      fire('disconnect', 'io server disconnect');

      service.disconnect();
      await jest.advanceTimersByTimeAsync(5000);
      await flush();

      expect(mockRefreshSession).not.toHaveBeenCalled();
      expect(fake.socket.connect).not.toHaveBeenCalled();
    });

    it('does not reconnect a socket that was replaced while refreshing', async () => {
      let resolveRefresh: (token: string | null) => void = () => {};
      mockRefreshSession.mockImplementation(
        () =>
          new Promise<string | null>(resolve => {
            resolveRefresh = resolve;
          }),
      );
      await connectService();
      const firstSocket = fake.socket;

      fire('disconnect', 'io server disconnect');
      await jest.advanceTimersByTimeAsync(1000);
      expect(mockRefreshSession).toHaveBeenCalledTimes(1);

      // User signs out / in again while the refresh is in flight.
      service.disconnect();
      fake = createFakeSocket();
      mockIo.mockImplementation(() => fake.socket);
      await service.connect();

      resolveRefresh('access-2');
      await flush();

      expect(firstSocket.connect).not.toHaveBeenCalled();
      expect(fake.socket.connect).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // disconnect()
  // ==========================================================================

  describe('disconnect', () => {
    it('tears down the socket and every lifecycle subscription', async () => {
      await connectService();
      fake.socket.connected = true;

      service.disconnect();

      expect(fake.socket.removeAllListeners).toHaveBeenCalledTimes(1);
      expect(fake.socket.disconnect).toHaveBeenCalledTimes(1);
      expect(appStateRemove).toHaveBeenCalledTimes(1);
      expect(tokenUnsubscribe).toHaveBeenCalledTimes(1);
      expect(service.isConnected()).toBe(false);
    });

    it('creates a fresh socket and re-attaches hooks on the next connect', async () => {
      await connectService();
      service.disconnect();

      await service.connect();

      expect(mockIo).toHaveBeenCalledTimes(2);
      expect(AppState.addEventListener).toHaveBeenCalledTimes(2);
      expect(mockOnTokensRefreshed).toHaveBeenCalledTimes(2);
    });

    it('is safe without a socket and survives a throwing socket', async () => {
      expect(() => service.disconnect()).not.toThrow();

      await connectService();
      fake.socket.disconnect.mockImplementation(() => {
        throw new Error('already closed');
      });
      expect(() => service.disconnect()).not.toThrow();
      expect(service.isConnected()).toBe(false);
    });
  });

  // ==========================================================================
  // voice_status routing
  // ==========================================================================

  describe('voice_status events', () => {
    const makeListener = (): VoiceStatusListener & { applyRealtimeVoiceStatus: jest.Mock } => ({
      applyRealtimeVoiceStatus: jest.fn(),
    });

    it('forwards the parsed event to every registered listener', async () => {
      const a = makeListener();
      const b = makeListener();
      service.addVoiceStatusListener(a);
      service.addVoiceStatusListener(b);
      await connectService();

      fire('voice_status', { voiceProfileId: 'vp-1', status: 'READY' });

      const expected: VoiceStatusEvent = {
        voiceProfileId: 'vp-1',
        status: VoiceProfileStatus.READY,
        errorMessage: null,
      };
      expect(a.applyRealtimeVoiceStatus).toHaveBeenCalledWith(expected);
      expect(b.applyRealtimeVoiceStatus).toHaveBeenCalledWith(expected);
    });

    it('passes the FAILED errorMessage through', async () => {
      const a = makeListener();
      service.addVoiceStatusListener(a);
      await connectService();

      fire('voice_status', {
        voiceProfileId: 'vp-1',
        status: 'FAILED',
        errorMessage: 'Ses hazirlanirken bir sorun olustu.',
      });

      expect(a.applyRealtimeVoiceStatus).toHaveBeenCalledWith({
        voiceProfileId: 'vp-1',
        status: VoiceProfileStatus.FAILED,
        errorMessage: 'Ses hazirlanirken bir sorun olustu.',
      });
    });

    it('stops delivering after unsubscribe', async () => {
      const a = makeListener();
      const unsubscribe = service.addVoiceStatusListener(a);
      await connectService();

      unsubscribe();
      fire('voice_status', { voiceProfileId: 'vp-1', status: 'READY' });

      expect(a.applyRealtimeVoiceStatus).not.toHaveBeenCalled();
    });

    it('a throwing listener does not block the others', async () => {
      const broken = makeListener();
      broken.applyRealtimeVoiceStatus.mockImplementation(() => {
        throw new Error('store disposed');
      });
      const healthy = makeListener();
      service.addVoiceStatusListener(broken);
      service.addVoiceStatusListener(healthy);
      await connectService();

      expect(() =>
        fire('voice_status', { voiceProfileId: 'vp-1', status: 'READY' }),
      ).not.toThrow();
      expect(healthy.applyRealtimeVoiceStatus).toHaveBeenCalledTimes(1);
    });

    it('legacy FAILED without an id calls the fallback, not the listeners', async () => {
      const a = makeListener();
      const fallback = jest.fn();
      service.addVoiceStatusListener(a);
      service.setVoiceStatusFallback(fallback);
      await connectService();

      fire('voice_status', { status: 'FAILED', reason: 'timeout' });

      expect(fallback).toHaveBeenCalledTimes(1);
      expect(a.applyRealtimeVoiceStatus).not.toHaveBeenCalled();
    });

    it('survives a throwing fallback and a cleared fallback', async () => {
      service.setVoiceStatusFallback(() => {
        throw new Error('reload failed');
      });
      await connectService();
      expect(() => fire('voice_status', { status: 'FAILED' })).not.toThrow();

      service.setVoiceStatusFallback(null);
      expect(() => fire('voice_status', { status: 'FAILED' })).not.toThrow();
    });

    it('ignores unparseable payloads', async () => {
      const a = makeListener();
      const fallback = jest.fn();
      service.addVoiceStatusListener(a);
      service.setVoiceStatusFallback(fallback);
      await connectService();

      fire('voice_status', null);
      fire('voice_status', 'READY');
      fire('voice_status', { status: 'READY' });
      fire('voice_status', { voiceProfileId: 'vp-1' });

      expect(a.applyRealtimeVoiceStatus).not.toHaveBeenCalled();
      expect(fallback).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // narration_status routing
  // ==========================================================================

  describe('narration_status events', () => {
    /** The store's generation part, next to a story that plays: A plays, nar-1 is generated. */
    const makeStore = (generatingNarrationId: string | null = 'nar-1') => ({
      audioId: 'nar-playing',
      currentStory: { id: 's-playing', title: 'Uykulu Ay' },
      generatingNarrationId,
      isGenerating: true,
      generationProgress: 0,
      generationReadyId: null as string | null,
    });

    it('a status of the generating narration moves its progress while another story is loaded', async () => {
      const store = makeStore();
      service.registerAudioPlayerStore(store);
      await connectService();

      fire('narration_status', { narrationId: 'nar-1', status: 'GENERATING', progress: 45 });

      expect(store.generationProgress).toBe(45);
      expect(store.isGenerating).toBe(true);
      // The playing story is never touched.
      expect(store.audioId).toBe('nar-playing');
      expect(store.currentStory).toEqual({ id: 's-playing', title: 'Uykulu Ay' });
      expect(store).not.toHaveProperty('generationStatus');
    });

    it('progress never goes backwards within a job: 65 then 60 keeps 65', async () => {
      const store = makeStore();
      service.registerAudioPlayerStore(store);
      await connectService();

      fire('narration_status', { narrationId: 'nar-1', status: 'GENERATING', progress: 65 });
      fire('narration_status', { narrationId: 'nar-1', status: 'GENERATING', progress: 60 });

      expect(store.generationProgress).toBe(65);
    });

    it('READY completes the job and names it ready, without loading anything', async () => {
      const store = makeStore();
      service.registerAudioPlayerStore(store);
      await connectService();

      fire('narration_status', { status: 'READY', narrationId: 'nar-1', storyId: 's-1' });

      expect(store.generationProgress).toBe(100);
      expect(store.isGenerating).toBe(false);
      expect(store.generationReadyId).toBe('nar-1');
      expect(store.audioId).toBe('nar-playing');
    });

    it('READY with a lower progress still completes the bar', async () => {
      const store = makeStore();
      service.registerAudioPlayerStore(store);
      await connectService();

      fire('narration_status', { narrationId: 'nar-1', status: 'ready', progress: 95 });

      expect(store.generationProgress).toBe(100);
      expect(store.generationReadyId).toBe('nar-1');
    });

    it('accepts the id alias for the narration id', async () => {
      const store = makeStore();
      service.registerAudioPlayerStore(store);
      await connectService();

      fire('narration_status', { id: 'nar-1', status: 'GENERATING', progress: 45 });

      expect(store.generationProgress).toBe(45);
    });

    it('FAILED without progress does not fake a completion', async () => {
      const store = makeStore();
      service.registerAudioPlayerStore(store);
      await connectService();

      fire('narration_status', {
        status: 'FAILED',
        narrationId: 'nar-1',
        storyId: 's-1',
        errorMessage: 'Masal hazirlanamadi.',
      });

      expect(store.generationProgress).toBe(0);
      expect(store.generationReadyId).toBeNull();
    });

    it('ignores events for another narration, the playing one included, and when no job runs', async () => {
      const store = makeStore('nar-1');
      service.registerAudioPlayerStore(store);
      await connectService();

      fire('narration_status', { narrationId: 'nar-2', status: 'READY' });
      fire('narration_status', { narrationId: 'nar-playing', status: 'GENERATING', progress: 80 });

      expect(store.generationProgress).toBe(0);
      expect(store.generationReadyId).toBeNull();

      const idle = makeStore(null);
      service.registerAudioPlayerStore(idle);
      fire('narration_status', { narrationId: 'nar-1', status: 'READY' });
      expect(idle.generationReadyId).toBeNull();
    });

    it('ignores payloads without an id or status, and non-objects', async () => {
      const store = makeStore();
      const listener = jest.fn();
      service.registerAudioPlayerStore(store);
      service.addNarrationStatusListener(listener);
      await connectService();

      fire('narration_status', { status: 'READY' });
      fire('narration_status', { narrationId: 'nar-1' });
      fire('narration_status', { narrationId: 'nar-1', status: 42 });
      fire('narration_status', null);
      fire('narration_status', 'READY');

      expect(store.generationProgress).toBe(0);
      expect(listener).not.toHaveBeenCalled();
    });

    it('listeners hear every narration (READY of any narration), before the generation filter', async () => {
      const store = makeStore('nar-1');
      const heard = jest.fn();
      const failing = jest.fn(() => {
        throw new Error('listener bug');
      });
      service.registerAudioPlayerStore(store);
      service.addNarrationStatusListener(failing);
      const unsubscribe = service.addNarrationStatusListener(heard);
      await connectService();

      fire('narration_status', { narrationId: 'nar-7', status: 'ready' });
      fire('narration_status', { id: 'nar-1', status: 'GENERATING', progress: 30 });

      expect(heard).toHaveBeenNthCalledWith(1, {
        narrationId: 'nar-7',
        status: 'READY',
        progress: undefined,
      });
      expect(heard).toHaveBeenNthCalledWith(2, {
        narrationId: 'nar-1',
        status: 'GENERATING',
        progress: 30,
      });
      // A throwing listener stops neither the others nor the store update.
      expect(failing).toHaveBeenCalledTimes(2);
      expect(store.generationProgress).toBe(30);

      unsubscribe();
      fire('narration_status', { narrationId: 'nar-8', status: 'READY' });
      expect(heard).toHaveBeenCalledTimes(2);
    });

    it('does nothing to a store when none is registered, and still tells the listeners', async () => {
      const heard = jest.fn();
      service.addNarrationStatusListener(heard);
      await connectService();
      expect(() =>
        fire('narration_status', { narrationId: 'nar-1', status: 'READY' }),
      ).not.toThrow();
      expect(heard).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // notification routing
  // ==========================================================================

  describe('notification events', () => {
    const backendNotification = {
      id: 'ntf-1',
      type: 'NARRATION_READY',
      title: 'Masalın hazır',
      body: '"Kırmızı Başlıklı Kız" masalını şimdi dinleyebilirsin.',
      data: { type: 'NARRATION_READY', narrationId: 'nar-1', storyId: 's-1' },
      read: false,
      createdAt: '2026-09-27T20:00:00.000Z',
    };

    it('refreshes the unread count and prepends the parsed notification', async () => {
      await connectService();

      fire('notification', backendNotification);

      expect(mockRefreshUnreadCount).toHaveBeenCalledTimes(1);
      expect(mockPrependNotification).toHaveBeenCalledTimes(1);
      expect(mockPrependNotification.mock.calls[0][0]).toMatchObject({
        id: 'ntf-1',
        type: NotificationType.NARRATION_READY,
        title: 'Masalın hazır',
        read: false,
        data: { type: 'NARRATION_READY', narrationId: 'nar-1', storyId: 's-1' },
      });
      expect(mockPrependNotification.mock.calls[0][0].createdAt).toEqual(
        new Date('2026-09-27T20:00:00.000Z'),
      );
    });

    it('a malformed payload still refreshes the count but is not prepended', async () => {
      await connectService();

      fire('notification', { title: 'no id', createdAt: '2026-09-27T20:00:00.000Z' });
      fire('notification', 'garbage');
      fire('notification', null);

      expect(mockRefreshUnreadCount).toHaveBeenCalledTimes(3);
      expect(mockPrependNotification).not.toHaveBeenCalled();
    });

    it('swallows a failing unread-count refresh', async () => {
      mockRefreshUnreadCount.mockRejectedValue(new Error('offline'));
      await connectService();

      fire('notification', backendNotification);
      await flush();

      expect(mockPrependNotification).toHaveBeenCalledTimes(1);
      expect(console.warn).toHaveBeenCalledWith(
        '[WebSocket] refreshUnreadCount failed:',
        expect.any(Error),
      );
    });
  });
});
