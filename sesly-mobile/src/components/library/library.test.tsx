/**
 * Pieces of the Kütüphane tab (design/v4/playful): the segment request, the
 * status a narration row can state, the two `.nr` row cards, the row card's
 * long press, the saved positions read and the empty shelf.
 */

import React from 'react';
import { Animated, Text } from 'react-native';
import { observable, runInAction } from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen } from '@testing-library/react-native';
import { playbackProgress } from '../../utils/playbackProgress';
import {
  rememberNarrationDuration,
  resetNarrationDurationsForTests,
} from '../../utils/narrationDurations';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { StoryNarration } from '../../models/Narration';
import { DEFAULT_STORY_EXTRAS, EMPTY_STORY_CREDIT, Story } from '../../models/Story';
import { VoiceProfile } from '../../models/VoiceProfile';
import {
  AgeGroup,
  NarrationStatus,
  StoryCategory,
  TTSProvider,
  VoiceProfileStatus,
} from '../../types/enums';
import {
  consumeLibrarySegmentRequest,
  requestLibrarySegment,
  subscribeLibrarySegment,
} from './librarySegment';
import {
  describeNarrationStatus,
  getNarrationListenState,
  isVisibleNarration,
  narrationDurationMs,
  narrationStatusText,
  sortNarrations,
  withGenerationProgress,
} from './narrationProgress';
import { LIBRARY_ROW_HEIGHT, NarrationRow } from './NarrationRow';
import { LibraryRowCard } from './LibraryRowCard';
import { queueStore } from '../../stores/QueueStore';
import { iconGlyph } from '../design/Icon';
import { parseSavedPosition, readSavedPositions, removeSavedPosition } from './savedPositions';
import { SavedStoryRow, savedStoryByline, savedStoryMeta } from './SavedStoryRow';
import { LibraryEmptyState, SHELF_BOOKS } from './LibraryEmptyState';

jest.setTimeout(60000);

// An observable stand-in for the audio store: rows are observers, so a
// change made in a test re-renders them like the real store does.
const PLAYER_IDLE = {
  audioId: '',
  isPlayingStory: false,
  isStoryLoaded: false,
  pendingNarrationId: null as string | null,
  isPlaying: false,
  isBusy: false,
  currentPositionMs: 0,
  totalDurationMs: 0,
  hasPosition: false,
  remainingMinutes: null as number | null,
  playbackSpeed: 1,
  speedForAllStories: false,
};
const mockPlayer = observable(
  {
    ...PLAYER_IDLE,
    togglePlayPause: jest.fn(),
    startNarration: jest.fn(() => Promise.resolve(true)),
  },
  { togglePlayPause: false, startNarration: false },
);
const setPlayer = (patch: Partial<typeof PLAYER_IDLE>) =>
  runInAction(() => {
    Object.assign(mockPlayer, patch);
  });
jest.mock('../../hooks/useAudioPlayer', () => ({ useAudioPlayer: () => mockPlayer }));

const story = (id: string, title: string, patch: Partial<Story> = {}): Story => ({
  id,
  title,
  description: null,
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.WORLD_CLASSICS,
  estimatedDuration: 6,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: true,
  ...DEFAULT_STORY_EXTRAS,
  ...patch,
});

const voice = (name: string): VoiceProfile => ({
  id: `vp-${name}`,
  name,
  status: VoiceProfileStatus.READY,
  provider: TTSProvider.CARTESIA,
  voiceId: 'v-1',
  language: 'tr',
  contentLanguage: 'tr',
  sampleAudioUrl: null,
  errorMessage: null,
  voiceModelId: null,
  kind: 'CLONE',
  consentAt: null,
  createdAt: new Date('2026-10-12T09:00:00Z'),
  updatedAt: new Date('2026-10-12T09:00:00Z'),
});

const narration = (id: string, patch: Partial<StoryNarration> = {}): StoryNarration => ({
  id,
  userId: 'u-1',
  storyId: `s-${id}`,
  voiceProfileId: 'vp-Zeynep',
  voiceProfile: voice('Zeynep'),
  status: NarrationStatus.READY,
  totalChunks: 10,
  completedChunks: 10,
  errorMessage: null,
  isPreGenerated: false,
  createdAt: new Date('2026-10-01T10:00:00Z'),
  updatedAt: new Date('2026-10-01T10:00:00Z'),
  completedAt: null,
  story: story(`s-${id}`, 'Bremen Mızıkacıları', { availableLanguages: ['tr', 'en'] }),
  audioChunks: [],
  totalDuration: 360,
  audioUrl: null,
  voiceLanguage: null,
  storyLanguage: null,
  languageMismatch: false,
  nativeVoiceUsed: false,
  ...patch,
});

const t = i18n.t.bind(i18n) as (key: string, options?: Record<string, unknown>) => string;

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

beforeEach(() => {
  setPlayer(PLAYER_IDLE);
  mockPlayer.togglePlayPause.mockClear();
  mockPlayer.startNarration.mockClear();
  consumeLibrarySegmentRequest();
});

describe('librarySegment', () => {
  it('keeps a request until the library reads it, once', () => {
    expect(consumeLibrarySegmentRequest()).toBeNull();
    requestLibrarySegment('saved');
    expect(consumeLibrarySegmentRequest()).toBe('saved');
    expect(consumeLibrarySegmentRequest()).toBeNull();
  });

  it('hands a request straight to a mounted library', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeLibrarySegment(listener);
    requestLibrarySegment('saved');
    expect(listener).toHaveBeenCalledWith('saved');
    expect(consumeLibrarySegmentRequest()).toBeNull();

    unsubscribe();
    requestLibrarySegment('mine');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(consumeLibrarySegmentRequest()).toBe('mine');
  });
});

