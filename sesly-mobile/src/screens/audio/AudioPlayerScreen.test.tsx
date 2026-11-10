/**
 * AudioPlayerScreen (design v4 playful, frame d "Oynatıcı", SPEC-audio 5):
 * layout and copy, palette colours, time labels, the native-driven progress
 * track and its knob grab, the transport and its sizes, the render states
 * derived from the store (instant open for a loaded story and for a known
 * meta, the loading line only for an unknown narration, the full and the
 * inline errors), the autoplay param, track changes through setParams, the
 * queue context (caption, previous / next, the queue button), the title
 * link, the timer and speed tiles, languages.
 *
 * The player store is a MobX observable stand-in so the observer screen
 * re-renders when a test flips a value; `startNarration` behaves like the
 * store's first synchronous step. The queue store, the queue sheet and the
 * queue playback functions are the real ones. Jest fake timers are global.
 */

import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { Animated, Dimensions, NativeModules } from 'react-native';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { computed, observable, runInAction } from 'mobx';

import { renderScreen, renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation, setMockFocused, setMockRouteParams } from '../../test-utils/mocks/navigation';
import { getMockNarrationJSON } from '../../test-utils/mock-data';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { mix } from '../../theme/color';
import { DURATION } from '../../theme/motion';
import { scanSource } from '../../theme/designScan';
import type { PaletteKey } from '../../theme/palettes';
import { parseStoryNarrationFromJSON } from '../../models/Narration';
import {
  metaFromNarration,
  rememberNarrationMeta,
  resetNarrationMetaForTests,
  type NarrationMeta,
  type PlayerStory,
} from '../../stores/narrationMeta';
import { queueStore } from '../../stores/QueueStore';
import { queueSheet } from '../../stores/queueSheet';
import sleepTimerService from '../../services/SleepTimerService';
import { playbackProgress } from '../../utils/playbackProgress';
import { resetContentNoticeForTests } from '../../utils/contentNotice';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PlayerTimerSheet } from '../../components/audio/PlayerTimerSheet';
import { SpeedSheet } from '../../components/audio/SpeedSheet';
import AudioPlayerScreen, {
  ART_MAX_WIDTH,
  ART_MIN_WIDTH,
  KNOB_GRAB_SCALE,
  KNOB_SIZE,
  PLAYER_CHROME_HEIGHT,
  PLAYER_ENTER_FALLBACK_MS,
  PLAY_SIZE,
  SKIP_SIZE,
  TRACK_HEIGHT,
  playerArtSize,
  playerEndCardEstimate,
  transportLayout,
} from './AudioPlayerScreen';

jest.setTimeout(60000);

jest.mock('../../services/UserPreferencesService', () => ({
  __esModule: true,
  default: {
    getCachedSync: () => null,
    get: jest.fn(() => new Promise(() => undefined)),
    update: jest.fn(() => Promise.resolve({})),
  },
}));
jest.mock('../../utils/toast', () => ({
  showToast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

/** The home shelf of the bedtime category, as the story store holds it (null: not loaded). */
let mockShelf: Array<{
  id: string;
  title: string;
  translationGroupId: string | null;
  category: string;
  isPremium?: boolean;
}> | null = null;
jest.mock('../../hooks/useStory', () => ({
  ...jest.requireActual('../../hooks/useStory'),
  getStoryStore: () => (mockShelf ? { shelfByCategory: new Map([['BEDTIME', mockShelf]]) } : null),
}));

type LoadError = 'notFound' | 'audioRemoved' | 'loadFailed' | 'streamFailed';

interface PlayerMock {
  source: 'none' | 'story' | 'sample';
  audioId: string;
  pendingNarrationId: string | null;
  loadPhase: 'idle' | 'loading' | 'ready' | 'failed';
  loadError: LoadError | null;
  isPlaying: boolean;
  isBuffering: boolean;
  storyEnded: boolean;
  currentPositionMs: number;
  totalDurationMs: number;
  playbackSpeed: number;
  speedForAllStories: boolean;
  currentStory: PlayerStory | null;
  currentVoiceProfile: null;
  currentNarratorName: string | null;
  currentOwnVoice: boolean;
  readonly isStoryLoaded: boolean;
  readonly isPlayingStory: boolean;
  readonly isBusy: boolean;
  readonly positionSeconds: number;
  readonly totalDuration: number;
  readonly currentPosition: number;
  startNarration: jest.Mock;
  play: jest.Mock;
  pause: jest.Mock;
  togglePlayPause: jest.Mock;
  seek: jest.Mock;
  skipBackward: jest.Mock;
  skipForward: jest.Mock;
  reloadStream: jest.Mock;
  setSpeed: jest.Mock;
  setSpeedForAllStories: jest.Mock;
  setVolume: jest.Mock;
}

let mockPlayer: PlayerMock;

jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockPlayer,
  getAudioPlayerStore: () => mockPlayer,
}));

const NARRATION = parseStoryNarrationFromJSON(getMockNarrationJSON({ id: 'n-1', totalDuration: 353 }));
const META_1 = metaFromNarration(NARRATION);
const TITLE_1 = 'Küçük Tavşan ile Havuç Macerası';
const STORY_ID_1 = 'story-123';

/** A meta of another narration (another story, a ready-made narrator). */
function metaOf(id: string, title: string, patch: Partial<NarrationMeta> = {}): NarrationMeta {
  return {
    narrationId: id,
    storyId: `s-${id}`,
    voiceProfileId: 'v-deniz',
    story: { id: `s-${id}`, title, coverImageUrl: null, translationGroupId: null, category: 'BEDTIME' },
    voiceProfile: null,
    narratorName: 'Deniz',
    ownVoice: false,
    estimateMs: 300000,
    ...patch,
  };
}

const plainFields = (meta: NarrationMeta | null) => ({
  currentStory: meta?.story ?? null,
  currentNarratorName: meta?.narratorName ?? null,
  currentOwnVoice: meta?.ownVoice ?? false,
});

/** The store holding `meta`'s narration (default n-1), paused at 0, 353 s long. */
function makePlayer(overrides: Partial<PlayerMock> = {}, meta: NarrationMeta | null = META_1): PlayerMock {
  const player = observable(
    {
      source: 'story' as PlayerMock['source'],
      audioId: meta?.narrationId ?? '',
      pendingNarrationId: null as string | null,
      loadPhase: 'ready' as PlayerMock['loadPhase'],
      loadError: null as LoadError | null,
      isPlaying: false,
      isBuffering: false,
      storyEnded: false,
      currentPositionMs: 0,
      totalDurationMs: 353000,
      playbackSpeed: 1,
      speedForAllStories: false,
      currentStory: null as PlayerStory | null,
      currentNarratorName: null as string | null,
      currentOwnVoice: false,
      currentVoiceProfile: null,
      // Computed like the real store.
      get isStoryLoaded(): boolean {
        return this.source === 'story' && !!this.audioId;
      },
      get isPlayingStory(): boolean {
        return this.source === 'story';
      },
      get isBusy(): boolean {
        return this.isPlaying && (this.loadPhase === 'loading' || this.isBuffering);
      },
      get positionSeconds(): number {
        return Math.floor(this.currentPositionMs / 1000);
      },
      get totalDuration(): number {
        return this.totalDurationMs / 1000;
      },
      get currentPosition(): number {
        return this.currentPositionMs / 1000;
      },
      startNarration: jest.fn(),
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(() => Promise.resolve()),
      togglePlayPause: jest.fn(() => Promise.resolve()),
      seek: jest.fn(() => Promise.resolve()),
      skipBackward: jest.fn(() => Promise.resolve()),
      skipForward: jest.fn(() => Promise.resolve()),
      reloadStream: jest.fn(() => Promise.resolve()),
      setSpeed: jest.fn(() => Promise.resolve()),
      setSpeedForAllStories: jest.fn(),
      setVolume: jest.fn(),
    },
    {
      isStoryLoaded: computed,
      isPlayingStory: computed,
      isBusy: computed,
      positionSeconds: computed,
      totalDuration: computed,
      currentPosition: computed,
      currentStory: observable.ref,
      startNarration: false,
      play: false,
      pause: false,
      togglePlayPause: false,
      seek: false,
      skipBackward: false,
      skipForward: false,
      reloadStream: false,
      setSpeed: false,
      setSpeedForAllStories: false,
      setVolume: false,
    },
  ) as PlayerMock;
  // Assigned after creation: a spread in the literal would read the getters
  // once and turn them into plain values.
  runInAction(() => Object.assign(player, plainFields(meta), overrides));
  // Like the store's synchronous first step: the pending id and the intent.
  player.startNarration.mockImplementation(
    (input: { narrationId?: string; narration?: { id: string } }, options: { autoplay?: boolean } = {}) => {
      const id = input.narration?.id ?? input.narrationId ?? '';
      runInAction(() => {
        player.pendingNarrationId = id;
        player.loadPhase = 'loading';
        player.loadError = null;
        player.isPlaying = !!options.autoplay;
        player.isBuffering = false;
      });
      return new Promise<boolean>(() => undefined);
    },
  );
  return player;
}

/** Nothing (or a sample) in the player. */
function emptyPlayer(overrides: Partial<PlayerMock> = {}): PlayerMock {
  return makePlayer({ source: 'none', audioId: '', loadPhase: 'idle', totalDurationMs: 0, ...overrides }, null);
}

/** The store's hard flip and the end of a start, as a store action (inside a mocked start). */
function landNow(meta: NarrationMeta, patch: Partial<PlayerMock> = {}) {
  runInAction(() => {
    Object.assign(mockPlayer, {
      source: 'story',
      audioId: meta.narrationId,
      pendingNarrationId: null,
      loadPhase: 'ready',
      currentPositionMs: 0,
      ...plainFields(meta),
      ...patch,
    });
  });
}

