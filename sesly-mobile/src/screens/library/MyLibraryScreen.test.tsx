/**
 * MyLibraryScreen: the "Kütüphane" tab (design/v4/playful).
 *
 * Keeps the regression tests of the effect loop scan (M2.m): the narrations
 * loader used to depend on [page, searchVal] and the focus effect on the
 * loader, so every appended page re-ran the focus effect (list reset to
 * page 1) and every keystroke refetched immediately. useFocusEffect is mocked
 * with real semantics (the effect runs on focus and cleans up on blur;
 * `setFocused` moves the tab away and back), the audio store and the story
 * store are observable stand-ins, the queue is the real store.
 */

import React from 'react';
import { FlatList } from 'react-native';
import { observable, runInAction } from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import i18n from '../../i18n';
import { themes } from '../../theme/theme';
import { contrastRatio } from '../../theme/color';
import { PALETTE_KEYS, type PaletteKey } from '../../theme/palettes';
import { DEFAULT_STORY_EXTRAS, EMPTY_STORY_CREDIT, Story } from '../../models/Story';
import { AgeGroup, StoryCategory } from '../../types/enums';
import {
  consumeLibrarySegmentRequest,
  requestLibrarySegment,
} from '../../components/library/librarySegment';
import { LIBRARY_ROW_HEIGHT } from '../../components/library/NarrationRow';
import { FadeIn, RowSkeleton } from '../../components/design';
import { queueStore } from '../../stores/QueueStore';
import { queueSheet } from '../../stores/queueSheet';
import { getNarrationMeta, resetNarrationMetaForTests } from '../../stores/narrationMeta';
import { resetSessionForTests, setSessionUserId } from '../../stores/session';
import { lastPlayedFrom, readLastPlayed, writeLastPlayed } from '../../utils/lastPlayed';
import { ApiError } from '../../services/ApiError';
import { MINI_PLAYER_DOCK_HEIGHT } from '../../components/design/MiniPlayerBar';
import { FOCUS_REFRESH_SKIP_MS, MyLibraryScreen, NARRATION_POLL_MS } from './MyLibraryScreen';

jest.setTimeout(60000);

// ── Services ──
const mockGetMyNarrations = jest.fn();
const mockGetNarrationStatus = jest.fn();
const mockDeleteNarration = jest.fn();
const mockGetNarrationById = jest.fn();
jest.mock('../../services/NarrationService', () => ({
  __esModule: true,
  default: {
    getMyNarrations: (...args: unknown[]) => mockGetMyNarrations(...args),
    getNarrationStatus: (...args: unknown[]) => mockGetNarrationStatus(...args),
    deleteNarration: (...args: unknown[]) => mockDeleteNarration(...args),
    getNarrationById: (...args: unknown[]) => mockGetNarrationById(...args),
    getNarrationsByStory: () => Promise.resolve([]),
  },
}));
// The top bar bell asks for the unread count (components/common/TopBarAccount).
const mockGetUnreadCount = jest.fn(() => Promise.resolve(0));
jest.mock('../../services/NotificationService', () => ({
  __esModule: true,
  default: { getUnreadCount: () => mockGetUnreadCount() },
}));
const mockSocketListeners = new Set<(event: { narrationId: string; status: string; progress?: number }) => void>();
jest.mock('../../services/WebSocketService', () => ({
  __esModule: true,
  default: {
    addNarrationStatusListener: (
      listener: (event: { narrationId: string; status: string; progress?: number }) => void,
    ) => {
      mockSocketListeners.add(listener);
      return () => {
        mockSocketListeners.delete(listener);
      };
    },
  },
}));
const emitStatus = (narrationId: string, status: string, progress?: number) =>
  act(() => {
    mockSocketListeners.forEach(listener => listener({ narrationId, status, progress }));
  });

// ── Snackbars ──
type MockToastAction = { label: string; onPress: () => void };
const mockToast = {
  success: jest.fn<void, [string, string?, MockToastAction?]>(),
  error: jest.fn<void, [string, string?, MockToastAction?]>(),
  info: jest.fn<void, [string, string?, MockToastAction?]>(),
  warning: jest.fn<void, [string, string?, MockToastAction?]>(),
};
// A getter: the screen's imports load this module before mockToast exists.
jest.mock('../../utils/toast', () => ({
  get showToast() {
    return mockToast;
  },
}));
/** The action of the last snackbar with this text. */
function toastAction(level: keyof typeof mockToast, message: string): MockToastAction {
  const call = [...mockToast[level].mock.calls].reverse().find(args => args[0] === message);
  if (!call?.[2]) throw new Error(`no ${level} snackbar "${message}" with an action`);
  return call[2];
}

// ── The audio store ──
const PLAYER_IDLE = {
  audioId: '',
  source: 'none' as 'none' | 'story' | 'sample',
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
  loadPhase: 'idle' as 'idle' | 'loading' | 'ready' | 'failed',
  loadError: null as null | 'notFound' | 'audioRemoved' | 'loadFailed' | 'streamFailed',
  loadErrorNarrationId: null as string | null,
  showMiniPlayer: false,
  generatingNarrationId: null as string | null,
  generationReadyId: null as string | null,
};
const mockPlayer = observable(
  {
    ...PLAYER_IDLE,
    togglePlayPause: jest.fn(() => Promise.resolve()),
    startNarration: jest.fn((..._args: unknown[]) => Promise.resolve(true)),
    stopAndCleanup: jest.fn(() => Promise.resolve()),
  },
  { togglePlayPause: false, startNarration: false, stopAndCleanup: false },
);
const setPlayer = (patch: Partial<typeof PLAYER_IDLE>) =>
  act(() => {
    runInAction(() => Object.assign(mockPlayer, patch));
  });
/** `id` is loaded in the player. */
const loadedPatch = (id: string, playing: boolean): Partial<typeof PLAYER_IDLE> => ({
  audioId: id,
  source: 'story',
  isPlayingStory: true,
  isStoryLoaded: true,
  isPlaying: playing,
  loadPhase: 'ready',
  pendingNarrationId: null,
});
jest.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => mockPlayer,
  getAudioPlayerStore: () => mockPlayer,
}));

// ── The story store ──
interface MockStoryStore {
  favoriteStories: Story[];
  favoritesTotal: number;
  favoritesError: boolean;
  favoritesErrorKind: string | null;
  isLoadingFavorites: boolean;
  hasMoreFavorites: boolean;
  isLoadingMoreFavorites: boolean;
  loadFavorites: jest.Mock;
  loadMoreFavorites: jest.Mock;
  toggleFavorite: jest.Mock;
  restoreFavorite: jest.Mock;
  getFavoriteState: jest.Mock;
  peekStory: jest.Mock;
}
const STORY_FNS = {
  loadFavorites: false,
  loadMoreFavorites: false,
  toggleFavorite: false,
  restoreFavorite: false,
  getFavoriteState: false,
  peekStory: false,
} as const;
let mockStoryStore: MockStoryStore;
jest.mock('../../hooks/useStory', () => ({
  useStory: () => mockStoryStore,
  getStoryStore: () => mockStoryStore,
}));

let mockAuthStore: { backendUser: { firstName: string } | null; user: null };
jest.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuthStore }));

// ── Navigation: focus with real semantics ──
const mockNav = { navigate: jest.fn(), goBack: jest.fn(), addListener: jest.fn(() => jest.fn()) };
const mockScrollToTop = jest.fn();
let mockFocused = true;
// The most times one focus effect ran its callback (1: only on focus, never
// again because its callback changed identity).
let mockFocusRuns = 0;
const mockFocusListeners = new Set<() => void>();
function setFocused(focused: boolean) {
  act(() => {
    mockFocused = focused;
    mockFocusListeners.forEach(listener => listener());
  });
}
jest.mock('@react-navigation/native', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  const subscribe = (listener: () => void) => {
    mockFocusListeners.add(listener);
    return () => {
      mockFocusListeners.delete(listener);
    };
  };
  const useFocused = () => ReactActual.useSyncExternalStore(subscribe, () => mockFocused);
  return {
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => mockNav,
    useRoute: () => ({ key: 'lib', name: 'Library', params: undefined }),
    useIsFocused: () => useFocused(),
    useScrollToTop: (ref: unknown) => mockScrollToTop(ref),
    useFocusEffect: (callback: () => void | (() => void)) => {
      const focused = useFocused();
      const runs = ReactActual.useRef(0);
      ReactActual.useEffect(() => {
        if (!focused) return undefined;
        runs.current += 1;
        mockFocusRuns = Math.max(mockFocusRuns, runs.current);
        return callback();
      }, [focused, callback]);
    },
  };
});