describe('narrationProgress', () => {
  it('lists ready and generating narrations, generating first, newest first', () => {
    const list = [
      narration('old', { updatedAt: new Date('2026-09-01T00:00:00Z') }),
      narration('failed', { status: NarrationStatus.FAILED }),
      narration('new', { updatedAt: new Date('2026-10-05T00:00:00Z') }),
      narration('gen', { status: NarrationStatus.GENERATING }),
      narration('pend', {
        status: NarrationStatus.PENDING,
        updatedAt: new Date('2026-10-09T00:00:00Z'),
      }),
    ];
    expect(sortNarrations(list.filter(isVisibleNarration)).map(n => n.id)).toEqual([
      'pend',
      'gen',
      'new',
      'old',
    ]);
  });

  it('takes the length from the story estimate, else from the stored audio length', () => {
    expect(narrationDurationMs(narration('a'))).toBe(360000);
    // The stored totalDuration runs long: the story's minutes (what its card
    // shows) win over it until the player reports the real length.
    expect(narrationDurationMs(narration('a', { totalDuration: 900 }))).toBe(360000);
    expect(narrationDurationMs(narration('a', { totalDuration: 0 }))).toBe(360000);
    expect(narrationDurationMs(narration('a', { story: null }))).toBe(360000);
    expect(narrationDurationMs(narration('a', { totalDuration: 900, story: null }))).toBe(900000);
    expect(narrationDurationMs(narration('a', { totalDuration: 0, story: null }))).toBe(0);
  });

  it('states the time left only when a position is known', () => {
    const item = narration('a');
    const status = describeNarrationStatus(item, 120000);
    expect(status).toEqual({ kind: 'progress', fraction: 120000 / 360000, minutesLeft: 4 });
    expect(narrationStatusText(status, t)).toBe('4 dk kaldı');

    const plain = describeNarrationStatus(item, null);
    expect(plain).toEqual({ kind: 'plain', durationMinutes: 6 });
    expect(narrationStatusText(plain, t)).toBe('6 dk');
    // A position at the end is not "0 dk kaldı".
    expect(describeNarrationStatus(item, 360000).kind).toBe('plain');
    // No length at all: nothing to say.
    expect(
      narrationStatusText(
        describeNarrationStatus(narration('a', { totalDuration: 0, story: null }), 5000),
        t,
      ),
    ).toBe('');
  });

  it('counts the time left at the playback speed', () => {
    const item = narration('a');
    // 4 minutes of story left at 2,0x: 2 minutes of listening.
    expect(describeNarrationStatus(item, 120000, 360000, 2)).toEqual({
      kind: 'progress',
      fraction: 120000 / 360000,
      minutesLeft: 2,
    });
    // At 0,5x the same 4 minutes take 8.
    expect(describeNarrationStatus(item, 120000, 360000, 0.5)).toMatchObject({ minutesLeft: 8 });
    // A nonsense speed counts as 1,0x.
    expect(describeNarrationStatus(item, 120000, 360000, 0)).toMatchObject({ minutesLeft: 4 });
  });

  it('scales a polled percentage onto the chunks of a generating narration', () => {
    const generating = narration('g', {
      status: NarrationStatus.GENERATING,
      totalChunks: 10,
      completedChunks: 2,
    });
    const patched = withGenerationProgress(generating, 60, 'GENERATING');
    expect(patched).toMatchObject({ totalChunks: 10, completedChunks: 6 });
    expect(narrationStatusText(describeNarrationStatus(patched, null), t)).toBe('Hazırlanıyor, %60');
    // Nothing new: the same object, so nothing re-renders.
    expect(withGenerationProgress(patched, 60, 'GENERATING')).toBe(patched);
    // Out of range values are clamped.
    expect(withGenerationProgress(generating, 140)).toMatchObject({ completedChunks: 10 });
    expect(withGenerationProgress(generating, -5)).toMatchObject({ completedChunks: 0 });
  });

  it('counts in hundredths while no chunk is planned, and follows a PENDING to GENERATING step', () => {
    const pending = narration('p', {
      status: NarrationStatus.PENDING,
      totalChunks: 0,
      completedChunks: 0,
    });
    expect(narrationStatusText(describeNarrationStatus(pending, null), t)).toBe('Hazırlanıyor');
    const patched = withGenerationProgress(pending, 35, 'GENERATING');
    expect(patched).toMatchObject({
      status: NarrationStatus.GENERATING,
      totalChunks: 100,
      completedChunks: 35,
    });
    expect(narrationStatusText(describeNarrationStatus(patched, null), t)).toBe('Hazırlanıyor, %35');
    // A settled status is never written by the patch (the list refreshes instead).
    expect(withGenerationProgress(pending, 100, 'READY').status).toBe(NarrationStatus.PENDING);
  });

  it('a poll at 0 of a narration with nothing planned keeps "Hazırlanıyor", not "%0"', () => {
    const pending = narration('p', {
      status: NarrationStatus.PENDING,
      totalChunks: 0,
      completedChunks: 0,
    });
    // Same status, nothing done: the same object, nothing re-renders.
    expect(withGenerationProgress(pending, 0, 'PENDING')).toBe(pending);
    // The job started but reports 0: the status follows, the words stay.
    const started = withGenerationProgress(pending, 0, 'GENERATING');
    expect(started).toMatchObject({ status: NarrationStatus.GENERATING, totalChunks: 0 });
    expect(narrationStatusText(describeNarrationStatus(started, null), t)).toBe('Hazırlanıyor');
    // A planned narration at 0 still says its percentage (the chunks are real).
    const planned = narration('q', { status: NarrationStatus.GENERATING, totalChunks: 8, completedChunks: 0 });
    expect(withGenerationProgress(planned, 0, 'GENERATING')).toBe(planned);
  });

  it('does not invent a listened state: the backend placeholder answers null', () => {
    expect(getNarrationListenState(narration('a'))).toBeNull();
  });

  it('has the words for the listened states once the backend sends them', () => {
    expect(narrationStatusText({ kind: 'finished', durationMinutes: 5 }, t)).toBe('Dinlendi, 5 dk');
    expect(narrationStatusText({ kind: 'unplayed', durationMinutes: 5 }, t)).toBe(
      'Dinlenmedi, 5 dk',
    );
    expect(narrationStatusText({ kind: 'finished', durationMinutes: null }, t)).toBe('Dinlendi');
    expect(narrationStatusText({ kind: 'unplayed', durationMinutes: null }, t)).toBe('Dinlenmedi');
  });

  it('gives a generating narration its percentage from the chunks', () => {
    const generating = narration('g', {
      status: NarrationStatus.GENERATING,
      totalChunks: 10,
      completedChunks: 6,
    });
    const status = describeNarrationStatus(generating, 90000);
    expect(status).toEqual({ kind: 'preparing', percent: 60 });
    expect(narrationStatusText(status, t)).toBe('Hazırlanıyor, %60');

    const unknown = describeNarrationStatus(
      narration('p', { status: NarrationStatus.PENDING, totalChunks: 0, completedChunks: 0 }),
      null,
    );
    expect(narrationStatusText(unknown, t)).toBe('Hazırlanıyor');
  });
});

