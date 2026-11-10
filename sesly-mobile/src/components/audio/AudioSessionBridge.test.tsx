/**
 * AudioSessionBridge (src/components/audio/AudioSessionBridge.tsx): the
 * app-wide audio wiring, mounted once.
 *
 * The audio store is the real singleton on a fake expo-audio player (status
 * events are emitted by hand), so the free-plan background rules run
 * through the store's own status handling. The queue, the session module
 * and the subscription store are real; ApiClient, NarrationService, the
 * socket service, the preferences, the sleep timer and the snackbar API are
 * mocked. React Native's AppState mock records the listeners; a test calls
 * the bridge's listener directly.
 */

const mockCreateAudioPlayer = jest.fn();
const mockSetAudioModeAsync = jest.fn();
const mockToast = { info: jest.fn(), error: jest.fn(), success: jest.fn(), warning: jest.fn() };
const mockTimer = {
  attachPlayer: jest.fn(),
  turnOff: jest.fn(),
  handleStoryFinished: jest.fn((): 'stop' | 'continue' => 'continue'),
  onPlayRequested: jest.fn(),
  isFading: false,
  store: { active: false, mode: 'duration' },
};

jest.mock('expo-audio', () => ({
  __esModule: true,
  createAudioPlayer: (...a: unknown[]) => mockCreateAudioPlayer(...a),
  setAudioModeAsync: (...a: unknown[]) => mockSetAudioModeAsync(...a),
}));
jest.mock('../../services/ApiClient', () => ({
  __esModule: true,
  default: {
    getBaseURL: () => 'https://api.sesly.test/api/v1',
    getAccessToken: () => Promise.resolve('jwt'),
    getFreshAccessToken: () => Promise.resolve('jwt'),
    get: () => new Promise(() => {}),
    post: jest.fn(),
  },
}));
jest.mock('../../services/NarrationService', () => ({
  __esModule: true,
  NarrationAlreadyExistsError: class NarrationAlreadyExistsError extends Error {},
  default: {
    getNarrationById: () => new Promise(() => {}),
    getNarrationsByStory: () => Promise.resolve([]),
  },
}));
jest.mock('../../services/WebSocketService', () => ({
  __esModule: true,
  default: { registerAudioPlayerStore: jest.fn() },
}));
jest.mock('../../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    getCachedSync: () => null,
    get: () => new Promise(() => {}),
    update: () => Promise.resolve({}),
  },
}));
jest.mock('../../services/SleepTimerService', () => ({
  __esModule: true,
  get default() {
    return mockTimer;
  },
}));
jest.mock('../../utils/toast', () => ({
  get showToast() {
    return mockToast;
  },
}));

import React from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, screen } from '@testing-library/react-native';
import { AudioSessionBridge, BACKGROUND_PAUSE_WINDOW_MS } from './AudioSessionBridge';
import { RootHosts } from '../../navigation/RootHosts';
import { renderWithProviders } from '../../test-utils/render-helpers';
import { queueSheet } from '../../stores/queueSheet';
import {
  PLAY_SETTLE_MS,
  getAudioPlayerStore,
  getAudioPlayerStoreIfCreated,
  useAudioPlayer,
  type AudioPlayerStore,
} from '../../hooks/useAudioPlayer';
import { getSubscriptionStore } from '../../hooks/useSubscription';
import { queueStore, queueStorageKey } from '../../stores/QueueStore';
import { playQueueFrom } from '../../stores/queuePlayback';
import { metaFromNarration, resetNarrationMetaForTests } from '../../stores/narrationMeta';
import {
  resetSessionForTests,
  runSessionEndHandlers,
  setSessionUserId,
} from '../../stores/session';
import { resetNarrationDurationsForTests } from '../../utils/narrationDurations';
import { parseStoryNarrationFromJSON } from '../../models/Narration';
import { msg } from '../../i18n/messages';
import { mockNarrationJSON, mockStoryJSON } from '../../test-utils/mock-data';

type StatusListener = (status: Record<string, unknown>) => void;

class FakeAudioPlayer {
  playing = false;
  currentTime = 0;
  volume = 1;
  isLoaded = true;
  isBuffering = false;
  shouldCorrectPitch = false;
  currentStatus: Record<string, unknown> | undefined = undefined;
  statusListener: StatusListener | null = null;
  replace = jest.fn();
  play = jest.fn();
  pause = jest.fn();
  seekTo = jest.fn(async () => undefined);
  setPlaybackRate = jest.fn();
  remove = jest.fn();
  release = jest.fn();
  setActiveForLockScreen = jest.fn();
  updateLockScreenMetadata = jest.fn();
  clearLockScreenControls = jest.fn();
  addListener = jest.fn((event: string, listener: StatusListener) => {
    if (event === 'playbackStatusUpdate') this.statusListener = listener;
    return { remove: jest.fn() };
  });