// ── Fixtures ──
function narration(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    userId: 'u-1',
    storyId: `story-${id}`,
    voiceProfileId: 'vp-1',
    status: 'READY',
    totalChunks: 10,
    completedChunks: 10,
    totalDuration: 300,
    createdAt: new Date('2026-09-20T10:00:00Z'),
    updatedAt: new Date('2026-09-20T10:00:00Z'),
    story: {
      id: `story-${id}`,
      title: `Masal ${id}`,
      estimatedDuration: 5,
      coverImageUrl: null,
      ...DEFAULT_STORY_EXTRAS,
    },
    voiceProfile: { id: 'vp-1', name: 'Annem' },
    ...patch,
  };
}

function page(items: ReturnType<typeof narration>[], pageNo: number, totalPages: number, total?: number) {
  return {
    data: items,
    meta: { page: pageNo, limit: 20, total: total ?? items.length, totalPages },
  };
}

/** `count` ready narrations, newest first (ids p<pageNo>-<i>). */
function readyPage(pageNo: number, count: number) {
  return Array.from({ length: count }, (_, i) =>
    narration(`p${pageNo}-${i}`, {
      updatedAt: new Date(Date.UTC(2026, 8, 30 - pageNo, 23 - (i % 24), 59 - i)),
    }),
  );
}

const savedStory = (id: string, title: string): Story => ({
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
  credit: { ...EMPTY_STORY_CREDIT, collectorName: 'Grimm Kardeşler' },
});

/** The record the audio store writes when a story starts. */
async function rememberLastPlayed(narrationId: string, userId: string, positionMs?: number) {
  await writeLastPlayed(
    lastPlayedFrom(
      {
        narrationId,
        storyId: `story-${narrationId}`,
        voiceProfileId: 'vp-kerem',
        story: {
          id: `story-${narrationId}`,
          title: 'Uykulu Ay',
          coverImageUrl: null,
          translationGroupId: null,
          category: 'BEDTIME',
        },
        voiceProfile: null,
        narratorName: 'Kerem',
        ownVoice: false,
        estimateMs: 240000,
      },
      userId,
      1000,
    ),
  );
  if (positionMs !== undefined) {
    await AsyncStorage.setItem(`narration_position:${narrationId}`, String(positionMs));
  }
}

const flush = async (ms = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
};

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

async function renderLibrary(theme: PaletteKey = 'gece-mavisi') {
  const view = renderWithProviders(<MyLibraryScreen />, { theme, withDialog: true });
  await flush(500);
  return view;
}

