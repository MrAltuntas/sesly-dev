/**
 * AudioPlayerStore + useAudioPlayer (src/hooks/useAudioPlayer.ts) unit tests.
 *
 * The global 'expo-audio' mock is replaced here by a createAudioPlayer /
 * setAudioModeAsync mock. The player is a class instance (like the real
 * native shared object) and writes every call into one ordered log, so a test
 * can assert that the store pauses before it replaces and replaces before it
 * plays.
 *
 * Lock-screen behavior is asserted on the player's setActiveForLockScreen /
 * updateLockScreenMetadata calls, driven by the real LockScreenController
 * (its throttling details are covered in src/utils/lockScreen.test.ts).
 * SubscriptionStore, the session module, the narration meta cache, the
 * real-length memory and the queue are real (the last block renders the real
 * session bridge for the plan in the background); ApiClient,
 * NarrationService, the socket service, the preferences and the sleep timer
 * are mocked. Quota refusals are the backend's 403 bodies (contract fixtures).
 */

const mockCreateAudioPlayer = jest.fn();
const mockSetAudioModeAsync = jest.fn();
const mockGetBaseURL = jest.fn();
const mockGetAccessToken = jest.fn();
const mockGetFreshAccessToken = jest.fn();
// The JWT expiry the store reads off a stream token (null: an opaque token).
const mockJwtExpiryMs = jest.fn();
const mockApiGet = jest.fn();
const mockCreateNarration = jest.fn();
const mockGenerateAudio = jest.fn();
const mockGetNarrationStatus = jest.fn();
const mockGetNarrationById = jest.fn();
const mockRegisteredStores: unknown[] = [];
const mockPrefsCached = jest.fn();
const mockPrefsGet = jest.fn();
const mockPrefsUpdate = jest.fn();
const mockTimer = {
  onPlayRequested: jest.fn(),
  isFading: false,
  // What the session bridge wires (its test at the end of this file).
  attachPlayer: jest.fn(),
  turnOff: jest.fn(),
};

jest.mock('expo-audio', () => ({
  __esModule: true,
  createAudioPlayer: (...a: unknown[]) => mockCreateAudioPlayer(...a),
  setAudioModeAsync: (...a: unknown[]) => mockSetAudioModeAsync(...a),
}));
jest.mock('../services/ApiClient', () => ({
  __esModule: true,
  jwtExpiryMs: (...a: unknown[]) => mockJwtExpiryMs(...a),
  default: {
    getBaseURL: (...a: unknown[]) => mockGetBaseURL(...a),
    getAccessToken: (...a: unknown[]) => mockGetAccessToken(...a),
    getFreshAccessToken: (...a: unknown[]) => mockGetFreshAccessToken(...a),
    get: (...a: unknown[]) => mockApiGet(...a),
    post: jest.fn(),
  },
}));
jest.mock('../services/NarrationService', () => {
  const actual = jest.requireActual('../services/NarrationService');
  return {
    __esModule: true,
    NarrationAlreadyExistsError: actual.NarrationAlreadyExistsError,
    default: {
      createNarration: (...a: unknown[]) => mockCreateNarration(...a),
      generateAudio: (...a: unknown[]) => mockGenerateAudio(...a),
      getNarrationStatus: (...a: unknown[]) => mockGetNarrationStatus(...a),
      getNarrationById: (...a: unknown[]) => mockGetNarrationById(...a),
    },
  };
});
jest.mock('../services/WebSocketService', () => ({
  __esModule: true,
  default: {
    registerAudioPlayerStore: (store: unknown) => {
      mockRegisteredStores.push(store);
    },
  },
}));
jest.mock('../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    getCachedSync: (...a: unknown[]) => mockPrefsCached(...a),
    get: (...a: unknown[]) => mockPrefsGet(...a),
    update: (...a: unknown[]) => mockPrefsUpdate(...a),
  },
}));
jest.mock('../services/SleepTimerService', () => ({
  __esModule: true,
  // Read lazily: the factory runs before the const above is initialised.
  get default() {
    return mockTimer;
  },
}));
jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

import * as fs from 'fs';
import * as path from 'path';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, render, renderHook } from '@testing-library/react-native';
import { autorun, reaction, runInAction } from 'mobx';
import {
  AudioPlayerStore,
  DOCK_PAUSE_HOLD_MS,
  GENERATION_POLL_LIMIT_MS,
  GENERATION_SLOW_AFTER_MS,
  GENERATION_SLOW_POLL_MS,
  PLAYBACK_SPEED_STORAGE_KEY,
  PLAY_SETTLE_MS,
  PREVIEW_IDLE_GRACE_MS,
  PREVIEW_START_TIMEOUT_MS,
  STORY_START_TIMEOUT_MS,
  STREAM_TOKEN_MARGIN_MS,
  STREAM_TOKEN_MAX_AGE_MS,
  STREAM_TOKEN_MIN_VALIDITY_MS,
  streamReloadDeadline,
  getAudioPlayerStore,
  getAudioPlayerStoreIfCreated,
  isUnplayableLoadError,
  playbackAudioMode,
  restorePlaybackAudioMode,
  useAudioPlayer,
} from './useAudioPlayer';
import { USAGE_SOON_DELAY_MS, getSubscriptionStore } from './useSubscription';
import { NarrationAlreadyExistsError } from '../services/NarrationService';
import { apiErrorFromResponse } from '../services/ApiError';
import { parseStoryNarrationFromJSON, type StoryNarration } from '../models/Narration';
import {
  LOCK_SCREEN_METADATA_MIN_INTERVAL_MS,
  LOCK_SCREEN_OPTIONS,
  buildLockScreenMetadata,
} from '../utils/lockScreen';
import { AUDIO_PLAYBACK, POLLING_INTERVALS } from '../config/constants';
import { showToast } from '../utils/toast';
import * as crashlytics from '@react-native-firebase/crashlytics';
import { mockNarrationJSON, mockStoryJSON } from '../test-utils/mock-data';
import {
  knownNarrationDurationMs,
  rememberNarrationDuration,
  resetNarrationDurationsForTests,
} from '../utils/narrationDurations';
import {
  getNarrationMeta,
  metaFromNarration,
  rememberNarrationMeta,
  resetNarrationMetaForTests,
} from '../stores/narrationMeta';
import { LAST_PLAYED_STORAGE_KEY } from '../utils/lastPlayed';
import { PlaybackProgressDriver, SEEK_CONFIRM_MS, bindPlaybackProgress } from '../utils/playbackProgress';
import { resetSessionForTests, setSessionUserId } from '../stores/session';
import { queueStore } from '../stores/QueueStore';
import { msg } from '../i18n/messages';
import { AudioSessionBridge } from '../components/audio/AudioSessionBridge';
import { parseUsageSummary } from '../models/Quota';
import {
  backendPremiumStoryError,
  backendQuotaCloneLifetimeError,
  backendQuotaCloneMonthlyError,
  backendQuotaPresetMonthlyError,
  backendUsageMini,
} from '../test-utils/contract-fixtures';

// ============================================================================
// Fakes + fixtures
// ============================================================================

type StatusListener = (status: Record<string, unknown>) => void;

/** Every native call of every fake player, in order. */
let log: string[] = [];

class FakeAudioPlayer {
  playing = false;
  currentTime = 0;
  volume = 1;
  isLoaded = true;
  isBuffering = false;
  shouldCorrectPitch = false;
  currentStatus: Record<string, unknown> | undefined = undefined;
  statusListener: StatusListener | null = null;
  readonly subscription = { remove: jest.fn() };
  replace = jest.fn((source: { uri: string; headers?: Record<string, string> } | null) => {
    log.push(`replace ${source?.uri ?? 'null'} ${source?.headers?.Authorization ?? '-'}`);
  });
  play = jest.fn(() => {
    log.push('play');
  });
  pause = jest.fn(() => {
    log.push('pause');
  });
  seekTo = jest.fn(async (seconds: number) => {
    log.push(`seek ${seconds}`);
  });
  setPlaybackRate = jest.fn();
  remove = jest.fn();
  release = jest.fn();
  setActiveForLockScreen = jest.fn();
  updateLockScreenMetadata = jest.fn();
  addListener = jest.fn((event: string, listener: StatusListener) => {
    if (event === 'playbackStatusUpdate') this.statusListener = listener;
    return this.subscription;
  });

  emit(status: Record<string, unknown>): void {
    if (!this.statusListener) throw new Error('no status listener');
    this.statusListener({
      currentTime: 0,
      duration: 0,
      playing: false,
      didJustFinish: false,
      ...status,
    });
  }
}

const BASE_URL = 'https://api.sesly.test/api/v1';
const TOKEN = 'jwt-access-token';
const SAMPLE = 'https://cdn.sesly.test/sample.mp3';

const narrationA: StoryNarration = parseStoryNarrationFromJSON({
  ...mockNarrationJSON,
  id: 'narr-a',
  totalDuration: 300,
});
const narrationB: StoryNarration = parseStoryNarrationFromJSON({
  ...mockNarrationJSON,
  id: 'narr-b',
  totalDuration: 120,
  story: {
    ...mockStoryJSON,
    id: 'story-b',
    title: 'Deniz Feneri',
    coverImageUrl: 'https://images.sesly.io/covers/story-b.jpg',
  },
});
const narrationC: StoryNarration = parseStoryNarrationFromJSON({
  ...mockNarrationJSON,
  id: 'narr-c',
  totalDuration: 200,
  story: { ...mockStoryJSON, id: 'story-c', title: 'Kibritçi Kız' },
});
const metadataA = buildLockScreenMetadata(narrationA.story, narrationA.voiceProfile?.name);
const metadataB = buildLockScreenMetadata(narrationB.story, narrationB.voiceProfile?.name);

const streamOf = (id: string, token: string = TOKEN) =>
  `replace ${BASE_URL}/narrations/${id}/stream Bearer ${token}`;
const positionKey = (id: string) => `narration_position:${id}`;

const toastError = showToast.error as jest.Mock;

let players: FakeAudioPlayer[] = [];
const createdStores: AudioPlayerStore[] = [];

function playerOf(store: AudioPlayerStore): FakeAudioPlayer {
  const player = (store as unknown as { player: FakeAudioPlayer | null }).player;
  if (!player) throw new Error('store has no player');
  return player;
}

async function createStore(): Promise<{ store: AudioPlayerStore; player: FakeAudioPlayer }> {
  const store = new AudioPlayerStore();
  createdStores.push(store);
  await store.setupPlayer();
  return { store, player: playerOf(store) };
}

/** A store with narration A loaded and sounding at `atSeconds`. */
async function playingA(atSeconds = 60) {
  const created = await createStore();
  await created.store.startNarration({ narration: narrationA }, { autoplay: true });
  created.player.currentTime = atSeconds;
  created.player.emit({ currentTime: atSeconds, duration: 300, playing: true, playbackState: 'ready' });
  return created;
}

function setPro(isPro: boolean): void {
  setPlan(isPro ? 'PRO' : 'FREE');
}

/** The plan from the user payload (no GET /usage answered). */
function setPlan(tier: 'FREE' | 'MINI' | 'PRO'): void {
  getSubscriptionStore().setTierFromUser(tier);
}

const flush = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const audioMode = (shouldPlayInBackground: boolean) => ({
  playsInSilentMode: true,
  shouldPlayInBackground,
  interruptionMode: 'doNotMix',
});

beforeEach(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  log = [];
  players = [];
  mockCreateAudioPlayer.mockReset().mockImplementation(() => {
    const player = new FakeAudioPlayer();
    players.push(player);
    return player;
  });
  mockSetAudioModeAsync.mockReset().mockResolvedValue(undefined);
  mockGetBaseURL.mockReset().mockReturnValue(BASE_URL);
  mockGetAccessToken.mockReset().mockResolvedValue(TOKEN);
  mockGetFreshAccessToken.mockReset().mockResolvedValue(TOKEN);
  mockJwtExpiryMs.mockReset().mockReturnValue(null);
  // Only reached if something initializes the subscription singleton.
  mockApiGet.mockReset().mockReturnValue(new Promise(() => {}));
  mockCreateNarration.mockReset();
  mockGenerateAudio.mockReset().mockResolvedValue(undefined);
  mockGetNarrationStatus.mockReset();
  // A background refresh that never answers unless a test says so.
  mockGetNarrationById.mockReset().mockReturnValue(new Promise(() => {}));
  mockPrefsCached.mockReset().mockReturnValue(null);
  // No stored preferences unless a test provides them.
  mockPrefsGet.mockReset().mockReturnValue(new Promise(() => {}));
  mockPrefsUpdate.mockReset().mockResolvedValue({});
  mockTimer.onPlayRequested = jest.fn();
  mockTimer.isFading = false;

  // No usage request of an earlier test is still shared.
  getSubscriptionStore().reset();
  queueStore.reset();
  setPro(false);
  resetNarrationDurationsForTests();
  resetNarrationMetaForTests();
  resetSessionForTests();
  setSessionUserId('u-1');
  await AsyncStorage.clear();
});

afterEach(() => {
  while (createdStores.length) {
    createdStores.pop()!.dispose();
  }
  jest.clearAllTimers();
});

// ============================================================================
// Setup
// ============================================================================