describe('NarrationRow', () => {
  it('shows title, narrator, time left with a progress line, codes and the round play button', () => {
    const onOpen = jest.fn();
    const item = narration('n1');
    renderWithProviders(<NarrationRow narration={item} savedPositionMs={120000} onOpen={onOpen} />);

    expect(screen.getByText('Bremen Mızıkacıları')).toBeOnTheScreen();
    expect(screen.getByText('Zeynep anlatıyor')).toBeOnTheScreen();
    expect(screen.getByText('4 dk kaldı')).toBeOnTheScreen();
    expect(screen.getByLabelText('Diller: TR, EN')).toBeOnTheScreen();
    expect(screen.getByTestId('library-progress-n1').props.accessibilityValue.now).toBe(33);

    // The body is the screen's (it opens the player).
    fireEvent.press(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını dinle' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenLastCalledWith(item);
  });

  it('plays in place from its button: a start with autoplay, no navigation, a spinner until it sounds', async () => {
    const onOpen = jest.fn();
    const item = narration('n1');
    renderWithProviders(<NarrationRow narration={item} onOpen={onOpen} />, { theme: 'kitaplik' });

    fireEvent.press(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını oynat' }));
    // The start runs in the frame after the press (RC-6).
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16);
    });
    expect(mockPlayer.startNarration).toHaveBeenCalledWith({ narration: item }, { autoplay: true });
    expect(mockPlayer.togglePlayPause).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();

    // The start runs: the button spins in the action colour and ignores presses.
    act(() => setPlayer({ pendingNarrationId: 'n1', isPlaying: true, isBusy: true }));
    expect(screen.getByTestId('library-play-n1-spinner')).toBeOnTheScreen();
    expect(flatStyle(screen.getByTestId('library-play-n1-face')).backgroundColor).toBe(
      themes.kitaplik.action,
    );
    fireEvent.press(screen.getByTestId('library-play-n1'));
    expect(mockPlayer.startNarration).toHaveBeenCalledTimes(1);

    // It sounds: the pause glyph, toggled in place.
    act(() =>
      setPlayer({
        pendingNarrationId: null,
        audioId: 'n1',
        isPlayingStory: true,
        isStoryLoaded: true,
        isBusy: false,
      }),
    );
    expect(screen.queryByTestId('library-play-n1-spinner')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını duraklat' }));
    expect(mockPlayer.togglePlayPause).toHaveBeenCalledTimes(1);
    expect(mockPlayer.startNarration).toHaveBeenCalledTimes(1);
  });

  it('spins for a stall of the loaded story, not for a start of another one', () => {
    setPlayer({
      audioId: 'n1',
      isPlayingStory: true,
      isStoryLoaded: true,
      isPlaying: true,
      isBusy: true,
      pendingNarrationId: 'n2',
    });
    renderWithProviders(
      <>
        <NarrationRow narration={narration('n1')} onOpen={jest.fn()} />
        <NarrationRow narration={narration('n2')} onOpen={jest.fn()} />
      </>,
    );
    // n2 is starting: its button spins; n1 (being replaced) does not.
    expect(screen.getByTestId('library-play-n2-spinner')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-play-n1-spinner')).toBeNull();

    // n1 alone, buffering mid-story: it spins.
    act(() => setPlayer({ pendingNarrationId: null }));
    expect(screen.getByTestId('library-play-n1-spinner')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-play-n2-spinner')).toBeNull();
  });

  it('a stall of the loaded story re-renders its row only, not the other rows', () => {
    setPlayer({ audioId: 'n1', isPlayingStory: true, isStoryLoaded: true, isPlaying: true });
    let otherRenders = 0;
    renderWithProviders(
      <>
        <NarrationRow narration={narration('n1')} onOpen={jest.fn()} />
        <React.Profiler id="other" onRender={() => (otherRenders += 1)}>
          <NarrationRow narration={narration('n2')} onOpen={jest.fn()} />
        </React.Profiler>
      </>,
    );
    const before = otherRenders;
    act(() => setPlayer({ isBusy: true }));
    expect(screen.getByTestId('library-play-n1-spinner')).toBeOnTheScreen();
    act(() => setPlayer({ isBusy: false }));
    expect(screen.queryByTestId('library-play-n1-spinner')).toBeNull();
    expect(otherRenders).toBe(before);
  });

  // NL-07: every row read the player's story id, so each start or switch
  // re-rendered every row of the list.
  it('a start or a switch of stories re-renders only the rows it leaves and reaches', () => {
    setPlayer({ audioId: 'n1', isPlayingStory: true, isStoryLoaded: true, isPlaying: true });
    const renders: Record<string, number> = { n1: 0, n2: 0, n3: 0 };
    renderWithProviders(
      <>
        {['n1', 'n2', 'n3'].map(id => (
          <React.Profiler key={id} id={id} onRender={() => (renders[id] += 1)}>
            <NarrationRow narration={narration(id)} onOpen={jest.fn()} />
          </React.Profiler>
        ))}
      </>,
    );
    const mounted = { ...renders };
    const face = (id: string) => flatStyle(screen.getByTestId(`library-play-${id}-face`)).backgroundColor;
    const neutral = face('n3');
    expect(face('n1')).not.toBe(neutral);

    // A start of n2 is on its way: n2 shows it, n3 never hears of it.
    act(() => setPlayer({ pendingNarrationId: 'n2' }));
    expect(renders.n2).toBeGreaterThan(mounted.n2);
    expect(face('n2')).toBe(face('n1'));
    expect(renders.n3).toBe(mounted.n3);

    // n2 takes the player: n1 lets go, n2 holds it, n3 still untouched.
    const beforeSwitch = { ...renders };
    act(() => setPlayer({ audioId: 'n2', pendingNarrationId: null }));
    expect(renders.n1).toBeGreaterThan(beforeSwitch.n1);
    expect(renders.n2).toBeGreaterThan(beforeSwitch.n2);
    expect(renders.n3).toBe(mounted.n3);
    expect(face('n1')).toBe(neutral);
    expect(face('n2')).not.toBe(neutral);
    expect(screen.getByTestId('library-play-n2').props.accessibilityLabel).toBe(
      'Bremen Mızıkacıları masalını duraklat',
    );

    // A switch between two other stories leaves all three rows alone but
    // the one it leaves.
    const beforeOther = { ...renders };
    act(() => setPlayer({ audioId: 'n9' }));
    act(() => setPlayer({ audioId: 'n8' }));
    expect(renders.n1).toBe(beforeOther.n1);
    expect(renders.n3).toBe(beforeOther.n3);
    expect(renders.n2).toBe(beforeOther.n2 + 1);
  });

  it('is active only for the story loaded in the player', async () => {
    // The id is the player's, but a sample took the player: not this row's.
    setPlayer({ audioId: 'n1', isPlayingStory: false, isStoryLoaded: false, isPlaying: true });
    renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />, {
      theme: 'gece-mavisi',
    });
    expect(flatStyle(screen.getByTestId('library-play-n1-face')).backgroundColor).toBe(
      themes['gece-mavisi'].surface2,
    );
    fireEvent.press(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını oynat' }));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(16);
    });
    expect(mockPlayer.startNarration).toHaveBeenCalledTimes(1);
    expect(mockPlayer.togglePlayPause).not.toHaveBeenCalled();
  });

  describe('play answers at the touch (RC-6)', () => {
    type Instance = { type: unknown; props: { testID?: string; unstable_pressDelay?: number } };
    const pressDelayOf = (testID: string) =>
      (
        screen.UNSAFE_root.findAll(
          (node: Instance) =>
            typeof node.type !== 'string' && node.props.testID === testID && 'unstable_pressDelay' in node.props,
          { deep: true },
        )[0] as Instance
      ).props.unstable_pressDelay;

    it('the play button sinks with no delay; the row body keeps the list delay', () => {
      renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />);
      expect(pressDelayOf('library-play-n1')).toBe(0);
      expect(pressDelayOf('library-narration-n1')).toBeGreaterThan(0);
    });

    it('spins in the commit of the press, while another story still plays, and starts a frame later', async () => {
      // Another story plays; the store has not heard of the press yet.
      setPlayer({ audioId: 'n9', isPlayingStory: true, isStoryLoaded: true, isPlaying: true });
      let settle: (ok: boolean) => void = () => undefined;
      mockPlayer.startNarration.mockImplementationOnce(
        () => new Promise<boolean>(resolve => (settle = resolve)),
      );
      renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />, { theme: 'kitaplik' });

      fireEvent.press(screen.getByTestId('library-play-n1'));

      // Before the start: the spinner, on the action face, and a second press does nothing.
      expect(mockPlayer.startNarration).not.toHaveBeenCalled();
      expect(screen.getByTestId('library-play-n1-spinner')).toBeOnTheScreen();
      expect(flatStyle(screen.getByTestId('library-play-n1-face')).backgroundColor).toBe(themes.kitaplik.action);
      fireEvent.press(screen.getByTestId('library-play-n1'));

      await act(async () => {
        await jest.advanceTimersByTimeAsync(16);
      });
      expect(mockPlayer.startNarration).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('library-play-n1-spinner')).toBeOnTheScreen();

      // The store takes over (pending, then loaded and sounding): its own state decides.
      act(() => setPlayer({ pendingNarrationId: 'n1', isBusy: true }));
      expect(screen.getByTestId('library-play-n1-spinner')).toBeOnTheScreen();
      act(() => setPlayer({ pendingNarrationId: null, audioId: 'n1', isBusy: false }));
      await act(async () => settle(true));
      expect(screen.queryByTestId('library-play-n1-spinner')).toBeNull();
    });

    it('a start that fails puts the play button back', async () => {
      mockPlayer.startNarration.mockImplementationOnce(() => Promise.resolve(false));
      renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />);
      fireEvent.press(screen.getByTestId('library-play-n1'));
      expect(screen.getByTestId('library-play-n1-spinner')).toBeOnTheScreen();
      await act(async () => {
        await jest.advanceTimersByTimeAsync(16);
      });
      expect(screen.queryByTestId('library-play-n1-spinner')).toBeNull();
      expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını oynat' })).toBeOnTheScreen();
    });
  });

  it('counts the saved time left at the speed every story plays at', () => {
    setPlayer({ speedForAllStories: true, playbackSpeed: 2 });
    const { rerender } = renderWithProviders(
      <NarrationRow narration={narration('n1')} savedPositionMs={120000} onOpen={jest.fn()} />,
    );
    // 4 minutes of story at 2,0x.
    expect(screen.getByText('2 dk kaldı')).toBeOnTheScreen();
    // The speed of the loaded story alone does not apply to the others.
    act(() => setPlayer({ speedForAllStories: false }));
    rerender(<NarrationRow narration={narration('n1')} savedPositionMs={120000} onOpen={jest.fn()} />);
    expect(screen.getByText('4 dk kaldı')).toBeOnTheScreen();
  });

  describe('visible controls beside play (owner feedback: no long press)', () => {
    beforeEach(() => queueStore.reset());

    it('has "Sıraya ekle", play and "more", in that order, and no long press', () => {
      const onMenu = jest.fn();
      const onOpen = jest.fn();
      const item = narration('n1');
      renderWithProviders(<NarrationRow narration={item} onOpen={onOpen} onMenu={onMenu} />);
      const ids = screen
        .getAllByTestId(/^library-(queue|play|more)-n1$/)
        .map(node => String(node.props.testID));
      expect(ids).toEqual(['library-queue-n1', 'library-play-n1', 'library-more-n1']);
      expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını sıraya ekle' })).toBeOnTheScreen();
      expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları için diğer seçenekler' })).toBeOnTheScreen();
      // The row itself offers nothing hidden.
      const row = screen.getByTestId('library-narration-n1');
      expect(row.props.onLongPress).toBeUndefined();
      expect(row.props.accessibilityActions ?? []).toEqual([]);
      fireEvent(row, 'longPress');
      expect(onMenu).not.toHaveBeenCalled();
      expect(onOpen).not.toHaveBeenCalled();

      fireEvent.press(screen.getByTestId('library-more-n1'));
      expect(onMenu).toHaveBeenCalledWith(item);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it('"Sıraya ekle" adds the narration and turns into "Sıradan çıkar", filled in the action colour', () => {
      const T = themes['gece-mavisi'];
      renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} onMenu={jest.fn()} />, {
        theme: 'gece-mavisi',
      });
      const outline = screen.UNSAFE_getByProps({ name: iconGlyph('queue') });
      expect(outline.props.color).toBe(T.text2);

      fireEvent.press(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını sıraya ekle' }));
      expect(queueStore.has('n1')).toBe(true);
      expect(queueStore.entries[0]).toMatchObject({ narrationId: 'n1', story: { title: 'Bremen Mızıkacıları' } });
      // Queued: the filled glyph in the action colour, and the label says what a press does now.
      const queued = screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını sıradan çıkar' });
      expect(screen.UNSAFE_getByProps({ name: iconGlyph('queue', true) }).props.color).toBe(T.action);
      fireEvent.press(queued);
      expect(queueStore.has('n1')).toBe(false);
      expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını sıraya ekle' })).toBeOnTheScreen();
    });

    it('a queue changed elsewhere (the queue sheet) shows on the row at once', () => {
      renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} onMenu={jest.fn()} />);
      fireEvent.press(screen.getByTestId('library-queue-n1'));
      expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını sıradan çıkar' })).toBeOnTheScreen();
      act(() => {
        queueStore.remove('n1');
      });
      expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını sıraya ekle' })).toBeOnTheScreen();
    });

    it('fits a 360dp phone: 44dp controls, the "more" target on the card edge, a tight gap to the text', () => {
      renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} onMenu={jest.fn()} />);
      for (const id of ['library-queue-n1', 'library-more-n1']) {
        expect(flatStyle(screen.getByTestId(id))).toMatchObject({ width: 44, height: 48 });
      }
      // The face ends at the "more" target, whose glyph sits on the 12dp inset.
      expect(flatStyle(screen.getByTestId('library-narration-n1-face')).paddingRight).toBe(0);
      expect(flatStyle(screen.getByTestId('library-narration-n1-trailing')).marginLeft).toBe(-8);
      // Inline 20dp glyphs, smaller than the play button's.
      expect(flatStyle(screen.getByTestId('icon-more', { includeHiddenElements: true }))).toMatchObject({ width: 20, height: 20 });
    });
  });

  it('shows the length alone and no bar when no position is known', () => {
    renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />);
    expect(screen.getByText('6 dk')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-progress-n1')).toBeNull();
    expect(screen.queryByText(/Dinlen/)).toBeNull();
  });

  it('follows the player for the story it holds and toggles it in place', () => {
    setPlayer({
      audioId: 'n1',
      isPlayingStory: true,
      isStoryLoaded: true,
      isPlaying: true,
      currentPositionMs: 300000,
      totalDurationMs: 420000,
      hasPosition: true,
      remainingMinutes: 2,
    });
    const onOpen = jest.fn();
    renderWithProviders(
      <NarrationRow narration={narration('n1')} savedPositionMs={1000} onOpen={onOpen} />,
      { theme: 'gece-mavisi' },
    );

    // Live position and the player's own duration win over the saved ones.
    expect(screen.getByText('2 dk kaldı')).toBeOnTheScreen();
    const pause = screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını duraklat' });
    // The loaded story's button is the action colour (it is "doing").
    expect(flatStyle(screen.getByTestId('library-play-n1-face')).backgroundColor).toBe(
      themes['gece-mavisi'].action,
    );
    fireEvent.press(pause);
    expect(mockPlayer.togglePlayPause).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a preview playing over a paused story does not mark the row as active', () => {
    setPlayer({ audioId: 'n1', isPlayingStory: false, isPlaying: true });
    renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını oynat' })).toBeOnTheScreen();
  });

  it('a generating narration shows its percentage and a spinner, and opens its generation', () => {
    const onOpen = jest.fn();
    const onMenu = jest.fn();
    const item = narration('g1', {
      status: NarrationStatus.GENERATING,
      totalChunks: 10,
      completedChunks: 6,
    });
    renderWithProviders(<NarrationRow narration={item} onOpen={onOpen} onMenu={onMenu} />);
    expect(screen.getByText('Hazırlanıyor, %60')).toBeOnTheScreen();
    // Nothing to queue or delete while it is prepared.
    expect(screen.queryByTestId('library-queue-g1')).toBeNull();
    expect(screen.queryByTestId('library-more-g1')).toBeNull();
    expect(screen.getByTestId('library-spinner-g1')).toBeOnTheScreen();
    // No play button: the only control is the row itself.
    expect(screen.queryByTestId('library-play-g1')).toBeNull();
    const row = screen.getByRole('button', { name: 'Bremen Mızıkacıları hazırlanıyor. Hazırlanıyor, %60' });
    fireEvent.press(row);
    expect(onOpen).toHaveBeenCalledWith(item);
    // No menu while it is prepared, and no long press.
    expect(row.props.onLongPress).toBeUndefined();
    expect(onMenu).not.toHaveBeenCalled();
    expect(mockPlayer.startNarration).not.toHaveBeenCalled();
  });

  it('marks a narration that a voice of another language read with its accent', () => {
    renderWithProviders(
      <NarrationRow
        narration={narration('n1', {
          voiceLanguage: 'tr',
          storyLanguage: 'en',
          languageMismatch: true,
          nativeVoiceUsed: false,
        })}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.getByText('Zeynep anlatıyor')).toBeOnTheScreen();
    expect(screen.getByTestId('library-accent-n1')).toBeOnTheScreen();
    expect(screen.getByText('aksanlı')).toBeOnTheScreen();
  });

  it('shows no marker when the narrator was read by its voice of the story language', () => {
    renderWithProviders(
      <NarrationRow
        narration={narration('n1', {
          voiceLanguage: 'tr',
          storyLanguage: 'en',
          languageMismatch: true,
          nativeVoiceUsed: true,
        })}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.getByText('Zeynep anlatıyor')).toBeOnTheScreen();
    expect(screen.queryByText(/aksanlı/)).toBeNull();
    expect(screen.queryByTestId('library-accent-n1')).toBeNull();
  });

  it('puts the wave in the own-voice colour only before the own voice of the parent', () => {
    const own = renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />, {
      theme: 'kitaplik',
    });
    const wave = screen.UNSAFE_getByProps({ testID: 'library-own-voice-n1' });
    expect(wave.props.name).toBe('wave');
    expect(wave.props.color).toBe(themes.kitaplik.own);
    own.unmount();

    renderWithProviders(
      <NarrationRow
        narration={narration('n2', { voiceProfile: { ...voice('Achernar'), kind: 'PRESET' } })}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.getByText('Achernar anlatıyor')).toBeOnTheScreen();
    expect(screen.UNSAFE_queryAllByProps({ testID: 'library-own-voice-n2' })).toHaveLength(0);
  });

  it('leaves the narrator line out when the narration has no voice', () => {
    renderWithProviders(
      <NarrationRow
        narration={narration('n1', { voiceProfile: null, story: null })}
        onOpen={jest.fn()}
      />,
    );
    expect(screen.queryByText(/anlatıyor/)).toBeNull();
    expect(screen.getByText('Masal')).toBeOnTheScreen();
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', scheme => {
    renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />, {
      theme: scheme,
    });
    const T = themes[scheme];
    expect(flatStyle(screen.getByText('Bremen Mızıkacıları')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Zeynep anlatıyor')).color).toBe(T.text2);
    expect(flatStyle(screen.getByText('6 dk')).color).toBe(T.text3);
    // A row card: surface face on the neutral lip, the 20dp row-card corners
    // and the same 12dp inset on both sides.
    expect(flatStyle(screen.getByTestId('library-narration-n1-face'))).toMatchObject({
      backgroundColor: T.surface,
      borderRadius: 20,
      paddingHorizontal: 12,
    });
    expect(flatStyle(screen.getByTestId('library-narration-n1-lip')).backgroundColor).toBe(T.lip);
    // The idle play button is the raised neutral circle.
    expect(flatStyle(screen.getByTestId('library-play-n1-face')).backgroundColor).toBe(T.surface2);
  });

  it('draws the cover as a flat rounded square', () => {
    renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />);
    expect(screen.queryByTestId('cover-lip')).toBeNull();
    expect(screen.queryByTestId('cover-ring')).toBeNull();
  });

  it('a pressed card sinks onto its lip', () => {
    // The native driver moves the value off the JS thread; here it lands at once.
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((
      value: Animated.Value,
      config: { toValue: number },
    ) => ({
      start: () => value.setValue(config.toValue),
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />);
    const row = screen.getByTestId('library-narration-n1');
    expect(flatStyle(screen.getByTestId('library-narration-n1-face')).transform).toEqual([
      { translateY: 0 },
    ]);
    fireEvent(row, 'pressIn');
    expect(flatStyle(screen.getByTestId('library-narration-n1-face')).transform).toEqual([
      { translateY: 3 },
    ]);
    fireEvent(row, 'pressOut');
    expect(flatStyle(screen.getByTestId('library-narration-n1-face')).transform).toEqual([
      { translateY: 0 },
    ]);
    timing.mockRestore();
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(
      <NarrationRow narration={narration('n1')} savedPositionMs={120000} onOpen={jest.fn()} />,
    );
    expect(screen.getByText('Told by Zeynep')).toBeOnTheScreen();
    expect(screen.getByText('4 min left')).toBeOnTheScreen();
    await act(() => i18n.changeLanguage('tr'));
  });
});

