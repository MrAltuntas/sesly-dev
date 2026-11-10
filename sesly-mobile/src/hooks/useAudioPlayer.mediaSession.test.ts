/**
 * AudioPlayerStore on Android: the lock screen is the Sesly media session
 * (modules/sesly-media, mocked here as a small event emitter) and its remote
 * commands drive the store. Premium gating is the same as on iOS
 * (useAudioPlayer.test.ts); this suite covers what is Android-only.
 */

const mockCreateAudioPlayer = jest.fn();
const mockGetBaseURL = jest.fn(() => 'https://api.sesly.test/api/v1');
const mockGetAccessToken = jest.fn(async () => 'jwt');
const mockListeners = new Map<string, Array<(event?: unknown) => void>>();
const mockSession = {
  activate: jest.fn(async (..._args: unknown[]) => undefined),
  updateMetadata: jest.fn(async (..._args: unknown[]) => undefined),
  deactivate: jest.fn(async () => undefined),
  isActive: jest.fn(() => false),
  addListener: jest.fn((event: string, listener: (event?: unknown) => void) => {
    mockListeners.set(event, [...(mockListeners.get(event) ?? []), listener]);
    return {
      remove: () =>
        mockListeners.set(
          event,
          (mockListeners.get(event) ?? []).filter(l => l !== listener),
        ),
    };
  }),
};

jest.mock('../../modules/sesly-media', () => ({
  __esModule: true,
  get default() {
    return mockSession;
  },
}));
jest.mock('expo-audio', () => ({
  __esModule: true,
  createAudioPlayer: (...a: unknown[]) => mockCreateAudioPlayer(...a),
  setAudioModeAsync: jest.fn(async () => undefined),
}));
jest.mock('../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getBaseURL: () => mockGetBaseURL(),
    getAccessToken: () => mockGetAccessToken(),
    getFreshAccessToken: () => mockGetAccessToken(),
    get: jest.fn(() => new Promise(() => {})),
    post: jest.fn(),
  },
}));
jest.mock('../services/WebSocketService', () => ({
  __esModule: true,
  default: { registerAudioPlayerStore: jest.fn() },
}));
jest.mock('../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    getCachedSync: jest.fn(() => null),
    get: jest.fn(() => new Promise(() => {})),
    update: jest.fn(async () => ({})),
  },
}));
jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AudioPlayerStore } from './useAudioPlayer';
import { getSubscriptionStore } from './useSubscription';
import { parseStoryNarrationFromJSON, type StoryNarration } from '../models/Narration';
import { mockNarrationJSON, mockStoryJSON } from '../test-utils/mock-data';
import { resetNarrationDurationsForTests } from '../utils/narrationDurations';

type StatusListener = (status: Record<string, unknown>) => void;

class FakeAudioPlayer {
  playing = false;
  currentTime = 0;
  volume = 1;
  isLoaded = true;
  isBuffering = false;
  shouldCorrectPitch = false;
  statusListener: StatusListener | null = null;
  replace = jest.fn();
  play = jest.fn();
  pause = jest.fn();
  seekTo = jest.fn(async (_seconds: number) => undefined);
  setPlaybackRate = jest.fn();
  remove = jest.fn();
  release = jest.fn();
  setActiveForLockScreen = jest.fn();
  updateLockScreenMetadata = jest.fn();
  addListener = jest.fn((event: string, listener: StatusListener) => {
    if (event === 'playbackStatusUpdate') this.statusListener = listener;
    return { remove: jest.fn() };
  });

  emit(status: Record<string, unknown>): void {
    this.statusListener?.({ currentTime: 0, duration: 0, playing: false, didJustFinish: false, ...status });
  }
}

const narrationA: StoryNarration = parseStoryNarrationFromJSON({
  ...mockNarrationJSON,
  id: 'narr-a',
  totalDuration: 300,
});
const narrationB: StoryNarration = parseStoryNarrationFromJSON({
  ...mockNarrationJSON,
  id: 'narr-b',
  totalDuration: 120,
  story: { ...mockStoryJSON, id: 'story-b', title: 'Deniz Feneri', coverImageUrl: null },
});

const stores: AudioPlayerStore[] = [];
const originalOS = Platform.OS;

function emitNative(event: string, body?: unknown): void {
  (mockListeners.get(event) ?? []).forEach(listener => listener(body));
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

async function createStore(): Promise<{ store: AudioPlayerStore; player: FakeAudioPlayer }> {
  const store = new AudioPlayerStore();
  stores.push(store);
  await store.setupPlayer();
  const player = (store as unknown as { player: FakeAudioPlayer }).player;
  return { store, player };
}

function setPro(isPro: boolean): void {
  getSubscriptionStore().setTierFromUser(isPro ? 'PRO' : 'FREE');
}

/**
 * A Pro user with narration A loaded and playing on the lock screen. The
 * pause the load made before its replace is forgotten.
 */
async function playingStory() {
  setPro(true);
  const created = await createStore();
  await created.store.startNarration({ narration: narrationA });
  await created.store.play();
  created.player.emit({ currentTime: 60, duration: 300, playing: true });
  created.player.currentTime = 60;
  created.player.pause.mockClear();
  return created;
}

beforeAll(() => {
  Platform.OS = 'android';
});

afterAll(() => {
  Platform.OS = originalOS;
});

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  mockListeners.clear();
  [mockSession.activate, mockSession.updateMetadata, mockSession.deactivate].forEach(fn =>
    fn.mockClear(),
  );
  mockSession.activate.mockImplementation(async () => undefined);
  mockCreateAudioPlayer.mockReset().mockImplementation(() => new FakeAudioPlayer());
  setPro(false);
  resetNarrationDurationsForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  while (stores.length) stores.pop()!.dispose();
  jest.clearAllTimers();
});