describe('AudioPlayerStore setup', () => {
  it('applies the free audio mode and creates one player with a status listener', async () => {
    const { player } = await createStore();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(audioMode(false));
    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockCreateAudioPlayer).toHaveBeenCalledWith(null, { updateInterval: 500 });
    expect(player.addListener).toHaveBeenCalledWith('playbackStatusUpdate', expect.any(Function));
    expect(playbackAudioMode(true)).toEqual(audioMode(true));
  });

  it('a Pro user starts with background playback and doNotMix', async () => {
    setPro(true);

    await createStore();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(audioMode(true));
  });

  it('a Mini user (a paid plan) starts with background playback too', async () => {
    setPlan('MINI');
    // Mini, not Premium: the gate is the paid plan, not the Premium tier.
    expect(getSubscriptionStore().planId).toBe('mini');

    await createStore();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(audioMode(true));
  });

  it('what GET /usage says about background playback wins over the tier', async () => {
    setPlan('MINI');
    runInAction(() => {
      getSubscriptionStore().usage = parseUsageSummary({
        ...backendUsageMini,
        features: { backgroundPlayback: false, premiumStories: true },
      });
    });

    await createStore();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith(audioMode(false));
  });

  it('a starting store and a concurrent setup create a single native player', async () => {
    const store = new AudioPlayerStore();
    createdStores.push(store);

    await Promise.all([
      store.startNarration({ narration: narrationA }, { autoplay: true }),
      store.setupPlayer(),
      store.setupPlayer(),
    ]);

    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(players[0].play).toHaveBeenCalledTimes(1);
  });

  it('a failed setup is retried by the next start', async () => {
    mockSetAudioModeAsync.mockRejectedValueOnce(new Error('audio session busy'));
    const store = new AudioPlayerStore();
    createdStores.push(store);
    await store.setupPlayer();
    expect(mockCreateAudioPlayer).not.toHaveBeenCalled();
    expect(store.nativePlayer).toBeNull();

    await store.startNarration({ narration: narrationA }, { autoplay: true });

    expect(mockCreateAudioPlayer).toHaveBeenCalledTimes(1);
    expect(store.nativePlayer).toBe(players[0]);
    expect(players[0].play).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(true);
  });

  it('dispose releases the listener, the native player and the lock screen', async () => {
    setPro(true);
    const { store, player } = await playingA();

    store.dispose();

    expect(player.subscription.remove).toHaveBeenCalledTimes(1);
    expect(player.pause).toHaveBeenCalled();
    expect(player.remove).toHaveBeenCalledTimes(1);
    expect(player.release).toHaveBeenCalledTimes(1);
    expect(player.setActiveForLockScreen).toHaveBeenLastCalledWith(false);
    expect(store.isPlaying).toBe(false);
    expect(store.nativePlayer).toBeNull();
  });

  it('dispose tolerates a player whose remove/release throw', async () => {
    const { store, player } = await createStore();
    player.remove.mockImplementation(() => {
      throw new Error('already removed');
    });
    player.release.mockImplementation(() => {
      throw new Error('already released');
    });

    expect(() => store.dispose()).not.toThrow();
    expect(player.release).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================
// startNarration: the one load path
// ============================================================================

describe('AudioPlayerStore.startNarration', () => {
  it('streams /narrations/:id/stream with a fresh token and describes the story from its meta', async () => {
    const { store, player } = await createStore();

    await expect(store.startNarration({ narration: narrationA })).resolves.toBe(true);

    expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockGetAccessToken).not.toHaveBeenCalled();
    expect(player.replace).toHaveBeenCalledWith({
      uri: `${BASE_URL}/narrations/narr-a/stream`,
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    // Streams via the backend, never the raw GCS audioUrl.
    expect(player.replace.mock.calls[0][0]?.uri).not.toBe(narrationA.audioUrl);
    expect(store.source).toBe('story');
    expect(store.audioId).toBe('narr-a');
    expect(store.isStoryLoaded).toBe(true);
    expect(store.isPlayingStory).toBe(true);
    expect(store.currentStory).toEqual({
      id: 'story-123',
      title: 'Küçük Tavşan ile Havuç Macerası',
      coverImageUrl: 'https://images.sesly.io/covers/story-123.jpg',
      translationGroupId: null,
      category: 'BEDTIME',
    });
    expect(store.currentVoiceProfile).toEqual(narrationA.voiceProfile);
    expect(store.currentNarratorName).toBe('Babamın Sesi');
    expect(store.currentOwnVoice).toBe(true);
    expect(store.loadPhase).toBe('ready');
    expect(store.pendingNarrationId).toBeNull();
    expect(store.loadError).toBeNull();
    expect(store.currentPositionMs).toBe(0);
    expect(player.seekTo).not.toHaveBeenCalled();
    // A full narration needs no background refresh.
    expect(mockGetNarrationById).not.toHaveBeenCalled();
    // Without autoplay nothing sounds.
    expect(player.play).not.toHaveBeenCalled();
    expect(store.isPlaying).toBe(false);
  });

  it('the length is real only: the backend estimate is never the shown length', async () => {
    const { store } = await createStore();

    await store.startNarration({ narration: { ...narrationA, totalDuration: 900 } });

    expect(store.totalDurationMs).toBe(0);
    expect(store.remainingMinutes).toBeNull();
  });

  it('adopts the length the native player already knows at load', async () => {
    const { store, player } = await createStore();
    player.currentStatus = { duration: 300, isLoaded: true };

    await store.startNarration({ narration: { ...narrationA, totalDuration: 900 } });

    expect(store.totalDurationMs).toBe(300_000);
    expect(knownNarrationDurationMs('narr-a')).toBe(300_000);
  });

  it('a length remembered on the device is shown at once', async () => {
    rememberNarrationDuration('narr-a', 104_500);
    const { store } = await createStore();

    await store.startNarration({ narration: narrationA });

    expect(store.totalDurationMs).toBe(104_500);
  });

  it('sends no Authorization header without a token', async () => {
    mockGetFreshAccessToken.mockResolvedValue(null);
    const { store, player } = await createStore();

    await store.startNarration({ narration: narrationA });

    expect(player.replace).toHaveBeenCalledWith({
      uri: `${BASE_URL}/narrations/narr-a/stream`,
      headers: undefined,
    });
  });

  it('keeps currentVoiceProfile null when the backend omitted it', async () => {
    const { store } = await createStore();

    await store.startNarration({ narration: { ...narrationA, voiceProfile: null } });

    expect(store.currentVoiceProfile).toBeNull();
    expect(store.currentNarratorName).toBeNull();
    expect(store.currentOwnVoice).toBe(false);
  });

  it('resumes from the saved position (the estimate decides it is not near the end)', async () => {
    await AsyncStorage.setItem(positionKey('narr-a'), '60000');
    const { store, player } = await createStore();

    await store.startNarration({ narration: narrationA });

    expect(player.seekTo).toHaveBeenCalledWith(60);
    expect(store.currentPositionMs).toBe(60_000);
    expect(store.hasPosition).toBe(true);
  });

  it('starts over and clears a saved position at the very end', async () => {
    await AsyncStorage.setItem(positionKey('narr-a'), '299500');
    const { store, player } = await createStore();

    await store.startNarration({ narration: narrationA });
    await flush();

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(store.currentPositionMs).toBe(0);
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBeNull();
  });

  it('a saved position past the real end starts over, whatever the estimate says', async () => {
    rememberNarrationDuration('narr-a', 104_500);
    await AsyncStorage.setItem(positionKey('narr-a'), '104000');
    const { store, player } = await createStore();

    await store.startNarration({ narration: narrationA });

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(store.currentPositionMs).toBe(0);
  });

  it('resumes when the length is unknown', async () => {
    await AsyncStorage.setItem(positionKey('narr-a'), '45000');
    const { store, player } = await createStore();

    await store.startNarration({ narration: { ...narrationA, totalDuration: 0 } });

    expect(player.seekTo).toHaveBeenCalledWith(45);
    expect(store.totalDurationMs).toBe(0);
    expect(store.progressPercent).toBe(0);
  });

  it('starts at 0 when reading the saved position fails', async () => {
    const { store, player } = await createStore();
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('storage locked'));

    await store.startNarration({ narration: narrationA });

    expect(store.loadPhase).toBe('ready');
    expect(player.seekTo).not.toHaveBeenCalled();
    expect(store.currentPositionMs).toBe(0);
  });

  it('with autoplay it plays once loaded, after the seek', async () => {
    await AsyncStorage.setItem(positionKey('narr-a'), '60000');
    const { store, player } = await createStore();

    await store.startNarration({ narration: narrationA }, { autoplay: true });

    expect(log).toEqual(['pause', streamOf('narr-a'), 'seek 60', 'play']);
    expect(store.isPlaying).toBe(true);
    expect(player.play).toHaveBeenCalledTimes(1);
    // The sleep timer hears about every play.
    expect(mockTimer.onPlayRequested).toHaveBeenCalledTimes(1);
  });

  it('autoplay records the intent synchronously, so the play button spins while it loads', async () => {
    const { store } = await createStore();
    const token = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(token.promise);

    const start = store.startNarration({ narration: narrationA }, { autoplay: true });

    expect(store.pendingNarrationId).toBe('narr-a');
    expect(store.loadPhase).toBe('loading');
    expect(store.isPlaying).toBe(true);
    expect(store.isBusy).toBe(true);
    token.resolve(TOKEN);
    await start;
    expect(store.pendingNarrationId).toBeNull();
    expect(store.isBusy).toBe(false);
  });

  it('pauses before every replace: a playing story, a sample, a finished story', async () => {
    const { store, player } = await playingA();
    log = [];

    await store.startNarration({ narration: narrationB });
    expect(log.indexOf('pause')).toBeGreaterThanOrEqual(0);
    expect(log.indexOf('pause')).toBeLessThan(log.indexOf(streamOf('narr-b')));

    await store.playFromUrl(SAMPLE, { key: 'sample-1' });
    log = [];
    await store.startNarration({ narration: narrationA });
    expect(log[0]).toBe('pause');
    expect(log).toContain(streamOf('narr-a'));

    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });
    log = [];
    await store.startNarration({ narration: narrationB });
    expect(log.indexOf('pause')).toBeLessThan(log.indexOf(streamOf('narr-b')));
  });

  it('without autoplay a new story loads paused even if another was playing', async () => {
    const { store, player } = await playingA();

    await store.startNarration({ narration: narrationB });

    expect(store.audioId).toBe('narr-b');
    expect(store.isPlaying).toBe(false);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('switching tracks saves the old position under the old id only, from the player itself', async () => {
    const { store, player } = await playingA(328);
    player.currentTime = 328.5;
    mockGetFreshAccessToken.mockImplementationOnce(async () => {
      // The old stream keeps reporting while narration B is loading.
      player.emit({ currentTime: 331.5, duration: 400, playing: true });
      return TOKEN;
    });

    await store.startNarration({ narration: narrationB });
    await flush();

    expect(await AsyncStorage.getItem(positionKey('narr-b'))).toBeNull();
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('328500');
    expect(knownNarrationDurationMs('narr-b')).toBeNull();
    expect(store.currentPositionMs).toBe(0);
  });

  it('a failing player setup leaves the previous story untouched', async () => {
    const { store } = await createStore();
    await store.startNarration({ narration: narrationA });
    // The native player is gone and cannot be created again.
    store.dispose();
    mockSetAudioModeAsync.mockRejectedValue(new Error('audio session busy'));

    await expect(store.startNarration({ narration: narrationB })).resolves.toBe(false);

    expect(store.audioId).toBe('narr-a');
    expect(store.currentStory?.id).toBe('story-123');
    expect(store.currentVoiceProfile).toEqual(narrationA.voiceProfile);
    expect(store.loadPhase).toBe('failed');
    expect(store.loadError).toBe('loadFailed');
    expect(store.isPlaying).toBe(false);
    expect(store.pendingNarrationId).toBeNull();
    expect(toastError).toHaveBeenCalledWith(msg('player.loadFailed'));
  });

  it('a failing token read leaves the previous story untouched and reports once', async () => {
    const { store, player } = await playingA();
    mockGetFreshAccessToken.mockRejectedValueOnce(new Error('keychain unavailable'));

    await expect(store.startNarration({ narration: narrationB }, { autoplay: true })).resolves.toBe(false);

    expect(store.audioId).toBe('narr-a');
    expect(store.currentStory?.title).toBe('Küçük Tavşan ile Havuç Macerası');
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(store.loadError).toBe('loadFailed');
    // The failure is the started story's, not the loaded one's.
    expect(store.loadErrorNarrationId).toBe('narr-b');
    expect(store.isPlaying).toBe(false);
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Masal yüklenemedi');
    // The intact story plays again on the next play (reloaded first).
    await store.play();
    expect(player.replace).toHaveBeenLastCalledWith(
      expect.objectContaining({ uri: `${BASE_URL}/narrations/narr-a/stream` }),
    );
    expect(store.isPlaying).toBe(true);
    expect(store.loadError).toBeNull();
    expect(store.loadErrorNarrationId).toBeNull();
  });

  it('a replace that throws keeps the new story, without sound', async () => {
    const { store, player } = await createStore();
    player.replace.mockImplementationOnce(() => {
      throw new Error('native');
    });

    await expect(store.startNarration({ narration: narrationB }, { autoplay: true })).resolves.toBe(false);

    expect(store.audioId).toBe('narr-b');
    expect(store.loadPhase).toBe('failed');
    expect(store.loadError).toBe('loadFailed');
    expect(store.loadErrorNarrationId).toBe('narr-b');
    expect(store.isPlaying).toBe(false);
    expect(player.play).not.toHaveBeenCalled();
  });

  it('a second start during the first wins', async () => {
    const { store, player } = await createStore();
    const firstToken = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(firstToken.promise);

    const first = store.startNarration({ narration: narrationB }, { autoplay: true });
    // The first start waits for its token when the second one begins.
    await flush();
    expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    const second = store.startNarration({ narration: narrationC });
    await expect(second).resolves.toBe(true);
    firstToken.resolve(TOKEN);

    await expect(first).resolves.toBe(false);
    expect(store.audioId).toBe('narr-c');
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(log).toContain(streamOf('narr-c'));
    expect(log).not.toContain(streamOf('narr-b'));
    // The later start had no autoplay: nothing sounds.
    expect(player.play).not.toHaveBeenCalled();
    expect(store.loadPhase).toBe('ready');
  });

  it('the same narration started twice joins the first start (and keeps an autoplay)', async () => {
    const { store, player } = await createStore();
    const token = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(token.promise);

    const first = store.startNarration({ narration: narrationA });
    const second = store.startNarration({ narrationId: 'narr-a' }, { autoplay: true });
    token.resolve(TOKEN);

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('already loaded + autoplay + paused plays without a replace', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });

    await expect(store.startNarration({ narrationId: 'narr-a' }, { autoplay: true })).resolves.toBe(true);

    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(true);
  });

  it('already loaded, finished and autoplay starts it over', async () => {
    const { store, player } = await playingA();
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });

    await store.startNarration({ narrationId: 'narr-a' }, { autoplay: true });

    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(player.seekTo).toHaveBeenLastCalledWith(0);
    expect(store.storyEnded).toBe(false);
    expect(store.isPlaying).toBe(true);
  });

  it('a meta input streams without fetching first and refreshes in the background', async () => {
    const meta = { ...metaFromNarration(narrationB), voiceProfile: null, narratorName: 'Eski Ad' };
    const fresh = deferred<StoryNarration>();
    mockGetNarrationById.mockReturnValue(fresh.promise);
    const { store, player } = await createStore();

    await store.startNarration({ narrationId: 'narr-b', meta }, { autoplay: true });

    // Streaming before any network answer about the narration.
    expect(log).toContain(streamOf('narr-b'));
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(store.currentStory?.title).toBe('Deniz Feneri');
    expect(store.currentVoiceProfile).toBeNull();
    expect(store.currentNarratorName).toBe('Eski Ad');
    expect(mockGetNarrationById).toHaveBeenCalledWith('narr-b');

    fresh.resolve(narrationB);
    await flush();

    expect(store.currentVoiceProfile).toEqual(narrationB.voiceProfile);
    expect(store.currentNarratorName).toBe('Babamın Sesi');
    expect(getNarrationMeta('narr-b')?.voiceProfile).toEqual(narrationB.voiceProfile);
  });

  it('a bare id starts from the remembered meta', async () => {
    rememberNarrationMeta(metaFromNarration(narrationB));
    const { store } = await createStore();

    await store.startNarration({ narrationId: 'narr-b' });

    expect(store.audioId).toBe('narr-b');
    expect(store.currentStory?.title).toBe('Deniz Feneri');
    // Only the background refresh asked the network.
    expect(mockGetNarrationById).toHaveBeenCalledTimes(1);
  });

  it('a refresh of a narration that was replaced meanwhile changes nothing', async () => {
    const fresh = deferred<StoryNarration>();
    mockGetNarrationById.mockReturnValueOnce(fresh.promise);
    const { store } = await createStore();
    await store.startNarration({ narrationId: 'narr-b', meta: metaFromNarration(narrationB) });
    await store.startNarration({ narration: narrationC });

    fresh.resolve({ ...narrationB, story: { ...narrationB.story!, title: 'Başka' } });
    await flush();

    expect(store.currentStory?.title).toBe('Kibritçi Kız');
  });

  it('a 404 of the background refresh marks the loaded story as gone and stops it', async () => {
    mockGetNarrationById.mockRejectedValueOnce(apiErrorFromResponse(404, { message: 'Not found' }));
    const { store, player } = await createStore();

    await store.startNarration({ narrationId: 'narr-b', meta: metaFromNarration(narrationB) }, { autoplay: true });
    await flush();

    expect(store.loadError).toBe('notFound');
    expect(store.loadErrorNarrationId).toBe('narr-b');
    expect(store.isPlaying).toBe(false);
    expect(player.pause).toHaveBeenCalled();
  });

  it("a 404 of the outgoing story's refresh while the next one starts leaves that start alone", async () => {
    const fresh = deferred<StoryNarration>();
    mockGetNarrationById.mockReturnValueOnce(fresh.promise);
    const { store, player } = await createStore();
    await store.startNarration({ narrationId: 'narr-b', meta: metaFromNarration(narrationB) }, { autoplay: true });

    // "Sonraki": C is still waiting for its token while B's refresh answers 404.
    const token = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(token.promise);
    const next = store.startNarration({ narration: narrationC }, { autoplay: true });
    await flush();
    expect(store.pendingNarrationId).toBe('narr-c');
    fresh.reject(apiErrorFromResponse(404, { message: 'Not found' }));
    await flush();

    expect(store.loadError).toBeNull();
    expect(store.loadErrorNarrationId).toBeNull();
    expect(store.isPlaying).toBe(true);

    player.play.mockClear();
    token.resolve(TOKEN);
    await expect(next).resolves.toBe(true);
    expect(store.audioId).toBe('narr-c');
    expect(store.loadPhase).toBe('ready');
    // The incoming story still plays.
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('an unknown narration is fetched first', async () => {
    mockGetNarrationById.mockResolvedValue(narrationB);
    const { store } = await createStore();

    await expect(store.startNarration({ narrationId: 'narr-b' })).resolves.toBe(true);

    expect(mockGetNarrationById).toHaveBeenCalledTimes(1);
    expect(store.currentStory?.title).toBe('Deniz Feneri');
    expect(store.currentVoiceProfile).toEqual(narrationB.voiceProfile);
  });

  it.each([
    [404, 'notFound'],
    [500, 'loadFailed'],
  ] as const)('an unknown narration whose fetch fails with %i reports %s and replaces nothing', async (status, error) => {
    mockGetNarrationById.mockRejectedValue(apiErrorFromResponse(status, { message: 'x' }));
    const { store, player } = await playingA();

    await expect(store.startNarration({ narrationId: 'narr-x' }, { autoplay: true })).resolves.toBe(false);

    expect(store.loadError).toBe(error);
    // Named after the narration that was started: "narr-a" is still loaded.
    expect(store.loadErrorNarrationId).toBe('narr-x');
    expect(store.loadPhase).toBe('failed');
    expect(store.isPlaying).toBe(false);
    expect(store.pendingNarrationId).toBeNull();
    expect(player.replace).toHaveBeenCalledTimes(1);
    // The story that played before rests where it was, its position saved.
    expect(store.audioId).toBe('narr-a');
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('60000');
  });

  it('writes the last played record with the account and the time; samples and generation never do', async () => {
    const { store } = await createStore();

    await store.playFromUrl(SAMPLE, { key: 'sample-1' });
    mockCreateNarration.mockResolvedValue({ id: 'narr-g' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'READY', progress: 100 });
    await store.generateAudio(narrationB.story!, narrationB.voiceProfile!);
    await jest.advanceTimersByTimeAsync(POLLING_INTERVALS.AUDIO_GENERATION);
    expect(await AsyncStorage.getItem(LAST_PLAYED_STORAGE_KEY)).toBeNull();

    jest.setSystemTime(new Date('2026-10-19T21:00:00Z'));
    await store.startNarration({ narration: narrationA });
    await flush();

    const record = JSON.parse((await AsyncStorage.getItem(LAST_PLAYED_STORAGE_KEY)) ?? '{}');
    expect(record).toMatchObject({
      narrationId: 'narr-a',
      storyId: 'story-123',
      userId: 'u-1',
      updatedAt: Date.parse('2026-10-19T21:00:00Z'),
      narratorName: 'Babamın Sesi',
      estimateMs: 300000,
      voiceProfile: null,
    });
    // And the meta is remembered for an instant start later.
    expect(getNarrationMeta('narr-a')?.story.title).toBe('Küçük Tavşan ile Havuç Macerası');
  });

  it('tells the start listener about every new start, not about an already loaded one', async () => {
    const listener = jest.fn();
    const { store } = await createStore();
    store.setStartListener(listener);

    await store.startNarration({ narration: narrationA }, { autoplay: true, fromQueue: true });
    await store.startNarration({ narrationId: 'narr-a' });
    await store.startNarration({ narration: narrationB });

    expect(listener.mock.calls).toEqual([
      ['narr-a', { autoplay: true, fromQueue: true }],
      ['narr-b', {}],
    ]);
  });

  it('a missing id reports the story as not found', async () => {
    const { store, player } = await createStore();

    await expect(store.startNarration({ narrationId: '' })).resolves.toBe(false);

    expect(toastError).toHaveBeenCalledWith('Masal bulunamadı.');
    expect(player.replace).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Intent and status updates
// ============================================================================

describe('AudioPlayerStore intent and status', () => {
  it('a buffering status after play keeps the intent; the toggle then pauses', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.play();

    player.emit({ playing: false, isBuffering: true, playbackState: 'buffering' });

    expect(store.isPlaying).toBe(true);
    expect(store.isBuffering).toBe(true);
    expect(store.isBusy).toBe(true);

    // The native player says "not playing" while it buffers: the toggle reads the intent.
    player.playing = false;
    await store.togglePlayPause();

    expect(player.pause).toHaveBeenCalledTimes(1 + 1);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(false);
    expect(store.isBuffering).toBe(false);
  });

  it('iOS waiting and Android buffering states count as buffering', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });

    player.emit({ playing: false, timeControlStatus: 'waitingToPlayAtSpecifiedRate', playbackState: 'readyToPlay' });
    expect(store.isBuffering).toBe(true);
    player.emit({ playing: true, playbackState: 'readyToPlay' });
    expect(store.isBuffering).toBe(false);
    player.emit({ playing: false, playbackState: 'buffering' });
    expect(store.isBuffering).toBe(true);
    expect(store.isPlaying).toBe(true);
  });

  it('an Android stall in mid-story reports playing with buffering: it counts as buffering', async () => {
    const { store, player } = await playingA();
    expect(store.isBuffering).toBe(false);

    // ExoPlayer stalls: `playing` stays the intended state while it buffers.
    player.emit({ currentTime: 61, duration: 300, playing: true, isBuffering: true, playbackState: 'buffering' });
    expect(store.isPlaying).toBe(true);
    expect(store.isBuffering).toBe(true);
    expect(store.isBusy).toBe(true);

    player.emit({ currentTime: 61.2, duration: 300, playing: true, isBuffering: false, playbackState: 'ready' });
    expect(store.isBuffering).toBe(false);
    expect(store.isBusy).toBe(false);
  });

  it('play marks a not yet loaded source as buffering', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.isLoaded = false;

    await store.play();

    expect(store.isBuffering).toBe(true);
    expect(store.isBusy).toBe(true);
  });

  it('a ready, not playing report after the settle time is an external pause and saves the position', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.play();

    // Within PLAY_SETTLE_MS a fresh play still reports not playing.
    jest.advanceTimersByTime(PLAY_SETTLE_MS - 500);
    player.emit({ playing: false, playbackState: 'ready', currentTime: 1 });
    expect(store.isPlaying).toBe(true);

    jest.advanceTimersByTime(1000);
    player.emit({ playing: false, playbackState: 'ready', currentTime: 12 });
    await flush();

    expect(store.isPlaying).toBe(false);
    expect(store.showMiniPlayer).toBe(false);
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('12000');
  });

  it('playing: true after an external pause sets the intent again', async () => {
    const { store, player } = await playingA();
    jest.advanceTimersByTime(PLAY_SETTLE_MS + 1);
    player.emit({ playing: false, playbackState: 'ready', currentTime: 61 });
    expect(store.isPlaying).toBe(false);

    player.emit({ playing: true, playbackState: 'ready', currentTime: 62 });

    expect(store.isPlaying).toBe(true);
    expect(store.showMiniPlayer).toBe(true);
  });

  it('mirrors position and the real duration; an unknown duration keeps the last one', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });

    player.emit({ currentTime: 30, duration: 120, playing: true });
    expect(store.currentPositionMs).toBe(30_000);
    expect(store.totalDurationMs).toBe(120_000);
    expect(store.progressPercent).toBe(25);
    expect(knownNarrationDurationMs('narr-a')).toBe(120_000);

    player.emit({ currentTime: 31, duration: 0, playing: true });
    expect(store.totalDurationMs).toBe(120_000);
  });

  it('ignores statuses while a start is loading and when nothing is loaded', async () => {
    const { store, player } = await createStore();
    player.emit({ currentTime: 9, duration: 50, playing: true });
    expect(store.currentPositionMs).toBe(0);
    expect(store.isPlaying).toBe(false);

    const token = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(token.promise);
    const start = store.startNarration({ narration: narrationA });
    player.emit({ currentTime: 9, duration: 50, playing: true });
    expect(store.totalDurationMs).toBe(0);
    token.resolve(TOKEN);
    await start;
    expect(knownNarrationDurationMs('narr-a')).toBeNull();
  });

  it('saves the story position at most every 3 seconds while playing', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    (AsyncStorage.setItem as jest.Mock).mockClear();
    const positionWrites = () =>
      (AsyncStorage.setItem as jest.Mock).mock.calls.filter(c => c[0] === positionKey('narr-a'));

    player.emit({ currentTime: 1, duration: 300, playing: true });
    expect(positionWrites()).toHaveLength(0);
    player.emit({ currentTime: 3.5, duration: 300, playing: true });
    expect(positionWrites()).toEqual([[positionKey('narr-a'), '3500']]);
    player.emit({ currentTime: 5, duration: 300, playing: true });
    expect(positionWrites()).toHaveLength(1);
    player.emit({ currentTime: 7, duration: 300, playing: true });
    expect(positionWrites()).toEqual([
      [positionKey('narr-a'), '3500'],
      [positionKey('narr-a'), '7000'],
    ]);
    expect(store.positionSeconds).toBe(7);
  });

  it('remainingMinutes follows the playback speed: 10 min left at 2,0x is 5', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    player.emit({ currentTime: 0, duration: 600, playing: true });
    expect(store.remainingMinutes).toBe(10);

    await store.setSpeed(2);

    expect(store.remainingMinutes).toBe(5);
  });

  it('whole seconds and minutes left are computed: observers run when the value changes', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    player.emit({ currentTime: 0, duration: 300, playing: true });
    const seconds: number[] = [];
    const minutes: Array<number | null> = [];
    const disposeSeconds = autorun(() => seconds.push(store.positionSeconds));
    const disposeMinutes = autorun(() => minutes.push(store.remainingMinutes));

    for (const currentTime of [10, 10.5, 11, 11.5, 12, 59.5, 60.5]) {
      player.emit({ currentTime, duration: 300, playing: true });
    }
    disposeSeconds();
    disposeMinutes();

    expect(seconds).toEqual([0, 10, 11, 12, 59, 60]);
    expect(minutes).toEqual([5, 4]);
  });
});