describe('SavedStoryRow', () => {
  const parmak = story('s-4', 'Parmak Kız', {
    languageLevel: 'A2',
    availableLanguages: ['tr', 'en'],
    credit: {
      ...EMPTY_STORY_CREDIT,
      authorName: 'Hans Christian Andersen',
      translationMethod: 'MACHINE',
    },
  });

  it('draws the Keşfet row: byline, level and meta, translation tag, codes', () => {
    const onOpen = jest.fn();
    const onUnsave = jest.fn();
    renderWithProviders(<SavedStoryRow story={parmak} onOpen={onOpen} onUnsave={onUnsave} />);

    expect(screen.getByText('Parmak Kız')).toBeOnTheScreen();
    expect(screen.getByText('Yazan Hans Christian Andersen')).toBeOnTheScreen();
    expect(screen.getByText('A2, 3-6 yaş, 6 dk')).toBeOnTheScreen();
    expect(screen.getByText('Yapay zekâ ile çevrildi')).toBeOnTheScreen();
    expect(screen.getByLabelText('Diller: TR, EN')).toBeOnTheScreen();

    fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını aç' }));
    expect(onOpen).toHaveBeenCalledWith(parmak);
    fireEvent.press(
      screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }),
    );
    expect(onUnsave).toHaveBeenCalledWith(parmak);
  });

  it('credits the collector, else falls back to the category', () => {
    expect(
      savedStoryByline(
        story('a', 'A', { credit: { ...EMPTY_STORY_CREDIT, collectorName: 'Grimm Kardeşler' } }),
        t,
      ),
    ).toBe('Derleyen Grimm Kardeşler');
    expect(savedStoryByline(story('a', 'A'), t)).toBe('Dünya klasiği');
    expect(savedStoryMeta(story('a', 'A'))).toBe('3-6 yaş, 6 dk');
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', scheme => {
    renderWithProviders(<SavedStoryRow story={parmak} onOpen={jest.fn()} onUnsave={jest.fn()} />, {
      theme: scheme,
    });
    const T = themes[scheme];
    expect(screen.getByTestId('library-unsave-s-4')).toBeOnTheScreen();
    expect(flatStyle(screen.getByText('Parmak Kız')).color).toBe(T.text);
    expect(flatStyle(screen.getByText('Yazan Hans Christian Andersen')).color).toBe(T.text2);
  });

  it('puts the bookmark glyph on the same 12dp inset as the cover on the other side', () => {
    renderWithProviders(<SavedStoryRow story={parmak} onOpen={jest.fn()} onUnsave={jest.fn()} />);
    // The faceless 48dp target reaches to the card edge: its centred 24dp
    // glyph then ends 12dp from it, as the cover starts 12dp from the left.
    const face = flatStyle(screen.getByTestId('library-saved-s-4-face'));
    expect(face).toMatchObject({ paddingHorizontal: 12, paddingRight: 0 });
    expect(flatStyle(screen.getByTestId('library-unsave-s-4'))).toMatchObject({ width: 48, height: 48 });
  });
});