/** The same from the test body: `meta`'s story is in the player. */
function land(meta: NarrationMeta, patch: Partial<PlayerMock> = {}) {
  act(() => landNow(meta, patch));
}

function set(patch: Partial<PlayerMock>) {
  act(() => {
    runInAction(() => Object.assign(mockPlayer, patch));
  });
}

const flat = (node: { props: { style?: unknown } }) => {
  const style = node.props.style;
  const list = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...list.filter(Boolean)) as Record<string, unknown>;
};

const renderPlayer = (theme?: PaletteKey) => renderScreen(<AudioPlayerScreen />, { theme });

const advance = (ms: number) =>
  act(() => {
    jest.advanceTimersByTime(ms);
  });

type TransitionListener = (event: { data: { closing: boolean } }) => void;
/** The native stack reports the end of the player's transition (`transitionEnd`). */
function endTransition(closing = false) {
  const calls = mockNavigation.addListener.mock.calls as unknown as [string, TransitionListener][];
  act(() => {
    calls.filter(([name]) => name === 'transitionEnd').forEach(([, listener]) => listener({ data: { closing } }));
  });
}

/** A tile press: the sheet opens in the frame after the sunk tile. */
function pressTile(testID: string) {
  fireEvent.press(screen.getByTestId(testID));
  advance(16);
}

const elapsed = () => screen.getByTestId('player-time-elapsed');
const remaining = () => screen.getByTestId('player-time-remaining');
const timerState = () => screen.getByTestId('player-timer-state');
const face = (testID: string) => flat(screen.getByTestId(`${testID}-face`));
const titleText = () => screen.getByTestId('player-title');

/** setParams updates the mocked route, as the navigator does. */
function routeFollowsSetParams() {
  mockNavigation.setParams.mockImplementation((params: Record<string, unknown>) => {
    const current = (mockNavigation as unknown as { __params?: Record<string, unknown> }).__params ?? {};
    const next = { ...current, ...params };
    (mockNavigation as unknown as { __params?: Record<string, unknown> }).__params = next;
    setMockRouteParams(next);
  });
}

function setRoute(params: Record<string, unknown>) {
  (mockNavigation as unknown as { __params?: Record<string, unknown> }).__params = params;
  setMockRouteParams(params);
}

/** A queue of these metas, playing from `currentId`. */
function queueOf(metas: NarrationMeta[], currentId: string | null) {
  act(() => {
    queueStore.replaceAll(metas);
    if (currentId) queueStore.startAt(currentId);
  });
}

const store = sleepTimerService.store;

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.clearAllMocks();
  // An unsubscribe for every listener (restoreAllMocks drops the mock's own).
  mockNavigation.addListener.mockImplementation(() => jest.fn());
  mockNavigation.setParams.mockReset();
  mockNavigation.getState.mockReset();
  setRoute({ narrationId: 'n-1' });
  mockShelf = null;
  resetNarrationMetaForTests();
  queueStore.reset();
  queueSheet.close();
  sleepTimerService.turnOff();
  runInAction(() => {
    store.mode = 'stories';
    store.storyCount = 1;
    store.lastDurationMin = null;
    store.fadeOut = true;
  });
});

afterEach(async () => {
  sleepTimerService.turnOff();
  jest.restoreAllMocks();
  await i18n.changeLanguage('tr');
});

describe('AudioPlayerScreen content note', () => {
  const warned = (id: string) =>
    metaOf(id, 'Kurt ile Yedi Keçi', {
      story: {
        id: `s-${id}`,
        title: 'Kurt ile Yedi Keçi',
        coverImageUrl: null,
        translationGroupId: null,
        category: 'WORLD_CLASSICS',
        ageGroup: 'THREE_TO_SIX',
        contentWarnings: ['SCARY', 'SAD_ENDING'],
      },
    });

  beforeEach(async () => {
    resetContentNoticeForTests();
    await AsyncStorage.clear();
  });

  it('shows the age group and the warnings under the title the first time only', async () => {
    const meta = warned('n-w');
    setRoute({ narrationId: 'n-w' });
    mockPlayer = makePlayer({}, meta);
    const first = await renderPlayer();
    await act(async () => undefined);
    expect(screen.getByTestId('player-content-note')).toBeOnTheScreen();
    expect(screen.getByText('3-6 yaş için. Korkutucu bir sahne içeriyor. Üzücü bir sonu var.')).toBeOnTheScreen();
    first.unmount();

    mockPlayer = makePlayer({}, meta);
    await renderPlayer();
    await act(async () => undefined);
    expect(screen.queryByTestId('player-content-note')).toBeNull();
  });

  it('a story without warnings shows no note', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    await act(async () => undefined);
    expect(screen.queryByTestId('player-content-note')).toBeNull();
  });
});

describe('AudioPlayerScreen layout (frame d)', () => {
  it('shows the caption, the artwork, the title, the narrator, the transport and the tiles', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();

    expect(screen.getByText('Şimdi dinleniyor')).toBeOnTheScreen();
    expect(screen.getByTestId('player-category')).toHaveTextContent('Uyku masalları');
    expect(screen.getByText(TITLE_1)).toBeOnTheScreen();
    expect(screen.getByTestId('player-narrator')).toHaveTextContent('Babamın Sesi anlatıyor');
    expect(screen.getByLabelText('15 saniye geri')).toBeOnTheScreen();
    expect(screen.getByLabelText('15 saniye ileri')).toBeOnTheScreen();
    expect(screen.getByLabelText('Oynat')).toBeOnTheScreen();
    expect(screen.getByText('Zamanlayıcı')).toBeOnTheScreen();
    expect(timerState()).toHaveTextContent('Kapalı');
    expect(screen.getByText('Hız')).toBeOnTheScreen();
    expect(screen.getByTestId('player-speed-value')).toHaveTextContent('1,0x');
    expect(screen.getByLabelText('Oynatma hızı, 1,0x')).toBeOnTheScreen();
    // The one-choice "more" dialog is gone: the queue button took its place.
    expect(screen.queryByLabelText('Diğer seçenekler')).toBeNull();
    expect(screen.getByTestId('player-queue')).toBeOnTheScreen();
  });

  it('draws the artwork at the size the window allows, radius 32 on its 4dp lip', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    const { width, height } = Dimensions.get('window');
    const art = playerArtSize(width, height, 0, 0);
    const cover = flat(screen.getByTestId('player-cover'));
    expect(cover.width).toBe(art.width);
    // The test window (750 x 1334) is tall: the art reaches its largest size.
    expect(art).toEqual({ width: ART_MAX_WIDTH, height: Math.floor(ART_MAX_WIDTH * (290 / 236)) });
    // Covers 130dp and wider sit on the 4dp lip (coverLip).
    expect(cover.height).toBe(art.height + 4);
    expect(flat(screen.getByTestId('player-cover-lip')).borderRadius).toBe(32);
    expect(screen.getByLabelText(`${TITLE_1} kapağı`)).toBeOnTheScreen();
  });

  it('shares the height left over between five gaps that grow, inside a content that fills the screen', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    const gaps = screen.getAllByTestId('player-gap');
    expect(gaps).toHaveLength(5);
    for (const gap of gaps) expect(flat(gap).flexGrow).toBe(1);
    // The gaps only grow when the content is at least as tall as the screen.
    const scroll = screen.getByTestId('player-scroll');
    expect(flat({ props: { style: scroll.props.contentContainerStyle } }).flexGrow).toBe(1);
  });

  it('blurs the cover behind the top and fades it into the canvas exactly where the glow ends', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    endTransition();
    const glow = screen.getByTestId('player-glow', { includeHiddenElements: true });
    expect(glow.props.blurRadius).toBeGreaterThan(20);
    expect(glow.props.source.uri).toBe('https://images.sesly.io/covers/story-123.jpg');
    // A new track's cover cross-fades in.
    expect(glow.props.transition).toBe(DURATION.base);
    const glowStyle = flat(glow);
    const glowBottom = (glowStyle.top as number) + (glowStyle.height as number);
    const fade = screen.getByTestId('player-glow-fade', { includeHiddenElements: true });
    expect(fade.props.colors[2]).toBe(themes['gece-mavisi'].bg);
    // Solid canvas at the glow's bottom edge: no seam under the cover.
    expect(fade.props.locations[2]).toBe(1);
    expect((flat(fade).top as number) + (flat(fade).height as number)).toBe(glowBottom);
  });

  it('draws the glow after the enter transition and fades it in, where it always is (LR-4)', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    // The first frame: everything but the glow; its canvas fade is already there.
    expect(screen.queryByTestId('player-glow', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('player-glow-fade', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.getByTestId('player-cover')).toBeOnTheScreen();
    expect(screen.getByTestId('player-play')).toBeOnTheScreen();
    expect(mockNavigation.addListener).toHaveBeenCalledWith('transitionEnd', expect.any(Function));

    // The end of a closing transition is not the end of the enter.
    endTransition(true);
    expect(screen.queryByTestId('player-glow', { includeHiddenElements: true })).toBeNull();

    const timing = jest.spyOn(Animated, 'timing');
    endTransition();
    expect(screen.getByTestId('player-glow', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(timing).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.enter, useNativeDriver: true }),
    );
    // A layer over the whole screen, like the one around it: the glow keeps its place.
    const layer = flat(screen.getByTestId('player-glow-layer', { includeHiddenElements: true }));
    expect(layer).toMatchObject({ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 });
  });

  it('a player shown without a transition still gets its glow, after the fallback', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    advance(PLAYER_ENTER_FALLBACK_MS - 50);
    expect(screen.queryByTestId('player-glow', { includeHiddenElements: true })).toBeNull();
    advance(50);
    expect(screen.getByTestId('player-glow', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('mounts the sheets after the enter, not with the first frame', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    const inner = (PlayerTimerSheet as unknown as { type: React.ComponentType }).type;
    expect(screen.UNSAFE_queryAllByType(inner)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(SpeedSheet)).toHaveLength(0);
    endTransition();
    expect(screen.UNSAFE_queryAllByType(inner)).toHaveLength(1);
    expect(screen.UNSAFE_queryAllByType(SpeedSheet)).toHaveLength(1);
    expect(screen.queryByTestId('timer-sheet')).toBeNull();
  });

  it('has no "Metin" entry and no playlist entry', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.queryByText('Metin')).toBeNull();
    expect(screen.queryByLabelText('Çalma listesi')).toBeNull();
  });

  it('hides the narrator line when the narrator is not known', async () => {
    mockPlayer = makePlayer({ currentNarratorName: null });
    await renderPlayer();
    expect(screen.queryByTestId('player-narrator')).toBeNull();
    expect(screen.queryByTestId('player-narrator-dot')).toBeNull();
  });

  it('the own (cloned) voice gets the wave dot in the own-voice colour, a ready-made one a neutral dot', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    const T = themes['gece-mavisi'];
    expect(flat(screen.getByTestId('player-narrator-dot')).backgroundColor).toBe(T.own);
    expect(flat(screen.getByTestId('player-narrator-dot')).width).toBe(22);
    screen.unmount();

    mockPlayer = makePlayer({ currentNarratorName: 'Deniz', currentOwnVoice: false });
    await renderPlayer();
    expect(screen.getByTestId('player-narrator')).toHaveTextContent('Deniz anlatıyor');
    expect(flat(screen.getByTestId('player-narrator-dot')).backgroundColor).toBe(T.line);
  });

  it('puts the spacing on the scale: narrator row 8 apart, 4 under the title, tiles 16 under the transport', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    const row = flat(screen.getByTestId('player-narrator-row'));
    expect(row.gap).toBe(8);
    expect(row.marginTop).toBe(4);
    expect(flat(titleText()).marginTop).toBe(16);
  });

  it('shows pause while playing and toggles on press', async () => {
    mockPlayer = makePlayer({ isPlaying: true });
    await renderPlayer();
    fireEvent.press(screen.getByLabelText('Duraklat'));
    expect(mockPlayer.togglePlayPause).toHaveBeenCalledTimes(1);
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
  });

  it('the chevron closes the player', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    fireEvent.press(screen.getByLabelText('Kapat'));
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('is translated, with a decimal point in the speed', async () => {
    await i18n.changeLanguage('en');
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.getByText('Now playing')).toBeOnTheScreen();
    expect(screen.getByTestId('player-narrator')).toHaveTextContent('Narrated by Babamın Sesi');
    expect(screen.getByText('Timer')).toBeOnTheScreen();
    expect(screen.getByText('Speed')).toBeOnTheScreen();
    expect(timerState()).toHaveTextContent('Off');
    expect(screen.getByTestId('player-speed-value')).toHaveTextContent('1.0x');
    expect(screen.getByLabelText('Back 15 seconds')).toBeOnTheScreen();
    expect(screen.getByLabelText('Close')).toBeOnTheScreen();
    expect(screen.getByTestId('player-queue').props.accessibilityLabel).toBe('Up next');
  });

  it('keeps the source on the spacing, radius, lip and motion scale', () => {
    const file = path.join(__dirname, 'AudioPlayerScreen.tsx');
    expect(scanSource(fs.readFileSync(file, 'utf8'), 'src/screens/audio/AudioPlayerScreen.tsx')).toEqual([]);
  });
});