// ============================================================================
// The end of a story
// ============================================================================

describe('AudioPlayerStore story end', () => {
  it('with no handler: the story rests at its end, the intent stops, the saved position goes', async () => {
    const { store, player } = await playingA();
    await AsyncStorage.setItem(positionKey('narr-a'), '150000');

    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
    await flush();

    expect(store.storyEnded).toBe(true);
    expect(store.isPlaying).toBe(false);
    expect(store.showMiniPlayer).toBe(false);
    expect(store.progressPercent).toBe(100);
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBeNull();
    // Android keeps playWhenReady after the end: the store pauses it.
    expect(log[log.length - 1]).toBe('pause');
    // No end flag for a screen to consume: the store handled the end.
    expect('didJustFinish' in store).toBe(false);
    expect('acknowledgeFinish' in store).toBe(false);
  });

  it("with a handler that advances, the mini player never reads false between the two stories", async () => {
    const { store, player } = await playingA();
    const handler = jest.fn((finishedId: string) => {
      void store.startNarration({ narration: narrationB }, { autoplay: true, fromQueue: true });
      return finishedId === 'narr-a' ? ('advance' as const) : ('stop' as const);
    });
    store.setStoryEndHandler(handler);
    const shown: boolean[] = [];
    const dispose = reaction(
      () => store.showMiniPlayer,
      value => shown.push(value),
      { fireImmediately: true },
    );
    log = [];

    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
    await flush();
    dispose();

    expect(handler).toHaveBeenCalledWith('narr-a');
    expect(shown).toEqual([true]);
    expect(store.audioId).toBe('narr-b');
    expect(store.isPlaying).toBe(true);
    expect(log.slice(-2)).toEqual([streamOf('narr-b'), 'play']);
  });

  it("a handler that stops, or throws, leaves the story at its end", async () => {
    const { store, player } = await playingA();
    store.setStoryEndHandler(() => 'stop');
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });
    expect(store.isPlaying).toBe(false);
    expect(store.storyEnded).toBe(true);

    await store.play();
    store.setStoryEndHandler(() => {
      throw new Error('queue bug');
    });
    // A later end (an end reported right after the restart landed is the old one).
    jest.advanceTimersByTime(SEEK_CONFIRM_MS + 1);
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });
    expect(store.isPlaying).toBe(false);
  });

  it('play after the end starts the story over', async () => {
    const { store, player } = await playingA();
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });

    await store.togglePlayPause();

    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(store.storyEnded).toBe(false);
    expect(store.currentPositionMs).toBe(0);
  });

  it('a restart shows the pause icon and the start at once; the old end reported meanwhile moves nothing back', async () => {
    const { store, player } = await playingA();
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });
    const seek = deferred<void>();
    player.seekTo.mockImplementationOnce(() => seek.promise);
    const intent: boolean[] = [];
    const dispose = reaction(() => store.isPlaying, playing => intent.push(playing));

    const playing = store.togglePlayPause();

    // Before the seek has landed: the intent, the knob and the clock.
    expect(store.isPlaying).toBe(true);
    expect(store.storyEnded).toBe(false);
    expect(store.currentPositionMs).toBe(0);
    expect(store.positionSeconds).toBe(0);
    // A late report of the end: neither the position nor the intent go back.
    player.emit({ currentTime: 300, duration: 300, playing: false, playbackState: 'ready' });
    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
    expect(store.currentPositionMs).toBe(0);
    expect(store.isPlaying).toBe(true);
    expect(store.storyEnded).toBe(false);

    seek.resolve();
    await playing;
    dispose();

    expect(intent).toEqual([true]);
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(store.isSeeking).toBe(false);
    // Reports count again once the seek landed (this one a second later).
    jest.advanceTimersByTime(1000);
    player.emit({ currentTime: 1, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(1000);
  });

  it('a report of the old end read before the restart landed ends nothing and moves nothing (NL-01)', async () => {
    const { store, player } = await playingA();
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });

    await store.togglePlayPause();
    expect(store.isSeeking).toBe(false);
    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });

    expect(store.storyEnded).toBe(false);
    expect(store.isPlaying).toBe(true);
    expect(store.currentPositionMs).toBe(0);
    player.emit({ currentTime: 0.4, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(400);
  });

  it('a pause while the restart seeks back wins: nothing plays after the seek, the end is not saved', async () => {
    const { store, player } = await playingA();
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });
    const seek = deferred<void>();
    player.seekTo.mockImplementationOnce(() => seek.promise);
    player.currentTime = 300;

    const playing = store.togglePlayPause();
    expect(store.isPlaying).toBe(true);
    await store.togglePlayPause();
    expect(store.isPlaying).toBe(false);
    seek.resolve();
    await playing;
    await flush();

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(false);
    expect(store.currentPositionMs).toBe(0);
    // The end removed the saved position; the pause during the seek did not
    // write the old end back.
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBeNull();
  });

  it('a long restart seek: a paused report of the old end does not flip the icon', async () => {
    const { store, player } = await playingA();
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });
    const seek = deferred<void>();
    player.seekTo.mockImplementationOnce(() => seek.promise);

    const playing = store.togglePlayPause();
    jest.advanceTimersByTime(PLAY_SETTLE_MS + 500);
    player.emit({ currentTime: 300, duration: 300, playing: false, playbackState: 'ready' });
    expect(store.isPlaying).toBe(true);

    seek.resolve();
    await playing;
    expect(player.play).toHaveBeenCalledTimes(2);
    expect(store.isPlaying).toBe(true);
  });

  it('a restart whose seek fails stops the intent and says so', async () => {
    const { store, player } = await playingA();
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });
    player.seekTo.mockRejectedValueOnce(new Error('seek failed'));

    await store.togglePlayPause();

    expect(store.isPlaying).toBe(false);
    expect(store.isSeeking).toBe(false);
    expect(toastError).toHaveBeenCalledWith(msg('player.playFailed'));
  });

  it('play within the last half second also starts over', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.emit({ currentTime: 299.7, duration: 300, playing: false });

    await store.togglePlayPause();

    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('the media session play restarts a finished story too', async () => {
    const { store, player } = await playingA();
    player.emit({ currentTime: 300, duration: 300, didJustFinish: true });

    await store.remotePlay();

    expect(player.seekTo).toHaveBeenLastCalledWith(0);
    expect(store.isPlaying).toBe(true);
  });
});