  emit(status: Record<string, unknown>): void {
    this.statusListener?.({
      currentTime: 0,
      duration: 0,
      playing: false,
      didJustFinish: false,
      ...status,
    });
  }

  resetCalls(): void {
    [
      this.replace,
      this.play,
      this.pause,
      this.seekTo,
      this.setPlaybackRate,
      this.setActiveForLockScreen,
      this.updateLockScreenMetadata,
      this.clearLockScreenControls,
    ].forEach(fn => fn.mockClear());
  }
}

const narrationA = parseStoryNarrationFromJSON({
  ...mockNarrationJSON,
  id: 'narr-a',
  totalDuration: 300,
});
const narrationB = parseStoryNarrationFromJSON({
  ...mockNarrationJSON,
  id: 'narr-b',
  totalDuration: 200,
  story: { ...mockStoryJSON, id: 'story-b', title: 'Deniz Feneri' },
});

const addEventListener = AppState.addEventListener as unknown as jest.Mock;

let store: AudioPlayerStore;
let player: FakeAudioPlayer;
let now = 1_800_000_000_000;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function setTier(tier: 'FREE' | 'MINI' | 'PRO'): void {
  act(() => {
    getSubscriptionStore().setTierFromUser(tier);
  });
}

function setPro(isPro: boolean): void {
  setTier(isPro ? 'PRO' : 'FREE');
}

/** Render the bridge (plus `callers` components using the hook) and return its AppState listener. */
async function mountBridge(callers = 0) {
  addEventListener.mockClear();
  mockSetAudioModeAsync.mockClear();
  const Caller = () => {
    useAudioPlayer();
    return null;
  };
  const view = render(
    <>
      {Array.from({ length: callers }, (_, i) => (
        <Caller key={i} />
      ))}
      <AudioSessionBridge />
    </>,
  );
  await act(async () => {
    await flush();
  });
  const calls = addEventListener.mock.calls.filter(call => call[0] === 'change');
  const listener = calls[calls.length - 1]?.[1] as ((state: AppStateStatus) => void) | undefined;
  const subscription = addEventListener.mock.results[addEventListener.mock.results.length - 1]
    ?.value as { remove: jest.Mock } | undefined;
  const appState = (state: AppStateStatus) => {
    act(() => {
      listener?.(state);
    });
  };
  return { view, appState, listenerCount: calls.length, subscription };
}

/** Story A playing (sounding for a while, past the play settle time). */
async function playA() {
  await store.startNarration({ narration: narrationA }, { autoplay: true });
  player.currentTime = 60;
  player.emit({ currentTime: 60, duration: 300, playing: true, playbackState: 'ready' });
  now += PLAY_SETTLE_MS + 5000;
}

beforeAll(async () => {
  mockCreateAudioPlayer.mockImplementation(() => new FakeAudioPlayer());
  mockSetAudioModeAsync.mockResolvedValue(undefined);
  store = getAudioPlayerStore();
  await store.setupPlayer();
  player = (store as unknown as { player: FakeAudioPlayer }).player;
});

beforeEach(async () => {
  // The shared setup restores every spy after each test.
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  now += 60_000;
  resetSessionForTests();
  await store.unloadForSignOut();
  player.volume = 1;
  player.resetCalls();
  queueStore.reset();
  resetNarrationMetaForTests();
  resetNarrationDurationsForTests();
  await AsyncStorage.clear();
  Object.values(mockToast).forEach(fn => fn.mockReset());
  mockTimer.attachPlayer.mockReset();
  mockTimer.turnOff.mockReset();
  mockTimer.handleStoryFinished.mockReset().mockReturnValue('continue');
  mockSetAudioModeAsync.mockReset().mockResolvedValue(undefined);
  getSubscriptionStore().setTierFromUser('FREE');
});