describe('AudioPlayerScreen palette', () => {
  it.each(['gece-mavisi', 'kitaplik', 'orijinal'] as const)('draws everything from the %s palette', async scheme => {
    mockPlayer = makePlayer({ currentPositionMs: 100000 });
    await renderPlayer(scheme);
    const T = themes[scheme];
    expect(flat(screen.getByTestId('player-screen')).backgroundColor).toBe(T.bg);
    const title = flat(screen.getByText(TITLE_1));
    expect(title.color).toBe(T.text);
    expect(title.fontFamily).toBe(T.fontDisplay);
    expect(title.fontSize).toBe(26);
    expect(title.lineHeight as number).toBeGreaterThanOrEqual(25 * 1.3);
    // The fat track, its action fill and the knob on its lip.
    const track = flat(screen.getByTestId('player-seek-track'));
    expect(track.backgroundColor).toBe(T.line);
    expect(track.height).toBe(TRACK_HEIGHT);
    expect(flat(screen.getByTestId('player-seek-fill')).backgroundColor).toBe(T.action);
    const knob = flat(screen.getByTestId('player-seek-knob-face'));
    expect(knob.backgroundColor).toBe(T.knob);
    expect(knob.width).toBe(KNOB_SIZE);
    const knobLip = flat(screen.getByTestId('player-seek-knob-lip'));
    expect(knobLip.backgroundColor).toBe(T.knobLip);
    expect(knobLip.top).toBe(2);
    // Transport: neutral round buttons and the big action button on its 4dp lip.
    expect(face('player-rewind').backgroundColor).toBe(T.surface);
    expect(flat(screen.getByTestId('player-rewind-lip')).backgroundColor).toBe(T.lip);
    expect(face('player-play').backgroundColor).toBe(T.action);
    expect(flat(screen.getByTestId('player-play-lip')).backgroundColor).toBe(T.actionLip);
    // Tiles: the timer's moon in the sleep colour, the speed tile neutral.
    expect(face('player-timer-entry').backgroundColor).toBe(T.surface);
    expect(flat(screen.getByTestId('player-timer-entry-icon')).backgroundColor).toBe(T.catUyku);
    expect(face('player-speed-entry').backgroundColor).toBe(T.surface);
    expect(flat(screen.getByTestId('player-speed-entry-icon')).backgroundColor).toBe(T.surface2);
    expect(flat(screen.getByTestId('player-speed-value')).fontFamily).toBe(T.fontDisplay);
    expect(flat(elapsed()).color).toBe(T.text3);
    expect(flat(screen.getByTestId('player-category')).color).toBe(T.text);
  });

  it('the speed tile keeps its 2dp ring and tabular figures', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(face('player-speed-entry').borderWidth).toBe(2);
    expect(face('player-speed-entry').borderColor).toBe('transparent');
    expect(flat(screen.getByTestId('player-speed-value')).fontVariant).toEqual(['tabular-nums']);
  });

  it('draws in the palette it is shown in', async () => {
    mockPlayer = makePlayer();
    await renderPlayer('orman');
    expect(flat(screen.getByTestId('player-screen')).backgroundColor).toBe(themes.orman.bg);
    expect(face('player-play').backgroundColor).toBe(themes.orman.action);
  });
});