// ============================================================================
// Controls
// ============================================================================

describe('AudioPlayerStore playback controls', () => {
  it('play without a loaded story is a no-op', async () => {
    const { store, player } = await createStore();

    await store.play();
    await store.togglePlayPause();

    expect(player.play).not.toHaveBeenCalled();
    expect(store.isPlaying).toBe(false);
  });

  it('play during a start only records the intent; the start plays', async () => {
    const { store, player } = await createStore();
    const token = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(token.promise);
    const start = store.startNarration({ narration: narrationA });

    await store.play();
    expect(store.isPlaying).toBe(true);
    expect(player.play).not.toHaveBeenCalled();
    token.resolve(TOKEN);
    await start;

    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('pause during a start keeps it silent', async () => {
    const { store, player } = await createStore();
    const token = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(token.promise);
    const start = store.startNarration({ narration: narrationA }, { autoplay: true });

    await store.pause();
    token.resolve(TOKEN);
    await start;

    expect(player.play).not.toHaveBeenCalled();
    expect(store.isPlaying).toBe(false);
  });

  it('play failure clears the intent and explains it', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.play.mockImplementation(() => {
      throw new Error('native player gone');
    });

    await store.play();

    expect(store.isPlaying).toBe(false);
    expect(toastError).toHaveBeenCalledWith('Oynatma başarısız oldu. Lütfen tekrar dene.');
  });

  it('play asks the sleep timer first and restores the volume unless the timer fades it', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.volume = 0;

    await store.play();
    expect(mockTimer.onPlayRequested).toHaveBeenCalledTimes(1);
    expect(player.volume).toBe(1);

    await store.pause();
    player.volume = 0.3;
    mockTimer.isFading = true;
    await store.play();
    expect(player.volume).toBe(0.3);
  });

  it('pause saves the exact position the player stopped at', async () => {
    const { store, player } = await playingA(12);
    player.currentTime = 12.34;

    await store.pause();
    await flush();

    expect(player.pause).toHaveBeenCalled();
    expect(store.isPlaying).toBe(false);
    expect(store.currentPositionMs).toBe(12_340);
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('12340');
  });

  it('a pause from the dock keeps the mini player for 5 s, a play clears the hold', async () => {
    const { store } = await playingA();
    expect(store.showMiniPlayer).toBe(true);

    await store.pause({ fromDock: true });
    expect(store.isPlaying).toBe(false);
    expect(store.dockHold).toBe(true);
    expect(store.showMiniPlayer).toBe(true);
    jest.advanceTimersByTime(DOCK_PAUSE_HOLD_MS - 1);
    expect(store.showMiniPlayer).toBe(true);
    jest.advanceTimersByTime(1);
    expect(store.showMiniPlayer).toBe(false);

    await store.togglePlayPause({ fromDock: true });
    await store.togglePlayPause({ fromDock: true });
    await store.play();
    expect(store.dockHold).toBe(false);
    jest.advanceTimersByTime(DOCK_PAUSE_HOLD_MS);
    expect(store.showMiniPlayer).toBe(true);
  });

  it('a pause anywhere else hides the mini player at once', async () => {
    const { store } = await playingA();

    await store.pause();

    expect(store.dockHold).toBe(false);
    expect(store.showMiniPlayer).toBe(false);
  });

  it('seek moves the player and the position, clamped to the known length; failures revert', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.emit({ currentTime: 0, duration: 300, playing: false });

    await store.seek(42);
    expect(player.seekTo).toHaveBeenLastCalledWith(42);
    expect(store.currentPositionMs).toBe(42_000);
    expect(store.currentPosition).toBe(42);

    await store.seek(400);
    expect(player.seekTo).toHaveBeenLastCalledWith(300);
    expect(store.currentPositionMs).toBe(300_000);

    await store.seek(-5);
    expect(player.seekTo).toHaveBeenLastCalledWith(0);

    player.seekTo.mockRejectedValueOnce(new Error('seek failed'));
    await store.seek(90);
    expect(store.currentPositionMs).toBe(0);
  });

  it('skipForward 10 s before the end lands on the end, not past it', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.emit({ currentTime: 295, duration: 300, playing: false });
    player.currentTime = 295;

    await store.skipForward(15);

    expect(player.seekTo).toHaveBeenLastCalledWith(300);
    expect(store.currentPositionMs).toBe(300_000);
  });

  it('skipForward / skipBackward use the player time and the default interval', async () => {
    const { store, player } = await createStore();
    player.currentTime = 25;

    await store.skipForward();
    expect(player.seekTo).toHaveBeenLastCalledWith(25 + AUDIO_PLAYBACK.SEEK_INTERVAL_SECONDS);

    await store.skipBackward();
    expect(player.seekTo).toHaveBeenLastCalledWith(25 - AUDIO_PLAYBACK.SEEK_INTERVAL_SECONDS);

    player.currentTime = 4;
    await store.skipBackward();
    expect(player.seekTo).toHaveBeenLastCalledWith(0);
  });

  it('seek and skip are no-ops without a player', async () => {
    const { store, player } = await createStore();
    store.dispose();

    await store.seek(10);
    await store.skipForward();
    await store.skipBackward();

    expect(player.seekTo).not.toHaveBeenCalled();
  });

  it('a seek moves the position at once and ignores stale reports until it lands', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    let land: () => void = () => undefined;
    player.seekTo.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          land = () => resolve();
        }),
    );
    const epoch = store.positionEpoch;

    const seeking = store.seek(42);
    expect(store.currentPositionMs).toBe(42_000);
    expect(store.positionEpoch).toBe(epoch + 1);
    expect(store.isSeeking).toBe(true);

    // Emitted before the seek took effect: still the old position.
    player.emit({ currentTime: 5, duration: 300, playing: false });
    expect(store.currentPositionMs).toBe(42_000);

    land();
    await seeking;
    expect(store.isSeeking).toBe(false);
    // Half a second later the player reports from the target on.
    jest.advanceTimersByTime(500);
    player.emit({ currentTime: 42.5, duration: 300, playing: false });
    expect(store.currentPositionMs).toBe(42_500);
  });

  it('a 15 s rewind: a report read before the jump moves neither the clock nor the bar back (NL-01)', async () => {
    const { store, player } = await playingA(114);
    const driver = new PlaybackProgressDriver();
    const unbind = bindPlaybackProgress(store, driver);
    const epoch = store.positionEpoch;

    await store.skipBackward(15);
    expect(player.seekTo).toHaveBeenLastCalledWith(99);
    expect(store.currentPositionMs).toBe(99_000);

    // The seek call returned; half a second later a report the player read
    // before the jump arrives, on the old timeline.
    jest.advanceTimersByTime(450);
    player.emit({ currentTime: 114.4, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(99_000);
    expect(store.positionSeconds).toBe(99);
    expect(store.positionEpoch).toBe(epoch + 1);
    expect(driver.shownFraction()).toBeCloseTo(99_450 / 300_000, 3);

    // The next report agrees with the target: it counts, and every later one.
    jest.advanceTimersByTime(500);
    player.emit({ currentTime: 99.9, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(99_900);
    player.emit({ currentTime: 100.4, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(100_400);
    unbind();
  });

  it('after the confirmation window a report counts even far from the target (the player did not follow)', async () => {
    const { store, player } = await playingA(114);

    await store.seek(99);
    jest.advanceTimersByTime(SEEK_CONFIRM_MS);
    player.emit({ currentTime: 115, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(99_000);

    jest.advanceTimersByTime(1);
    player.emit({ currentTime: 115.2, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(115_200);
  });

  it('a forward skip and a seek while paused take the first report near the target', async () => {
    const { store, player } = await playingA(60);

    await store.skipForward(15);
    player.emit({ currentTime: 75.3, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(75_300);

    await store.pause();
    await store.seek(30);
    player.emit({ currentTime: 30, duration: 300, playing: false, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(30_000);
    // Confirmed: the next report counts wherever it is.
    player.emit({ currentTime: 31, duration: 300, playing: false, playbackState: 'ready' });
    expect(store.currentPositionMs).toBe(31_000);
  });

  it('a new story right after a seek takes its own reports at once', async () => {
    const { store, player } = await playingA(114);
    await store.seek(99);

    await store.startNarration({ narration: narrationB }, { autoplay: true });
    player.emit({ currentTime: 0.4, duration: 120, playing: true, playbackState: 'ready' });

    expect(store.audioId).toBe('narr-b');
    expect(store.currentPositionMs).toBe(400);
  });

  it('setSpeed sets the pitch-corrected playback rate', async () => {
    const { store, player } = await createStore();

    await store.setSpeed(1.5);

    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5, 'high');
    expect(player.shouldCorrectPitch).toBe(true);
    expect(store.playbackSpeed).toBe(1.5);
    // A speed for this story only is not stored anywhere.
    expect(mockPrefsUpdate).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY)).toBeNull();
  });

  it('setVolume clamps to 0..1 and is a no-op without a player', async () => {
    const { store, player } = await createStore();

    store.setVolume(0.4);
    expect(player.volume).toBe(0.4);
    store.setVolume(7);
    expect(player.volume).toBe(1);
    store.setVolume(-1);
    expect(player.volume).toBe(0);

    store.dispose();
    expect(() => store.setVolume(0.5)).not.toThrow();
  });

  it('the free plan background pause: a native resume is paused again until the user plays', async () => {
    const { store, player } = await playingA();
    await store.pause();
    store.setVolume(0);
    store.setPausedByBackground(true);
    log = [];

    // expo-audio resumes by itself when the app returns.
    player.emit({ playing: true, currentTime: 61, playbackState: 'ready' });

    expect(log).toEqual(['pause']);
    expect(store.isPlaying).toBe(false);
    expect(store.pausedByBackground).toBe(true);

    await store.play();
    expect(store.pausedByBackground).toBe(false);
    expect(player.volume).toBe(1);
    expect(store.isPlaying).toBe(true);
  });
});

// ============================================================================
// Story start watchdog and the stream token
// ============================================================================

describe('AudioPlayerStore failure attribution', () => {
  it('a failed start never names the loaded story; the next start of that story clears it', async () => {
    mockGetNarrationById.mockRejectedValueOnce(apiErrorFromResponse(404, { message: 'x' }));
    const { store } = await playingA();

    await store.startNarration({ narrationId: 'narr-gone' }, { autoplay: true });
    expect(store.audioId).toBe('narr-a');
    expect(store.loadError).toBe('notFound');
    expect(store.loadErrorNarrationId).toBe('narr-gone');
    expect(store.loadErrorNarrationId).not.toBe(store.audioId);

    // The next start (any narration) clears the old failure before it runs.
    await store.startNarration({ narration: narrationB });
    expect(store.loadError).toBeNull();
    expect(store.loadErrorNarrationId).toBeNull();
  });

  it('a stream that never sounds names the loaded story until it sounds', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    expect(store.loadErrorNarrationId).toBe('narr-a');

    player.emit({ playing: true, currentTime: 1, playbackState: 'ready' });
    expect(store.loadError).toBeNull();
    expect(store.loadErrorNarrationId).toBeNull();
  });

  it('a sample and a stop clear the failure with the error', async () => {
    mockGetNarrationById.mockRejectedValueOnce(apiErrorFromResponse(500, { message: 'x' }));
    const { store } = await playingA();
    await store.startNarration({ narrationId: 'narr-x' });
    expect(store.loadErrorNarrationId).toBe('narr-x');

    await store.playFromUrl('https://cdn.sesly.io/sample.mp3', { key: 'k' });
    expect(store.loadError).toBeNull();
    expect(store.loadErrorNarrationId).toBeNull();

    mockGetNarrationById.mockRejectedValueOnce(apiErrorFromResponse(404, { message: 'x' }));
    await store.startNarration({ narrationId: 'narr-y' });
    expect(store.loadErrorNarrationId).toBe('narr-y');
    await store.stopAndCleanup();
    expect(store.loadError).toBeNull();
    expect(store.loadErrorNarrationId).toBeNull();
  });
});

describe('AudioPlayerStore story start watchdog', () => {
  it('a stream that never sounds within 15 s fails as streamFailed, without a toast', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });

    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS - 1);
    expect(store.loadError).toBeNull();
    jest.advanceTimersByTime(1);

    expect(store.loadError).toBe('streamFailed');
    expect(store.loadErrorNarrationId).toBe('narr-a');
    expect(store.loadPhase).toBe('failed');
    expect(store.isPlaying).toBe(false);
    expect(log[log.length - 1]).toBe('pause');
    expect(toastError).not.toHaveBeenCalled();
    // Still the loaded story: the player shows the inline retry.
    expect(store.isStoryLoaded).toBe(true);
  });

  it("an iOS 'failed' status reloads the stream once; a second one fails it at once", async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    log = [];

    player.emit({ playing: false, playbackState: 'failed' });
    await flush();

    expect(log).toEqual(['pause', streamOf('narr-a'), 'play']);
    // The automatic reload asks for a new token even if the old one looks valid.
    expect(mockGetFreshAccessToken).toHaveBeenLastCalledWith(Number.POSITIVE_INFINITY);
    expect(store.loadError).toBeNull();
    expect(store.isPlaying).toBe(true);

    player.emit({ playing: false, playbackState: 'failed' });

    expect(store.loadError).toBe('streamFailed');
    expect(store.isPlaying).toBe(false);
  });

  it("an Android 'idle' status counts only after the grace: one reload, then the error", async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });

    player.emit({ playing: false, playbackState: 'idle' });
    expect(store.loadError).toBeNull();
    expect(player.replace).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    player.emit({ playing: false, playbackState: 'idle' });
    await flush();
    expect(player.replace).toHaveBeenCalledTimes(2);
    expect(store.loadError).toBeNull();

    // The reloaded source is idle again after its own grace: the error shows.
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    player.emit({ playing: false, playbackState: 'idle' });
    expect(store.loadError).toBe('streamFailed');
    expect(player.replace).toHaveBeenCalledTimes(2);
  });

  it('play over an Android source that failed while paused reloads it at once', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.emit({ currentTime: 42, duration: 300, playing: false, playbackState: 'ready' });
    // The connection dropped while paused: ExoPlayer rests in 'idle'.
    player.currentStatus = { playbackState: 'idle', duration: 300 };
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    mockGetFreshAccessToken.mockResolvedValueOnce('fresh-token');
    log = [];

    await store.play();

    expect(log).toEqual(['pause', streamOf('narr-a', 'fresh-token'), 'seek 42', 'play']);
    expect(store.isPlaying).toBe(true);
  });

  it('a source that was just replaced is not taken for a failed one', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.currentStatus = { playbackState: 'idle' };
    log = [];

    await store.play();

    expect(log).toEqual(['play']);
  });

  it('a sounding status clears the watch', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });

    player.emit({ playing: true, currentTime: 0.3, playbackState: 'ready' });
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS * 2);

    expect(store.loadError).toBeNull();
    expect(store.isPlaying).toBe(true);
  });

  it('the retry reloads with a fresh token at the position and plays', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    player.emit({ playing: false, currentTime: 42, playbackState: 'buffering' });
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    expect(store.loadError).toBe('streamFailed');
    mockGetFreshAccessToken.mockResolvedValueOnce('fresh-token');
    log = [];

    await store.reloadStream();

    expect(log).toEqual(['pause', streamOf('narr-a', 'fresh-token'), 'seek 42', 'play']);
    expect(store.loadError).toBeNull();
    expect(store.loadErrorNarrationId).toBeNull();
    expect(store.loadPhase).toBe('ready');
    expect(store.isPlaying).toBe(true);
    // Sounding clears what failed before.
    player.emit({ playing: true, currentTime: 42.5, playbackState: 'ready' });
    expect(store.loadError).toBeNull();
  });

  it('a reload that cannot get a token fails as streamFailed', async () => {
    const { store } = await playingA();
    mockGetFreshAccessToken.mockRejectedValueOnce(new Error('offline'));

    await store.reloadStream();

    expect(store.loadError).toBe('streamFailed');
    expect(store.loadErrorNarrationId).toBe('narr-a');
    expect(store.isPlaying).toBe(false);
  });

  it('play after 51 minutes reloads the stream with a fresh token before it plays', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.emit({ currentTime: 42, duration: 300, playing: false });
    expect(STREAM_TOKEN_MAX_AGE_MS).toBe(50 * 60 * 1000);
    jest.setSystemTime(Date.now() + 51 * 60 * 1000);
    mockGetFreshAccessToken.mockResolvedValueOnce('fresh-token');
    log = [];

    await store.play();

    expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(2);
    expect(log).toEqual(['pause', streamOf('narr-a', 'fresh-token'), 'seek 42', 'play']);
    expect(store.isPlaying).toBe(true);
    // Within the next 50 minutes no reload.
    await store.pause();
    log = [];
    await store.play();
    expect(log).toEqual(['play']);
  });
});