const list = () => screen.UNSAFE_getByType(FlatList);

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  (AsyncStorage.multiGet as jest.Mock).mockClear();
  mockFocusRuns = 0;
  mockFocused = true;
  mockGetMyNarrations.mockReset().mockResolvedValue(page([], 1, 1));
  mockGetNarrationStatus.mockReset();
  mockDeleteNarration.mockReset().mockResolvedValue(undefined);
  mockGetNarrationById.mockReset();
  mockNav.navigate.mockReset();
  mockScrollToTop.mockReset();
  Object.values(mockToast).forEach(fn => fn.mockReset());
  runInAction(() => Object.assign(mockPlayer, PLAYER_IDLE));
  mockPlayer.togglePlayPause.mockClear();
  mockPlayer.startNarration.mockReset().mockResolvedValue(true);
  mockPlayer.stopAndCleanup.mockClear();
  mockStoryStore = observable(
    {
      favoriteStories: [] as Story[],
      favoritesTotal: 0,
      favoritesError: false,
      favoritesErrorKind: null as string | null,
      isLoadingFavorites: false,
      hasMoreFavorites: false,
      isLoadingMoreFavorites: false,
      loadFavorites: jest.fn().mockResolvedValue(undefined),
      loadMoreFavorites: jest.fn().mockResolvedValue(undefined),
      toggleFavorite: jest.fn().mockResolvedValue('done'),
      restoreFavorite: jest.fn().mockResolvedValue('done'),
      getFavoriteState: jest.fn(() => true),
      peekStory: jest.fn(() => null),
    },
    STORY_FNS,
  );
  mockAuthStore = { backendUser: { firstName: 'zeynep' }, user: null };
  resetSessionForTests();
  setSessionUserId('u-1');
  queueStore.reset();
  queueSheet.close();
  resetNarrationMetaForTests();
  consumeLibrarySegmentRequest();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('MyLibraryScreen', () => {
  describe('narrations loading', () => {
    it('loads once on focus and appends page 2 without resetting to page 1', async () => {
      mockGetMyNarrations
        .mockResolvedValueOnce(page([narration('n1')], 1, 2, 2))
        .mockResolvedValueOnce(page([narration('n2')], 2, 2, 2));
      await renderLibrary();

      expect(mockFocusRuns).toBe(1);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(1);
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: '' });

      await act(async () => {
        list().props.onEndReached();
      });
      await flush(500);

      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 2, limit: 20, search: '' });
      // The focus effect did not fire again after the page changed.
      expect(mockFocusRuns).toBe(1);
      expect(screen.getByText('Masal n1')).toBeOnTheScreen();
      expect(screen.getByText('Masal n2')).toBeOnTheScreen();

      // Last page reached: further end-of-list events request nothing.
      await act(async () => {
        list().props.onEndReached();
      });
      await flush(500);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
    });

    it('a refocus within 30 s makes no request and keeps the pages; later it refreshes in place', async () => {
      mockGetMyNarrations
        .mockResolvedValueOnce(page(readyPage(1, 20), 1, 3, 45))
        .mockResolvedValueOnce(page(readyPage(2, 20), 2, 3, 45));
      await renderLibrary();
      await act(async () => {
        list().props.onEndReached();
      });
      await flush(100);
      expect(list().props.data).toHaveLength(40);
      // One storage read per loaded page, never one per row.
      expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(2);

      setFocused(false);
      await flush(10000);
      setFocused(true);
      await flush(100);
      // No request; the 40 rows stay; the positions are read again, once.
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
      expect(list().props.data).toHaveLength(40);
      expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(3);
      expect((AsyncStorage.multiGet as jest.Mock).mock.calls[2][0]).toHaveLength(40);

      // Past 30 s: one request for both pages, the list stays at 40 rows.
      setFocused(false);
      await flush(FOCUS_REFRESH_SKIP_MS);
      mockGetMyNarrations.mockResolvedValueOnce(
        page([...readyPage(1, 20), ...readyPage(2, 20)], 1, 2, 45),
      );
      setFocused(true);
      await flush(100);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(3);
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 1, limit: 40, search: '' });
      expect(list().props.data).toHaveLength(40);

      // The next page is page 3 of 20, not page 2 of the larger request.
      mockGetMyNarrations.mockResolvedValueOnce(page(readyPage(3, 5), 3, 3, 45));
      await act(async () => {
        list().props.onEndReached();
      });
      await flush(100);
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 3, limit: 20, search: '' });
      expect(list().props.data).toHaveLength(45);
    });

    it('a generation that started or finished since the last load refreshes on focus at once', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(1);

      setFocused(false);
      setPlayer({ generatingNarrationId: 'n-new' });
      setFocused(true);
      await flush(100);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
    });

    it('debounces search typing into one request; closing the search reloads at once', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1')], 1, 1));
      await renderLibrary();
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(1);

      // The field is behind the search button of the count row.
      expect(screen.queryByPlaceholderText('Masal ya da anlatıcı ara')).toBeNull();
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      const input = screen.getByPlaceholderText('Masal ya da anlatıcı ara');
      fireEvent.changeText(input, 'a');
      fireEvent.changeText(input, 'ay');
      fireEvent.changeText(input, 'ayı');
      await flush(500);

      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: 'ayı' });
      expect(mockFocusRuns).toBe(1);

      // Nothing matched: a search result state, not the "no stories yet" one.
      expect(screen.getByText('Sonuç yok')).toBeOnTheScreen();
      expect(screen.queryByText('Henüz masalın yok')).toBeNull();
      // The search is closed from "Vazgeç" beside the field, so no count row
      // is left holding a lone close button.
      expect(screen.queryByTestId('library-count')).toBeNull();
      expect(screen.queryByTestId('library-count-row')).toBeNull();

      // Closing clears the term and reloads the whole list without the debounce.
      fireEvent.press(screen.getByRole('button', { name: 'Vazgeç' }));
      await flush(0);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(3);
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: '' });
      expect(screen.queryByPlaceholderText('Masal ya da anlatıcı ara')).toBeNull();
      // And the debounce does not reload a second time.
      await flush(500);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(3);
    });

    it('a stale search response never replaces the rows while the newer one runs', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1')], 1, 1));
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      let releaseFirst: (value: unknown) => void = () => undefined;
      mockGetMyNarrations
        .mockImplementationOnce(() => new Promise(resolve => (releaseFirst = resolve)))
        .mockImplementationOnce(() => new Promise(() => undefined));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'ay');
      await flush(500);
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'ayı');
      await flush(500);
      expect(screen.getByText('Masal n1')).toBeOnTheScreen();

      // The older request answers late: it is dropped, the rows stay.
      await act(async () => {
        releaseFirst(page([], 1, 1));
      });
      await flush(0);
      expect(screen.getByText('Masal n1')).toBeOnTheScreen();
      expect(screen.queryByText('Sonuç yok')).toBeNull();
    });

    it('the end of the list asks for no next page while a search loads its first page', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page(readyPage(1, 20), 1, 3, 45));
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      let release: (value: unknown) => void = () => undefined;
      mockGetMyNarrations.mockImplementationOnce(() => new Promise(resolve => (release = resolve)));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'ay');
      await flush(500);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);

      // The old rows are still on screen and reach the end: no page 2 of the
      // old paging with the new term, which would land under the old rows.
      await act(async () => {
        list().props.onEndReached();
      });
      await flush(0);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);

      await act(async () => {
        release(page([narration('a1')], 1, 1));
      });
      await flush(0);
      expect(list().props.data.map((item: { id: string }) => item.id)).toEqual(['a1']);
      expect(screen.getByTestId('library-count')).toHaveTextContent('1 sonuç');
    });

    it('leaving Masallarım closes the search, so coming back opens no keyboard and no filter', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1')], 1, 1));
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'ay');
      await flush(500);
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: 'ay' });

      fireEvent.press(screen.getByRole('radio', { name: 'Kaydedilenler' }));
      await flush(16);
      fireEvent.press(screen.getByRole('radio', { name: 'Masallarım' }));
      await flush(16);
      expect(screen.queryByTestId('library-search-input')).toBeNull();
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: '' });
    });

    it('clears the term with the field button', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1')], 1, 1));
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'ay');
      fireEvent.press(screen.getByRole('button', { name: 'Aramayı temizle' }));
      expect(screen.getByPlaceholderText('Masal ya da anlatıcı ara').props.value).toBe('');
    });

    it('pull to refresh always asks the server, for the pages on screen', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      await act(async () => {
        await list().props.refreshControl.props.onRefresh();
      });
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
      expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: '' });
    });

    it('a failed pull to refresh keeps the rows and says so', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1')], 1, 1));
      await renderLibrary();
      mockGetMyNarrations.mockRejectedValueOnce(new Error('500'));
      await act(async () => {
        await list().props.refreshControl.props.onRefresh();
      });
      expect(screen.getByText('Masal n1')).toBeOnTheScreen();
      expect(mockToast.error).toHaveBeenCalledWith('Liste yenilenemedi');
    });

    it('a failed load offers a retry', async () => {
      mockGetMyNarrations.mockRejectedValueOnce(new Error('500'));
      await renderLibrary();
      expect(screen.getByText('Kütüphane yüklenemedi')).toBeOnTheScreen();

      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      });
      await flush(100);
      expect(screen.getByText('Masal n1')).toBeOnTheScreen();
    });

    it('an offline failure says so, not "Sorun bizde"', async () => {
      mockGetMyNarrations.mockRejectedValueOnce(
        new ApiError({ message: 'Network', status: 0, code: 'NETWORK_ERROR' }),
      );
      await renderLibrary();
      expect(screen.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
      expect(screen.queryByText('Kütüphane yüklenemedi')).toBeNull();
      expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeOnTheScreen();
    });
  });

  describe('narrations being prepared', () => {
    const generating = () =>
      narration('g1', { status: 'GENERATING', totalChunks: 10, completedChunks: 2 });

    it('follows the status poll while on screen and refreshes in place when it is ready', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([generating(), narration('n1')], 1, 1));
      await renderLibrary();
      expect(screen.getByText('Hazırlanıyor, %20')).toBeOnTheScreen();

      mockGetNarrationStatus.mockResolvedValueOnce({ status: 'GENERATING', progress: 60 });
      await flush(NARRATION_POLL_MS);
      expect(mockGetNarrationStatus).toHaveBeenCalledWith('g1');
      expect(screen.getByText('Hazırlanıyor, %60')).toBeOnTheScreen();
      // The progress comes from the poll: no list request.
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(1);

      mockGetNarrationStatus.mockResolvedValueOnce({ status: 'READY', progress: 100 });
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('g1'), narration('n1')], 1, 1));
      await flush(NARRATION_POLL_MS);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('library-play-g1')).toBeOnTheScreen();

      // Nothing is prepared any more: the poll stopped.
      mockGetNarrationStatus.mockClear();
      await flush(NARRATION_POLL_MS * 3);
      expect(mockGetNarrationStatus).not.toHaveBeenCalled();
    });

    it('a READY socket event refreshes the row without waiting for the poll', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([generating()], 1, 1));
      await renderLibrary();
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('g1')], 1, 1));
      emitStatus('g1', 'READY');
      await flush(0);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
      expect(mockGetNarrationStatus).not.toHaveBeenCalled();
      expect(screen.getByTestId('library-play-g1')).toBeOnTheScreen();
    });

    it('polls nothing while the tab is away, and an event then refreshes on the next focus', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([generating()], 1, 1));
      await renderLibrary();
      setFocused(false);
      await flush(NARRATION_POLL_MS * 3);
      expect(mockGetNarrationStatus).not.toHaveBeenCalled();

      emitStatus('g1', 'READY');
      await flush(0);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(1);
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('g1')], 1, 1));
      setFocused(true);
      await flush(0);
      expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
    });

    it('polls nothing when no row is prepared', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1')], 1, 1));
      await renderLibrary();
      await flush(NARRATION_POLL_MS * 3);
      expect(mockGetNarrationStatus).not.toHaveBeenCalled();
    });

    it('a prepared row opens the generation screen, which follows the job', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([generating()], 1, 1));
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: /Masal g1 hazırlanıyor/ }));
      expect(mockNav.navigate).toHaveBeenCalledWith('AudioGeneration', {
        storyId: 'story-g1',
        voiceProfileId: 'vp-1',
      });
    });
  });

  describe('Masallarım', () => {
    it('has the tab app bar: title, and the avatar opening Profile', async () => {
      await renderLibrary();
      expect(screen.getByRole('header', { name: 'Kütüphane' })).toBeOnTheScreen();
      expect(screen.getByText('Z')).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Profil' }));
      expect(mockNav.navigate).toHaveBeenCalledWith('Profile', undefined, { pop: true });
    });

    it('offers two segments and no downloads segment', async () => {
      await renderLibrary();
      expect(screen.getAllByRole('radio').map(node => node.props.accessibilityLabel)).toEqual([
        'Masallarım',
        'Kaydedilenler',
      ]);
      expect(screen.queryByText('İndirilenler')).toBeNull();
    });

    it('lists narrations with count, narrator and the time left from the saved position', async () => {
      mockGetMyNarrations.mockResolvedValue(
        page(
          [
            narration('n1'),
            narration('n2'),
            narration('g1', { status: 'GENERATING', totalChunks: 10, completedChunks: 6 }),
            narration('f1', { status: 'FAILED' }),
          ],
          1,
          1,
        ),
      );
      await AsyncStorage.setItem('narration_position:n1', '60000');
      await renderLibrary();

      expect(screen.getByTestId('library-count')).toHaveTextContent('3 masal');
      expect(screen.getAllByText('Annem anlatıyor')).toHaveLength(3);
      // Failed narrations are not listed.
      expect(screen.queryByText('Masal f1')).toBeNull();
      // n1 has a saved position, n2 has none, g1 is generating.
      expect(screen.getByText('4 dk kaldı')).toBeOnTheScreen();
      expect(screen.getByText('5 dk')).toBeOnTheScreen();
      expect(screen.getByText('Hazırlanıyor, %60')).toBeOnTheScreen();
      // Positions are read for ready narrations only, in one storage read.
      expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(1);
      expect((AsyncStorage.multiGet as jest.Mock).mock.calls[0][0].sort()).toEqual([
        'narration_position:n1',
        'narration_position:n2',
      ]);
      // No sort control: the list has one order.
      expect(screen.queryByText(/Sırala/)).toBeNull();
    });

    // NL-07: every start or pause read the positions again and set a new
    // object, so the whole list rendered again for nothing.
    it('a pause that saved no new position does not render the list again; a new position shows at once', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1'), narration('n2')], 1, 1));
      await AsyncStorage.setItem('narration_position:n2', '60000');
      setPlayer(loadedPatch('n1', true));
      await renderLibrary();
      expect(screen.getByText('4 dk kaldı')).toBeOnTheScreen();
      const reads = (AsyncStorage.multiGet as jest.Mock).mock.calls.length;
      const renderItem = list().props.renderItem;

      // The positions are read again and are the same: the screen keeps its
      // state, so its list does not render again.
      setPlayer({ isPlaying: false });
      await flush(16);
      expect((AsyncStorage.multiGet as jest.Mock).mock.calls.length).toBe(reads + 1);
      expect(list().props.renderItem).toBe(renderItem);

      // A position that did change reaches its row.
      await AsyncStorage.setItem('narration_position:n2', '120000');
      setPlayer({ isPlaying: true });
      await flush(16);
      expect(screen.getByText('3 dk kaldı')).toBeOnTheScreen();
    });

    it('says "1 masal" for a single story, "1 sonuç" for a single result', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      expect(screen.getByTestId('library-count')).toHaveTextContent('1 masal');

      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'masal');
      await flush(500);
      expect(screen.getByTestId('library-count')).toHaveTextContent('1 sonuç');
    });

    it('the row body opens the player with the meta known; the play button plays in place', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      // Every loaded row is remembered, so the player starts it at once.
      expect(getNarrationMeta('n1')?.story.title).toBe('Masal n1');

      fireEvent.press(screen.getByRole('button', { name: 'Masal n1 masalını dinle' }));
      expect(mockNav.navigate).toHaveBeenLastCalledWith('AudioPlayer', { narrationId: 'n1' });
      mockNav.navigate.mockClear();

      fireEvent.press(screen.getByRole('button', { name: 'Masal n1 masalını oynat' }));
      // The start runs in the frame after the press (RC-6).
      await flush(16);
      expect(mockPlayer.startNarration).toHaveBeenCalledWith(
        { narration: expect.objectContaining({ id: 'n1' }) },
        { autoplay: true },
      );
      expect(mockNav.navigate).not.toHaveBeenCalled();
    });

    it('pauses the story that is playing without leaving the list', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      setPlayer(loadedPatch('n1', true));
      await renderLibrary();

      fireEvent.press(screen.getByRole('button', { name: 'Masal n1 masalını duraklat' }));
      expect(mockPlayer.togglePlayPause).toHaveBeenCalledTimes(1);
      expect(mockNav.navigate).not.toHaveBeenCalled();
    });

    it('shows the empty shelf, which leads to Keşfet', async () => {
      await renderLibrary();
      expect(screen.getByText('Henüz masalın yok')).toBeOnTheScreen();
      expect(screen.getByText('Dinlediğin masallar burada durur.')).toBeOnTheScreen();
      expect(
        screen.getByTestId('library-empty-shelf', { includeHiddenElements: true }),
      ).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Masallara göz at' }));
      expect(mockNav.navigate).toHaveBeenCalledWith('Main', { screen: 'Discover' });
    });

    it('loads as a skeleton with the 40dp count slot first, so the rows do not move when data lands', async () => {
      mockGetMyNarrations.mockReturnValue(new Promise(() => {}));
      await renderLibrary();
      const skeleton = screen.getByTestId('library-loading');
      expect(screen.queryByText('Henüz masalın yok')).toBeNull();
      const slot = screen.getByTestId('library-loading-count');
      expect(flatStyle(slot).minHeight).toBe(40);
      // The slot comes before the first row skeleton, which is as tall as a row.
      const children = skeleton.children as unknown as { props: { testID?: string } }[];
      expect(children[0].props.testID).toBe('library-loading-count');
      // Every row skeleton is as tall as a real row and on the row's lip.
      const rows = screen.UNSAFE_getAllByType(RowSkeleton);
      expect(rows).toHaveLength(5);
      rows.forEach(row => expect(row.props).toMatchObject({ height: LIBRARY_ROW_HEIGHT, lip: 3, radius: 20 }));
    });

    it('the first content fades in once; rows of a later page get no fade wrapper', async () => {
      mockGetMyNarrations
        .mockResolvedValueOnce(page([narration('n1'), narration('n2')], 1, 2, 3))
        .mockResolvedValueOnce(page([narration('n3')], 2, 2, 3));
      await renderLibrary();
      // The count row and the two rows that replaced the skeleton.
      expect(screen.UNSAFE_getAllByType(FadeIn)).toHaveLength(3);

      await act(async () => {
        list().props.onEndReached();
      });
      await flush(100);
      expect(screen.getByText('Masal n3')).toBeOnTheScreen();
      expect(screen.UNSAFE_getAllByType(FadeIn)).toHaveLength(3);
    });

    it('the count row of the loaded list has the same 40dp', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      expect(flatStyle(screen.getByTestId('library-count-row')).minHeight).toBe(40);
    });

    it('the app bar holds three actions, so "Kütüphane" never truncates at 360dp', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      const actions = within(screen.getByTestId('library-actions'));
      expect(actions.getByTestId('library-queue')).toBeOnTheScreen();
      expect(actions.getByTestId('library-bell')).toBeOnTheScreen();
      expect(actions.getByTestId('library-avatar')).toBeOnTheScreen();
      // The search moved to the list's count row.
      expect(actions.queryByTestId('library-search-toggle')).toBeNull();
      expect(within(screen.getByTestId('library-count-row')).getByTestId('library-search-toggle')).toBeOnTheScreen();
      // 44 + 8 + 44 + 6 + 40 next to the 12dp bar gap leaves 174dp of the 328
      // inside the gutters: "Kütüphane" in displayL needs about 152.
      const queue = flatStyle(screen.getByTestId('library-queue-face'));
      expect(queue.width ?? queue.minWidth).toBe(44);
    });

    it('an empty library offers no search; a search that found nothing can still be closed', async () => {
      await renderLibrary();
      expect(screen.getByText('Henüz masalın yok')).toBeOnTheScreen();
      expect(screen.queryByRole('button', { name: 'Masallarımda ara' })).toBeNull();

      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1')], 1, 1));
      await act(async () => {
        await list().props.refreshControl.props.onRefresh();
      });
      await flush(0);
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'zzz');
      await flush(500);
      expect(screen.getByText('Sonuç yok')).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Vazgeç' }));
      await flush(0);
      expect(screen.queryByPlaceholderText('Masal ya da anlatıcı ara')).toBeNull();
    });

    // V5-06: the in-field clear and a second close sat alone on a row under
    // the field, and "Sonuç yok" was centred in the list, half under the keyboard.
    it('a search that found nothing: the close is "Vazgeç" beside the field, the state sits at the top', async () => {
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1'), narration('n2')], 1, 1));
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));

      // One row: the field (growing) and "Vazgeç" after it.
      const row = screen.getByTestId('library-search-row');
      expect(flatStyle(row)).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
      const cancel = within(row).getByRole('button', { name: 'Vazgeç' });
      expect(within(row).getByPlaceholderText('Masal ya da anlatıcı ara')).toBeOnTheScreen();
      const children = row.children as unknown as { props: { testID?: string } }[];
      expect(children.map(child => child.props.testID)).toEqual(['library-search-input', 'library-search-cancel']);
      let frame = screen.getByTestId('library-search-input-field-face').parent;
      while (frame && flatStyle(frame).flex === undefined) frame = frame.parent;
      expect(frame && flatStyle(frame)).toMatchObject({ flex: 1, minWidth: 0 });
      // The text button's label ends on the gutter, centred on the field.
      expect(flatStyle(screen.getByTestId('library-search-cancel'))).toMatchObject({ alignSelf: 'center', marginRight: -12 });
      expect(cancel).toBeOnTheScreen();
      // The count row keeps its count but no second close button.
      expect(screen.getByTestId('library-count')).toHaveTextContent('2 masal');
      expect(screen.queryByTestId('library-search-toggle')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Masallarımda ara' })).toBeNull();

      mockGetMyNarrations.mockResolvedValueOnce(page([], 1, 1, 0));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'yildiz');
      await flush(500);
      expect(screen.getByText('Sonuç yok')).toBeOnTheScreen();
      // Nothing under the field but the state: no row with a lone close.
      expect(screen.queryByTestId('library-count-row')).toBeNull();
      expect(screen.getAllByRole('button', { name: /kapat|Vazgeç/ })).toHaveLength(1);
      // In-field clear and "Vazgeç" are the only two controls of the search.
      expect(within(row).getByRole('button', { name: 'Aramayı temizle' })).toBeOnTheScreen();
      // At the top of the list, so it reads above the keyboard while typing.
      expect(flatStyle(screen.getByTestId('library-no-results'))).toMatchObject({
        justifyContent: 'flex-start',
        paddingTop: 24,
      });

      // "Vazgeç" closes the search and brings the whole list back.
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1'), narration('n2')], 1, 1));
      fireEvent.press(screen.getByRole('button', { name: 'Vazgeç' }));
      await flush(0);
      expect(screen.queryByTestId('library-search-row')).toBeNull();
      expect(screen.getByTestId('library-count')).toHaveTextContent('2 masal');
      expect(within(screen.getByTestId('library-count-row')).getByRole('button', { name: 'Masallarımda ara' })).toBeOnTheScreen();
    });

    it('the search glyph ends on the gutter when "Hepsini çal" is not there', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      expect(flatStyle(screen.getByTestId('library-search-toggle'))).toMatchObject({ marginRight: -12 });
      mockGetMyNarrations.mockResolvedValue(page([narration('n1'), narration('n2')], 1, 1, 2));
      await act(async () => {
        await list().props.refreshControl.props.onRefresh();
      });
      await flush(0);
      expect(screen.getByRole('button', { name: 'Hepsini çal' })).toBeOnTheScreen();
      expect(flatStyle(screen.getByTestId('library-search-toggle')).marginRight).toBeUndefined();
    });

    it('scrolls to the top when its tab is tapped again', async () => {
      await renderLibrary();
      expect(mockScrollToTop).toHaveBeenCalled();
      // One of the refs it got is the list on screen.
      const refs = mockScrollToTop.mock.calls.map(call => call[0] as { current: unknown });
      expect(refs.some(ref => ref.current === list().instance)).toBe(true);
    });

    it('leaves room for the mini player at the end of the list while it shows', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      const base = list().props.contentContainerStyle.paddingBottom;
      setPlayer({ showMiniPlayer: true });
      expect(list().props.contentContainerStyle.paddingBottom).toBe(base + MINI_PLAYER_DOCK_HEIGHT + 8);
    });
  });

  describe('row controls and the "more" menu (no long press)', () => {
    const openMenuOf = (id: string) => {
      fireEvent.press(screen.getByTestId(`library-more-${id}`));
    };
    /** Pick an option and let the sheet leave (its action runs after the exit). */
    const pick = async (title: string) => {
      fireEvent.press(screen.getByText(title));
      await flush(1000);
    };

    it('"Sıraya ekle" beside play adds the narration at once and takes it out again', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      // Nothing hides behind a long press any more.
      const row = screen.getByTestId('library-narration-n1');
      expect(row.props.onLongPress).toBeUndefined();
      expect(row.props.accessibilityActions ?? []).toEqual([]);

      fireEvent.press(screen.getByRole('button', { name: 'Masal n1 masalını sıraya ekle' }));
      expect(queueStore.has('n1')).toBe(true);
      expect(queueStore.entries[0]).toMatchObject({ narrationId: 'n1', story: { title: 'Masal n1' } });
      expect(mockToast.success).toHaveBeenCalledWith('Sıraya eklendi', undefined, expect.anything());

      fireEvent.press(screen.getByRole('button', { name: 'Masal n1 masalını sıradan çıkar' }));
      expect(queueStore.has('n1')).toBe(false);
    });

    it('"more" opens the row menu under the story title: the story page and delete, no queue rows', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: 'Masal n1 için diğer seçenekler' }));
      await flush(300);
      // The sheet is titled with the story (the row has the same title).
      expect(screen.getAllByText('Masal n1')).toHaveLength(2);
      expect(screen.getByText('Masalın sayfası')).toBeOnTheScreen();
      expect(screen.getByText('Sil')).toBeOnTheScreen();
      // The queue is the row's own button now.
      expect(screen.queryByTestId('story-option-queue-add')).toBeNull();
      expect(screen.queryByTestId('story-option-queue-remove')).toBeNull();
    });

    it('"Masalın sayfası" opens the story', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      openMenuOf('n1');
      await flush(300);
      await pick('Masalın sayfası');
      expect(mockNav.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 'story-n1' });
    });

    it('"Sil" asks first, then deletes the narration and everything that points to it', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1'), narration('n2')], 1, 1, 2));
      await rememberLastPlayed('n1', 'u-1', 60000);
      await renderLibrary();
      queueStore.add({
        narrationId: 'n1',
        storyId: 'story-n1',
        voiceProfileId: 'vp-1',
        story: { id: 'story-n1', title: 'Masal n1', coverImageUrl: null, translationGroupId: null, category: null },
        voiceProfile: null,
        narratorName: 'Annem',
        ownVoice: false,
        estimateMs: 300000,
      });
      setPlayer(loadedPatch('n1', false));

      openMenuOf('n1');
      await flush(300);
      await pick('Sil');
      expect(screen.getByText('Bu masal kütüphanenden silinsin mi?')).toBeOnTheScreen();
      expect(mockDeleteNarration).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sil' }));
      });
      await flush(500);
      expect(mockDeleteNarration).toHaveBeenCalledWith('n1');
      expect(screen.queryByText('Masal n1')).toBeNull();
      expect(screen.getByText('Masal n2')).toBeOnTheScreen();
      expect(queueStore.has('n1')).toBe(false);
      // The loaded story is unloaded, its position and the continue record go.
      expect(mockPlayer.stopAndCleanup).toHaveBeenCalledTimes(1);
      expect(await AsyncStorage.getItem('narration_position:n1')).toBeNull();
      expect(await readLastPlayed('u-1')).toBeNull();
      expect(mockToast.success).toHaveBeenCalledWith('Masal silindi');
    });

    it('deleting a story that is not in the player leaves the player and the continue record alone', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1'), narration('n2')], 1, 1, 2));
      await rememberLastPlayed('n1', 'u-1', 60000);
      await renderLibrary();
      setPlayer(loadedPatch('n1', true));
      openMenuOf('n2');
      await flush(300);
      await pick('Sil');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sil' }));
      });
      await flush(500);
      expect(mockDeleteNarration).toHaveBeenCalledWith('n2');
      expect(mockPlayer.stopAndCleanup).not.toHaveBeenCalled();
      expect((await readLastPlayed('u-1'))?.narrationId).toBe('n1');
      expect(screen.queryByText('Masal n2')).toBeNull();
      expect(screen.getByTestId('library-count')).toHaveTextContent('1 masal');
    });

    it('a failed delete keeps the row and says so', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      mockDeleteNarration.mockRejectedValueOnce(new Error('500'));
      await renderLibrary();
      openMenuOf('n1');
      await flush(300);
      await pick('Sil');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sil' }));
      });
      await flush(500);
      expect(screen.getByText('Masal n1')).toBeOnTheScreen();
      expect(mockToast.error).toHaveBeenCalledWith('Masal silinemedi. Tekrar dene.');
      expect(mockPlayer.stopAndCleanup).not.toHaveBeenCalled();
    });

    it('a narration the server no longer has (404) is taken out like a deleted one', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1'), narration('n2')], 1, 1, 2));
      mockDeleteNarration.mockRejectedValueOnce(
        new ApiError({ message: 'Seslendirme bulunamadı.', status: 404 }),
      );
      await rememberLastPlayed('n1', 'u-1', 60000);
      await renderLibrary();
      openMenuOf('n1');
      await flush(300);
      await pick('Sil');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Sil' }));
      });
      await flush(500);
      expect(screen.queryByText('Masal n1')).toBeNull();
      expect(await readLastPlayed('u-1')).toBeNull();
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalledWith('Masal silindi');
    });

    it('cancelling the confirm deletes nothing', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      openMenuOf('n1');
      await flush(300);
      await pick('Sil');
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Vazgeç' }));
      });
      await flush(500);
      expect(mockDeleteNarration).not.toHaveBeenCalled();
      expect(screen.getByText('Masal n1')).toBeOnTheScreen();
    });
  });

  describe('queue', () => {
    it('"Hepsini çal" replaces the queue in list order and starts the first', async () => {
      mockGetMyNarrations.mockResolvedValue(
        page(
          [
            narration('old', { updatedAt: new Date('2026-09-01T10:00:00Z') }),
            narration('new', { updatedAt: new Date('2026-09-25T10:00:00Z') }),
            narration('g1', { status: 'GENERATING', totalChunks: 10, completedChunks: 1 }),
          ],
          1,
          1,
        ),
      );
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: 'Hepsini çal' }));
      await flush(0);
      // Ready rows only, in the order the list shows them.
      expect(queueStore.entries.map(entry => entry.narrationId)).toEqual(['new', 'old']);
      expect(queueStore.currentId).toBe('new');
      expect(mockPlayer.startNarration).toHaveBeenCalledWith(
        expect.objectContaining({ narrationId: 'new' }),
        { autoplay: true, fromQueue: true },
      );
      // The queue was empty: nothing to undo.
      expect(mockToast.info).not.toHaveBeenCalled();
      expect(mockNav.navigate).not.toHaveBeenCalled();
    });

    it('undo after "Hepsini çal" restores the previous queue', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('a'), narration('b')], 1, 1));
      await renderLibrary();
      queueStore.add({
        narrationId: 'x',
        storyId: 'story-x',
        voiceProfileId: null,
        story: { id: 'story-x', title: 'X', coverImageUrl: null, translationGroupId: null, category: null },
        voiceProfile: null,
        narratorName: null,
        ownVoice: false,
        estimateMs: 0,
      });
      fireEvent.press(screen.getByRole('button', { name: 'Hepsini çal' }));
      await flush(0);
      expect(queueStore.entries.map(entry => entry.narrationId)).not.toContain('x');

      act(() => toastAction('info', 'Sıra yenilendi').onPress());
      expect(queueStore.entries.map(entry => entry.narrationId)).toEqual(['x']);
    });

    it('"Hepsini çal" needs two ready stories and is not offered for a search', async () => {
      mockGetMyNarrations.mockResolvedValue(page([narration('a')], 1, 1));
      await renderLibrary();
      expect(screen.queryByRole('button', { name: 'Hepsini çal' })).toBeNull();

      mockGetMyNarrations.mockResolvedValue(page([narration('a'), narration('b')], 1, 1));
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'masal');
      await flush(500);
      expect(screen.getByTestId('library-count')).toHaveTextContent('2 sonuç');
      expect(screen.queryByRole('button', { name: 'Hepsini çal' })).toBeNull();
    });

    it('the app bar queue button shows the count on both segments and opens the queue', async () => {
      await renderLibrary();
      expect(screen.getByRole('button', { name: 'Sıradakiler' })).toBeOnTheScreen();
      const bubble = () => screen.queryByTestId('library-queue-count', { includeHiddenElements: true });
      expect(bubble()).toBeNull();

      act(() => {
        queueStore.replaceAll(
          ['a', 'b', 'c'].map(id => ({
            narrationId: id,
            storyId: `story-${id}`,
            voiceProfileId: null,
            story: { id: `story-${id}`, title: id, coverImageUrl: null, translationGroupId: null, category: null },
            voiceProfile: null,
            narratorName: null,
            ownVoice: false,
            estimateMs: 0,
          })),
        );
      });
      expect(bubble()).toHaveTextContent('3');
      fireEvent.press(screen.getByRole('button', { name: 'Sıradakiler, 3 masal' }));
      expect(queueSheet.visible).toBe(true);
      expect(queueSheet.origin).toBe('library');

      fireEvent.press(screen.getByRole('radio', { name: 'Kaydedilenler' }));
      await flush(16);
      expect(bubble()).toHaveTextContent('3');
    });

    // NL-06 / V5-05: after "Sırayı temizle" the button still said
    // "Sıradakiler, 4" (Android kept the old value), and with entries it said
    // the count twice ("Sıradakiler, 3 masal, 3").
    it('the queue button says the count once, in its label, and nothing stale once the queue is cleared', async () => {
      await renderLibrary();
      const queueButton = () => screen.getByTestId('library-queue');
      const entry = (id: string) => ({
        narrationId: id,
        storyId: `story-${id}`,
        voiceProfileId: null,
        story: { id: `story-${id}`, title: id, coverImageUrl: null, translationGroupId: null, category: null },
        voiceProfile: null,
        narratorName: null,
        ownVoice: false,
        estimateMs: 0,
      });
      expect(queueButton().props.accessibilityLabel).toBe('Sıradakiler');
      expect(queueButton().props.accessibilityValue?.text).toBeUndefined();

      act(() => {
        queueStore.replaceAll(['a', 'b', 'c', 'd'].map(entry));
      });
      expect(screen.getByRole('button', { name: 'Sıradakiler, 4 masal' })).toBe(queueButton());
      // The count is in the label only: no value repeats it.
      expect(queueButton().props.accessibilityValue?.text).toBeUndefined();

      act(() => {
        queueStore.replaceAll([entry('a')]);
      });
      expect(queueButton().props.accessibilityLabel).toBe('Sıradakiler, 1 masal');
      expect(queueButton().props.accessibilityValue?.text).toBeUndefined();

      act(() => {
        queueStore.replaceAll([]);
      });
      expect(screen.queryByTestId('library-queue-count', { includeHiddenElements: true })).toBeNull();
      expect(screen.getByRole('button', { name: 'Sıradakiler' })).toBe(queueButton());
      expect(queueButton().props.accessibilityValue?.text).toBeUndefined();
    });
  });

  describe('Kaldığın yerden devam et', () => {
    it('shows the last story of this account with the narrator and the time left', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      await renderLibrary();
      expect(screen.getByTestId('library-continue')).toBeOnTheScreen();
      expect(screen.getByText('Kaldığın yerden devam et')).toBeOnTheScreen();
      expect(screen.getByTestId('library-continue-meta')).toHaveTextContent('Kerem anlatıyor, 1 dk kaldı');
      expect(screen.getByTestId('library-continue-progress').props.accessibilityValue.now).toBe(75);
    });

    it('is above the count row, and above the skeleton while the list loads', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      mockGetMyNarrations.mockReturnValue(new Promise(() => {}));
      await renderLibrary();
      expect(screen.getByTestId('library-continue')).toBeOnTheScreen();
      expect(screen.getByTestId('library-loading')).toBeOnTheScreen();
    });

    it.each([
      ['another account', async () => rememberLastPlayed('n1', 'u-2', 180000)],
      ['no position', async () => rememberLastPlayed('n1', 'u-1')],
      ['a finished position', async () => rememberLastPlayed('n1', 'u-1', 239500)],
    ])('is hidden for %s', async (_label, prepare) => {
      await prepare();
      await renderLibrary();
      expect(screen.queryByTestId('library-continue')).toBeNull();
    });

    it('is hidden on Kaydedilenler and while searching', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      mockGetMyNarrations.mockResolvedValueOnce(page([narration('n2')], 1, 1));
      await renderLibrary();
      fireEvent.press(screen.getByRole('radio', { name: 'Kaydedilenler' }));
      await flush(16);
      expect(screen.queryByTestId('library-continue')).toBeNull();

      fireEvent.press(screen.getByRole('radio', { name: 'Masallarım' }));
      await flush(16);
      expect(screen.getByTestId('library-continue')).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
      fireEvent.changeText(screen.getByPlaceholderText('Masal ya da anlatıcı ara'), 'ay');
      await flush(500);
      expect(screen.queryByTestId('library-continue')).toBeNull();
    });

    it('is hidden when its story was playing as the tab gained focus', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      setPlayer(loadedPatch('n1', true));
      await renderLibrary();
      expect(screen.queryByTestId('library-continue')).toBeNull();
    });

    it('play resumes in place and the card stays, now live', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      mockPlayer.startNarration.mockImplementation(async () => {
        runInAction(() => Object.assign(mockPlayer, loadedPatch('n1', true)));
        return true;
      });
      await renderLibrary();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Devam et: Uykulu Ay' }));
      });
      await flush(0);
      expect(mockPlayer.startNarration).toHaveBeenCalledWith(
        { narrationId: 'n1', meta: expect.objectContaining({ narrationId: 'n1', narratorName: 'Kerem' }) },
        { autoplay: true },
      );
      expect(mockNav.navigate).not.toHaveBeenCalled();
      expect(screen.getByTestId('library-continue')).toBeOnTheScreen();
      // Live: the play button pauses the story in place.
      fireEvent.press(screen.getByRole('button', { name: 'Uykulu Ay masalını duraklat' }));
      expect(mockPlayer.togglePlayPause).toHaveBeenCalledTimes(1);
    });

    it('the body opens the player as the mini player does, and plays nothing by itself (VR-05)', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      await renderLibrary();
      fireEvent.press(screen.getByRole('button', { name: 'Oynatıcıyı aç: Uykulu Ay' }));
      expect(mockNav.navigate).toHaveBeenCalledWith('AudioPlayer', { narrationId: 'n1' });
      expect(getNarrationMeta('n1')?.story.title).toBe('Uykulu Ay');
      expect(mockPlayer.startNarration).not.toHaveBeenCalled();
    });

    it('a story that is gone (404) is forgotten with "Masal bulunamadı." and the card leaves', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      // The start goes through on the stored meta; the server then answers 404.
      mockPlayer.startNarration.mockImplementation(async () => {
        runInAction(() => Object.assign(mockPlayer, loadedPatch('n1', true)));
        return true;
      });
      await renderLibrary();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Devam et: Uykulu Ay' }));
      });
      // The start runs in the frame after the press (RC-6).
      await flush(16);
      setPlayer({ loadError: 'notFound', loadErrorNarrationId: 'n1', loadPhase: 'failed', isPlaying: false });
      await flush(0);
      expect(screen.queryByTestId('library-continue')).toBeNull();
      expect(mockToast.info).toHaveBeenCalledWith('Masal bulunamadı.');
      expect(await readLastPlayed('u-1')).toBeNull();
    });

    it('a start that fails with notFound at once is handled the same way', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      mockPlayer.startNarration.mockImplementation(async () => {
        runInAction(() => {
          mockPlayer.loadError = 'notFound';
          mockPlayer.loadErrorNarrationId = 'n1';
          mockPlayer.loadPhase = 'failed';
        });
        return false;
      });
      await renderLibrary();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Devam et: Uykulu Ay' }));
      });
      await flush(0);
      expect(screen.queryByTestId('library-continue')).toBeNull();
      expect(mockToast.info).toHaveBeenCalledWith('Masal bulunamadı.');
    });

    it('a story whose audio was removed is forgotten too, and the message says how to get it back', async () => {
      await rememberLastPlayed('n1', 'u-1', 180000);
      mockPlayer.startNarration.mockImplementation(async () => {
        runInAction(() => {
          mockPlayer.loadError = 'audioRemoved';
          mockPlayer.loadErrorNarrationId = 'n1';
          mockPlayer.loadPhase = 'failed';
        });
        return false;
      });
      await renderLibrary();
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Devam et: Uykulu Ay' }));
      });
      await flush(0);
      expect(screen.queryByTestId('library-continue')).toBeNull();
      expect(mockToast.info).toHaveBeenCalledWith(
        'Bu masalın sesi yenileniyor. Masal sayfasından yeniden oluşturabilirsin.',
      );
      expect(await readLastPlayed('u-1')).toBeNull();
    });
  });

  describe('Kaydedilenler', () => {
    const openSaved = async () => {
      fireEvent.press(screen.getByRole('radio', { name: 'Kaydedilenler' }));
      // The segmented control hands the choice over in the next frame.
      await flush(16);
    };

    it('loads the saved tales on mount when the store has none', async () => {
      await renderLibrary();
      expect(mockStoryStore.loadFavorites).toHaveBeenCalledTimes(1);
    });

    it('lists one row per tale and opens the story', async () => {
      mockStoryStore.favoriteStories = [
        savedStory('s-1', 'Bremen Mızıkacıları'),
        savedStory('s-2', 'Parmak Kız'),
      ];
      await renderLibrary();
      expect(mockStoryStore.loadFavorites).not.toHaveBeenCalled();
      await openSaved();

      expect(screen.getByTestId('library-count')).toHaveTextContent('2 masal');
      expect(screen.getAllByText('Derleyen Grimm Kardeşler')).toHaveLength(2);
      // Search belongs to Masallarım.
      expect(screen.queryByRole('button', { name: 'Masallarımda ara' })).toBeNull();

      fireEvent.press(screen.getByRole('button', { name: 'Parmak Kız masalını aç' }));
      expect(mockNav.navigate).toHaveBeenCalledWith('StoryDetail', { storyId: 's-2' });
    });

    it('unsaving offers "Geri al", which puts the row back at its place', async () => {
      const bremen = savedStory('s-1', 'Bremen Mızıkacıları');
      const parmak = savedStory('s-2', 'Parmak Kız');
      const kurt = savedStory('s-3', 'Kurt ile Yedi Keçi');
      mockStoryStore.favoriteStories = [bremen, parmak, kurt];
      mockStoryStore.toggleFavorite.mockImplementation(async (id: string) => {
        runInAction(() => {
          mockStoryStore.favoriteStories = mockStoryStore.favoriteStories.filter(s => s.id !== id);
        });
        return 'done';
      });
      await renderLibrary();
      await openSaved();

      await act(async () => {
        fireEvent.press(
          screen.getByRole('button', { name: 'Parmak Kız masalını kaydedilenlerden çıkar' }),
        );
      });
      expect(mockStoryStore.toggleFavorite).toHaveBeenCalledWith('s-2', { quiet: true });
      expect(screen.queryByText('Parmak Kız')).toBeNull();
      const undo = toastAction('info', 'Parmak Kız kaydedilenlerden çıkarıldı');
      expect(undo.label).toBe('Geri al');

      await act(async () => {
        undo.onPress();
      });
      expect(mockStoryStore.restoreFavorite).toHaveBeenCalledWith(parmak, 1);
    });

    it('a failed unsave says so once and offers no undo', async () => {
      mockStoryStore.favoriteStories = [savedStory('s-1', 'Bremen Mızıkacıları')];
      mockStoryStore.toggleFavorite.mockResolvedValue('failed');
      await renderLibrary();
      await openSaved();
      await act(async () => {
        fireEvent.press(
          screen.getByRole('button', { name: 'Bremen Mızıkacıları masalını kaydedilenlerden çıkar' }),
        );
      });
      expect(mockToast.error).toHaveBeenCalledTimes(1);
      expect(mockToast.info).not.toHaveBeenCalled();
    });

    it('shows the count from the first page on, from the store total', async () => {
      mockStoryStore.favoriteStories = [savedStory('s-1', 'Bremen Mızıkacıları')];
      mockStoryStore.favoritesTotal = 21;
      mockStoryStore.hasMoreFavorites = true;
      await renderLibrary();
      await openSaved();
      expect(screen.getByTestId('library-count')).toHaveTextContent('21 masal');

      await act(async () => {
        list().props.onEndReached();
      });
      expect(mockStoryStore.loadMoreFavorites).toHaveBeenCalledTimes(1);

      await act(async () => {
        await list().props.refreshControl.props.onRefresh();
      });
      expect(mockStoryStore.loadFavorites).toHaveBeenCalledTimes(1);
    });

    it('a failed load shows an error with a retry, not "Kaydettiğin masal yok"', async () => {
      mockStoryStore.loadFavorites.mockImplementationOnce(async () => {
        runInAction(() => {
          mockStoryStore.favoritesError = true;
          mockStoryStore.favoritesErrorKind = 'server';
        });
      });
      await renderLibrary();
      await openSaved();
      expect(screen.getByTestId('library-saved-error')).toBeOnTheScreen();
      expect(screen.getByText('Kaydedilenler yüklenemedi')).toBeOnTheScreen();
      expect(screen.queryByTestId('library-empty-saved')).toBeNull();

      mockStoryStore.loadFavorites.mockImplementationOnce(async () => {
        runInAction(() => {
          mockStoryStore.favoritesError = false;
          mockStoryStore.favoriteStories = [savedStory('s-1', 'Bremen Mızıkacıları')];
        });
      });
      await act(async () => {
        fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
      });
      await flush(0);
      expect(mockStoryStore.loadFavorites).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Bremen Mızıkacıları')).toBeOnTheScreen();
    });

    it('an offline load failure shows the offline copy', async () => {
      mockStoryStore.loadFavorites.mockImplementationOnce(async () => {
        runInAction(() => {
          mockStoryStore.favoritesError = true;
          mockStoryStore.favoritesErrorKind = 'offline';
        });
      });
      await renderLibrary();
      await openSaved();
      expect(screen.getByText('İnternete bağlı değilsin')).toBeOnTheScreen();
    });

    it('loads as the same skeleton with the count slot', async () => {
      mockStoryStore.loadFavorites.mockReturnValue(new Promise(() => undefined));
      await renderLibrary();
      await openSaved();
      expect(screen.getByTestId('library-loading-count')).toBeOnTheScreen();
    });

    it('has its own empty state', async () => {
      await renderLibrary();
      await openSaved();
      expect(screen.getByText('Kaydettiğin masal yok')).toBeOnTheScreen();
      expect(screen.getByText('Kaydettiğin masallar burada durur.')).toBeOnTheScreen();
      fireEvent.press(screen.getByRole('button', { name: 'Masallara göz at' }));
      expect(mockNav.navigate).toHaveBeenCalledWith('Main', { screen: 'Discover' });
    });

    it('opens on the saved segment when another screen asked for it', async () => {
      requestLibrarySegment('saved');
      await renderLibrary();
      expect(screen.getByRole('radio', { name: 'Kaydedilenler' })).toBeSelected();
      expect(screen.getByText('Kaydettiğin masal yok')).toBeOnTheScreen();
    });

    it('switches to the saved segment when asked while mounted', async () => {
      await renderLibrary();
      expect(screen.getByText('Henüz masalın yok')).toBeOnTheScreen();
      act(() => requestLibrarySegment('saved'));
      await flush(0);
      expect(screen.getByText('Kaydettiğin masal yok')).toBeOnTheScreen();
    });
  });

  it.each(PALETTE_KEYS)('in %s every face stands out from what it sits on', async scheme => {
    mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
    await renderLibrary(scheme);
    const T = themes[scheme];
    const bg = (testID: string) => flatStyle(screen.getByTestId(testID)).backgroundColor as string;
    const apart = (face: string, container: string) => {
      expect(face).not.toBe(container);
      expect(contrastRatio(face, container)).toBeGreaterThan(1.05);
    };
    // The row card and the app bar buttons on the canvas.
    apart(bg('library-narration-n1-face'), T.bg);
    apart(bg('library-queue-face'), T.bg);
    apart(bg('library-bell-face'), T.bg);
    // The row's play button on its card.
    apart(bg('library-play-n1-face'), bg('library-narration-n1-face'));
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
    await renderLibrary(scheme);
    const T = themes[scheme];
    expect(flatStyle(screen.getByRole('header', { name: 'Kütüphane' })).color).toBe(T.text);
    // The selected segment is filled with the action colour, so its label is dark.
    expect(flatStyle(screen.getByText('Masallarım')).color).toBe(T.onAction);
    expect(flatStyle(screen.getByText('Kaydedilenler')).color).toBe(T.text2);
    expect(flatStyle(screen.getByText('Masal n1')).color).toBe(T.text);
    // Rows are cards on their lips, the queue button a tactile card.
    expect(flatStyle(screen.getByTestId('library-narration-n1-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('library-narration-n1-lip')).backgroundColor).toBe(T.lip);
    expect(flatStyle(screen.getByTestId('library-queue-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('library-count')).color).toBe(T.text);
  });

  it('draws the search field as the shared field: radius 20 on a 3dp lip, 12dp under the segments', async () => {
    mockGetMyNarrations.mockResolvedValueOnce(page([narration('n1')], 1, 1));
    await renderLibrary('kitaplik');
    fireEvent.press(screen.getByRole('button', { name: 'Masallarımda ara' }));
    const T = themes.kitaplik;
    const face = flatStyle(screen.getByTestId('library-search-input-field-face'));
    expect(face).toMatchObject({ borderRadius: 20, minHeight: 52 });
    const lip = flatStyle(screen.getByTestId('library-search-input-field-lip'));
    expect(lip).toMatchObject({ borderRadius: 20, backgroundColor: T.lip });
    // The row around the field and its "Vazgeç" carries the screen's margins.
    let frame = screen.getByTestId('library-search-input-field-face').parent;
    while (frame && flatStyle(frame).marginTop === undefined) frame = frame.parent;
    expect(frame?.props.testID).toBe('library-search-row');
    expect(frame && flatStyle(frame)).toMatchObject({ marginTop: 12, marginHorizontal: 16 });
  });

  it('is translated into English', async () => {
    await i18n.changeLanguage('en');
    try {
      mockGetMyNarrations.mockResolvedValue(page([narration('n1')], 1, 1));
      await renderLibrary();
      expect(screen.getByRole('header', { name: 'Library' })).toBeOnTheScreen();
      expect(screen.getByRole('radio', { name: 'My stories' })).toBeOnTheScreen();
      expect(screen.getByRole('radio', { name: 'Saved' })).toBeOnTheScreen();
      // One story, not "1 stories".
      expect(screen.getByTestId('library-count')).toHaveTextContent('1 story');
      fireEvent.press(screen.getByRole('button', { name: 'Search my stories' }));
      expect(within(screen.getByTestId('library-search-row')).getByRole('button', { name: 'Cancel' })).toBeOnTheScreen();
    } finally {
      await i18n.changeLanguage('tr');
    }
  });
});