describe('AudioPlayerScreen render states', () => {
  it('opens instantly on the loaded story', async () => {
    mockPlayer = makePlayer();
    // The first frame, before any effect has settled.
    renderWithProviders(<AudioPlayerScreen />);
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-loading')).toBeNull();
    expect(screen.getByText(TITLE_1)).toBeOnTheScreen();
    await act(async () => undefined);
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
  });

  it('opens instantly with known meta: the play face spins and the start runs once', async () => {
    const meta = metaOf('n-2', 'Uykulu Ay');
    rememberNarrationMeta(meta);
    setRoute({ narrationId: 'n-2', autoplay: true });
    // Another story is loaded and playing.
    mockPlayer = makePlayer({ isPlaying: true });
    renderWithProviders(<AudioPlayerScreen />);
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.getByText('Uykulu Ay')).toBeOnTheScreen();
    expect(screen.queryByText(TITLE_1)).toBeNull();
    expect(screen.getByTestId('player-narrator')).toHaveTextContent('Deniz anlatıyor');
    await act(async () => undefined);

    expect(mockPlayer.startNarration).toHaveBeenCalledTimes(1);
    expect(mockPlayer.startNarration).toHaveBeenCalledWith({ narrationId: 'n-2', meta }, { autoplay: true });
    expect(screen.getByTestId('player-play-busy')).toBeOnTheScreen();
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ autoplay: undefined });
    // The store goes on: no second start.
    land(meta, { isPlaying: true });
    expect(mockPlayer.startNarration).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('player-play-busy')).toBeNull();
    expect(screen.getByLabelText('Duraklat')).toBeOnTheScreen();
  });

  it('a queue entry is known meta too', async () => {
    const meta = metaOf('n-3', 'Çizmeli Kedi');
    queueOf([meta], null);
    setRoute({ narrationId: 'n-3' });
    mockPlayer = emptyPlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.getByText('Çizmeli Kedi')).toBeOnTheScreen();
    expect(mockPlayer.startNarration).toHaveBeenCalledWith(
      { narrationId: 'n-3', meta: expect.objectContaining({ narrationId: 'n-3' }) },
      { autoplay: false },
    );
  });

  it('shows the loading line only for an unknown narration', async () => {
    setRoute({ narrationId: 'n-9' });
    mockPlayer = emptyPlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-loading')).toBeOnTheScreen();
    expect(screen.getByTestId('player-loading-line')).toBeOnTheScreen();
    expect(screen.getByText('Masal yükleniyor...')).toBeOnTheScreen();
    // The way out is there while it loads.
    expect(screen.getByTestId('player-back')).toBeOnTheScreen();
    expect(mockPlayer.startNarration).toHaveBeenCalledWith({ narrationId: 'n-9' }, { autoplay: false });

    // The fetch answered and the story is in the player.
    land(metaOf('n-9', 'Pinokyo'));
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.getByText('Pinokyo')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-loading')).toBeNull();
  });

  it('a failed background refresh keeps the player', async () => {
    rememberNarrationMeta(META_1);
    mockPlayer = emptyPlayer();
    // The start from the meta lands; its background refresh fails quietly
    // (the store keeps the story and sets no error for it).
    mockPlayer.startNarration.mockImplementation(() => {
      landNow(META_1);
      return Promise.resolve(true);
    });
    await renderPlayer();
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-error')).toBeNull();
    expect(screen.queryByTestId('player-stream-error')).toBeNull();
    expect(screen.getByText(TITLE_1)).toBeOnTheScreen();
  });

  it('a narration that is gone shows the full error; retry starts it again', async () => {
    mockPlayer = makePlayer();
    await renderPlayer('kitaplik');
    // The background refresh answered 404.
    set({ loadPhase: 'failed', loadError: 'notFound', isPlaying: false });
    expect(screen.getByTestId('player-error')).toBeOnTheScreen();
    expect(screen.getByText('Masal bulunamadı.')).toBeOnTheScreen();
    expect(flat(screen.getByTestId('player-error')).backgroundColor).toBe(themes.kitaplik.bg);
    expect(flat(screen.getByText('Yüklenemedi')).fontFamily).toBe(themes.kitaplik.fontDisplay);
    fireEvent.press(screen.getByTestId('player-retry'));
    expect(mockPlayer.startNarration).toHaveBeenCalledWith({ narrationId: 'n-1' }, { autoplay: false });
  });

  it('a narration whose audio was removed says so and offers to create it again, never a retry', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    // The background refresh found it not READY (an admin removed the audio).
    set({ loadPhase: 'failed', loadError: 'audioRemoved', isPlaying: false });
    expect(screen.getByTestId('player-audio-removed')).toBeOnTheScreen();
    expect(screen.getByText('Bu masalın sesi yenileniyor')).toBeOnTheScreen();
    expect(screen.getByText('Dinlemek için masalın sesini masal sayfasından yeniden oluştur.')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-retry')).toBeNull();
    expect(screen.queryByTestId('player-stream-error')).toBeNull();
    fireEvent.press(screen.getByTestId('player-recreate'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: STORY_ID_1 });
  });

  it('an unknown narration whose audio was removed shows the same state without a story to open', async () => {
    setRoute({ narrationId: 'n-9' });
    mockPlayer = emptyPlayer();
    mockPlayer.startNarration.mockImplementation(() => {
      runInAction(() => {
        mockPlayer.loadPhase = 'failed';
        mockPlayer.loadError = 'audioRemoved';
        mockPlayer.pendingNarrationId = null;
      });
      return Promise.resolve(false);
    });
    await renderPlayer();
    expect(screen.getByTestId('player-audio-removed')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-recreate')).toBeNull();
  });

  it('an unknown narration that fails to load shows the full error with a retry', async () => {
    setRoute({ narrationId: 'n-9' });
    mockPlayer = emptyPlayer();
    mockPlayer.startNarration.mockImplementation(() => {
      runInAction(() => {
        mockPlayer.loadPhase = 'failed';
        mockPlayer.loadError = 'loadFailed';
        mockPlayer.pendingNarrationId = null;
      });
      return Promise.resolve(false);
    });
    await renderPlayer();
    expect(screen.getByTestId('player-error')).toBeOnTheScreen();
    expect(screen.getByText('Masal yüklenemedi.')).toBeOnTheScreen();

    mockPlayer.startNarration.mockImplementation(() => {
      landNow(metaOf('n-9', 'Pinokyo'));
      return Promise.resolve(true);
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('player-retry'));
    });
    expect(mockPlayer.startNarration).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
  });

  it('a failure of another start is not this narration\'s error', async () => {
    rememberNarrationMeta(metaOf('n-2', 'Uykulu Ay'));
    setRoute({ narrationId: 'n-2' });
    // Something else failed before this screen opened; this start runs.
    mockPlayer = makePlayer({ loadPhase: 'failed', loadError: 'loadFailed' });
    await renderPlayer();
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-stream-error')).toBeNull();
    expect(screen.queryByTestId('player-error')).toBeNull();
  });

  it('a start of another narration that failed before the player opened does not mark the loaded story', async () => {
    // A push tap for a deleted narration answered 404; the story before it
    // stays loaded next to the store's error. Its player opens normally.
    mockPlayer = makePlayer({ loadPhase: 'failed', loadError: 'notFound' });
    await renderPlayer();
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-error')).toBeNull();
    expect(screen.queryByTestId('player-stream-error')).toBeNull();
    expect(screen.getByText(TITLE_1)).toBeOnTheScreen();
  });

  it('a start that fails while the player is hidden is that narration\'s error, not the loaded one\'s', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    act(() => setMockFocused(false));
    set({ pendingNarrationId: 'n-7', loadPhase: 'loading' });
    set({ pendingNarrationId: null, loadPhase: 'failed', loadError: 'notFound' });
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-error')).toBeNull();

    // The loaded story's own refresh answering 404 is its error.
    set({ loadPhase: 'ready', loadError: null });
    set({ loadPhase: 'failed', loadError: 'notFound' });
    expect(screen.getByTestId('player-error')).toBeOnTheScreen();
  });

  it('a start of this narration made elsewhere that fails shows the inline retry', async () => {
    routeFollowsSetParams();
    const next = metaOf('n-2', 'Uykulu Ay');
    queueOf([META_1, next], 'n-1');
    mockPlayer = makePlayer({ isPlaying: true });
    await renderPlayer();
    // The queue sheet starts B; the player follows, then B's start fails
    // before its stream reached the player (A stays loaded).
    act(() => {
      queueStore.startAt('n-2');
      runInAction(() => {
        mockPlayer.pendingNarrationId = 'n-2';
        mockPlayer.loadPhase = 'loading';
      });
    });
    set({ pendingNarrationId: null, loadPhase: 'failed', loadError: 'loadFailed', isPlaying: false });
    expect(screen.getByText('Uykulu Ay')).toBeOnTheScreen();
    expect(screen.getByTestId('player-stream-error')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('player-stream-retry'));
    expect(mockPlayer.reloadStream).not.toHaveBeenCalled();
    expect(mockPlayer.startNarration).toHaveBeenLastCalledWith(
      { narrationId: 'n-2', meta: expect.objectContaining({ narrationId: 'n-2' }) },
      { autoplay: true },
    );
  });

  it('says the story was not found without a narration id', async () => {
    setRoute({});
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.getByText('Masal bulunamadı.')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-retry')).toBeNull();
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Kapat'));
    expect(mockNavigation.goBack).toHaveBeenCalled();
  });
});

describe('AudioPlayerScreen autoplay param', () => {
  it('plays once and is cleared', async () => {
    routeFollowsSetParams();
    setRoute({ narrationId: 'n-1', autoplay: true });
    mockPlayer = makePlayer();
    const view = await renderPlayer();
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ autoplay: undefined });

    // The cleared param re-renders the screen: nothing plays again.
    view.rerender(<AudioPlayerScreen />);
    await act(async () => undefined);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it('does not play a story that already plays, and never without the param', async () => {
    setRoute({ narrationId: 'n-1', autoplay: true });
    mockPlayer = makePlayer({ isPlaying: true });
    await renderPlayer();
    expect(mockPlayer.play).not.toHaveBeenCalled();
    screen.unmount();

    setRoute({ narrationId: 'n-1' });
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(mockPlayer.play).not.toHaveBeenCalled();
    expect(mockNavigation.setParams).toHaveBeenCalledTimes(1);
  });

  it('already loaded, finished and autoplay restarts it', async () => {
    setRoute({ narrationId: 'n-1', autoplay: true });
    mockPlayer = makePlayer({ storyEnded: true, currentPositionMs: 353000 });
    await renderPlayer();
    // play() starts a finished story over (the store's rule); no new load.
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
  });

  it('a start already running for this narration only gets the intent', async () => {
    const meta = metaOf('n-2', 'Uykulu Ay');
    rememberNarrationMeta(meta);
    setRoute({ narrationId: 'n-2', autoplay: true });
    mockPlayer = makePlayer({ pendingNarrationId: 'n-2', loadPhase: 'loading' });
    await renderPlayer();
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });
});