// ============================================================================
// Stream token (LR-1): every rewind is a new range request with the header
// ============================================================================

describe('AudioPlayerStore stream token', () => {
  const MINUTE = 60 * 1000;
  /** The stream tokens of these tests expire `ms` after now. */
  function tokenExpiresIn(token: string, ms: number): void {
    const expiresAt = Date.now() + ms;
    mockJwtExpiryMs.mockImplementation((value: unknown) => (value === token ? expiresAt : null));
  }

  it('the stream starts and reloads with a token asked for the whole reload window', async () => {
    expect(STREAM_TOKEN_MIN_VALIDITY_MS).toBe(STREAM_TOKEN_MAX_AGE_MS + STREAM_TOKEN_MARGIN_MS);
    const { store } = await createStore();

    await store.startNarration({ narration: narrationA });
    expect(mockGetFreshAccessToken).toHaveBeenCalledTimes(1);
    const [asked] = mockGetFreshAccessToken.mock.calls[0];
    expect(asked).toBeGreaterThanOrEqual(STREAM_TOKEN_MAX_AGE_MS);

    await store.reloadStream();
    expect(mockGetFreshAccessToken).toHaveBeenLastCalledWith(STREAM_TOKEN_MIN_VALIDITY_MS);
  });

  it('the reload deadline is the window, or the margin before an earlier token expiry', () => {
    const at = Date.parse('2026-10-20T05:41:00Z');
    mockJwtExpiryMs.mockImplementation((value: unknown) =>
      value === 'short' ? at + 20 * MINUTE : value === 'long' ? at + 60 * MINUTE : null,
    );

    expect(streamReloadDeadline('opaque', at)).toBe(at + STREAM_TOKEN_MAX_AGE_MS);
    expect(streamReloadDeadline(null, at)).toBe(at + STREAM_TOKEN_MAX_AGE_MS);
    expect(streamReloadDeadline('long', at)).toBe(at + STREAM_TOKEN_MAX_AGE_MS);
    expect(streamReloadDeadline('short', at)).toBe(at + 20 * MINUTE - STREAM_TOKEN_MARGIN_MS);
  });

  it('a seek before the deadline seeks the loaded stream', async () => {
    const { store, player } = await playingA(60);
    jest.setSystemTime(Date.now() + 49 * MINUTE);
    log = [];

    await store.seek(11);

    expect(log).toEqual(['seek 11']);
    expect(player.replace).toHaveBeenCalledTimes(1);
  });

  it('a seek after the deadline reloads the stream at the seek target and keeps a paused story paused', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.emit({ currentTime: 90, duration: 300, playing: false, playbackState: 'ready' });
    jest.setSystemTime(Date.now() + STREAM_TOKEN_MAX_AGE_MS + MINUTE);
    mockGetFreshAccessToken.mockResolvedValueOnce('fresh-token');
    log = [];

    await store.seek(11);

    expect(log).toEqual(['pause', streamOf('narr-a', 'fresh-token'), 'seek 11']);
    expect(store.currentPositionMs).toBe(11_000);
    expect(store.loadPhase).toBe('ready');
    expect(store.isPlaying).toBe(false);
    // The new stream has a deadline of its own: the next seek moves it.
    log = [];
    await store.seek(20);
    expect(log).toEqual(['seek 20']);
  });

  it('a token with less life than the window moves the deadline up: a rewind after it reloads and plays', async () => {
    // Karga: the stream got a token with 16 minutes left (a backend with
    // shorter JWTs, or a refresh that failed and kept the old one), and the
    // rewind came 14 minutes in.
    tokenExpiresIn(TOKEN, 16 * MINUTE);
    const { store, player } = await playingA(60);
    jest.setSystemTime(Date.now() + 14 * MINUTE);
    player.currentTime = 60;
    mockGetFreshAccessToken.mockResolvedValueOnce('fresh-token');
    log = [];

    await store.skipBackward(15);

    expect(log).toEqual(['pause', streamOf('narr-a', 'fresh-token'), 'seek 45', 'play']);
    expect(store.currentPositionMs).toBe(45_000);
    expect(store.isPlaying).toBe(true);
    expect(store.loadError).toBeNull();
  });

  it('"Baştan dinle" after the deadline reloads at the start instead of seeking the old stream', async () => {
    const { store, player } = await playingA(299);
    player.emit({ currentTime: 300, duration: 300, playing: false, didJustFinish: true });
    expect(store.storyEnded).toBe(true);
    jest.setSystemTime(Date.now() + STREAM_TOKEN_MAX_AGE_MS + MINUTE);
    mockGetFreshAccessToken.mockResolvedValueOnce('fresh-token');
    log = [];

    await store.play();

    expect(log).toEqual(['pause', streamOf('narr-a', 'fresh-token'), 'play']);
    expect(store.storyEnded).toBe(false);
    expect(store.currentPositionMs).toBe(0);
    expect(store.isPlaying).toBe(true);
  });

  it('a native source failure while playing reloads once at the position with no error; a second failure shows it', async () => {
    const { store, player } = await playingA(60);
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    mockGetFreshAccessToken.mockResolvedValueOnce('fresh-token');
    log = [];

    // The rewind's range request was refused (401): ExoPlayer rests in 'idle'.
    player.emit({ currentTime: 60, duration: 300, playing: false, playbackState: 'idle' });
    await flush();

    expect(log).toEqual(['pause', streamOf('narr-a', 'fresh-token'), 'seek 60', 'play']);
    expect(mockGetFreshAccessToken).toHaveBeenLastCalledWith(Number.POSITIVE_INFINITY);
    expect(store.loadError).toBeNull();
    expect(store.isPlaying).toBe(true);
    expect(toastError).not.toHaveBeenCalled();

    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    log = [];
    player.emit({ currentTime: 60, duration: 300, playing: false, playbackState: 'idle' });
    await flush();

    expect(log).toEqual(['pause']);
    expect(store.loadError).toBe('streamFailed');
    expect(store.loadErrorNarrationId).toBe('narr-a');
    expect(store.isPlaying).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('a stream that sounded after its reload earns a new one; the inline retry does too', async () => {
    const { store, player } = await playingA(60);
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    player.emit({ currentTime: 60, duration: 300, playing: false, playbackState: 'idle' });
    await flush();
    expect(player.replace).toHaveBeenCalledTimes(2);

    // It sounds again: a later failure is a new one.
    player.emit({ currentTime: 61, duration: 300, playing: true, playbackState: 'ready' });
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    player.emit({ currentTime: 70, duration: 300, playing: false, playbackState: 'idle' });
    await flush();
    expect(player.replace).toHaveBeenCalledTimes(3);
    expect(store.loadError).toBeNull();

    // Fails again without a sound: the error, then the user's retry.
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    player.emit({ currentTime: 70, duration: 300, playing: false, playbackState: 'idle' });
    expect(store.loadError).toBe('streamFailed');
    await store.reloadStream();
    expect(player.replace).toHaveBeenCalledTimes(4);
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    player.emit({ currentTime: 70, duration: 300, playing: false, playbackState: 'idle' });
    await flush();
    expect(player.replace).toHaveBeenCalledTimes(5);
    expect(store.loadError).toBeNull();
  });

  it('a source that went idle inside the grace is reloaded once by the start watchdog', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    // Refused at once: the report came inside the grace and nothing followed.
    player.currentStatus = { playbackState: 'idle' };
    player.emit({ playing: false, playbackState: 'idle' });

    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    await flush();
    expect(player.replace).toHaveBeenCalledTimes(2);
    expect(store.loadError).toBeNull();
    expect(store.isPlaying).toBe(true);

    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    expect(store.loadError).toBe('streamFailed');
    expect(player.replace).toHaveBeenCalledTimes(2);
  });

  it('a failed automatic reload shows the error and does not try again', async () => {
    const { store, player } = await playingA(60);
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    mockGetFreshAccessToken.mockRejectedValueOnce(new Error('offline'));

    player.emit({ currentTime: 60, duration: 300, playing: false, playbackState: 'idle' });
    await flush();

    expect(store.loadError).toBe('streamFailed');
    expect(store.isPlaying).toBe(false);
    expect(player.replace).toHaveBeenCalledTimes(1);
  });

  it('a start supersedes an automatic reload in flight', async () => {
    const { store, player } = await playingA(60);
    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS + 1);
    const token = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(token.promise);
    player.emit({ currentTime: 60, duration: 300, playing: false, playbackState: 'idle' });

    await store.startNarration({ narration: narrationB }, { autoplay: true });
    token.resolve('late-token');
    await flush();

    expect(store.audioId).toBe('narr-b');
    expect(player.replace.mock.calls.map(([source]) => source?.uri)).toEqual([
      `${BASE_URL}/narrations/narr-a/stream`,
      `${BASE_URL}/narrations/narr-b/stream`,
    ]);
    expect(store.loadError).toBeNull();
  });
});

// ============================================================================
// Samples
// ============================================================================

describe('AudioPlayerStore samples', () => {
  it('a sample over a playing story pauses and saves the story first, then takes the player', async () => {
    setPro(true);
    const { store, player } = await playingA(90);
    player.currentTime = 90.4;
    log = [];

    await store.playFromUrl(SAMPLE, { key: 'voice-1' });
    await flush();

    expect(log[0]).toBe('pause');
    expect(log).toContain(`replace ${SAMPLE} -`);
    expect(log[log.length - 1]).toBe('play');
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('90400');
    expect(store.source).toBe('sample');
    expect(store.sampleKey).toBe('voice-1');
    expect(store.audioId).toBe('');
    expect(store.currentStory).toBeNull();
    expect(store.isStoryLoaded).toBe(false);
    expect(store.showMiniPlayer).toBe(false);
    expect(store.isPlaying).toBe(true);
    expect(store.previewPending).toBe(true);
    // Samples never reach the lock screen.
    expect(player.setActiveForLockScreen).toHaveBeenLastCalledWith(false);
    // The story starts again at once from its meta.
    expect(getNarrationMeta('narr-a')).not.toBeNull();
  });

  it('stopPreview with a story loaded is a no-op', async () => {
    const { store, player } = await playingA();
    log = [];

    await store.stopPreview();
    await store.stopPreview('voice-1');

    expect(log).toEqual([]);
    expect(store.isPlaying).toBe(true);
    expect(store.audioId).toBe('narr-a');
  });

  it('stopPreview stops the named sample only, or any sample without a key', async () => {
    const { store } = await createStore();
    await store.playFromUrl(SAMPLE, { key: 'voice-1' });

    await store.stopPreview('voice-2');
    expect(store.sampleKey).toBe('voice-1');

    await store.stopPreview('voice-1');
    expect(store.sampleKey).toBeNull();
    expect(store.source).toBe('none');
    expect(store.isPlaying).toBe(false);
    expect(store.previewPending).toBe(false);

    await store.playFromUrl(SAMPLE);
    expect(store.sampleKey).toBe(SAMPLE);
    await store.stopPreview();
    expect(store.source).toBe('none');
  });

  it('a sample that ends frees the player and never reaches the story end handler', async () => {
    const handler = jest.fn(() => 'stop' as const);
    const { store, player } = await playingA(90);
    store.setStoryEndHandler(handler);
    await store.pause();
    await flush();

    await store.playFromUrl(SAMPLE, { key: 'voice-1' });
    player.emit({ currentTime: 12, duration: 12, playing: false, didJustFinish: true });
    await flush();

    expect(handler).not.toHaveBeenCalled();
    expect(store.sampleKey).toBeNull();
    expect(store.source).toBe('none');
    expect(store.isPlaying).toBe(false);
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('90000');
  });

  it('a sample saves no position, remembers no length and writes no last played record', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await AsyncStorage.removeItem(LAST_PLAYED_STORAGE_KEY);
    (AsyncStorage.setItem as jest.Mock).mockClear();

    await store.playFromUrl(SAMPLE);
    player.emit({ currentTime: 9, duration: 12, playing: true });
    await store.pause();

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(knownNarrationDurationMs('narr-a')).toBeNull();
    expect(store.totalDurationMs).toBe(12_000);
  });

  it('the intent of a sample never plays a story started afterwards', async () => {
    const { store, player } = await createStore();
    await store.playFromUrl(SAMPLE);
    expect(store.isPlaying).toBe(true);

    await store.startNarration({ narration: narrationA });

    expect(store.isPlaying).toBe(false);
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(store.sampleKey).toBeNull();
  });

  it('a sample sounds at the normal speed; the story speed comes back with the story', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.setSpeed(1.5);
    store.setSpeedForAllStories(true);

    await store.playFromUrl(SAMPLE);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1, 'high');
    expect(store.playbackSpeed).toBe(1.5);

    await store.startNarration({ narration: narrationA });
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.5, 'high');
  });

  it('a story keeps its own speed after a sample in between; the next story starts at 1,0x', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.setSpeed(1.5);

    await store.playFromUrl(SAMPLE, { key: 'sample-1' });
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1, 'high');

    await store.startNarration({ narration: narrationA });
    expect(store.playbackSpeed).toBe(1.5);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.5, 'high');

    await store.startNarration({ narration: narrationB });
    expect(store.playbackSpeed).toBe(1);
  });

  it('a sample wins over a story start in flight', async () => {
    const { store, player } = await createStore();
    const token = deferred<string>();
    mockGetFreshAccessToken.mockReturnValueOnce(token.promise);
    const start = store.startNarration({ narration: narrationA }, { autoplay: true });

    await store.playFromUrl(SAMPLE, { key: 'voice-1' });
    token.resolve(TOKEN);

    await expect(start).resolves.toBe(false);
    expect(store.source).toBe('sample');
    expect(store.loadPhase).toBe('idle');
    expect(log).not.toContain(streamOf('narr-a'));
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('playFromUrl failure explains it, rethrows and leaves the story', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    player.replace.mockImplementation(() => {
      throw new Error('bad url');
    });

    await expect(store.playFromUrl('not-a-url')).rejects.toThrow('bad url');

    expect(store.isPlaying).toBe(false);
    expect(store.audioId).toBe('narr-a');
    expect(toastError).toHaveBeenCalledWith('Ses oynatılamadı. Lütfen tekrar dene.');
  });

  it('stopAndCleanup keeps (and writes) the saved position of the loaded story', async () => {
    setPro(true);
    const { store, player } = await playingA(42);
    player.currentTime = 42;

    await store.stopAndCleanup();
    await flush();

    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('42000');
    expect(player.setActiveForLockScreen).toHaveBeenLastCalledWith(false);
    expect(store.source).toBe('none');
    expect(store.audioId).toBe('');
    expect(store.currentStory).toBeNull();
    expect(store.isPlaying).toBe(false);
    expect(store.totalDurationMs).toBe(0);
    // It never relies on unloading the native source.
    expect(player.replace).not.toHaveBeenCalledWith(null);
  });
});