describe('one bridge for the app', () => {
  it('ten components calling useAudioPlayer plus the bridge: one audio mode call, one AppState listener', async () => {
    const { listenerCount } = await mountBridge(10);

    expect(listenerCount).toBe(1);
    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    });
  });

  it('RootHosts renders the bridge', async () => {
    addEventListener.mockClear();
    render(<RootHosts />);
    await act(async () => {
      await flush();
    });

    expect(mockTimer.attachPlayer).toHaveBeenCalledWith(store);
    expect(addEventListener.mock.calls.filter(call => call[0] === 'change')).toHaveLength(1);
  });

  it('RootHosts also hosts the queue sheet, created at its first open', async () => {
    renderWithProviders(<RootHosts />);
    await act(async () => {
      await flush();
    });
    expect(screen.queryByTestId('queue-sheet')).toBeNull();

    act(() => queueSheet.open('toast'));
    expect(screen.getByTestId('queue-sheet')).toBeOnTheScreen();
    expect(screen.getByText('Sıran boş')).toBeOnTheScreen();

    act(() => queueSheet.close());
    expect(queueSheet.visible).toBe(false);
  });

  it('attaches the sleep timer to the store and detaches it on unmount', async () => {
    const { view, subscription } = await mountBridge();

    expect(mockTimer.attachPlayer).toHaveBeenCalledWith(store);
    view.unmount();
    expect(mockTimer.attachPlayer).toHaveBeenLastCalledWith(null);
    expect(subscription?.remove).toHaveBeenCalled();
  });

  it('a plan change re-applies the audio mode and puts a playing story on the lock screen', async () => {
    await mountBridge();
    await playA();
    mockSetAudioModeAsync.mockClear();
    player.setActiveForLockScreen.mockClear();

    setPro(true);
    await act(async () => {
      await flush();
    });

    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ shouldPlayInBackground: true }),
    );
    expect(player.setActiveForLockScreen).toHaveBeenCalledWith(true, expect.anything(), expect.anything());

    setPro(false);
    await act(async () => {
      await flush();
    });
    expect(mockSetAudioModeAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ shouldPlayInBackground: false }),
    );
  });
});