describe('AudioPlayerScreen track changes', () => {
  it('never shows the previous narration\'s title during a switch', async () => {
    routeFollowsSetParams();
    const next = metaOf('n-2', 'Uykulu Ay');
    queueOf([META_1, next], 'n-1');
    mockPlayer = makePlayer({ isPlaying: true });
    await renderPlayer();
    expect(screen.getByText(TITLE_1)).toBeOnTheScreen();

    // The queue starts B: pending, the store still holds A's story.
    act(() => {
      queueStore.advance();
      runInAction(() => {
        mockPlayer.pendingNarrationId = 'n-2';
        mockPlayer.loadPhase = 'loading';
      });
    });
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ narrationId: 'n-2' });
    expect(screen.getByText('Uykulu Ay')).toBeOnTheScreen();
    expect(screen.queryByText(TITLE_1)).toBeNull();
    expect(screen.getByTestId('player-narrator')).toHaveTextContent('Deniz anlatıyor');
    // The pending start spins the play face; no full-screen loading.
    expect(screen.getByTestId('player-play-busy')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-loading')).toBeNull();
    // A's position does not show on B's track.
    expect(elapsed()).toHaveTextContent('0:00');

    land(next, { isPlaying: true });
    expect(screen.getByText('Uykulu Ay')).toBeOnTheScreen();
    // Nothing was started twice.
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
  });

  it('a queue advance calls setParams, never replace', async () => {
    const next = metaOf('n-2', 'Uykulu Ay');
    queueOf([META_1, next], 'n-1');
    mockPlayer = makePlayer({ isPlaying: true });
    await renderPlayer();
    act(() => {
      runInAction(() => {
        mockPlayer.pendingNarrationId = 'n-2';
      });
    });
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ narrationId: 'n-2' });
    expect(mockNavigation.replace).not.toHaveBeenCalled();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it('a blurred player follows only the queue, and a failed start does not bounce it back', async () => {
    queueOf([META_1, metaOf('n-2', 'B'), metaOf('n-3', 'C')], 'n-1');
    mockPlayer = makePlayer({ isPlaying: true });
    await renderPlayer();
    act(() => setMockFocused(false));

    // A start from somewhere else (a library row) while the player is hidden.
    set({ pendingNarrationId: 'n-7' });
    expect(mockNavigation.setParams).not.toHaveBeenCalled();
    // That start failed: the old story stays, no track change.
    set({ pendingNarrationId: null, loadPhase: 'failed', loadError: 'loadFailed' });
    expect(mockNavigation.setParams).not.toHaveBeenCalled();

    // The queue goes on with the player hidden: it follows.
    act(() => {
      queueStore.advance();
    });
    set({ pendingNarrationId: 'n-2', loadPhase: 'loading' });
    expect(mockNavigation.setParams).toHaveBeenCalledWith({ narrationId: 'n-2' });
  });

  it('a sample taking the player is no track change; play starts this narration again', async () => {
    rememberNarrationMeta(META_1);
    mockPlayer = makePlayer({ isPlaying: true });
    await renderPlayer();
    // A narrator sample took the player (the story's meta is remembered).
    set({ source: 'sample', audioId: '', isPlaying: true, ...plainFields(null) });
    expect(mockNavigation.setParams).not.toHaveBeenCalled();
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.getByText(TITLE_1)).toBeOnTheScreen();
    // The sample's state is not this story's.
    expect(screen.getByLabelText('Oynat')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('player-play'));
    expect(mockPlayer.togglePlayPause).not.toHaveBeenCalled();
    expect(mockPlayer.startNarration).toHaveBeenCalledWith({ narrationId: 'n-1', meta: META_1 }, { autoplay: true });
  });
});

describe('AudioPlayerScreen queue', () => {
  const A = metaOf('n-0', 'Önceki');
  const C = metaOf('n-2', 'Sonraki');

  it('outside a queue there is no previous or next, as in the mockup', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.queryByLabelText('Önceki masal')).toBeNull();
    expect(screen.queryByLabelText('Sonraki masal')).toBeNull();
    expect(face('player-rewind').width).toBe(SKIP_SIZE);
    expect(screen.getByTestId('player-caption')).toHaveTextContent('Şimdi dinleniyor');
  });

  it('a queued story played from outside the queue has no queue context', async () => {
    queueOf([A, META_1, C], null);
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.queryByTestId('player-previous')).toBeNull();
    expect(screen.queryByTestId('player-next')).toBeNull();
    expect(screen.getByTestId('player-caption')).toHaveTextContent('Şimdi dinleniyor');
  });

  it('a queue of one has no previous or next but shows its place', async () => {
    queueOf([META_1], 'n-1');
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.queryByTestId('player-previous')).toBeNull();
    expect(screen.getByTestId('player-caption')).toHaveTextContent('Sıra 1/1');
  });

  it('in queue context the caption names the place, previous and next sit at the sides', async () => {
    queueOf([A, META_1, C], 'n-1');
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-caption')).toHaveTextContent('Sıra 2/3');
    const previous = screen.getByTestId('player-previous');
    const next = screen.getByTestId('player-next');
    // 40 wide with 4 of slop at each side: a 48dp target.
    expect(previous.props.hitSlop).toEqual({ left: 4, right: 4 });
    expect(next.props.hitSlop).toEqual({ left: 4, right: 4 });
    expect(flat(previous).width).toBe(40);
    expect(flat(screen.getByTestId('player-controls')).gap).toBe(8);

    await act(async () => {
      fireEvent.press(next);
    });
    expect(queueStore.currentId).toBe('n-2');
    expect(mockPlayer.startNarration).toHaveBeenCalledWith(
      { narrationId: 'n-2', meta: expect.objectContaining({ narrationId: 'n-2' }) },
      { autoplay: true, fromQueue: true },
    );
  });

  it('next is disabled at the end of the queue and does not seek', async () => {
    queueOf([A, META_1], 'n-1');
    mockPlayer = makePlayer({ currentPositionMs: 30000 });
    await renderPlayer();
    const next = screen.getByTestId('player-next');
    expect(next.props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      fireEvent.press(next);
    });
    expect(mockPlayer.seek).not.toHaveBeenCalled();
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
    expect(queueStore.currentId).toBe('n-1');
  });

  it('previous restarts after 5 s and goes back within the first 5 s', async () => {
    queueOf([A, META_1, C], 'n-1');
    mockPlayer = makePlayer({ currentPositionMs: 45000 });
    await renderPlayer();
    await act(async () => {
      fireEvent.press(screen.getByTestId('player-previous'));
    });
    expect(mockPlayer.seek).toHaveBeenCalledWith(0);
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();

    set({ currentPositionMs: 2000 });
    await act(async () => {
      fireEvent.press(screen.getByTestId('player-previous'));
    });
    expect(queueStore.currentId).toBe('n-0');
    expect(mockPlayer.startNarration).toHaveBeenCalledWith(
      { narrationId: 'n-0', meta: expect.objectContaining({ narrationId: 'n-0' }) },
      { autoplay: true, fromQueue: true },
    );
  });

  it('previous while this story still starts goes back an entry, never seeks the last story', async () => {
    queueOf([A, META_1, C], 'n-1');
    rememberNarrationMeta(META_1);
    // Next was just pressed on A at 3:00: n-1 is pending, the store still
    // holds A's story and position.
    mockPlayer = makePlayer(
      { pendingNarrationId: 'n-1', loadPhase: 'loading', isPlaying: true, currentPositionMs: 180000 },
      A,
    );
    await renderPlayer();
    const previous = screen.getByTestId('player-previous');
    expect(previous.props.accessibilityState.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(previous);
    });
    expect(mockPlayer.seek).not.toHaveBeenCalled();
    expect(queueStore.currentId).toBe('n-0');
    expect(mockPlayer.startNarration).toHaveBeenLastCalledWith(
      { narrationId: 'n-0', meta: expect.objectContaining({ narrationId: 'n-0' }) },
      { autoplay: true, fromQueue: true },
    );
  });

  it('previous is disabled only on the first entry within its first 5 s', async () => {
    queueOf([META_1, C], 'n-1');
    mockPlayer = makePlayer({ currentPositionMs: 3000 });
    await renderPlayer();
    expect(screen.getByTestId('player-previous').props.accessibilityState.disabled).toBe(true);
    set({ currentPositionMs: 6000 });
    const previous = screen.getByTestId('player-previous');
    expect(previous.props.accessibilityState.disabled).toBe(false);
    await act(async () => {
      fireEvent.press(previous);
    });
    expect(mockPlayer.seek).toHaveBeenCalledWith(0);
  });

  it('the queue button opens the queue sheet and shows the count', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.queryByTestId('player-queue-count')).toBeNull();
    // Empty: the Library button's wording, never "0 masal" (RC-4).
    expect(screen.getByTestId('player-queue').props.accessibilityLabel).toBe('Sıradakiler');
    expect(screen.queryByLabelText('Sıradakiler, 0 masal')).toBeNull();

    queueOf([A], null);
    expect(screen.getByLabelText('Sıradakiler, 1 masal')).toBeOnTheScreen();
    queueOf([A, META_1, C], null);
    expect(screen.getByTestId('player-queue-count', { includeHiddenElements: true })).toHaveTextContent('3');
    expect(screen.getByLabelText('Sıradakiler, 3 masal')).toBeOnTheScreen();
    // The label says the count: it is never repeated as the value
    // ("Sıradakiler, 3 masal, 3"), so no stale value can outlive it either.
    expect(screen.getByTestId('player-queue').props.accessibilityValue?.text).toBeUndefined();

    fireEvent.press(screen.getByTestId('player-queue'));
    expect(queueSheet.visible).toBe(true);
    expect(queueSheet.origin).toBe('player');
  });
});

describe('AudioPlayerScreen title link', () => {
  it('the title opens the story page', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    const title = titleText();
    expect(title.props.accessibilityRole).toBe('link');
    expect(title.props.accessibilityHint).toBe('Masalın sayfası');
    fireEvent.press(title);
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: STORY_ID_1 });
  });

  it('goes back to the story page when it is right below the player', async () => {
    mockNavigation.getState.mockReturnValue({
      index: 2,
      routes: [
        { name: 'Main' },
        { name: 'StoryDetail', params: { storyId: STORY_ID_1 } },
        { name: 'AudioPlayer', params: { narrationId: 'n-1' } },
      ],
    });
    mockPlayer = makePlayer();
    await renderPlayer();
    fireEvent.press(titleText());
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it('opens the page of the route\'s story while another one is in the player', async () => {
    rememberNarrationMeta(metaOf('n-2', 'Uykulu Ay'));
    setRoute({ narrationId: 'n-2' });
    mockPlayer = makePlayer();
    await renderPlayer();
    fireEvent.press(titleText());
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-n-2' });
  });
});