describe('AudioPlayerStore preview watchdog', () => {
  it('is pending until the sample sounds, then there is nothing left to watch', async () => {
    const { store, player } = await createStore();
    await store.playFromUrl(SAMPLE);
    expect(store.previewPending).toBe(true);
    expect(store.previewFailed).toBe(false);

    // Buffering: not playing yet, but not idle either.
    player.emit({ playing: false, playbackState: 'buffering' });
    expect(store.previewPending).toBe(true);

    player.emit({ playing: true, currentTime: 0.2, duration: 4, playbackState: 'ready' });
    expect(store.previewPending).toBe(false);

    jest.advanceTimersByTime(PREVIEW_START_TIMEOUT_MS * 2);
    expect(store.previewFailed).toBe(false);
    expect(toastError).not.toHaveBeenCalled();
  });

  it('fails when the player goes idle instead of starting (the source could not be loaded)', async () => {
    const { store, player } = await createStore();
    await store.playFromUrl(SAMPLE, { key: 'voice-1' });

    // Idle for a moment while the player takes the new source: not a failure.
    player.emit({ playing: false, playbackState: 'idle' });
    expect(store.previewFailed).toBe(false);

    jest.advanceTimersByTime(PREVIEW_IDLE_GRACE_MS);
    player.emit({ playing: false, playbackState: 'idle' });

    expect(store.previewFailed).toBe(true);
    expect(store.previewPending).toBe(false);
    expect(store.isPlaying).toBe(false);
    expect(store.sampleKey).toBeNull();
    expect(store.source).toBe('none');
    expect(player.pause).toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith('Örnek oynatılamadı. Tekrar dene.');

    store.acknowledgePreviewFailure();
    expect(store.previewFailed).toBe(false);
    // The watchdog was cleared with the failure: no second message.
    jest.advanceTimersByTime(PREVIEW_START_TIMEOUT_MS * 2);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it('fails when nothing sounds within the timeout', async () => {
    const { store } = await createStore();
    await store.playFromUrl(SAMPLE);
    jest.advanceTimersByTime(PREVIEW_START_TIMEOUT_MS - 1);
    expect(store.previewFailed).toBe(false);
    jest.advanceTimersByTime(1);
    expect(store.previewFailed).toBe(true);
    expect(toastError).toHaveBeenCalledWith('Örnek oynatılamadı. Tekrar dene.');
  });

  it('a new sample starts a fresh watch and clears an earlier failure', async () => {
    const { store } = await createStore();
    await store.playFromUrl(SAMPLE);
    jest.advanceTimersByTime(PREVIEW_START_TIMEOUT_MS);
    expect(store.previewFailed).toBe(true);

    await store.playFromUrl(SAMPLE);
    expect(store.previewFailed).toBe(false);
    expect(store.previewPending).toBe(true);
  });

  it('stopping, starting a story or a throwing player ends the watch without a failure', async () => {
    const { store, player } = await createStore();
    await store.playFromUrl(SAMPLE);
    await store.stopAndCleanup();
    expect(store.previewPending).toBe(false);

    await store.playFromUrl(SAMPLE);
    await store.startNarration({ narration: narrationA });
    expect(store.previewPending).toBe(false);

    player.replace.mockImplementationOnce(() => {
      throw new Error('native');
    });
    await expect(store.playFromUrl(SAMPLE)).rejects.toThrow('native');
    expect(store.previewPending).toBe(false);

    jest.advanceTimersByTime(PREVIEW_START_TIMEOUT_MS * 2);
    expect(store.previewFailed).toBe(false);
  });

  it('a story is never watched as a sample', async () => {
    const { store, player } = await playingA();
    expect(store.previewPending).toBe(false);
    player.emit({ playing: true, playbackState: 'ready' });
    expect(store.previewFailed).toBe(false);
  });
});

// ============================================================================
// Lock screen (Pro gating)
// ============================================================================

describe('AudioPlayerStore lock screen gating', () => {
  it('free user: playing a story never touches the lock screen', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });

    await store.play();

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(store.isPlaying).toBe(true);
    expect(player.setActiveForLockScreen).not.toHaveBeenCalled();
    expect(player.updateLockScreenMetadata).not.toHaveBeenCalled();
  });

  it('Pro user: the first story play activates the lock screen once with seek buttons', async () => {
    setPro(true);
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    // Loading alone does not activate.
    expect(player.setActiveForLockScreen).not.toHaveBeenCalled();

    await store.play();
    await store.pause();
    await store.play();

    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(1);
    expect(player.setActiveForLockScreen).toHaveBeenCalledWith(true, metadataA, LOCK_SCREEN_OPTIONS);
    expect(metadataA).toEqual({
      title: 'Küçük Tavşan ile Havuç Macerası',
      artist: 'Babamın Sesi',
      albumTitle: 'Sesly',
      artworkUrl: 'https://images.sesly.io/covers/story-123.jpg',
    });
  });

  it('Pro user: the next track only updates the metadata (throttled)', async () => {
    setPro(true);
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.play();

    await store.startNarration({ narration: narrationB });
    expect(player.updateLockScreenMetadata).not.toHaveBeenCalled();
    jest.advanceTimersByTime(LOCK_SCREEN_METADATA_MIN_INTERVAL_MS);

    expect(player.updateLockScreenMetadata).toHaveBeenCalledTimes(1);
    expect(player.updateLockScreenMetadata).toHaveBeenCalledWith(metadataB);
    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(1);
  });

  it('Pro user: the narrator of a meta start is on the lock screen without a voice model', async () => {
    setPro(true);
    const { store, player } = await createStore();
    const meta = { ...metaFromNarration(narrationA), voiceProfile: null, narratorName: 'Kerem' };

    await store.startNarration({ narrationId: 'narr-a', meta }, { autoplay: true });

    expect(player.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ artist: 'Kerem' }),
      LOCK_SCREEN_OPTIONS,
    );
  });

  it('playback that resumes natively puts the story back on the lock screen', async () => {
    setPro(true);
    const { store, player } = await playingA();
    await store.pause();
    store.releaseLockScreen();

    expect(player.setActiveForLockScreen).toHaveBeenLastCalledWith(false);

    player.emit({ playing: true, currentTime: 61, playbackState: 'ready' });

    // Activated, released, activated again.
    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(3);
    expect(player.setActiveForLockScreen).toHaveBeenLastCalledWith(true, metadataA, LOCK_SCREEN_OPTIONS);
    expect(store.isPlaying).toBe(true);
  });

  it('Mini user: a paid plan, so the first story play puts it on the lock screen', async () => {
    setPlan('MINI');
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });

    await store.play();

    expect(player.setActiveForLockScreen).toHaveBeenCalledTimes(1);
    expect(player.setActiveForLockScreen).toHaveBeenCalledWith(true, metadataA, LOCK_SCREEN_OPTIONS);
  });

  it('a downgrade to free takes the story off the lock screen on the next sync', async () => {
    setPro(true);
    const { store, player } = await playingA();

    setPro(false);
    store.syncLockScreen();

    expect(player.setActiveForLockScreen).toHaveBeenLastCalledWith(false);
  });
});

// ============================================================================
// Playback speed
// ============================================================================

describe('AudioPlayerStore playback speed', () => {
  const prefsWithSpeed = (speed: unknown) => ({ settings: { playbackSpeed: speed } });

  it('a speed for this story only: the next story starts at 1,0x', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.setSpeed(1.5);

    await store.startNarration({ narration: narrationB });

    expect(store.playbackSpeed).toBe(1.0);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.0, 'high');
  });

  it('starting the loaded story again keeps its speed', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.setSpeed(1.25);
    // A failed stream makes the next start load it again.
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    await store.play();
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    expect(store.loadPhase).toBe('failed');

    await store.startNarration({ narration: narrationA });

    expect(store.playbackSpeed).toBe(1.25);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.25, 'high');
  });

  it('switch on: stores the speed on the device and in the preferences, and keeps it for the next story', async () => {
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.setSpeed(1.25);

    store.setSpeedForAllStories(true);
    await flush();

    expect(store.speedForAllStories).toBe(true);
    expect(await AsyncStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY)).toBe('1.25');
    expect(mockPrefsUpdate).toHaveBeenLastCalledWith({ settings: { playbackSpeed: 1.25 } });

    await store.startNarration({ narration: narrationB });
    expect(store.playbackSpeed).toBe(1.25);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.25, 'high');
  });

  it('switch on: a later speed change is stored too', async () => {
    const { store } = await createStore();
    store.setSpeedForAllStories(true);

    await store.setSpeed(0.9);
    await flush();

    expect(await AsyncStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY)).toBe('0.9');
    expect(mockPrefsUpdate).toHaveBeenLastCalledWith({ settings: { playbackSpeed: 0.9 } });
  });

  it('switch off: removes it; this story keeps its speed, the next starts at 1,0x', async () => {
    const { store } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.setSpeed(1.5);
    store.setSpeedForAllStories(true);
    await flush();

    store.setSpeedForAllStories(false);
    await flush();

    expect(store.speedForAllStories).toBe(false);
    expect(store.playbackSpeed).toBe(1.5);
    expect(await AsyncStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY)).toBeNull();
    expect(mockPrefsUpdate).toHaveBeenLastCalledWith({ settings: { playbackSpeed: null } });

    await store.startNarration({ narration: narrationB });
    expect(store.playbackSpeed).toBe(1.0);
  });

  it('applies the speed stored on the device before any network answer', async () => {
    await AsyncStorage.setItem(PLAYBACK_SPEED_STORAGE_KEY, '1.5');
    const { store, player } = await createStore();

    await store.startNarration({ narration: narrationA });

    expect(store.speedForAllStories).toBe(true);
    expect(store.playbackSpeed).toBe(1.5);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.5, 'high');
    expect(mockPrefsGet).not.toHaveBeenCalled();
  });

  it('adopts the speed from the cached preferences on a device without a mirror', async () => {
    mockPrefsCached.mockReturnValue(prefsWithSpeed(0.75));
    const { store, player } = await createStore();

    await store.startNarration({ narration: narrationA });
    await flush();

    expect(store.speedForAllStories).toBe(true);
    expect(store.playbackSpeed).toBe(0.75);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(0.75, 'high');
    expect(await AsyncStorage.getItem(PLAYBACK_SPEED_STORAGE_KEY)).toBe('0.75');
  });

  it('adopts the speed when the preferences arrive later, never over a choice made meanwhile', async () => {
    const later = deferred<unknown>();
    mockPrefsGet.mockReturnValue(later.promise);
    const { store, player } = await createStore();
    await store.startNarration({ narration: narrationA });
    expect(store.playbackSpeed).toBe(1.0);

    later.resolve(prefsWithSpeed(1.1));
    await flush();
    expect(store.playbackSpeed).toBe(1.1);
    expect(player.setPlaybackRate).toHaveBeenLastCalledWith(1.1, 'high');

    // A fresh device: no mirror written by the store above.
    await AsyncStorage.clear();
    const late = deferred<unknown>();
    mockPrefsGet.mockReturnValue(late.promise);
    const other = await createStore();
    await other.store.startNarration({ narration: narrationA });
    await other.store.setSpeed(2);
    late.resolve(prefsWithSpeed(1.1));
    await flush();
    expect(other.store.playbackSpeed).toBe(2);
    expect(other.store.speedForAllStories).toBe(false);
  });

  it('ignores a stored value that is off, invalid or out of range', async () => {
    for (const value of [null, 'fast', 9, 0.1]) {
      mockPrefsCached.mockReturnValue(prefsWithSpeed(value));
      const { store } = await createStore();
      await store.startNarration({ narration: narrationA });
      expect(store.speedForAllStories).toBe(false);
      expect(store.playbackSpeed).toBe(1.0);
    }
  });

  it('keeps working when the preference sync fails, and hydrates only once', async () => {
    mockPrefsUpdate.mockRejectedValue(new Error('offline'));
    const { store } = await createStore();
    await store.startNarration({ narration: narrationA });
    await store.startNarration({ narration: narrationB });

    store.setSpeedForAllStories(true);
    await flush();

    expect(store.speedForAllStories).toBe(true);
    expect(mockPrefsGet).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[AudioPlayerStore] Speed preference sync failed:',
      expect.any(Error),
    );
  });
});

// ============================================================================
// Generation, kept apart from playback
// ============================================================================