describe('LibraryEmptyState', () => {
  it.each(['gece-mavisi', 'kitaplik'] as const)(
    'draws a shelf of three books in the %s category colours, on their lips',
    scheme => {
      const onAction = jest.fn();
      renderWithProviders(
        <LibraryEmptyState
          testID="empty"
          title="Henüz masalın yok"
          message="Dinlediğin masallar burada durur."
          actionLabel="Masallara göz at"
          onAction={onAction}
        />,
        { theme: scheme },
      );
      const T = themes[scheme];
      expect(SHELF_BOOKS.map(book => book.slot)).toEqual(['uyku', 'turk', 'dunya']);
      for (const book of SHELF_BOOKS) {
        const node = flatStyle(screen.getByTestId(`empty-shelf-${book.slot}`, { includeHiddenElements: true }));
        expect(node.backgroundColor).toBe(T.cat[book.slot].color);
        expect(node.borderBottomColor).toBe(T.cat[book.slot].lip);
      }
      expect(
        flatStyle(screen.getByTestId('empty-shelf-plank', { includeHiddenElements: true })).backgroundColor,
      ).toBe(T.line);
      // Decorative: hidden from screen readers.
      expect(screen.getByTestId('empty-shelf', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(
        true,
      );

      expect(screen.getByRole('header', { name: 'Henüz masalın yok' })).toBeOnTheScreen();
      expect(flatStyle(screen.getByText('Dinlediğin masallar burada durur.')).color).toBe(T.text2);
      expect(flatStyle(screen.getByTestId('empty-action-face', { includeHiddenElements: true })).backgroundColor).toBe(
        T.action,
      );
      fireEvent.press(screen.getByRole('button', { name: 'Masallara göz at' }));
      expect(onAction).toHaveBeenCalledTimes(1);
    },
  );
});

describe('NarrationRow, one value with the player', () => {
  it('the loaded story draws the shared animated progress, not a number of its own', () => {
    setPlayer({
      audioId: 'n1',
      isPlayingStory: true,
      isStoryLoaded: true,
      isPlaying: true,
      currentPositionMs: 300000,
      totalDurationMs: 420000,
      hasPosition: true,
      remainingMinutes: 2,
    });
    renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />);
    const bar = screen.getByTestId('library-progress-n1');
    fireEvent(bar, 'layout', { nativeEvent: { layout: { width: 44, height: 3, x: 0, y: 0 } } });
    act(() => playbackProgress.progress.setValue(0.5));
    const fill = flatStyle(screen.getByTestId('library-progress-n1-fill'));
    expect(fill.width).toBe(44);
    expect(fill.transform).toEqual([{ translateX: -22 }]);
    act(() => playbackProgress.progress.setValue(0));
  });

  it('the loaded story at its very start shows its length, like any other row', () => {
    setPlayer({
      audioId: 'n1',
      isPlayingStory: true,
      isStoryLoaded: true,
      totalDurationMs: 420000,
      hasPosition: false,
      remainingMinutes: 7,
    });
    renderWithProviders(<NarrationRow narration={narration('n1')} onOpen={jest.fn()} />);
    expect(screen.getByText('7 dk')).toBeOnTheScreen();
    expect(screen.queryByTestId('library-progress-n1')).toBeNull();
  });

  it('a story that is not loaded uses the real length remembered on the device', () => {
    // The backend says 6 minutes (360 s); the audio is 3 minutes.
    const item = narration('n1');
    const { rerender } = renderWithProviders(
      <NarrationRow narration={item} savedPositionMs={60000} onOpen={jest.fn()} />,
    );
    expect(screen.getByText('5 dk kaldı')).toBeOnTheScreen();

    act(() => rememberNarrationDuration('n1', 180000));
    rerender(<NarrationRow narration={item} savedPositionMs={60000} onOpen={jest.fn()} />);
    // The same "2 dk kaldı" the mini player shows for this narration.
    expect(screen.getByText('2 dk kaldı')).toBeOnTheScreen();
    expect(screen.getByTestId('library-progress-n1').props.accessibilityValue.now).toBe(33);
    act(() => resetNarrationDurationsForTests());
  });
});

describe('LibraryRowCard', () => {
  it('opens on a press and has no long press or hidden screen reader action', () => {
    const onPress = jest.fn();
    renderWithProviders(
      <LibraryRowCard onPress={onPress} accessibilityLabel="Uykulu Ay masalını dinle" testID="card">
        <Text>Uykulu Ay</Text>
      </LibraryRowCard>,
    );
    const card = screen.getByRole('button', { name: 'Uykulu Ay masalını dinle' });
    expect(card.props.onLongPress).toBeUndefined();
    expect(card.props.accessibilityActions).toBeUndefined();
    fireEvent(card, 'longPress');
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('waits the list press delay before it sinks, like every row in a scrolling list', () => {
    renderWithProviders(
      <LibraryRowCard onPress={jest.fn()} accessibilityLabel="Aç" testID="card">
        <Text>Uykulu Ay</Text>
      </LibraryRowCard>,
    );
    // The pressable behind the card's main area (the host view carries the testID).
    const pressable = screen.UNSAFE_getAllByProps({ testID: 'card' }).find(
      node => typeof node.props.unstable_pressDelay === 'number',
    );
    expect(pressable?.props.unstable_pressDelay).toBe(100);
  });

  it('without a long press handler it exposes no action', () => {
    renderWithProviders(
      <LibraryRowCard onPress={jest.fn()} accessibilityLabel="Aç" testID="card">
        <Text>Uykulu Ay</Text>
      </LibraryRowCard>,
    );
    expect(screen.getByTestId('card').props.accessibilityActions).toBeUndefined();
  });

  it('is a single block for a screen reader without any handler', () => {
    renderWithProviders(
      <LibraryRowCard accessibilityLabel="Hazırlanıyor" testID="card">
        <Text>Uykulu Ay</Text>
      </LibraryRowCard>,
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByLabelText('Hazırlanıyor')).toBeOnTheScreen();
  });

  it('a row with a one-line title is as tall as its skeleton', () => {
    // 12 + title 21 + 2 + narrator 18 + 4 + status 22 + 12.
    expect(LIBRARY_ROW_HEIGHT).toBe(91);
  });
});

describe('savedPositions', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (AsyncStorage.multiGet as jest.Mock).mockClear();
  });

  it('reads a page of positions in one storage read, 0 for missing or broken ones', async () => {
    await AsyncStorage.setItem('narration_position:a', '61000');
    await AsyncStorage.setItem('narration_position:b', 'not a number');
    await AsyncStorage.setItem('narration_position:c', '-5');
    const positions = await readSavedPositions(['a', 'b', 'c', 'd', 'a']);
    expect(positions).toEqual({ a: 61000, b: 0, c: 0, d: 0 });
    expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(1);
    expect(AsyncStorage.multiGet).toHaveBeenCalledWith([
      'narration_position:a',
      'narration_position:b',
      'narration_position:c',
      'narration_position:d',
    ]);
  });

  it('makes no storage read for an empty page', async () => {
    expect(await readSavedPositions([])).toEqual({});
    expect(AsyncStorage.multiGet).not.toHaveBeenCalled();
  });

  it('reads as no positions when storage fails', async () => {
    jest.spyOn(console, 'warn').mockImplementationOnce(() => undefined);
    (AsyncStorage.multiGet as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    expect(await readSavedPositions(['a'])).toEqual({ a: 0 });
  });

  it('forgets a deleted narration\'s position', async () => {
    await AsyncStorage.setItem('narration_position:a', '61000');
    await removeSavedPosition('a');
    expect(await AsyncStorage.getItem('narration_position:a')).toBeNull();
    expect(parseSavedPosition('1200')).toBe(1200);
    expect(parseSavedPosition(null)).toBe(0);
  });
});