describe('Android lock screen (media session)', () => {
  it('a Pro story play activates the media session with title, narrator, cover and 15 s skips', async () => {
    const { player } = await playingStory();

    expect(mockSession.activate).toHaveBeenCalledTimes(1);
    const [boundPlayer, metadata, options] = mockSession.activate.mock.calls[0];
    expect(boundPlayer).toBe(player);
    expect(metadata).toEqual(
      expect.objectContaining({
        title: 'Küçük Tavşan ile Havuç Macerası',
        artist: 'Babamın Sesi',
        albumTitle: 'Sesly',
        artworkUrl: 'https://images.sesly.io/covers/story-123.jpg',
      }),
    );
    expect(options).toEqual({ skipBackwardMs: 15_000, skipForwardMs: 15_000 });
    // expo-audio's own lock screen is not used on Android.
    expect(player.setActiveForLockScreen).not.toHaveBeenCalled();
  });

  it('the next story updates the session metadata at once', async () => {
    const { store } = await playingStory();

    await store.startNarration({ narration: narrationB });

    expect(mockSession.updateMetadata).toHaveBeenCalledTimes(1);
    expect(mockSession.updateMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Deniz Feneri', artworkUrl: null }),
    );
    expect(mockSession.activate).toHaveBeenCalledTimes(1);
  });

  it('free users never get the media session', async () => {
    const { store } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.play();

    expect(mockSession.activate).not.toHaveBeenCalled();
  });

  it('a preview and stop take the story off the lock screen', async () => {
    const { store } = await playingStory();

    await store.playFromUrl('https://storage.googleapis.com/sesly/sample.mp3');
    expect(mockSession.deactivate).toHaveBeenCalledTimes(1);

    await store.stopAndCleanup();
    expect(mockSession.deactivate).toHaveBeenCalledTimes(1);
  });
});

describe('Android remote commands', () => {
  it('pause and play from the lock screen run the store', async () => {
    const { store, player } = await playingStory();

    emitNative('onCommand', { command: 'pause' });
    await flush();
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(false);
    // The position is saved right away, like a pause in the app.
    expect(await AsyncStorage.getItem('narration_position:narr-a')).toBe('60000');

    emitNative('onCommand', { command: 'play' });
    await flush();
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(store.isPlaying).toBe(true);
  });

  it('the seek bar and the skip buttons seek the player', async () => {
    const { player } = await playingStory();

    emitNative('onCommand', { command: 'seekTo', positionMs: 125_000 });
    await flush();
    expect(player.seekTo).toHaveBeenLastCalledWith(125);

    emitNative('onCommand', { command: 'skipForward', intervalMs: 15_000 });
    await flush();
    expect(player.seekTo).toHaveBeenLastCalledWith(75);

    emitNative('onCommand', { command: 'skipBackward', intervalMs: 15_000 });
    await flush();
    expect(player.seekTo).toHaveBeenLastCalledWith(45);
  });

  it('a skip back from the lock screen past the stream token deadline reloads the stream at the target', async () => {
    const { store, player } = await playingStory();
    expect(player.replace).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 51 * 60 * 1000);

    emitNative('onCommand', { command: 'skipBackward', intervalMs: 15_000 });
    await flush();

    // A new stream (fresh header) at 0:45 instead of a seek the old one would refuse.
    expect(player.replace).toHaveBeenCalledTimes(2);
    expect(player.seekTo).toHaveBeenLastCalledWith(45);
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(store.currentPositionMs).toBe(45_000);
    expect(store.isPlaying).toBe(true);
  });

  it('play on a finished story starts it over', async () => {
    const { store, player } = await playingStory();
    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
    expect(store.storyEnded).toBe(true);

    emitNative('onCommand', { command: 'play' });
    await flush();

    expect(player.seekTo).toHaveBeenLastCalledWith(0);
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(store.storyEnded).toBe(false);
  });

  it('stop (a dismissed notification) pauses and releases the session; the next play brings it back', async () => {
    const { store, player } = await playingStory();

    emitNative('onCommand', { command: 'stop' });
    await flush();
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(mockSession.deactivate).toHaveBeenCalledTimes(1);

    await store.play();
    expect(mockSession.activate).toHaveBeenCalledTimes(2);
  });

  it('a session the system ended is activated again by the next play', async () => {
    const { store } = await playingStory();

    emitNative('onSessionEnded', { reason: 'serviceStopped' });
    await store.play();

    expect(mockSession.activate).toHaveBeenCalledTimes(2);
  });

  it('playback that resumes outside the store puts the story back on the lock screen', async () => {
    const { player } = await playingStory();
    emitNative('onCommand', { command: 'stop' });
    await flush();
    player.emit({ currentTime: 60, duration: 300, playing: false });

    // A headset key through another session, or audio focus coming back.
    player.emit({ currentTime: 61, duration: 300, playing: true });

    expect(mockSession.activate).toHaveBeenCalledTimes(2);
  });

  it('unplugged headphones pause, for free users too', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.play();
    player.pause.mockClear();

    emitNative('onBecomingNoisy');
    await flush();

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(false);
  });

  it('dispose stops listening to the session', async () => {
    const { store, player } = await playingStory();

    store.dispose();
    stores.splice(stores.indexOf(store), 1);
    emitNative('onCommand', { command: 'seekTo', positionMs: 10_000 });
    await flush();

    expect(player.seekTo).not.toHaveBeenCalledWith(10);
  });
});