describe('AudioPlayerStore generation', () => {
  const storyB = narrationB.story!;
  const voice = narrationA.voiceProfile!;
  const tick = () => jest.advanceTimersByTimeAsync(POLLING_INTERVALS.AUDIO_GENERATION);

  it('generating B while A plays never touches the playback state, and READY never loads', async () => {
    const { store, player } = await playingA(10);
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus
      .mockResolvedValueOnce({ status: 'GENERATING', progress: 40 })
      .mockResolvedValueOnce({ status: 'READY', progress: 100 });

    await store.generateAudio(storyB, voice);

    expect(store.generatingNarrationId).toBe('narr-b');
    expect(store.generatingStory).toEqual(storyB);
    expect(store.generatingVoiceProfile).toEqual(voice);
    expect(store.audioId).toBe('narr-a');
    expect(store.currentStory?.id).toBe('story-123');
    expect(store.currentVoiceProfile).toEqual(narrationA.voiceProfile);

    // A keeps playing and reporting meanwhile.
    player.emit({ currentTime: 14, duration: 104.5, playing: true });
    await tick();
    expect(store.generationProgress).toBe(40);
    player.emit({ currentTime: 18, duration: 104.5, playing: true });
    await flush();
    // A's own position, saved under A only.
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('18000');
    expect(await AsyncStorage.getItem(positionKey('narr-b'))).toBeNull();
    expect(knownNarrationDurationMs('narr-a')).toBe(104_500);
    expect(knownNarrationDurationMs('narr-b')).toBeNull();

    await tick();
    await flush();

    expect(store.generationReadyId).toBe('narr-b');
    expect(store.generationProgress).toBe(100);
    expect(store.isGenerating).toBe(false);
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(mockGetNarrationById).not.toHaveBeenCalled();
    expect(store.audioId).toBe('narr-a');
    expect(store.isPlaying).toBe(true);
    // Polling stopped.
    await tick();
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(2);
  });

  it('beginGenerationSession flips into a clean generating state synchronously', async () => {
    const { store } = await createStore();
    store.generationProgress = 100;
    store.generationReadyId = 'narr-old';
    store.hasError = true;
    store.errorMessage = 'old';
    store.conflictExistingNarrationId = 'narr-old';

    store.beginGenerationSession();

    expect(store.isGenerating).toBe(true);
    expect(store.generationProgress).toBe(0);
    expect(store.generationReadyId).toBeNull();
    expect(store.generatingNarrationId).toBeNull();
    expect(store.hasError).toBe(false);
    expect(store.errorMessage).toBe('');
    expect(store.conflictExistingNarrationId).toBeNull();
    expect(store).not.toHaveProperty('generationStatus');
  });

  it('progress never goes backwards within a job, READY is 100 at once, a new session starts at 0', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus
      .mockResolvedValueOnce({ status: 'GENERATING', progress: 65 })
      .mockResolvedValueOnce({ status: 'GENERATING', progress: 60 })
      .mockResolvedValueOnce({ status: 'READY' });
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);
    await tick();
    await tick();
    expect(store.generationProgress).toBe(65);

    // READY without a number: the bar is full in the same tick.
    await tick();
    expect(store.generationProgress).toBe(100);
    expect(store.isGenerating).toBe(false);
    expect(store.generationReadyId).toBe('narr-b');

    store.beginGenerationSession();
    expect(store.generationProgress).toBe(0);
  });

  it('a READY the socket announced ends the poll: no answer of an older request undoes it', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    const late = deferred<unknown>();
    mockGetNarrationStatus.mockReturnValueOnce(late.promise);
    const { store } = await createStore();
    await store.generateAudio(storyB, voice);
    await tick();
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(1);

    // What WebSocketService writes for a narration_status READY.
    runInAction(() => {
      store.generationProgress = 100;
      store.isGenerating = false;
      store.generationReadyId = 'narr-b';
    });
    late.resolve({ status: 'GENERATING', progress: 80 });
    await flush();
    await tick();
    await tick();

    expect(store.generationProgress).toBe(100);
    expect(store.isGenerating).toBe(false);
    expect(store.hasError).toBe(false);
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(1);
  });

  describe('a regenerate in the queue', () => {
    // The queued old narration of (story-b, voice-123), and the one after it.
    const oldEntry = { ...metaFromNarration(narrationB), storyId: 'story-b', voiceProfileId: 'voice-123' };
    const regenerated = parseStoryNarrationFromJSON({
      ...mockNarrationJSON,
      id: 'narr-b2',
      storyId: 'story-b',
      story: { ...mockStoryJSON, id: 'story-b', title: 'Deniz Feneri' },
    });

    beforeEach(() => {
      queueStore.add(oldEntry);
      queueStore.add(metaFromNarration(narrationC));
      mockCreateNarration.mockResolvedValue({ id: 'narr-b2' });
      mockGetNarrationById.mockImplementation(async (id: string) => {
        if (id === 'narr-b2') return regenerated;
        throw new Error('unexpected');
      });
    });

    it('READY puts the new narration in the place of the old one', async () => {
      mockGetNarrationStatus.mockResolvedValue({ status: 'READY', progress: 100 });
      const { store } = await createStore();

      await store.generateAudio(storyB, voice, { replace: true });
      await tick();
      await flush();

      expect(mockGetNarrationById).toHaveBeenCalledWith('narr-b2');
      expect(queueStore.entries.map(e => e.narrationId)).toEqual(['narr-b2', 'narr-c']);
      expect(getNarrationMeta('narr-b2')?.story.title).toBe('Deniz Feneri');
      // The player was never loaded with it.
      expect(store.audioId).toBe('');
    });

    it('a READY the socket announced follows the regenerate too', async () => {
      mockGetNarrationStatus.mockReturnValue(new Promise(() => {}));
      const { store } = await createStore();
      await store.generateAudio(storyB, voice, { replace: true });

      runInAction(() => {
        store.generationProgress = 100;
        store.isGenerating = false;
        store.generationReadyId = 'narr-b2';
      });
      await tick();
      await flush();

      expect(mockGetNarrationStatus).not.toHaveBeenCalled();
      expect(queueStore.entries.map(e => e.narrationId)).toEqual(['narr-b2', 'narr-c']);
    });

    it('a first narration (no replace), or a pair not in the queue, leaves the queue alone', async () => {
      mockGetNarrationStatus.mockResolvedValue({ status: 'READY', progress: 100 });
      const { store } = await createStore();

      await store.generateAudio(storyB, voice);
      await tick();
      await flush();
      expect(mockGetNarrationById).not.toHaveBeenCalled();

      queueStore.remove('narr-b');
      await store.generateAudio(storyB, voice, { replace: true });
      await tick();
      await flush();
      expect(mockGetNarrationById).not.toHaveBeenCalled();
      expect(queueStore.entries.map(e => e.narrationId)).toEqual(['narr-c']);
    });

    it('a narration that cannot be fetched leaves the old entry', async () => {
      mockGetNarrationStatus.mockResolvedValue({ status: 'READY', progress: 100 });
      mockGetNarrationById.mockRejectedValue(new Error('offline'));
      const { store } = await createStore();

      await store.generateAudio(storyB, voice, { replace: true });
      await tick();
      await flush();

      expect(queueStore.entries.map(e => e.narrationId)).toEqual(['narr-b', 'narr-c']);
      expect(store.hasError).toBe(false);
    });
  });

  it('a started narration has the usage read again soon (the backend counted it)', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockReturnValue(new Promise(() => {}));
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);
    expect(mockApiGet).not.toHaveBeenCalledWith('/usage');
    await jest.advanceTimersByTimeAsync(USAGE_SOON_DELAY_MS);

    expect(mockApiGet).toHaveBeenCalledWith('/usage');
    store.stopGenerating();
  });

  it('passes replace: true through for a regenerate', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 0 });
    const { store } = await createStore();

    await store.generateAudio(storyB, voice, { replace: true });

    expect(mockCreateNarration).toHaveBeenCalledWith(storyB.id, voice.id, { replace: true });
    expect(mockGenerateAudio).toHaveBeenCalledWith('narr-b');
    store.stopGenerating();
  });

  it('a READY 409 conflict parks in the conflict state without an error', async () => {
    mockCreateNarration.mockRejectedValue(new NarrationAlreadyExistsError('narr-old', 'READY'));
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);
    await tick();

    expect(store.isGenerating).toBe(false);
    expect(store.hasError).toBe(false);
    expect(store.conflictExistingNarrationId).toBe('narr-old');
    expect(store.conflictExistingNarrationStatus).toBe('READY');
    expect(mockGenerateAudio).not.toHaveBeenCalled();
    expect(mockGetNarrationStatus).not.toHaveBeenCalled();

    store.clearConflict();
    expect(store.conflictExistingNarrationId).toBeNull();
    expect(store.conflictExistingNarrationStatus).toBeNull();
  });

  it('a GENERATING 409 conflict follows the existing narration in the job fields', async () => {
    mockCreateNarration.mockRejectedValue(new NarrationAlreadyExistsError('narr-old', 'GENERATING'));
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 50 });
    const { store } = await playingA();

    await store.generateAudio(storyB, voice);

    expect(store.generatingNarrationId).toBe('narr-old');
    expect(store.audioId).toBe('narr-a');
    expect(store.isGenerating).toBe(true);
    expect(store.conflictExistingNarrationStatus).toBe('GENERATING');
    expect(store.conflictExistingNarrationId).toBeNull();

    await tick();
    expect(mockGetNarrationStatus).toHaveBeenCalledWith('narr-old');
    expect(store.generationProgress).toBe(50);
    store.stopGenerating();
    expect(store.isGenerating).toBe(false);
  });

  it('a refusal that is not a quota is the error state with the backend sentence', async () => {
    mockCreateNarration.mockRejectedValue(
      apiErrorFromResponse(403, { message: 'Bu işlem için yetkin yok.' }),
    );
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);

    expect(store.isGenerating).toBe(false);
    expect(store.quotaBlock).toBeNull();
    expect(store.hasError).toBe(true);
    expect(store.errorKind).toBe('client');
    expect(store.errorMessage).toBe('Bu işlem için yetkin yok.');
    expect(toastError).toHaveBeenCalledWith('Bu işlem için yetkin yok.');
  });

  describe('a used-up allowance', () => {
    const refusal = (body: Record<string, unknown>) => apiErrorFromResponse(403, body);
    const usageReads = () => mockApiGet.mock.calls.filter(([url]) => url === '/usage').length;

    it('a quota 403 from the create is a quota block: no error, no message, the usage read again', async () => {
      mockCreateNarration.mockRejectedValue(refusal(backendQuotaPresetMonthlyError));
      const { store } = await createStore();

      await store.generateAudio(storyB, voice);

      expect(store.isGenerating).toBe(false);
      expect(store.hasError).toBe(false);
      expect(store.errorMessage).toBe('');
      expect(store.errorKind).toBeNull();
      expect(store.quotaBlock).toMatchObject({
        code: 'QUOTA_PRESET_MONTHLY',
        planId: 'free',
        limit: 20,
        period: 'month',
      });
      expect(store.quotaBlock?.renewsAt).toEqual(new Date(backendQuotaPresetMonthlyError.renewsAt));
      expect(toastError).not.toHaveBeenCalled();
      expect(showToast.info).not.toHaveBeenCalled();
      expect(mockGenerateAudio).not.toHaveBeenCalled();

      // Soon, not at once: a burst of refusals costs one request.
      expect(usageReads()).toBe(0);
      await jest.advanceTimersByTimeAsync(USAGE_SOON_DELAY_MS);
      expect(usageReads()).toBe(1);
      // Nothing is polled for a job that never started.
      await jest.advanceTimersByTimeAsync(POLLING_INTERVALS.AUDIO_GENERATION * 3);
      expect(mockGetNarrationStatus).not.toHaveBeenCalled();
    });

    it('a quota 403 from the generate call (the atomic count) is a quota block too', async () => {
      setPlan('MINI');
      mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
      mockGenerateAudio.mockRejectedValue(refusal(backendQuotaCloneMonthlyError));
      const { store } = await createStore();

      await store.generateAudio(storyB, voice);

      expect(store.quotaBlock).toMatchObject({ code: 'QUOTA_CLONE_MONTHLY', planId: 'mini', limit: 5 });
      expect(store.isGenerating).toBe(false);
      expect(store.hasError).toBe(false);
      expect(toastError).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(USAGE_SOON_DELAY_MS);
      expect(usageReads()).toBe(1);
      expect(mockGetNarrationStatus).not.toHaveBeenCalled();
    });

    it('a lifetime own-voice block has no renewal; PREMIUM_STORY takes the plan of the user', async () => {
      mockCreateNarration.mockRejectedValueOnce(refusal(backendQuotaCloneLifetimeError));
      const { store } = await createStore();

      await store.generateAudio(storyB, voice);
      expect(store.quotaBlock).toMatchObject({ code: 'QUOTA_CLONE_LIFETIME', period: 'lifetime', renewsAt: null });

      mockCreateNarration.mockRejectedValueOnce(refusal(backendPremiumStoryError));
      await store.generateAudio(storyB, voice);
      expect(store.quotaBlock).toMatchObject({ code: 'PREMIUM_STORY', planId: 'free' });
      expect(toastError).not.toHaveBeenCalled();
    });

    it('a new generation, a new session and clearError each clear the block', async () => {
      mockCreateNarration.mockRejectedValue(refusal(backendQuotaPresetMonthlyError));
      const { store } = await createStore();
      await store.generateAudio(storyB, voice);
      expect(store.quotaBlock).not.toBeNull();

      // A new start clears it before its first await.
      const answer = deferred<unknown>();
      mockCreateNarration.mockReturnValueOnce(answer.promise);
      const next = store.generateAudio(storyB, voice);
      expect(store.quotaBlock).toBeNull();
      expect(store.isGenerating).toBe(true);
      answer.reject(refusal(backendQuotaPresetMonthlyError));
      await next;
      expect(store.quotaBlock).not.toBeNull();

      store.beginGenerationSession();
      expect(store.quotaBlock).toBeNull();

      await store.generateAudio(storyB, voice);
      store.clearError();
      expect(store.quotaBlock).toBeNull();
    });

    it('the screen hands a start failure over: a quota refusal of the story fetch is a block as well', async () => {
      const { store } = await createStore();
      store.beginGenerationSession();

      store.failGeneration(refusal(backendPremiumStoryError), 'Masal hazırlanmaya başlanamadı');

      expect(store.isGenerating).toBe(false);
      expect(store.quotaBlock?.code).toBe('PREMIUM_STORY');
      expect(store.hasError).toBe(false);
      expect(toastError).not.toHaveBeenCalled();
    });
  });

  it('a start that fails offline keeps the kind next to the error', async () => {
    mockCreateNarration.mockRejectedValue(apiErrorFromResponse(undefined, null));
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);

    expect(store.hasError).toBe(true);
    expect(store.errorKind).toBe('offline');
    expect(store.quotaBlock).toBeNull();
    // Offline is the phone: no crash report.
    expect(crashlytics.recordError).not.toHaveBeenCalled();

    store.clearError();
    expect(store.errorKind).toBeNull();
  });

  it('a start failure the screen reports uses its fallback and the server kind', async () => {
    const { store } = await createStore();
    store.beginGenerationSession();

    store.failGeneration(new Error('Voice profile not found: vp-x'), 'Masal hazırlanmaya başlanamadı');

    expect(store.isGenerating).toBe(false);
    expect(store.hasError).toBe(true);
    expect(store.errorKind).toBe('server');
    expect(store.errorMessage).toBe('Masal hazırlanmaya başlanamadı');
    // Reported as a non-fatal with a small context.
    expect(crashlytics.log).toHaveBeenCalledWith(expect.anything(), 'narration: step=start kind=server');
    expect(crashlytics.recordError).toHaveBeenCalledWith(
      expect.anything(),
      new Error('Voice profile not found: vp-x'),
      'narration_error',
    );
  });

  it('an internal error uses the fallback', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGenerateAudio.mockRejectedValue(new Error('Cannot read properties of undefined'));
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);

    expect(store.errorMessage).toBe('Sesli masal oluşturulamadı');
    expect(store.isGenerating).toBe(false);
  });

  it('FAILED status stops polling with the backend error message, or the fallback', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValueOnce({
      status: 'FAILED',
      progress: 30,
      errorMessage: 'Ses sentezi başarısız oldu',
    });
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);
    await tick();
    await tick();

    expect(store.isGenerating).toBe(false);
    expect(store.generationReadyId).toBeNull();
    expect(store.errorMessage).toBe('Ses sentezi başarısız oldu');
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(1);
    expect(crashlytics.log).toHaveBeenCalledWith(expect.anything(), 'narration: step=generate narrationId=narr-b');

    mockGetNarrationStatus.mockResolvedValueOnce({ status: 'FAILED', progress: 0 });
    await store.generateAudio(storyB, voice);
    await tick();
    expect(store.errorMessage).toBe('Sesli masal oluşturulamadı');
  });

  it('after 6 minutes without READY the job is slow, not failed, and the poll goes on every 15 s', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 20 });
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);
    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_AFTER_MS - POLLING_INTERVALS.AUDIO_GENERATION);
    expect(store.generationSlow).toBe(false);

    await tick();
    // 120 polls of 3 s: what used to be the timeout.
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(GENERATION_SLOW_AFTER_MS / POLLING_INTERVALS.AUDIO_GENERATION);
    expect(store.generationSlow).toBe(true);
    expect(store.isGenerating).toBe(true);
    expect(store.hasError).toBe(false);
    expect(store.errorMessage).toBe('');
    expect(toastError).not.toHaveBeenCalled();

    // The slower cadence.
    const before = mockGetNarrationStatus.mock.calls.length;
    await jest.advanceTimersByTimeAsync(POLLING_INTERVALS.AUDIO_GENERATION);
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(before);
    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_POLL_MS - POLLING_INTERVALS.AUDIO_GENERATION);
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(before + 1);

    // A READY at the slow cadence completes it as usual.
    mockGetNarrationStatus.mockResolvedValue({ status: 'READY', progress: 100 });
    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_POLL_MS);
    expect(store.generationReadyId).toBe('narr-b');
    expect(store.isGenerating).toBe(false);
    expect(store.generationSlow).toBe(false);
    expect(store.hasError).toBe(false);
  });

  it('only a FAILED fails a slow job; after 30 minutes the poll stops without a word', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 50 });
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);
    await jest.advanceTimersByTimeAsync(GENERATION_POLL_LIMIT_MS);
    const calls = mockGetNarrationStatus.mock.calls.length;
    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_POLL_MS * 4);

    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(calls);
    expect(store.isGenerating).toBe(true);
    expect(store.generationSlow).toBe(true);
    expect(store.hasError).toBe(false);
    expect(toastError).not.toHaveBeenCalled();

    // The pair opened again follows the job anew, from a fresh session.
    mockCreateNarration.mockRejectedValue(new NarrationAlreadyExistsError('narr-b', 'GENERATING'));
    mockGetNarrationStatus.mockResolvedValue({ status: 'FAILED', progress: 50 });
    store.beginGenerationSession();
    expect(store.generationSlow).toBe(false);
    await store.generateAudio(storyB, voice);
    await tick();
    expect(store.hasError).toBe(true);
    expect(store.isGenerating).toBe(false);
  });

  it('the screen opened again on a job whose poll gave up follows it again, at the slow pace', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 50 });
    const { store } = await createStore();
    await store.generateAudio(storyB, voice);
    await jest.advanceTimersByTimeAsync(GENERATION_POLL_LIMIT_MS + GENERATION_SLOW_POLL_MS);
    const calls = mockGetNarrationStatus.mock.calls.length;

    store.resumeGenerationPoll();
    // A second call while it runs adds no second poll.
    store.resumeGenerationPoll();
    await jest.advanceTimersByTimeAsync(POLLING_INTERVALS.AUDIO_GENERATION);
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(calls);
    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_POLL_MS - POLLING_INTERVALS.AUDIO_GENERATION);
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(calls + 1);

    // The FAILED the socket never brought arrives this way.
    mockGetNarrationStatus.mockResolvedValue({ status: 'FAILED', progress: 50 });
    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_POLL_MS);
    expect(store.hasError).toBe(true);
    expect(store.isGenerating).toBe(false);

    // Nothing to follow any more.
    store.resumeGenerationPoll();
    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_POLL_MS * 2);
    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(calls + 2);
  });

  it('a start the user left for another job never writes or fails the new one', async () => {
    const createA = deferred<{ id: string }>();
    mockCreateNarration.mockReturnValueOnce(createA.promise);
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 30 });
    const { store } = await createStore();

    const startA = store.generateAudio(storyB, voice);
    // The user went back and started another narration meanwhile.
    store.beginGenerationSession();
    mockCreateNarration.mockResolvedValueOnce({ id: 'narr-c' });
    await store.generateAudio(narrationC.story!, voice);
    expect(store.generatingNarrationId).toBe('narr-c');

    createA.resolve({ id: 'narr-a2' });
    await startA;
    await tick();

    // A is still made on the backend (it went on in the background) ...
    expect(mockGenerateAudio).toHaveBeenCalledWith('narr-a2');
    // ... but the store follows the new job only.
    expect(store.generatingNarrationId).toBe('narr-c');
    expect(store.generatingStory?.id).toBe(narrationC.story!.id);
    expect(mockGetNarrationStatus.mock.calls.every(([id]) => id === 'narr-c')).toBe(true);
    expect(store.generationProgress).toBe(30);
  });

  it('a start that answers after sign-out makes nothing and writes nothing', async () => {
    setSessionUserId('user-1');
    const createA = deferred<{ id: string }>();
    mockCreateNarration.mockReturnValueOnce(createA.promise);
    const { store } = await createStore();

    const startA = store.generateAudio(storyB, voice);
    await store.unloadForSignOut();
    setSessionUserId(null);
    createA.resolve({ id: 'narr-a2' });
    await startA;
    await tick();

    expect(mockGenerateAudio).not.toHaveBeenCalled();
    expect(mockGetNarrationStatus).not.toHaveBeenCalled();
    expect(store.generatingNarrationId).toBeNull();
    expect(store.isGenerating).toBe(false);
  });

  it('a late refusal of a left start sets no block and stops no poll of the new job', async () => {
    const createA = deferred<{ id: string }>();
    mockCreateNarration.mockReturnValueOnce(createA.promise);
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 30 });
    const { store } = await createStore();

    const startA = store.generateAudio(storyB, voice);
    store.beginGenerationSession();
    mockCreateNarration.mockResolvedValueOnce({ id: 'narr-c' });
    await store.generateAudio(narrationC.story!, voice);

    createA.reject(apiErrorFromResponse(403, backendQuotaPresetMonthlyError));
    await startA;

    expect(store.quotaBlock).toBeNull();
    expect(store.hasError).toBe(false);
    expect(store.isGenerating).toBe(true);
    await tick();
    expect(mockGetNarrationStatus).toHaveBeenCalledWith('narr-c');
    expect(store.generationProgress).toBe(30);
  });

  it('a slow job counts the time the app spent suspended (wall clock)', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 10 });
    const { store } = await createStore();
    await store.generateAudio(storyB, voice);

    // The JS timers stood still while the clock went on.
    jest.setSystemTime(Date.now() + GENERATION_SLOW_AFTER_MS);
    await tick();

    expect(mockGetNarrationStatus).toHaveBeenCalledTimes(1);
    expect(store.generationSlow).toBe(true);
  });

  it('failed status requests never fail the job: they are asked again, and it turns slow in time', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockRejectedValue(apiErrorFromResponse(undefined, null));
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);
    await tick();
    expect(store.hasError).toBe(false);
    expect(store.isGenerating).toBe(true);

    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_AFTER_MS);

    expect(store.isGenerating).toBe(true);
    expect(store.hasError).toBe(false);
    expect(store.generationSlow).toBe(true);
    expect(toastError).not.toHaveBeenCalled();

    // The connection is back: the next answer moves the job on.
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 70 });
    await jest.advanceTimersByTimeAsync(GENERATION_SLOW_POLL_MS);
    expect(store.generationProgress).toBe(70);
  });

  it('errors out when the created narration has no id', async () => {
    mockCreateNarration.mockResolvedValue({ id: '' });
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);

    expect(store.errorMessage).toBe(msg('narration.missingId'));
    expect(store.isGenerating).toBe(false);
    expect(mockGetNarrationStatus).not.toHaveBeenCalled();
  });

  it('a late answer of a stopped job changes nothing', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    const answer = deferred<unknown>();
    mockGetNarrationStatus.mockReturnValueOnce(answer.promise);
    const { store } = await createStore();
    await store.generateAudio(storyB, voice);
    await tick();

    store.stopGenerating();
    answer.resolve({ status: 'READY', progress: 100 });
    await flush();

    expect(store.generationReadyId).toBeNull();
    expect(store.generationProgress).toBe(0);
  });

  it('stopGenerating stops polling', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 20 });
    const { store } = await createStore();

    await store.generateAudio(storyB, voice);
    store.stopGenerating();
    await tick();
    await tick();

    expect(mockGetNarrationStatus).not.toHaveBeenCalled();
    expect(store.isGenerating).toBe(false);
  });

  it('reset clears generation, error and playback state, keeping saved positions', async () => {
    const { store, player } = await playingA(42);
    player.currentTime = 42;
    store.setError('boom');
    store.generationProgress = 60;
    store.generationReadyId = 'narr-x';

    store.reset();
    await flush();

    expect(store.isGenerating).toBe(false);
    expect(store.generationProgress).toBe(0);
    expect(store.generationReadyId).toBeNull();
    expect(store.audioId).toBe('');
    expect(store.currentStory).toBeNull();
    expect(store.hasError).toBe(false);
    expect(store.errorMessage).toBe('');
    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('42000');
  });

  it('cleanup stops polling and playback', async () => {
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 20 });
    const { store } = await playingA();
    await store.generateAudio(storyB, voice);

    store.cleanup();
    await tick();
    await flush();

    expect(mockGetNarrationStatus).not.toHaveBeenCalled();
    expect(store.isPlaying).toBe(false);
    expect(store.source).toBe('none');
  });
});