describe('free plan in the background', () => {
  it('pauses the story silently at volume 0', async () => {
    const { appState } = await mountBridge();
    await playA();
    player.pause.mockClear();

    appState('background');

    expect(store.isPlaying).toBe(false);
    expect(player.pause).toHaveBeenCalled();
    expect(player.volume).toBe(0);
    expect(store.pausedByBackground).toBe(true);
    expect(mockToast.info).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("expo-audio's own resume afterwards is paused again", async () => {
    const { appState } = await mountBridge();
    await playA();
    appState('background');
    player.pause.mockClear();

    // The native foreground hook calls play() by itself.
    player.emit({ currentTime: 61, duration: 300, playing: true, playbackState: 'ready' });

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(false);
    expect(player.volume).toBe(0);
  });

  it("'active' shows one snackbar whose action plays at full volume", async () => {
    const { appState } = await mountBridge();
    await playA();
    appState('background');
    player.play.mockClear();

    appState('active');
    appState('active');

    expect(mockToast.info).toHaveBeenCalledTimes(1);
    const [message, title, action] = mockToast.info.mock.calls[0];
    expect(message).toBe(msg('player.pausedOnLock'));
    expect(title).toBe(msg('player.pausedOnLockTitle'));
    expect(action.label).toBe(msg('player.resume'));

    await act(async () => {
      action.onPress();
      await flush();
    });
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(true);
    expect(player.volume).toBe(1);
    expect(store.pausedByBackground).toBe(false);
  });

  it('a second background and return without playing shows nothing', async () => {
    const { appState } = await mountBridge();
    await playA();
    appState('background');
    appState('active');
    mockToast.info.mockReset();
    now += 60_000;

    appState('background');
    appState('active');

    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('the native pause status beating the AppState event still counts', async () => {
    const { appState } = await mountBridge();
    await playA();

    // expo-audio paused natively first: the store reads it as a pause from outside.
    player.emit({ currentTime: 62, duration: 300, playing: false, playbackState: 'ready' });
    expect(store.isPlaying).toBe(false);
    now += 200;
    appState('background');

    expect(player.volume).toBe(0);
    expect(store.pausedByBackground).toBe(true);
    player.emit({ currentTime: 62, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.isPlaying).toBe(false);
    appState('active');
    expect(mockToast.info).toHaveBeenCalledTimes(1);
  });

  it('a start in flight when the app leaves loads paused; the return offers to resume', async () => {
    const { appState } = await mountBridge();

    // A tap on play just before the screen went off: nothing was loaded yet.
    const start = store.startNarration({ narration: narrationA }, { autoplay: true });
    appState('background');
    await act(async () => {
      await start;
    });

    expect(store.audioId).toBe('narr-a');
    expect(store.isPlaying).toBe(false);
    expect(player.play).not.toHaveBeenCalled();
    expect(player.volume).toBe(0);
    expect(store.pausedByBackground).toBe(true);

    appState('active');
    expect(mockToast.info).toHaveBeenCalledTimes(1);
    await act(async () => {
      mockToast.info.mock.calls[0][2].onPress();
      await flush();
    });
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.volume).toBe(1);
  });

  it("the queue's next story starting as the app leaves loads paused", async () => {
    const { appState } = await mountBridge();
    queueStore.add(metaFromNarration(narrationA));
    queueStore.add(metaFromNarration(narrationB));
    await act(async () => {
      await playQueueFrom('narr-a');
    });
    player.emit({ currentTime: 10, duration: 300, playing: true, playbackState: 'ready' });
    now += PLAY_SETTLE_MS + 5000;
    player.play.mockClear();

    // A ends in the foreground, the advance to B starts, then the screen goes off.
    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
    expect(store.loadPhase).toBe('loading');
    appState('background');
    await act(async () => {
      await flush();
    });

    expect(store.audioId).toBe('narr-b');
    expect(store.isPlaying).toBe(false);
    expect(player.play).not.toHaveBeenCalled();
    expect(store.pausedByBackground).toBe(true);
  });

  it('a new story loaded paused just before the app leaves is no background pause', async () => {
    const { appState } = await mountBridge();
    await playA();

    await act(async () => {
      await store.startNarration({ narration: narrationB });
    });
    now += 200;
    appState('background');
    appState('active');

    expect(store.audioId).toBe('narr-b');
    expect(player.volume).toBe(1);
    expect(store.pausedByBackground).toBe(false);
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('a story paused well before the app left is left alone', async () => {
    const { appState } = await mountBridge();
    await playA();
    await act(async () => {
      await store.pause();
    });
    now += BACKGROUND_PAUSE_WINDOW_MS + 1000;

    appState('background');
    appState('active');

    expect(player.volume).toBe(1);
    expect(store.pausedByBackground).toBe(false);
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('nothing loaded, or a story at its end: nothing happens', async () => {
    const { appState } = await mountBridge();

    appState('background');
    expect(player.volume).toBe(1);

    await playA();
    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
    expect(store.storyEnded).toBe(true);
    appState('background');
    appState('active');

    expect(player.volume).toBe(1);
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('Pro in the background does nothing', async () => {
    setPro(true);
    const { appState } = await mountBridge();
    await playA();
    player.pause.mockClear();

    appState('background');
    appState('active');

    expect(store.isPlaying).toBe(true);
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.volume).toBe(1);
    expect(store.pausedByBackground).toBe(false);
    expect(mockToast.info).not.toHaveBeenCalled();
  });
});

describe('Mini is a paid plan', () => {
  it('a Mini user keeps playing in the background, with no message on return', async () => {
    setTier('MINI');
    expect(getSubscriptionStore().isPaid).toBe(true);
    expect(getSubscriptionStore().isPremiumPlan).toBe(false);
    expect(getSubscriptionStore().canPlayInBackground).toBe(true);
    const { appState } = await mountBridge();
    await playA();
    player.pause.mockClear();

    appState('background');
    appState('active');

    expect(store.isPlaying).toBe(true);
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.volume).toBe(1);
    expect(store.pausedByBackground).toBe(false);
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('a Mini user gets the background audio mode from the first mount', async () => {
    setTier('MINI');

    await mountBridge();

    expect(mockSetAudioModeAsync).toHaveBeenCalledTimes(1);
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ shouldPlayInBackground: true }),
    );
  });

  it('a Free user is still paused, and a move to Mini lets the next background play on', async () => {
    const { appState } = await mountBridge();
    await playA();

    appState('background');
    expect(store.isPlaying).toBe(false);
    expect(store.pausedByBackground).toBe(true);
    appState('active');
    expect(mockToast.info).toHaveBeenCalledTimes(1);

    // The user upgrades to Mini and plays again.
    mockSetAudioModeAsync.mockClear();
    setTier('MINI');
    await act(async () => {
      await flush();
    });
    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ shouldPlayInBackground: true }),
    );
    await act(async () => {
      await store.play();
      await flush();
    });
    player.emit({ currentTime: 61, duration: 300, playing: true, playbackState: 'ready' });
    now += PLAY_SETTLE_MS + 5000;
    mockToast.info.mockReset();
    player.pause.mockClear();

    appState('background');
    appState('active');

    expect(store.isPlaying).toBe(true);
    expect(player.pause).not.toHaveBeenCalled();
    expect(player.volume).toBe(1);
    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('a Mini user downgraded to Free is paused again', async () => {
    setTier('MINI');
    const { appState } = await mountBridge();
    await playA();
    setTier('FREE');
    await act(async () => {
      await flush();
    });
    player.pause.mockClear();

    appState('background');

    expect(store.isPlaying).toBe(false);
    expect(player.pause).toHaveBeenCalled();
    expect(player.volume).toBe(0);
    expect(store.pausedByBackground).toBe(true);
  });
});

describe('queue wiring', () => {
  it('a queued story finishing starts the next one with no screen mounted', async () => {
    await mountBridge();
    queueStore.add(metaFromNarration(narrationA));
    queueStore.add(metaFromNarration(narrationB));
    await act(async () => {
      await playQueueFrom('narr-a');
    });
    player.emit({ currentTime: 10, duration: 300, playing: true, playbackState: 'ready' });
    player.replace.mockClear();

    await act(async () => {
      player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
      await flush();
    });

    expect(mockTimer.handleStoryFinished).toHaveBeenCalledTimes(1);
    expect(queueStore.currentId).toBe('narr-b');
    expect(store.audioId).toBe('narr-b');
    expect(store.isPlaying).toBe(true);
    expect(player.replace).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'https://api.sesly.test/api/v1/narrations/narr-b/stream' }),
    );
  });

  it('without the bridge a finished queued story rests at its end', async () => {
    const { view } = await mountBridge();
    queueStore.add(metaFromNarration(narrationA));
    queueStore.add(metaFromNarration(narrationB));
    await act(async () => {
      await playQueueFrom('narr-a');
    });
    view.unmount();

    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
    await flush();

    expect(store.audioId).toBe('narr-a');
    expect(store.storyEnded).toBe(true);
    expect(store.isPlaying).toBe(false);
  });
});

describe('session', () => {
  it('the session end handlers unload the player, turn the timer off and reset the queue', async () => {
    const order: string[] = [];
    mockTimer.turnOff.mockImplementation(() => {
      order.push(`timer off, player ${getAudioPlayerStoreIfCreated()?.source}`);
    });
    setSessionUserId('u-1');
    await mountBridge();
    queueStore.add(metaFromNarration(narrationA));
    await playA();

    await act(async () => {
      await runSessionEndHandlers();
    });

    expect(store.source).toBe('none');
    expect(store.audioId).toBe('');
    expect(store.isPlaying).toBe(false);
    expect(player.pause).toHaveBeenCalled();
    expect(order).toEqual(['timer off, player none']);
    expect(queueStore.entries).toEqual([]);
    expect(queueStore.hydrated).toBe(false);
    // The resume point survives the sign-out.
    expect(await AsyncStorage.getItem('narration_position:narr-a')).toBe('60000');
    // The stored queue stays for that account.
    expect(await AsyncStorage.getItem(queueStorageKey('u-1'))).not.toBeNull();
  });

  it('after unmount the end handler is gone', async () => {
    const { view } = await mountBridge();
    await playA();
    view.unmount();

    await runSessionEndHandlers();

    expect(store.audioId).toBe('narr-a');
    expect(mockTimer.turnOff).not.toHaveBeenCalled();
  });

  it('a session user change hydrates the queue of that user', async () => {
    await AsyncStorage.setItem(
      queueStorageKey('u-2'),
      JSON.stringify({
        version: 1,
        entries: [{ ...metaFromNarration(narrationB), voiceProfile: null, addedAt: 1 }],
        currentId: null,
      }),
    );
    await mountBridge();

    await act(async () => {
      setSessionUserId('u-2');
      await flush();
    });

    expect(queueStore.hydrated).toBe(true);
    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['narr-b']);

    await act(async () => {
      setSessionUserId(null);
      await flush();
    });
    expect(queueStore.entries).toEqual([]);
  });

  it('a user signed in before the bridge mounted gets their queue', async () => {
    await AsyncStorage.setItem(
      queueStorageKey('u-1'),
      JSON.stringify({
        version: 1,
        entries: [{ ...metaFromNarration(narrationA), voiceProfile: null, addedAt: 1 }],
        currentId: 'narr-a',
      }),
    );
    setSessionUserId('u-1');

    await mountBridge();

    expect(queueStore.entries.map(e => e.narrationId)).toEqual(['narr-a']);
    expect(queueStore.currentId).toBe('narr-a');
  });

  it('a meta the player remembers refreshes the queued row', async () => {
    await mountBridge();
    queueStore.add({ ...metaFromNarration(narrationB), story: { ...metaFromNarration(narrationB).story, title: '' } });

    await act(async () => {
      await store.startNarration({ narration: narrationB });
    });

    expect(queueStore.entries[0].story.title).toBe('Deniz Feneri');
  });
});