describe('AudioPlayerScreen play face', () => {
  it('spins while loading or buffering with the intent to play', async () => {
    mockPlayer = makePlayer({ isPlaying: true, isBuffering: true });
    await renderPlayer();
    expect(screen.getByTestId('player-play-busy')).toBeOnTheScreen();
    expect(screen.getByTestId('player-play').props.accessibilityState.busy).toBe(true);
    // The spinner takes the face's place without changing its size.
    expect(face('player-play').width).toBe(PLAY_SIZE);

    set({ isBuffering: false });
    expect(screen.queryByTestId('player-play-busy')).toBeNull();
    expect(screen.getByLabelText('Duraklat')).toBeOnTheScreen();

    // Buffering without the intent (paused) does not spin.
    set({ isPlaying: false, isBuffering: true });
    expect(screen.queryByTestId('player-play-busy')).toBeNull();
    expect(screen.getByLabelText('Oynat')).toBeOnTheScreen();

    // A reload with the intent spins again.
    set({ isPlaying: true, isBuffering: false, loadPhase: 'loading' });
    expect(screen.getByTestId('player-play-busy')).toBeOnTheScreen();
  });

  it('a stream error shows the inline retry; retry calls reloadStream', async () => {
    mockPlayer = makePlayer({ loadPhase: 'failed', loadError: 'streamFailed' });
    await renderPlayer();
    expect(screen.getByTestId('player-stream-error')).toBeOnTheScreen();
    expect(screen.getByText('Masal oynatılamadı.')).toBeOnTheScreen();
    // The player and its tiles stay.
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('player-timer-entry')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('player-stream-retry'));
    expect(mockPlayer.reloadStream).toHaveBeenCalledTimes(1);
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();

    set({ loadPhase: 'ready', loadError: null });
    expect(screen.queryByTestId('player-stream-error')).toBeNull();
  });

  it('a start that failed with the meta known shows the inline retry, which starts it again', async () => {
    const meta = metaOf('n-2', 'Uykulu Ay');
    rememberNarrationMeta(meta);
    setRoute({ narrationId: 'n-2' });
    mockPlayer = emptyPlayer();
    mockPlayer.startNarration.mockImplementation(() => {
      runInAction(() => {
        mockPlayer.loadPhase = 'failed';
        mockPlayer.loadError = 'loadFailed';
        mockPlayer.pendingNarrationId = null;
      });
      return Promise.resolve(false);
    });
    await renderPlayer();
    expect(screen.getByTestId('player-screen')).toBeOnTheScreen();
    expect(screen.getByTestId('player-stream-error')).toBeOnTheScreen();
    expect(screen.queryByTestId('player-error')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByTestId('player-stream-retry'));
    });
    expect(mockPlayer.reloadStream).not.toHaveBeenCalled();
    expect(mockPlayer.startNarration).toHaveBeenLastCalledWith({ narrationId: 'n-2', meta }, { autoplay: true });
  });
});

describe('AudioPlayerScreen transport sizes', () => {
  it('lays the transport out at 56 / 24 alone and 8 apart with previous and next', () => {
    expect(transportLayout(false)).toEqual({ skip: 56, gap: 24 });
    expect(transportLayout(false, 328)).toEqual({ skip: 56, gap: 24 });
    // At 360dp (328 inside the gutters) the queued row keeps 56dp skips.
    const queued = transportLayout(true, 328);
    expect(queued).toEqual({ skip: 56, gap: 8 });
    expect(queued.skip * 2 + PLAY_SIZE + 2 * 40 + 4 * queued.gap).toBeLessThanOrEqual(328);
    // Never under a 48dp touch target.
    expect(transportLayout(true, 240).skip).toBe(48);
  });

  it('the play face is 80 wide on its 4dp lip, the skips 56 on 3', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(face('player-play').width).toBe(80);
    expect(face('player-play').height).toBe(80);
    expect(flat(screen.getByTestId('player-play-lip')).top).toBe(4);
    expect(face('player-rewind').width).toBe(56);
    expect(flat(screen.getByTestId('player-rewind-lip')).top).toBe(3);
    expect(flat(screen.getByTestId('player-controls')).gap).toBe(24);
  });

  it('skips 15 seconds back and forward', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    fireEvent.press(screen.getByLabelText('15 saniye geri'));
    expect(mockPlayer.skipBackward).toHaveBeenCalledWith(15);
    fireEvent.press(screen.getByLabelText('15 saniye ileri'));
    expect(mockPlayer.skipForward).toHaveBeenCalledWith(15);
  });

  it('the skips do nothing while another narration holds the player', async () => {
    rememberNarrationMeta(metaOf('n-2', 'Uykulu Ay'));
    setRoute({ narrationId: 'n-2' });
    mockPlayer = makePlayer();
    await renderPlayer();
    fireEvent.press(screen.getByLabelText('15 saniye ileri'));
    expect(mockPlayer.skipForward).not.toHaveBeenCalled();
  });

  it('the track is adjustable for screen readers', async () => {
    mockPlayer = makePlayer({ currentPositionMs: 53000 });
    await renderPlayer();
    const seek = screen.getByTestId('player-seek');
    expect(seek.props.accessibilityRole).toBe('adjustable');
    expect(seek.props.accessibilityValue.text).toBe('0:53 geçti, 5:00 kaldı');
    fireEvent(seek, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(mockPlayer.skipForward).toHaveBeenCalledWith(15);
    fireEvent(seek, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(mockPlayer.skipBackward).toHaveBeenCalledWith(15);
  });
});

describe('AudioPlayerScreen art size (NP-21)', () => {
  const RATIO = 290 / 236;

  it('counts every block of the player but the art', () => {
    // Bar 8 + 46, art margin and lip 20, title 50, narrator 26, track 56,
    // times 9, transport 96, tiles 83, end padding 24.
    expect(PLAYER_CHROME_HEIGHT).toBe(418);
  });

  it('keeps a 360 x 640 phone at the smallest art, as before (the page scrolls a little)', () => {
    expect(playerArtSize(360, 640, 24, 48)).toEqual({ width: ART_MIN_WIDTH, height: Math.floor(ART_MIN_WIDTH * RATIO) });
    // Without insets (an older Android whose window ends above the bars) it
    // takes only what fits.
    const bare = playerArtSize(360, 640, 0, 0);
    expect(bare.width).toBeGreaterThan(ART_MIN_WIDTH);
    expect(bare.height).toBeLessThanOrEqual(640 - PLAYER_CHROME_HEIGHT);
  });

  it('a 360dp phone of normal height fills the height exactly, inside the side margins', () => {
    const art = playerArtSize(360, 740, 24, 48);
    expect(art.width).toBeGreaterThan(ART_MIN_WIDTH);
    // Never taller than the room the rest of the player leaves.
    expect(art.height).toBeLessThanOrEqual(740 - 24 - 48 - PLAYER_CHROME_HEIGHT);
    expect(art.height).toBeGreaterThan(740 - 24 - 48 - PLAYER_CHROME_HEIGHT - 3);
  });

  it('a tall phone grows the art until the side margins stop it', () => {
    // 412 x 914 with gesture navigation: the old cap of 236 left ~130dp empty.
    const art = playerArtSize(412, 914, 24, 24);
    expect(art.width).toBe(412 - 2 * 56);
    expect(art.height).toBe(Math.floor(300 * RATIO));
    // What is left goes to the five gaps: well under the old empty band.
    const left = 914 - 48 - PLAYER_CHROME_HEIGHT - art.height;
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(100);
  });

  it('never grows past the largest size, never shrinks under the smallest', () => {
    expect(playerArtSize(800, 2000, 0, 0).width).toBe(ART_MAX_WIDTH);
    expect(playerArtSize(320, 480, 0, 0).width).toBe(ART_MIN_WIDTH);
    // A taller window never makes the art smaller.
    let last = 0;
    for (let h = 600; h <= 1000; h += 20) {
      const { width } = playerArtSize(412, h, 24, 24);
      expect(width).toBeGreaterThanOrEqual(last);
      last = width;
    }
  });

  it('follows the safe area: a 48dp navigation bar leaves less room than a gesture bar', () => {
    expect(playerArtSize(360, 760, 24, 48).width).toBeLessThan(playerArtSize(360, 760, 24, 16).width);
  });
});