// ============================================================================
// Sign-out
// ============================================================================

describe('AudioPlayerStore.unloadForSignOut', () => {
  it('pauses and saves, leaves the lock screen, stops polling and forgets every field', async () => {
    setPro(true);
    mockCreateNarration.mockResolvedValue({ id: 'narr-b' });
    mockGetNarrationStatus.mockResolvedValue({ status: 'GENERATING', progress: 20 });
    const { store, player } = await playingA(75);
    player.currentTime = 75;
    await store.generateAudio(narrationB.story!, narrationB.voiceProfile!);

    await store.unloadForSignOut();
    await jest.advanceTimersByTimeAsync(POLLING_INTERVALS.AUDIO_GENERATION * 2);
    await flush();

    expect(await AsyncStorage.getItem(positionKey('narr-a'))).toBe('75000');
    expect(player.setActiveForLockScreen).toHaveBeenLastCalledWith(false);
    expect(mockGetNarrationStatus).not.toHaveBeenCalled();
    expect(store).toMatchObject({
      source: 'none',
      audioId: '',
      currentStory: null,
      currentVoiceProfile: null,
      currentNarratorName: null,
      totalDurationMs: 0,
      currentPositionMs: 0,
      isPlaying: false,
      storyEnded: false,
      sampleKey: null,
      dockHold: false,
      isGenerating: false,
      generatingNarrationId: null,
      generatingStory: null,
      generationReadyId: null,
    });
    expect(store.showMiniPlayer).toBe(false);
  });
});

// ============================================================================
// No hard-coded copy
// ============================================================================

describe('copy', () => {
  it('the store and the socket service contain no Turkish string literals outside comments', () => {
    const TURKISH = /[çğıöşüÇĞİÖŞÜ]/;
    for (const file of ['useAudioPlayer.ts', '../services/WebSocketService.ts']) {
      const source = fs
        .readFileSync(path.join(__dirname, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      const literals = source.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
      expect(literals.filter(literal => TURKISH.test(literal))).toEqual([]);
    }
  });
});

// ============================================================================
// restorePlaybackAudioMode
// ============================================================================

describe('restorePlaybackAudioMode', () => {
  it('re-applies the free playback mode with recording off', async () => {
    await restorePlaybackAudioMode();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
      ...audioMode(false),
      allowsRecording: false,
    });
  });

  it('keeps background playback for Pro', async () => {
    setPro(true);

    await restorePlaybackAudioMode();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
      ...audioMode(true),
      allowsRecording: false,
    });
  });

  it('keeps background playback for Mini', async () => {
    setPlan('MINI');

    await restorePlaybackAudioMode();

    expect(mockSetAudioModeAsync).toHaveBeenCalledWith({
      ...audioMode(true),
      allowsRecording: false,
    });
  });

  it('swallows a native failure', async () => {
    mockSetAudioModeAsync.mockRejectedValue(new Error('session busy'));

    await expect(restorePlaybackAudioMode()).resolves.toBeUndefined();
  });
});

// ============================================================================
// Singleton and hook
// ============================================================================

describe('getAudioPlayerStore / useAudioPlayer', () => {
  it('nothing creates the store before the first use', () => {
    expect(getAudioPlayerStoreIfCreated()).toBeNull();
    expect(mockRegisteredStores).toHaveLength(0);
  });

  it('is a singleton registered once with the WebSocketService', async () => {
    const store = getAudioPlayerStore();
    const a = renderHook(() => useAudioPlayer());
    const b = renderHook(() => useAudioPlayer());

    expect(a.result.current).toBe(store);
    expect(b.result.current).toBe(store);
    expect(getAudioPlayerStoreIfCreated()).toBe(store);
    expect(store).toBeInstanceOf(AudioPlayerStore);
    expect(mockRegisteredStores).toEqual([store]);
    a.unmount();
    b.unmount();
  });

  it('ten callers register no AppState listener and set no audio mode', async () => {
    const store = getAudioPlayerStore();
    await store.setupPlayer();
    const addEventListener = AppState.addEventListener as unknown as jest.Mock;
    addEventListener.mockClear();
    mockSetAudioModeAsync.mockClear();

    const hooks = Array.from({ length: 10 }, () => renderHook(() => useAudioPlayer()));
    setPro(true);
    hooks.forEach(hook => hook.rerender({}));
    await flush();

    expect(hooks.every(hook => hook.result.current === store)).toBe(true);
    expect(addEventListener).not.toHaveBeenCalled();
    expect(mockSetAudioModeAsync).not.toHaveBeenCalled();
    hooks.forEach(hook => hook.unmount());
  });
});

// ============================================================================
// The plan in the background, through the real session bridge
// ============================================================================

describe('the session bridge pauses the free plan only', () => {
  // After the singleton tests above: the bridge uses (and creates) the singleton.
  it.each([
    ['MINI', false],
    ['PRO', false],
    ['FREE', true],
  ] as const)('a %s user going to the background: paused %s', async (tier, paused) => {
    setPlan(tier);
    const store = getAudioPlayerStore();
    await store.setupPlayer();
    const player = playerOf(store);
    const addEventListener = AppState.addEventListener as unknown as jest.Mock;
    addEventListener.mockClear();
    const view = render(React.createElement(AudioSessionBridge));
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    player.emit({ currentTime: 30, duration: 300, playing: true, playbackState: 'ready' });
    expect(store.isPlaying).toBe(true);
    // The audio mode the bridge applies for the plan.
    expect(mockSetAudioModeAsync).toHaveBeenLastCalledWith(audioMode(!paused));

    const onChange = addEventListener.mock.calls.find(([event]) => event === 'change')?.[1] as
      | ((state: string) => void)
      | undefined;
    expect(onChange).toBeDefined();
    act(() => onChange!('background'));
    await flush();

    expect(store.isPlaying).toBe(!paused);
    expect(store.pausedByBackground).toBe(paused);
    if (!paused) {
      // expo-audio keeps sounding: nothing re-pauses it.
      player.emit({ currentTime: 31, duration: 300, playing: true, playbackState: 'ready' });
      expect(store.isPlaying).toBe(true);
      expect(player.volume).toBe(1);
    }

    view.unmount();
    await store.stopAndCleanup();
  });
});

describe('AudioPlayerStore: a narration whose audio was removed', () => {
  const removedB = (): StoryNarration => ({ ...narrationB, status: 'FAILED' as StoryNarration['status'] });

  it('an unknown narration that is not READY fails as audioRemoved, keeps its meta and loads nothing', async () => {
    mockGetNarrationById.mockResolvedValue(removedB());
    const { store, player } = await playingA();

    await expect(store.startNarration({ narrationId: 'narr-b' }, { autoplay: true })).resolves.toBe(false);

    expect(store.loadError).toBe('audioRemoved');
    expect(store.loadErrorNarrationId).toBe('narr-b');
    expect(store.isPlaying).toBe(false);
    expect(player.replace).toHaveBeenCalledTimes(1);
    expect(store.audioId).toBe('narr-a');
    // The player can still name the story and open its page.
    expect(getNarrationMeta('narr-b')?.storyId).toBe(narrationB.storyId);
  });

  it('a background refresh that finds the audio removed stops the loaded story as audioRemoved', async () => {
    mockGetNarrationById.mockResolvedValueOnce(removedB());
    const { store, player } = await createStore();

    await store.startNarration({ narrationId: 'narr-b', meta: metaFromNarration(narrationB) }, { autoplay: true });
    await flush();

    expect(store.loadError).toBe('audioRemoved');
    expect(store.loadErrorNarrationId).toBe('narr-b');
    expect(store.isPlaying).toBe(false);
    expect(player.pause).toHaveBeenCalled();
  });

  it('a stream that would not play is explained: not READY becomes audioRemoved, 404 notFound, a network error stays', async () => {
    mockGetNarrationStatus.mockResolvedValueOnce({ status: 'FAILED', progress: 0 });
    const { store } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    expect(store.loadError).toBe('streamFailed');
    await flush();
    expect(mockGetNarrationStatus).toHaveBeenCalledWith('narr-a');
    expect(store.loadError).toBe('audioRemoved');

    mockGetNarrationStatus.mockRejectedValueOnce(apiErrorFromResponse(404, { message: 'x' }));
    await store.startNarration({ narration: narrationC }, { autoplay: true });
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    await flush();
    expect(store.loadError).toBe('notFound');

    mockGetNarrationStatus.mockRejectedValueOnce(new Error('offline'));
    await store.startNarration({ narration: narrationB }, { autoplay: true });
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    await flush();
    expect(store.loadError).toBe('streamFailed');
  });

  it('a READY answer, or a retry that started meanwhile, leaves the stream failure alone', async () => {
    const late = deferred<{ status: string; progress: number }>();
    mockGetNarrationStatus.mockReturnValueOnce(late.promise);
    const { store } = await createStore();
    await store.startNarration({ narration: narrationA }, { autoplay: true });
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    expect(store.loadError).toBe('streamFailed');
    void store.reloadStream();
    late.resolve({ status: 'FAILED', progress: 0 });
    await flush();
    expect(store.loadError).not.toBe('audioRemoved');

    mockGetNarrationStatus.mockResolvedValueOnce({ status: 'READY', progress: 100 });
    await store.startNarration({ narration: narrationC }, { autoplay: true });
    jest.advanceTimersByTime(STORY_START_TIMEOUT_MS);
    await flush();
    expect(store.loadError).toBe('streamFailed');
  });

  it('isUnplayableLoadError: gone and removed audio cannot play, a load or stream failure can be retried', () => {
    expect(isUnplayableLoadError('notFound')).toBe(true);
    expect(isUnplayableLoadError('audioRemoved')).toBe(true);
    expect(isUnplayableLoadError('loadFailed')).toBe(false);
    expect(isUnplayableLoadError('streamFailed')).toBe(false);
    expect(isUnplayableLoadError(null)).toBe(false);
  });
});