describe('AudioPlayerScreen end of a story (NP-18)', () => {
  /** The loaded story rests at its end; nothing followed it. */
  const endedPlayer = () =>
    makePlayer({ storyEnded: true, isPlaying: false, currentPositionMs: 353000 });

  it('shows the end card with "Baştan dinle" once the story ended and nothing follows', async () => {
    mockPlayer = endedPlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-end-title')).toHaveTextContent('Masal bitti.');
    expect(screen.queryByTestId('player-end-next')).toBeNull();
    // Alone, the restart is the primary action.
    expect(face('player-end-restart').backgroundColor).toBe(themes['gece-mavisi'].action);
    fireEvent.press(screen.getByText('Baştan dinle'));
    // The store starts a finished story over on play.
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });

  it('goes away when the story starts again, and is never there while it plays', async () => {
    mockPlayer = endedPlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-end')).toBeOnTheScreen();
    set({ storyEnded: false, isPlaying: true, currentPositionMs: 0 });
    expect(screen.queryByTestId('player-end')).toBeNull();
    set({ storyEnded: true, isPlaying: true });
    expect(screen.queryByTestId('player-end')).toBeNull();
  });

  it('is not shown for a story that only paused, or for a route the store does not hold', async () => {
    mockPlayer = makePlayer({ isPlaying: false, currentPositionMs: 100000 });
    await renderPlayer();
    expect(screen.queryByTestId('player-end')).toBeNull();
    // Another narration of the queue is starting: the ended one is not this route's.
    rememberNarrationMeta(metaOf('n-2', 'Uykulu Ay'));
    act(() => setRoute({ narrationId: 'n-2' }));
    set({ storyEnded: true });
    expect(screen.queryByTestId('player-end')).toBeNull();
  });

  it('offers the next queued story when a sleep timer stopped the queue, and plays it', async () => {
    const second = metaOf('n-2', 'Uykulu Ay');
    queueOf([META_1, second], 'n-1');
    mockPlayer = endedPlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-end-next-title')).toHaveTextContent('Uykulu Ay');
    // Beside a next story the restart is the quieter choice.
    expect(face('player-end-restart').backgroundColor).not.toBe(themes['gece-mavisi'].action);
    fireEvent.press(screen.getByLabelText('Uykulu Ay masalını dinle'));
    expect(mockPlayer.startNarration).toHaveBeenCalledWith(
      { narrationId: 'n-2', meta: expect.objectContaining({ narrationId: 'n-2' }) },
      { autoplay: true, fromQueue: true },
    );
    expect(queueStore.currentId).toBe('n-2');
  });

  it('offers a queued story also when this one was not played from the queue', async () => {
    queueOf([metaOf('n-3', 'Ay Dede')], null);
    mockPlayer = endedPlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-end-next-title')).toHaveTextContent('Ay Dede');
    expect(screen.getByText('Dinle')).toBeOnTheScreen();
  });

  it('offers the next tale of the home shelf and opens its page', async () => {
    mockShelf = [
      { id: STORY_ID_1, title: TITLE_1, translationGroupId: null, category: 'BEDTIME' },
      { id: 'story-b', title: 'Yıldız Toplayan Kız', translationGroupId: null, category: 'BEDTIME' },
    ];
    mockPlayer = endedPlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-end-next-title')).toHaveTextContent('Yıldız Toplayan Kız');
    fireEvent.press(screen.getByLabelText('Yıldız Toplayan Kız masalının sayfasını aç'));
    expect(mockNavigation.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 'story-b' });
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
  });

  it('on the free plan it passes over a premium shelf tale (its page would only show the lock)', async () => {
    mockShelf = [
      { id: STORY_ID_1, title: TITLE_1, translationGroupId: null, category: 'BEDTIME' },
      { id: 'story-p', title: 'Altın Kuş', translationGroupId: null, category: 'BEDTIME', isPremium: true },
      { id: 'story-c', title: 'Kurbağa Prens', translationGroupId: null, category: 'BEDTIME' },
    ];
    mockPlayer = endedPlayer();
    await renderPlayer();
    expect(screen.getByTestId('player-end-next-title')).toHaveTextContent('Kurbağa Prens');
    expect(screen.queryByText('Altın Kuş')).toBeNull();
  });

  describe('keeps the tiles on screen (RC-3)', () => {
    // The emulator of the report, 411 wide, less its status and navigation bars
    // (the test safe area is 0): 840 high.
    const PHONE = { width: 411, height: 840, scale: 2.625, fontScale: 1 };
    let original: ReturnType<typeof Dimensions.get>;
    beforeEach(() => {
      original = Dimensions.get('window');
      act(() => Dimensions.set({ window: PHONE, screen: PHONE }));
    });
    afterEach(() => {
      act(() => Dimensions.set({ window: original, screen: original }));
    });
    const coverWidth = () => Number(flat(screen.getByTestId('player-cover')).width);

    it('the art gives up the end card height, estimated first and then as measured', async () => {
      mockPlayer = makePlayer({ isPlaying: false, currentPositionMs: 100000 });
      await renderPlayer();
      const playingWidth = coverWidth();
      expect(playingWidth).toBe(playerArtSize(411, 840, 0, 0).width);

      set({ storyEnded: true, currentPositionMs: 353000 });
      expect(screen.getByTestId('player-end')).toBeOnTheScreen();
      expect(coverWidth()).toBe(playerArtSize(411, 840, 0, 0, playerEndCardEstimate(false)).width);
      expect(coverWidth()).toBeLessThan(playingWidth);

      // Drawn taller (a large font): the art takes the measured height off.
      fireEvent(screen.getByTestId('player-end-wrap'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 379, height: 120 } },
      });
      expect(coverWidth()).toBe(playerArtSize(411, 840, 0, 0, 120).width);

      // Played again: the art is back at its size.
      set({ storyEnded: false, isPlaying: true, currentPositionMs: 0 });
      expect(coverWidth()).toBe(playingWidth);
    });

    it('with the next story too, everything but the art still fits the window', async () => {
      queueOf([metaOf('n-3', 'Ay Dede')], null);
      mockPlayer = endedPlayer();
      await renderPlayer();
      expect(screen.getByTestId('player-end-next')).toBeOnTheScreen();
      const art = playerArtSize(411, 914, 24, 24, playerEndCardEstimate(true));
      expect(art.height + PLAYER_CHROME_HEIGHT + playerEndCardEstimate(true)).toBeLessThanOrEqual(914 - 48);
      expect(coverWidth()).toBe(playerArtSize(411, 840, 0, 0, playerEndCardEstimate(true)).width);
    });

    it('estimates 85dp for the card alone and 148dp with the next story', () => {
      expect(playerEndCardEstimate(false)).toBe(85);
      expect(playerEndCardEstimate(true)).toBe(148);
      // A reserved block never makes the art grow, and never below its smallest size.
      expect(playerArtSize(411, 914, 24, 24, 152).width).toBeLessThan(playerArtSize(411, 914, 24, 24).width);
      expect(playerArtSize(360, 640, 24, 48, 152).width).toBe(ART_MIN_WIDTH);
    });
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    mockPlayer = endedPlayer();
    await renderPlayer();
    expect(screen.getByText('The story has ended.')).toBeOnTheScreen();
    expect(screen.getByText('Listen again')).toBeOnTheScreen();
  });
});

describe('AudioPlayerScreen time labels', () => {
  it('shows elapsed time left and a minus-prefixed remaining time right', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(elapsed()).toHaveTextContent('0:00');
    expect(remaining()).toHaveTextContent('-5:53');
  });

  it('keeps the remaining label in step with the player position', async () => {
    mockPlayer = makePlayer({ currentPositionMs: 53000 });
    await renderPlayer();
    expect(elapsed()).toHaveTextContent('0:53');
    expect(remaining()).toHaveTextContent('-5:00');
  });

  it('shows a placeholder while the real length is unknown', async () => {
    mockPlayer = makePlayer({ totalDurationMs: 0 });
    await renderPlayer();
    expect(remaining()).toHaveTextContent('-:--');
  });

  it('divides the remaining time by the playback speed', async () => {
    mockPlayer = makePlayer({ currentPositionMs: 53000, playbackSpeed: 2 });
    await renderPlayer();
    expect(elapsed()).toHaveTextContent('0:53');
    expect(remaining()).toHaveTextContent('-2:30');
    expect(screen.getByTestId('player-speed-value')).toHaveTextContent('2,0x');
  });
});

describe('AudioPlayerScreen progress', () => {
  it('runs no ticker of its own: the clock follows the store, second by second', async () => {
    mockPlayer = makePlayer({ isPlaying: true, currentPositionMs: 10000 });
    await renderPlayer();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(elapsed()).toHaveTextContent('0:10');
    set({ currentPositionMs: 12600 });
    expect(elapsed()).toHaveTextContent('0:12');
    expect(remaining()).toHaveTextContent('-5:41');
  });

  it('draws the fill and the knob with transforms, the knob inside the track ends', async () => {
    mockPlayer = makePlayer({ isPlaying: true, currentPositionMs: 10000 });
    await renderPlayer();
    fireEvent(screen.getByTestId('player-seek'), 'layout', {
      nativeEvent: { layout: { width: 280, height: 44, x: 0, y: 0 } },
    });
    // The fill is always as wide as the track; only its transform moves.
    const fill = flat(screen.getByTestId('player-seek-fill'));
    expect(fill.width).toBe(280);
    expect(Array.isArray(fill.transform)).toBe(true);
    const knob = flat(screen.getByTestId('player-seek-knob'));
    expect(knob.left).toBe(0);
    const travel = knob.transform as Array<Record<string, unknown>>;
    expect(travel.some(entry => 'translateX' in entry)).toBe(true);
    // The grab scales an inner layer of its own.
    const grab = flat(screen.getByTestId('player-seek-knob-grab')).transform as Array<Record<string, unknown>>;
    expect(grab.some(entry => 'scale' in entry)).toBe(true);
    // A position report changes nothing in the track's own layout.
    set({ currentPositionMs: 200000 });
    expect(flat(screen.getByTestId('player-seek-fill')).width).toBe(280);
  });

  function touch(pageX: number) {
    return {
      nativeEvent: { pageX, pageY: 10, touches: [], changedTouches: [], identifier: 0, timestamp: 1 },
      touchHistory: {
        numberActiveTouches: 1,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: 1,
        touchBank: [
          {
            touchActive: true,
            startPageX: pageX,
            startPageY: 10,
            startTimeStamp: 1,
            currentPageX: pageX,
            currentPageY: 10,
            currentTimeStamp: 1,
            previousPageX: pageX,
            previousPageY: 10,
            previousTimeStamp: 1,
          },
        ],
      },
    };
  }

  it('a 15 s rewind: the late native end of the stopped chunk never draws the knob back (NL-01)', async () => {
    // React Native's own end of a native animation: the mocked native module
    // keeps each end callback, the test delivers it late with the value the
    // node had when it was stopped, and React Native re-renders the knob.
    type NativeEnd = (result: { finished: boolean; value?: number }) => void;
    const ends: NativeEnd[] = [];
    const nativeAnimated = NativeModules.NativeAnimatedModule as { startAnimatingNode: (...args: unknown[]) => void };
    const startAnimatingNode = jest
      .spyOn(nativeAnimated, 'startAnimatingNode')
      .mockImplementation((...args: unknown[]) => {
        ends.push(args[3] as NativeEnd);
      });
    const at = (positionMs: number, playing: boolean, epoch: number) => ({
      narrationId: 'n-1',
      positionMs,
      durationMs: 353000,
      playing,
      rate: 1,
      epoch,
    });
    try {
      // The tracks of earlier tests detach in a microtask (fake here): let them
      // go before the shared value turns native.
      act(() => {
        jest.runAllTicks();
      });
      mockPlayer = makePlayer({ isPlaying: true, currentPositionMs: 114000 });
      await renderPlayer();
      fireEvent(screen.getByTestId('player-seek'), 'layout', {
        nativeEvent: { layout: { width: 280, height: 44, x: 0, y: 0 } },
      });
      const knobX = () => {
        const transform = flat(screen.getByTestId('player-seek-knob')).transform as Array<{ translateX?: number }>;
        return transform.find(entry => 'translateX' in entry)?.translateX ?? Number.NaN;
      };
      const travel = 280 - KNOB_SIZE;
      act(() => playbackProgress.sync(at(114000, true, 900)));
      expect(ends).toHaveLength(1);

      // The rewind: the seek is in flight, then the stream buffers, so
      // nothing animates; the stopped chunk's end arrives with 1:54.
      act(() => playbackProgress.sync(at(99000, false, 901)));
      act(() => ends[0]({ finished: false, value: 114500 / 353000 }));

      expect(knobX()).toBeCloseTo((travel * 99000) / 353000, 3);
      expect(Math.abs(knobX() - (travel * 114500) / 353000)).toBeGreaterThan(5);
    } finally {
      startAnimatingNode.mockRestore();
      act(() => playbackProgress.sync({ ...at(0, false, 0), narrationId: '', durationMs: 0 }));
    }
  });

  it('scrubbing seeks to the place the finger is lifted at', async () => {
    mockPlayer = makePlayer({ currentPositionMs: 10000 });
    await renderPlayer();
    const seek = screen.getByTestId('player-seek');
    fireEvent(seek, 'layout', { nativeEvent: { layout: { width: 200, height: 44, x: 0, y: 0 } } });
    const left = (Dimensions.get('window').width - 200) / 2;
    act(() => {
      seek.props.onResponderGrant(touch(left + 50));
      seek.props.onResponderMove(touch(left + 100));
    });
    // Nothing is sought while the finger is down.
    expect(mockPlayer.seek).not.toHaveBeenCalled();
    act(() => {
      seek.props.onResponderRelease(touch(left + 100));
    });
    expect(mockPlayer.seek).toHaveBeenCalledTimes(1);
    expect(mockPlayer.seek.mock.calls[0][0]).toBeCloseTo(353 / 2, 3);
  });

  it('measures the finger on the knob\'s travel, so the knob stays under it at the ends', async () => {
    mockPlayer = makePlayer({ currentPositionMs: 10000 });
    await renderPlayer();
    const seek = screen.getByTestId('player-seek');
    fireEvent(seek, 'layout', { nativeEvent: { layout: { width: 200, height: 44, x: 0, y: 0 } } });
    const left = (Dimensions.get('window').width - 200) / 2;
    // The knob's centre at the start sits half a knob in: that is 0.
    act(() => {
      seek.props.onResponderGrant(touch(left + KNOB_SIZE / 2));
      seek.props.onResponderRelease(touch(left + KNOB_SIZE / 2));
    });
    expect(mockPlayer.seek).toHaveBeenLastCalledWith(0);
    // Half a knob before the end is the end; past the track it stays there.
    act(() => {
      seek.props.onResponderGrant(touch(left + 200 - KNOB_SIZE / 2));
      seek.props.onResponderRelease(touch(left + 200 + 30));
    });
    expect(mockPlayer.seek).toHaveBeenLastCalledWith(353);
    // A quarter of the travel.
    act(() => {
      seek.props.onResponderGrant(touch(left + KNOB_SIZE / 2 + (200 - KNOB_SIZE) / 4));
      seek.props.onResponderRelease(touch(left + KNOB_SIZE / 2 + (200 - KNOB_SIZE) / 4));
    });
    expect(mockPlayer.seek.mock.calls[2][0]).toBeCloseTo(353 / 4, 3);
  });

  it('takes no scrub before the story is in the player or while its length is unknown', async () => {
    rememberNarrationMeta(META_1);
    mockPlayer = makePlayer({ totalDurationMs: 0 });
    await renderPlayer();
    const evt = touch(100);
    const seek = () => screen.getByTestId('player-seek');
    expect(seek().props.onStartShouldSetResponder(evt)).toBe(false);
    expect(seek().props.accessibilityState.disabled).toBe(true);
    set({ totalDurationMs: 353000 });
    expect(seek().props.onStartShouldSetResponder(evt)).toBe(true);
    expect(seek().props.accessibilityState.disabled).toBe(false);
    // A sample took the player: nothing to scrub for this story.
    set({ source: 'sample', audioId: '' });
    expect(seek().props.onStartShouldSetResponder(evt)).toBe(false);
  });

  it('the seek knob grab animates on the native driver', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    mockPlayer = makePlayer({ currentPositionMs: 10000 });
    await renderPlayer();
    timing.mockClear();
    const seek = screen.getByTestId('player-seek');
    act(() => {
      seek.props.onResponderGrant(touch(100));
    });
    expect(timing).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 1, duration: DURATION.fast, useNativeDriver: true }),
    );
    act(() => {
      seek.props.onResponderRelease(touch(100));
    });
    expect(timing).toHaveBeenLastCalledWith(
      expect.any(Object),
      expect.objectContaining({ toValue: 0, duration: DURATION.fast, useNativeDriver: true }),
    );
    expect(KNOB_GRAB_SCALE).toBe(1.15);
  });

  it('does not seek a narration that is not in the player', async () => {
    rememberNarrationMeta(metaOf('n-2', 'Uykulu Ay'));
    setRoute({ narrationId: 'n-2' });
    mockPlayer = makePlayer({ currentPositionMs: 100000 });
    await renderPlayer();
    // The other story's position is not drawn either.
    expect(elapsed()).toHaveTextContent('0:00');
    const seek = screen.getByTestId('player-seek');
    act(() => {
      seek.props.onResponderGrant(touch(100));
      seek.props.onResponderRelease(touch(100));
    });
    expect(mockPlayer.seek).not.toHaveBeenCalled();
  });
});

describe('AudioPlayerScreen sleep timer tile', () => {
  it('shows the timer state and opens the timer sheet', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(timerState()).toHaveTextContent('Kapalı');
    expect(screen.queryByTestId('timer-sheet')).toBeNull();
    pressTile('player-timer-entry');
    expect(screen.getByTestId('timer-sheet')).toBeOnTheScreen();
  });

  it('the tile sinks at the touch and the sheet opens in the next frame, also before the enter ended (LR-4)', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    const order: string[] = [];
    const realTiming = Animated.timing;
    jest.spyOn(Animated, 'timing').mockImplementation(((
      value: Animated.Value,
      config: Animated.TimingAnimationConfig & { toValue: number },
    ) => {
      if (config.duration === DURATION.pressIn) order.push('sink');
      return realTiming(value, config);
    }) as unknown as typeof Animated.timing);
    const tile = screen.getByTestId('player-timer-entry');
    fireEvent(tile, 'pressIn');
    fireEvent(tile, 'pressOut');
    fireEvent.press(tile);
    expect(order).toEqual(['sink']);
    expect(screen.queryByTestId('timer-sheet')).toBeNull();
    advance(16);
    // No transitionEnd yet: the press mounted the sheets itself, and the glow came with them.
    expect(screen.getByTestId('timer-sheet')).toBeOnTheScreen();
    expect(screen.getByTestId('player-glow', { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('tints the timer tile while the timer is on, its 2dp ring always there', async () => {
    mockPlayer = makePlayer();
    await renderPlayer('erik');
    const T = themes.erik;
    expect(face('player-timer-entry').borderWidth).toBe(2);
    expect(face('player-timer-entry').borderColor).toBe('transparent');
    act(() => sleepTimerService.turnOn({ maxStories: 1 }));
    expect(face('player-timer-entry').backgroundColor).toBe(mix(T.catUyku, 0.17, T.bg));
    expect(face('player-timer-entry').borderColor).toBe(mix(T.catUyku, 0.55, T.bg));
    expect(face('player-timer-entry').borderWidth).toBe(2);
    expect(timerState()).toHaveTextContent('Bu masal');
    act(() => sleepTimerService.turnOff());
    expect(face('player-timer-entry').backgroundColor).toBe(T.surface);
    expect(face('player-timer-entry').borderWidth).toBe(2);
    // Both tiles share the face metrics.
    expect(face('player-speed-entry').minHeight).toBe(face('player-timer-entry').minHeight);
  });

  it('does not attach the player to the timer (the session bridge does)', async () => {
    const attach = jest.spyOn(sleepTimerService, 'attachPlayer');
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(attach).not.toHaveBeenCalled();
  });
});

describe('AudioPlayerScreen playback speed', () => {
  it('the tile opens the sheet and a stop applies at once', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    expect(screen.queryByTestId('speed-sheet')).toBeNull();
    pressTile('player-speed-entry');
    expect(screen.getByTestId('speed-sheet')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('speed-slider-label-5'));
    expect(mockPlayer.setSpeed).toHaveBeenCalledWith(1.25);
  });

  it('the switch stores the speed for every story', async () => {
    mockPlayer = makePlayer();
    await renderPlayer();
    pressTile('player-speed-entry');
    fireEvent.press(screen.getByTestId('speed-for-all'));
    expect(mockPlayer.setSpeedForAllStories).toHaveBeenCalledWith(true);
  });

  it('follows the player: value, switch and tile', async () => {
    mockPlayer = makePlayer({ playbackSpeed: 1.5, speedForAllStories: true });
    await renderPlayer();
    expect(screen.getByLabelText('Oynatma hızı, 1,5x')).toBeOnTheScreen();
    expect(screen.getByTestId('player-speed-value')).toHaveTextContent('1,5x');
    pressTile('player-speed-entry');
    expect(screen.getByTestId('speed-value')).toHaveTextContent('1,5x');
    expect(screen.getByTestId('speed-for-all').props.accessibilityState.checked).toBe(true);
  });
});
