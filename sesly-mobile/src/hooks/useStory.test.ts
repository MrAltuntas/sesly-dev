import { renderHook } from '@testing-library/react-native';
import { apiErrorFromResponse } from '../services/ApiError';
import { DEFAULT_STORY_EXTRAS } from '../models/Story';
import type { PaginatedStories, Story, StoryDetail } from '../models/Story';
import type { StoryNarration } from '../models/Narration';
import { AgeGroup, NarrationStatus, StoryCategory } from '../types/enums';

const mockToggleFavorite = jest.fn();
const mockGetStories = jest.fn();
const mockGetStoryById = jest.fn();
const mockGetFavoriteStories = jest.fn();
const mockGetMyNarrations = jest.fn();
const mockGetNarrationsByStory = jest.fn();
// The content language store: `effective` is the language of the Home lists
// (flat) and the prefer of the grouped saved list.
const mockContentLanguage: { effective: string } = { effective: 'tr' };

jest.mock('../services/StoryService', () => ({
  __esModule: true,
  default: {
    toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args),
    getStories: (...args: unknown[]) => mockGetStories(...args),
    getStoryById: (...args: unknown[]) => mockGetStoryById(...args),
    getFavoriteStories: (...args: unknown[]) => mockGetFavoriteStories(...args),
  },
}));
jest.mock('../services/NarrationService', () => ({
  __esModule: true,
  default: {
    getMyNarrations: (...args: unknown[]) => mockGetMyNarrations(...args),
    getNarrationsByStory: (...args: unknown[]) => mockGetNarrationsByStory(...args),
  },
}));
jest.mock('./useContentLanguage', () => ({
  getContentLanguageStore: () => mockContentLanguage,
}));
jest.mock('../utils/toast', () => ({
  showToast: { error: jest.fn(), success: jest.fn(), info: jest.fn() },
}));

import {
  CATEGORY_SHELF_LIMIT,
  DETAIL_CACHE_SIZE,
  FAVORITE_CHANGES_KEPT,
  StoryStore,
  getStoryStore,
  useStory,
} from './useStory';
import { getDiscoverStore } from './useDiscover';
import { runSessionEndHandlers, setSessionUserId } from '../stores/session';
import { connectivityStore } from '../stores/ConnectivityStore';
import { showToast } from '../utils/toast';

const story = (id: string, isFavorite: boolean): Story => ({
  id,
  title: `Masal ${id}`,
  description: null,
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.BEDTIME,
  estimatedDuration: 5,
  coverImageUrl: null,
  isPremium: false,
  isFavorite,
  ...DEFAULT_STORY_EXTRAS,
});

const detail = (id: string, isFavorite: boolean): StoryDetail => ({
  ...story(id, isFavorite),
  translations: [],
  translation: null,
  part: null,
  requestedLanguages: [],
  chunks: [],
  userProgress: null,
});

describe('StoryStore.toggleFavorite', () => {
  beforeEach(() => {
    mockToggleFavorite.mockReset();
  });

  it('reads the state from currentStory when it is not in any list', async () => {
    mockToggleFavorite.mockResolvedValue(undefined);
    const store = new StoryStore();
    store.currentStory = detail('s-9', true);

    await store.toggleFavorite('s-9');

    // Was favorite -> must send "remove", not "add".
    expect(mockToggleFavorite).toHaveBeenCalledWith('s-9', false);
    expect(store.currentStory?.isFavorite).toBe(false);
  });

  it('updates every copy optimistically', async () => {
    mockToggleFavorite.mockResolvedValue(undefined);
    const store = new StoryStore();
    store.stories = [story('s-1', false), story('s-2', false)];
    store.currentStory = detail('s-1', false);

    await store.toggleFavorite('s-1');

    expect(mockToggleFavorite).toHaveBeenCalledWith('s-1', true);
    expect(store.stories[0].isFavorite).toBe(true);
    expect(store.stories[1].isFavorite).toBe(false);
    expect(store.currentStory?.isFavorite).toBe(true);
    expect(store.favoriteStories.map(s => s.id)).toEqual(['s-1']);
  });

  it('rolls every copy back when the request fails', async () => {
    mockToggleFavorite.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = new StoryStore();
    const fav = story('s-1', true);
    store.stories = [fav];
    store.favoriteStories = [story('s-0', true), fav];
    store.currentStory = detail('s-1', true);

    await store.toggleFavorite('s-1');

    expect(mockToggleFavorite).toHaveBeenCalledWith('s-1', false);
    expect(store.stories[0].isFavorite).toBe(true);
    expect(store.currentStory?.isFavorite).toBe(true);
    // Original order restored.
    expect(store.favoriteStories.map(s => s.id)).toEqual(['s-0', 's-1']);
  });
});

// ============================================================================
// Helpers for the list / pagination tests below
// ============================================================================

/** Backend PaginatedResult<T> as parsed by parsePaginatedStoriesFromJSON. */
const page = (
  data: Story[],
  pageNo: number,
  totalPages: number,
  limit = 20,
): PaginatedStories => ({
  data,
  meta: { page: pageNo, limit, total: totalPages * limit, totalPages },
});

const narration = (id: string, storyId: string): StoryNarration => ({
  id,
  userId: 'user-1',
  storyId,
  voiceProfileId: 'vp-1',
  voiceProfile: null,
  status: NarrationStatus.READY,
  totalChunks: 4,
  completedChunks: 4,
  errorMessage: null,
  isPreGenerated: false,
  createdAt: new Date('2026-09-01T20:00:00.000Z'),
  updatedAt: new Date('2026-09-01T20:05:00.000Z'),
  completedAt: new Date('2026-09-01T20:05:00.000Z'),
  story: null,
  audioChunks: [],
  totalDuration: 312,
  audioUrl: 'https://storage.googleapis.com/sesly-audio/narrations/n.mp3',
  voiceLanguage: null,
  storyLanguage: null,
  languageMismatch: false,
  nativeVoiceUsed: false,
});

const narrationPage = (data: StoryNarration[], pageNo: number, totalPages: number) => ({
  data,
  meta: { page: pageNo, limit: 20, total: data.length, totalPages },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const ids = (list: readonly { id: string }[]) => list.map(s => s.id);

/** Let every chained promise of a settled request run. */
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

const silenceConsole = () => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
};

// ============================================================================
// Stories pagination
// ============================================================================

describe('StoryStore stories pagination', () => {
  beforeEach(() => {
    mockGetStories.mockReset();
    silenceConsole();
  });

  it('first page replaces the list and derives hasMore from meta.totalPages', async () => {
    const store = new StoryStore();
    store.stories = [story('old', false)];
    mockGetStories.mockResolvedValue(page([story('s-1', false), story('s-2', false)], 1, 3));

    await store.loadStories();

    expect(mockGetStories).toHaveBeenCalledWith({ page: 1, limit: 20, category: undefined, language: 'tr' });
    expect(ids(store.stories)).toEqual(['s-1', 's-2']);
    expect(store.currentPage).toBe(1);
    expect(store.totalPages).toBe(3);
    expect(store.hasMore).toBe(true);
    expect(store.isLoadingMore).toBe(false);
    expect(store.errorMessage).toBe('');
  });

  it('a first page in flight is not a next page (isLoadingMore stays false)', async () => {
    const pending = deferred<PaginatedStories>();
    mockGetStories.mockReturnValue(pending.promise);
    const store = new StoryStore();

    const load = store.loadStories();
    expect(store.isLoadingMore).toBe(false);

    pending.resolve(page([], 1, 1));
    await load;
    expect(store.isLoadingMore).toBe(false);
    expect('isLoading' in store).toBe(false);
  });

  it('passes the category filter to the service', async () => {
    mockGetStories.mockResolvedValue(page([], 1, 1));
    const store = new StoryStore();

    await store.loadStories(1, 'BEDTIME');

    expect(mockGetStories).toHaveBeenCalledWith({ page: 1, limit: 20, category: 'BEDTIME', language: 'tr' });
  });

  it('loadMore appends the next page and advances currentPage until the last page', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValueOnce(page([story('s-1', false)], 1, 3));
    await store.loadStories();

    mockGetStories.mockResolvedValueOnce(page([story('s-2', false)], 2, 3));
    await store.loadMore();
    expect(mockGetStories).toHaveBeenLastCalledWith({ page: 2, limit: 20, category: undefined, language: 'tr' });
    expect(ids(store.stories)).toEqual(['s-1', 's-2']);
    expect(store.currentPage).toBe(2);
    expect(store.hasMore).toBe(true);

    mockGetStories.mockResolvedValueOnce(page([story('s-3', false)], 3, 3));
    await store.loadMore();
    expect(ids(store.stories)).toEqual(['s-1', 's-2', 's-3']);
    expect(store.currentPage).toBe(3);
    expect(store.hasMore).toBe(false);
    expect(store.isLoadingMore).toBe(false);
  });

  it('loadMore does nothing once the last page is loaded', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValueOnce(page([story('s-1', false)], 1, 1));
    await store.loadStories();
    expect(store.hasMore).toBe(false);

    await store.loadMore();

    expect(mockGetStories).toHaveBeenCalledTimes(1);
  });

  it('does not double-fetch while a loadMore is already in flight', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValueOnce(page([story('s-1', false)], 1, 3));
    await store.loadStories();

    const pending = deferred<PaginatedStories>();
    mockGetStories.mockReturnValueOnce(pending.promise);
    const first = store.loadMore();
    const second = store.loadMore();
    expect(store.isLoadingMore).toBe(true);

    pending.resolve(page([story('s-2', false)], 2, 3));
    await Promise.all([first, second]);

    expect(mockGetStories).toHaveBeenCalledTimes(2);
    expect(ids(store.stories)).toEqual(['s-1', 's-2']);
    expect(store.isLoadingMore).toBe(false);
  });

  it('refresh reloads page 1, replaces the list and re-opens pagination', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValueOnce(page([story('s-1', false)], 1, 2));
    await store.loadStories();
    mockGetStories.mockResolvedValueOnce(page([story('s-2', false)], 2, 2));
    await store.loadMore();
    expect(store.hasMore).toBe(false);

    mockGetStories.mockResolvedValueOnce(page([story('s-9', false)], 1, 2));
    await store.refresh();

    expect(mockGetStories).toHaveBeenLastCalledWith({ page: 1, limit: 20, category: undefined, language: 'tr' });
    expect(ids(store.stories)).toEqual(['s-9']);
    expect(store.currentPage).toBe(1);
    expect(store.hasMore).toBe(true);
  });

  it('sets the error state and its kind, without a snackbar, when the first page fails', async () => {
    const store = new StoryStore();
    mockGetStories.mockRejectedValue(apiErrorFromResponse(undefined, null));

    await store.loadStories();

    expect(store.errorMessage).toBe('Masallar yüklenemedi');
    expect(store.listErrorKind).toBe('offline');
    // The screen shows its error state; a snackbar would say it twice.
    expect(showToast.error).not.toHaveBeenCalled();
    expect(store.isLoadingMore).toBe(false);
  });

  it('a failed refresh keeps the rows and says so once (no error state covers them)', async () => {
    const store = new StoryStore();
    store.stories = [story('s-1', false)];
    mockGetStories.mockRejectedValue(apiErrorFromResponse(500, {}));

    await store.refresh();

    expect(ids(store.stories)).toEqual(['s-1']);
    expect(store.errorMessage).toBe('Masallar yüklenemedi');
    expect(store.listErrorKind).toBe('server');
    expect(showToast.error).toHaveBeenCalledTimes(1);
    expect(showToast.error).toHaveBeenCalledWith('Masallar yüklenemedi');
  });

  it('a stale failure that lands after a newer load says nothing', async () => {
    const store = new StoryStore();
    store.stories = [story('s-1', false)];
    const stale = deferred<PaginatedStories>();
    mockGetStories.mockReturnValueOnce(stale.promise);
    const first = store.loadStories();
    mockGetStories.mockResolvedValueOnce(page([story('s-2', false)], 1, 1));
    await store.loadStories();
    stale.reject(apiErrorFromResponse(500, {}));
    await first;

    expect(ids(store.stories)).toEqual(['s-2']);
    expect(store.errorMessage).toBe('');
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('names a server failure, and an offline device whatever the error', async () => {
    const store = new StoryStore();
    mockGetStories.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadStories();
    expect(store.listErrorKind).toBe('server');

    connectivityStore.offline = true;
    try {
      mockGetStories.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
      await store.loadStories();
      expect(store.listErrorKind).toBe('offline');
    } finally {
      connectivityStore.offline = false;
    }

    mockGetStories.mockResolvedValueOnce(page([], 1, 1));
    await store.loadStories();
    expect(store.listErrorKind).toBeNull();
  });

  it('lists the content language only (flat, no grouping)', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValue(page([], 1, 1));
    await store.loadStories();
    expect(mockGetStories.mock.calls[0][0]).not.toHaveProperty('grouped');

    mockContentLanguage.effective = 'en';
    try {
      await store.loadStories();
      expect(mockGetStories).toHaveBeenLastCalledWith({
        page: 1,
        limit: 20,
        category: undefined,
        language: 'en',
      });
    } finally {
      mockContentLanguage.effective = 'tr';
    }
  });

  it('a failed next page keeps the list error clear and says so in a snackbar', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValueOnce(page([story('s-1', false)], 1, 3));
    await store.loadStories();
    mockGetStories.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadMore();

    expect(store.errorMessage).toBe('');
    expect(store.listErrorKind).toBeNull();
    expect(showToast.error).toHaveBeenCalledTimes(1);
  });

  it('a save still being sent wins over a list that lands meanwhile', async () => {
    const store = new StoryStore();
    store.stories = [story('s-1', false)];
    const save = deferred<void>();
    mockToggleFavorite.mockReset().mockReturnValueOnce(save.promise);
    const toggled = store.toggleFavorite('s-1');

    mockGetStories.mockResolvedValueOnce(page([story('s-1', false), story('s-2', false)], 1, 1));
    await store.loadStories();
    expect(store.stories[0].isFavorite).toBe(true);
    expect(store.stories[1].isFavorite).toBe(false);

    save.resolve();
    await expect(toggled).resolves.toBe('done');
    expect(store.stories[0].isFavorite).toBe(true);
  });

  it('keeps loaded stories and clears isLoadingMore when loadMore fails', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValueOnce(page([story('s-1', false)], 1, 3));
    await store.loadStories();

    mockGetStories.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadMore();

    expect(ids(store.stories)).toEqual(['s-1']);
    expect(store.currentPage).toBe(1);
    expect(store.isLoadingMore).toBe(false);
    // A later retry asks for the same page again.
    mockGetStories.mockResolvedValueOnce(page([story('s-2', false)], 2, 3));
    await store.loadMore();
    expect(mockGetStories).toHaveBeenLastCalledWith({ page: 2, limit: 20, category: undefined, language: 'tr' });
  });

  it('clears the previous error at the start of the next first-page load', async () => {
    const store = new StoryStore();
    mockGetStories.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadStories();
    expect(store.errorMessage).not.toBe('');

    mockGetStories.mockResolvedValueOnce(page([story('s-1', false)], 1, 1));
    await store.loadStories();
    expect(store.errorMessage).toBe('');
  });

  // Regression (fixed 2026-09-28, was BUG): src/hooks/useStory.ts:130-140 - loadStories applies every response
  // without checking that it still belongs to the current list generation. A
  // pull-to-refresh while a loadMore is in flight lets the stale page land on
  // top of the refreshed page 1: stories = [page1, page3], currentPage = 3,
  // hasMore = false, so page 2 can never be loaded until the next refresh.
  it('drops a stale loadMore page that resolves after a refresh', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValueOnce(page([story('a-1', false)], 1, 3));
    await store.loadStories();
    mockGetStories.mockResolvedValueOnce(page([story('b-1', false)], 2, 3));
    await store.loadMore();

    const stalePage3 = deferred<PaginatedStories>();
    mockGetStories.mockReturnValueOnce(stalePage3.promise);
    const more = store.loadMore();

    mockGetStories.mockResolvedValueOnce(page([story('a-1', false)], 1, 3));
    await store.refresh();
    stalePage3.resolve(page([story('c-1', false)], 3, 3));
    await more;

    expect(ids(store.stories)).toEqual(['a-1']);
    expect(store.currentPage).toBe(1);
    expect(store.hasMore).toBe(true);
  });
});

// ============================================================================
// Story detail
// ============================================================================

describe('StoryStore.getStoryDetail', () => {
  beforeEach(() => {
    mockGetStoryById.mockReset();
    silenceConsole();
  });

  it('stores the detail and clears a previous error state', async () => {
    const store = new StoryStore();
    store.storyDetailErrorStatus = 403;
    store.detailErrorKind = 'client';
    mockGetStoryById.mockResolvedValue(detail('s-7', false));

    await store.getStoryDetail('s-7');

    expect(mockGetStoryById).toHaveBeenCalledWith('s-7');
    expect(store.currentStory?.id).toBe('s-7');
    expect(store.storyDetailErrorStatus).toBeNull();
    expect(store.detailErrorKind).toBeNull();
    expect(store.isLoadingDetail).toBe(false);
  });

  it('leaves the story list state alone', async () => {
    const store = new StoryStore();
    store.errorMessage = 'Masallar yüklenemedi';
    mockGetStoryById.mockRejectedValue(apiErrorFromResponse(500, {}));

    const pending = store.getStoryDetail('s-7');
    expect(store.isLoadingDetail).toBe(true);
    await pending;

    // Home's list error is neither cleared nor overwritten by a detail.
    expect(store.errorMessage).toBe('Masallar yüklenemedi');
    expect(store.detailErrorKind).toBe('server');
  });

  it('exposes 403 (premium story for a free user) without a failure toast', async () => {
    const store = new StoryStore();
    mockGetStoryById.mockRejectedValue(
      apiErrorFromResponse(403, {
        success: false,
        statusCode: 403,
        message: 'Bu masal Sesly Pro üyelerine özel.',
        path: '/stories/s-8',
      }),
    );

    await store.getStoryDetail('s-8');

    expect(store.storyDetailErrorStatus).toBe(403);
    expect(store.detailErrorKind).toBe('client');
    expect(showToast.error).not.toHaveBeenCalled();
    expect(store.isLoadingDetail).toBe(false);
  });

  it('exposes the status of other API errors without a snackbar', async () => {
    const store = new StoryStore();
    mockGetStoryById.mockRejectedValue(
      apiErrorFromResponse(404, { statusCode: 404, message: 'Masal bulunamadı' }),
    );

    await store.getStoryDetail('missing');

    expect(store.storyDetailErrorStatus).toBe(404);
    expect(store.detailErrorKind).toBe('client');
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('uses a null status and the server kind for non-API errors', async () => {
    const store = new StoryStore();
    mockGetStoryById.mockRejectedValue(new Error('Invalid story detail data: expected object'));

    await store.getStoryDetail('s-1');

    expect(store.storyDetailErrorStatus).toBeNull();
    expect(store.detailErrorKind).toBe('server');
    expect(showToast.error).not.toHaveBeenCalled();
  });

  // perf-14: the list loads used to share isLoading with the detail.
  it('keeps isLoadingDetail while the detail is pending and the favourites resolve', async () => {
    const store = new StoryStore();
    const pendingDetail = deferred<StoryDetail>();
    mockGetStoryById.mockReturnValue(pendingDetail.promise);
    mockGetFavoriteStories.mockResolvedValue(page([story('f-1', true)], 1, 1));
    mockGetStories.mockResolvedValue(page([story('s-1', false)], 1, 1));

    const open = store.getStoryDetail('s-7');
    await store.loadFavorites();
    await store.loadStories();

    expect(store.isLoadingDetail).toBe(true);
    expect(store.isLoadingFavorites).toBe(false);
    expect(store.isLoadingMore).toBe(false);

    pendingDetail.resolve(detail('s-7', false));
    await open;
    expect(store.isLoadingDetail).toBe(false);
  });

  it('an older answer never replaces the story asked for last', async () => {
    const store = new StoryStore();
    const answerA = deferred<StoryDetail>();
    const answerB = deferred<StoryDetail>();
    mockGetStoryById.mockImplementation((id: string) =>
      id === 'A' ? answerA.promise : answerB.promise,
    );

    const openA = store.getStoryDetail('A');
    const openB = store.getStoryDetail('B');
    answerB.resolve(detail('B', false));
    await openB;
    expect(store.currentStory?.id).toBe('B');
    expect(store.isLoadingDetail).toBe(false);

    answerA.resolve(detail('A', false));
    await openA;
    expect(store.currentStory?.id).toBe('B');
    expect(store.isLoadingDetail).toBe(false);
    // The late answer is still right for A: reopening A draws it at once.
    expect(store.cachedDetail('A')?.id).toBe('A');
  });

  it('an older failure neither sets an error nor ends the newer load', async () => {
    const store = new StoryStore();
    const answerA = deferred<StoryDetail>();
    const answerB = deferred<StoryDetail>();
    mockGetStoryById.mockImplementation((id: string) =>
      id === 'A' ? answerA.promise : answerB.promise,
    );

    const openA = store.getStoryDetail('A');
    const openB = store.getStoryDetail('B');
    answerA.reject(apiErrorFromResponse(403, {}));
    await openA;
    expect(store.storyDetailErrorStatus).toBeNull();
    expect(store.isLoadingDetail).toBe(true);

    answerB.resolve(detail('B', false));
    await openB;
    expect(store.currentStory?.id).toBe('B');
  });
});

// ============================================================================
// Detail cache (perf-12)
// ============================================================================

describe('StoryStore detail cache', () => {
  beforeEach(() => {
    mockGetStoryById.mockReset();
    silenceConsole();
  });

  it('shows a reopened story at once and refreshes it in the background', async () => {
    const store = new StoryStore();
    mockGetStoryById.mockResolvedValueOnce(detail('s-1', false));
    await store.getStoryDetail('s-1');
    mockGetStoryById.mockResolvedValueOnce(detail('s-2', false));
    await store.getStoryDetail('s-2');

    const fresher = deferred<StoryDetail>();
    mockGetStoryById.mockReturnValueOnce(fresher.promise);
    const reopen = store.getStoryDetail('s-1', { showCached: true });
    // No skeleton: the cached copy is the current story right away.
    expect(store.currentStory?.id).toBe('s-1');
    expect(store.isLoadingDetail).toBe(false);
    expect(mockGetStoryById).toHaveBeenCalledTimes(3);

    fresher.resolve({ ...detail('s-1', false), title: 'Yeni başlık' });
    await reopen;
    expect(store.currentStory?.title).toBe('Yeni başlık');
    expect(store.cachedDetail('s-1')?.title).toBe('Yeni başlık');
  });

  it('without showCached the version on screen stays until the answer arrives', async () => {
    const store = new StoryStore();
    mockGetStoryById.mockResolvedValueOnce(detail('en', false));
    await store.getStoryDetail('en');
    mockGetStoryById.mockResolvedValueOnce(detail('tr', false));
    await store.getStoryDetail('tr');

    // The language switch: "en" is cached, but "tr" stays current meanwhile.
    const answer = deferred<StoryDetail>();
    mockGetStoryById.mockReturnValueOnce(answer.promise);
    const sw = store.getStoryDetail('en');
    expect(store.currentStory?.id).toBe('tr');
    expect(store.isLoadingDetail).toBe(true);

    answer.resolve(detail('en', false));
    await sw;
    expect(store.currentStory?.id).toBe('en');
  });

  it('refreshing the open story is not a loading state', async () => {
    const store = new StoryStore();
    mockGetStoryById.mockResolvedValueOnce(detail('s-1', false));
    await store.getStoryDetail('s-1');

    const answer = deferred<StoryDetail>();
    mockGetStoryById.mockReturnValueOnce(answer.promise);
    const refresh = store.getStoryDetail('s-1');
    expect(store.isLoadingDetail).toBe(false);
    answer.resolve(detail('s-1', true));
    await refresh;
    expect(store.currentStory?.isFavorite).toBe(true);
  });

  it('keeps the cached copy on a network failure, drops it on 404', async () => {
    const store = new StoryStore();
    mockGetStoryById.mockResolvedValueOnce(detail('s-1', false));
    await store.getStoryDetail('s-1');

    mockGetStoryById.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));
    await store.getStoryDetail('s-1');
    expect(store.currentStory?.id).toBe('s-1');
    expect(store.detailErrorKind).toBe('offline');

    mockGetStoryById.mockRejectedValueOnce(apiErrorFromResponse(404, {}));
    await store.getStoryDetail('s-1');
    expect(store.currentStory).toBeNull();
    expect(store.cachedDetail('s-1')).toBeNull();
  });

  it(`keeps the ${DETAIL_CACHE_SIZE} most recently opened stories`, async () => {
    const store = new StoryStore();
    mockGetStoryById.mockImplementation((id: string) => Promise.resolve(detail(id, false)));
    for (let i = 0; i <= DETAIL_CACHE_SIZE; i += 1) {
      await store.getStoryDetail(`s-${i}`);
      // s-0 is read again after every open, so it stays the most recent.
      if (i < DETAIL_CACHE_SIZE) expect(store.cachedDetail('s-0')).not.toBeNull();
    }

    // 21 stories opened: the least recently used one (s-1) is gone.
    expect(store.cachedDetail('s-0')).not.toBeNull();
    expect(store.cachedDetail('s-1')).toBeNull();
    expect(store.cachedDetail('s-2')).not.toBeNull();
    expect(store.cachedDetail(`s-${DETAIL_CACHE_SIZE}`)).not.toBeNull();
  });

  it('a cached copy follows a save made elsewhere', async () => {
    mockToggleFavorite.mockReset().mockResolvedValue(undefined);
    const store = new StoryStore();
    mockGetStoryById.mockResolvedValueOnce(detail('s-1', false));
    await store.getStoryDetail('s-1');
    mockGetStoryById.mockResolvedValueOnce(detail('s-2', false));
    await store.getStoryDetail('s-2');
    store.stories = [story('s-1', false)];

    await store.toggleFavorite('s-1');

    expect(store.cachedDetail('s-1')?.isFavorite).toBe(true);
    expect(store.cachedDetail('s-1')?.isFavoriteAnyLanguage).toBe(true);
  });
});

// ============================================================================
// peekStory (perf-12)
// ============================================================================

describe('StoryStore.peekStory', () => {
  afterEach(() => {
    getDiscoverStore().reset();
  });

  it('finds a story in the lists, the Keşfet list, the shelves and the details', async () => {
    const store = new StoryStore();
    store.stories = [story('home', false)];
    store.favoriteStories = [story('saved', true)];
    getDiscoverStore().items = [story('discover', false)];
    mockGetStories.mockReset().mockResolvedValue(page([story('shelf', false)], 1, 1));
    await store.loadCategoryShelves(['BEDTIME']);
    store.currentStory = detail('open', true);

    expect(store.peekStory('home')?.id).toBe('home');
    expect(store.peekStory('saved')?.isFavorite).toBe(true);
    expect(store.peekStory('discover')?.id).toBe('discover');
    expect(store.peekStory('shelf')?.id).toBe('shelf');
    // The open detail comes back list-shaped.
    const open = store.peekStory('open') as unknown as Record<string, unknown>;
    expect(open.id).toBe('open');
    expect(open).not.toHaveProperty('chunks');
    expect(store.peekStory('nowhere')).toBeNull();
  });

  it('saving a story that only Keşfet lists puts it in the saved list', async () => {
    mockToggleFavorite.mockReset().mockResolvedValue(undefined);
    const store = new StoryStore();
    getDiscoverStore().items = [story('discover', false)];

    await store.toggleFavorite('discover');

    expect(ids(store.favoriteStories)).toEqual(['discover']);
  });
});

// ============================================================================
// Favorites list
// ============================================================================

describe('StoryStore favorites list', () => {
  beforeEach(() => {
    mockGetFavoriteStories.mockReset();
    silenceConsole();
  });

  it('first page replaces, the next page appends, hasMoreFavorites follows meta', async () => {
    const store = new StoryStore();
    store.favoriteStories = [story('stale', true)];
    mockGetFavoriteStories.mockResolvedValueOnce(page([story('f-1', true)], 1, 2));

    await store.loadFavorites();
    expect(mockGetFavoriteStories).toHaveBeenCalledWith({ page: 1, limit: 20, grouped: true, prefer: 'tr' });
    expect(ids(store.favoriteStories)).toEqual(['f-1']);
    expect(store.favoritesPage).toBe(1);
    expect(store.favoritesTotalPages).toBe(2);
    expect(store.hasMoreFavorites).toBe(true);
    expect(store.isLoadingFavorites).toBe(false);

    mockGetFavoriteStories.mockResolvedValueOnce(page([story('f-2', true)], 2, 2));
    await store.loadMoreFavorites();
    expect(mockGetFavoriteStories).toHaveBeenLastCalledWith({ page: 2, limit: 20, grouped: true, prefer: 'tr' });
    expect(ids(store.favoriteStories)).toEqual(['f-1', 'f-2']);
    expect(store.hasMoreFavorites).toBe(false);
    expect(store.isLoadingMoreFavorites).toBe(false);
  });

  it('treats the empty page the service returns for 404 as "no favorites"', async () => {
    const store = new StoryStore();
    store.favoriteStories = [story('f-1', true)];
    // StoryService.getFavoriteStories maps 404 to this shape.
    mockGetFavoriteStories.mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await store.loadFavorites();

    expect(store.favoriteStories).toEqual([]);
    expect(store.hasMoreFavorites).toBe(false);
    await store.loadMoreFavorites();
    expect(mockGetFavoriteStories).toHaveBeenCalledTimes(1);
  });

  it('ignores loadMoreFavorites while a page is loading', async () => {
    const store = new StoryStore();
    mockGetFavoriteStories.mockResolvedValueOnce(page([story('f-1', true)], 1, 3));
    await store.loadFavorites();

    const pending = deferred<PaginatedStories>();
    mockGetFavoriteStories.mockReturnValueOnce(pending.promise);
    const first = store.loadMoreFavorites();
    const second = store.loadMoreFavorites();
    expect(store.isLoadingMoreFavorites).toBe(true);
    pending.resolve(page([story('f-2', true)], 2, 3));
    await Promise.all([first, second]);

    expect(mockGetFavoriteStories).toHaveBeenCalledTimes(2);
    expect(ids(store.favoriteStories)).toEqual(['f-1', 'f-2']);
  });

  it('sets favoritesError, without a snackbar, when the first load of an empty list fails', async () => {
    const store = new StoryStore();
    mockGetFavoriteStories.mockRejectedValue(apiErrorFromResponse(500, {}));

    await store.loadFavorites();

    expect(store.favoritesError).toBe(true);
    expect(store.favoritesErrorKind).toBe('server');
    // The saved segment shows its error state; a snackbar would say it twice.
    expect(showToast.error).not.toHaveBeenCalled();
    expect(store.isLoadingFavorites).toBe(false);
    expect(store.isLoadingMoreFavorites).toBe(false);
  });

  it('a failed refresh keeps the saved rows and says so once', async () => {
    const store = new StoryStore();
    store.favoriteStories = [story('f-1', true)];
    mockGetFavoriteStories.mockRejectedValue(apiErrorFromResponse(500, {}));

    await store.loadFavorites();

    expect(ids(store.favoriteStories)).toEqual(['f-1']);
    expect(store.favoritesError).toBe(true);
    expect(showToast.error).toHaveBeenCalledTimes(1);
    expect(showToast.error).toHaveBeenCalledWith('Favori masallar yüklenemedi');
  });

  it('clears favoritesError when the retry starts and keeps it clear after success', async () => {
    const store = new StoryStore();
    mockGetFavoriteStories.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));
    await store.loadFavorites();
    expect(store.favoritesError).toBe(true);
    expect(store.favoritesErrorKind).toBe('offline');

    const retry = deferred<PaginatedStories>();
    mockGetFavoriteStories.mockReturnValueOnce(retry.promise);
    const pending = store.loadFavorites();
    expect(store.favoritesError).toBe(false);
    expect(store.favoritesErrorKind).toBeNull();
    expect(store.isLoadingFavorites).toBe(true);

    retry.resolve(page([story('f-1', true)], 1, 1));
    await pending;
    expect(store.favoritesError).toBe(false);
    expect(ids(store.favoriteStories)).toEqual(['f-1']);
  });

  it('a failed next page sets no favoritesError', async () => {
    const store = new StoryStore();
    mockGetFavoriteStories.mockResolvedValueOnce(page([story('f-1', true)], 1, 2));
    await store.loadFavorites();
    mockGetFavoriteStories.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadMoreFavorites();

    expect(store.favoritesError).toBe(false);
    expect(ids(store.favoriteStories)).toEqual(['f-1']);
    // The rows stay; only the snackbar tells the next page failed.
    expect(showToast.error).toHaveBeenCalledTimes(1);
  });

  it('keeps the total the backend counts, and follows saves and unsaves', async () => {
    mockToggleFavorite.mockReset().mockResolvedValue(undefined);
    const store = new StoryStore();
    mockGetFavoriteStories.mockResolvedValueOnce({
      data: [story('f-1', true), story('f-2', true)],
      meta: { page: 1, limit: 20, total: 31, totalPages: 2 },
    });
    await store.loadFavorites();
    expect(store.favoritesTotal).toBe(31);

    await store.toggleFavorite('f-2');
    expect(store.favoritesTotal).toBe(30);

    store.stories = [story('s-9', false)];
    await store.toggleFavorite('s-9');
    expect(store.favoritesTotal).toBe(31);
  });

  it('asks for the saved tales in the content language', async () => {
    const store = new StoryStore();
    mockGetFavoriteStories.mockResolvedValue(page([], 1, 1));
    mockContentLanguage.effective = 'en';
    try {
      await store.loadFavorites();
    } finally {
      mockContentLanguage.effective = 'tr';
    }
    expect(mockGetFavoriteStories).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      grouped: true,
      prefer: 'en',
    });
  });

  it('drops a stale next page that lands after a reload', async () => {
    const store = new StoryStore();
    mockGetFavoriteStories.mockResolvedValueOnce(page([story('f-1', true)], 1, 3));
    await store.loadFavorites();

    const stale = deferred<PaginatedStories>();
    mockGetFavoriteStories.mockReturnValueOnce(stale.promise);
    const more = store.loadMoreFavorites();
    mockGetFavoriteStories.mockResolvedValueOnce(page([story('f-9', true)], 1, 3));
    await store.loadFavorites();
    stale.resolve(page([story('f-2', true)], 2, 3));
    await more;

    expect(ids(store.favoriteStories)).toEqual(['f-9']);
    expect(store.favoritesPage).toBe(1);
    expect(store.isLoadingMoreFavorites).toBe(false);
  });
});

// ============================================================================
// Favorite toggle: favorites-list edge cases
// ============================================================================

describe('StoryStore.toggleFavorite favorites-list edge cases', () => {
  beforeEach(() => {
    mockToggleFavorite.mockReset();
    silenceConsole();
  });

  it('adding a story found only on a shelf puts it on top of favorites', async () => {
    mockToggleFavorite.mockResolvedValue(undefined);
    mockGetStories.mockReset().mockResolvedValue(page([story('s-4', false)], 1, 1));
    const store = new StoryStore();
    await store.loadCategoryShelves(['BEDTIME']);
    store.favoriteStories = [story('f-1', true)];

    await store.toggleFavorite('s-4');

    expect(mockToggleFavorite).toHaveBeenCalledWith('s-4', true);
    expect(ids(store.favoriteStories)).toEqual(['s-4', 'f-1']);
    expect(store.favoriteStories[0].isFavorite).toBe(true);
  });

  it('adding the open detail stores a list-shaped copy (no chunks) in favorites', async () => {
    mockToggleFavorite.mockResolvedValue(undefined);
    const store = new StoryStore();
    store.currentStory = detail('s-5', false);

    await store.toggleFavorite('s-5');

    expect(ids(store.favoriteStories)).toEqual(['s-5']);
    const copy = store.favoriteStories[0] as unknown as Record<string, unknown>;
    expect(copy.isFavorite).toBe(true);
    expect(copy).not.toHaveProperty('chunks');
    expect(copy).not.toHaveProperty('userProgress');
  });

  it('does not add a duplicate when the story is already in favorites', async () => {
    mockToggleFavorite.mockResolvedValue(undefined);
    const store = new StoryStore();
    // Out-of-sync list flag: favorites says yes, list copy says no.
    store.stories = [story('s-1', false)];
    store.favoriteStories = [story('s-1', true)];

    await store.toggleFavorite('s-1');

    expect(mockToggleFavorite).toHaveBeenCalledWith('s-1', true);
    expect(ids(store.favoriteStories)).toEqual(['s-1']);
  });

  it('removing a story that only lives in the favorites list sends "remove" and drops it', async () => {
    mockToggleFavorite.mockResolvedValue(undefined);
    const store = new StoryStore();
    store.favoriteStories = [story('f-1', true), story('f-2', true)];

    expect(store.getFavoriteState('f-2')).toBe(true);
    await store.toggleFavorite('f-2');

    expect(mockToggleFavorite).toHaveBeenCalledWith('f-2', false);
    expect(ids(store.favoriteStories)).toEqual(['f-1']);
    expect(store.getFavoriteState('f-2')).toBe(false);
  });

  it('restores a failed removal at its original favorites position', async () => {
    mockToggleFavorite.mockRejectedValue(apiErrorFromResponse(undefined, null));
    const store = new StoryStore();
    store.favoriteStories = [story('f-1', true), story('f-2', true), story('f-3', true)];

    await store.toggleFavorite('f-2');

    expect(ids(store.favoriteStories)).toEqual(['f-1', 'f-2', 'f-3']);
    expect(showToast.error).toHaveBeenCalledWith('İnternet bağlantısı kurulamadı');
  });

  it('takes a failed addition back out of favorites and unflags every copy', async () => {
    mockToggleFavorite.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = new StoryStore();
    store.stories = [story('s-1', false)];
    store.favoriteStories = [story('f-1', true)];

    await store.toggleFavorite('s-1');

    expect(ids(store.favoriteStories)).toEqual(['f-1']);
    expect(store.stories[0].isFavorite).toBe(false);
    expect(showToast.error).toHaveBeenCalledTimes(1);
  });

  it('never invents a favorites entry for a story it has no copy of', async () => {
    mockToggleFavorite.mockResolvedValue(undefined);
    const store = new StoryStore();

    await store.toggleFavorite('ghost');

    expect(mockToggleFavorite).toHaveBeenCalledWith('ghost', true);
    expect(store.favoriteStories).toEqual([]);
  });
});

// ============================================================================
// Favorite toggle: taps in a row (ui-19)
// ============================================================================

describe('StoryStore.toggleFavorite serialised per story', () => {
  beforeEach(() => {
    mockToggleFavorite.mockReset();
    silenceConsole();
  });

  /** Every StoryService.toggleFavorite call waits until the test settles it. */
  function controlledRequests() {
    const calls: { id: string; saved: boolean; settle: ReturnType<typeof deferred<void>> }[] = [];
    mockToggleFavorite.mockImplementation((id: string, saved: boolean) => {
      const settle = deferred<void>();
      calls.push({ id, saved, settle });
      return settle.promise;
    });
    return calls;
  }

  it('two quick taps send save, then unsave once the save settled, never in parallel', async () => {
    const calls = controlledRequests();
    const store = new StoryStore();
    store.stories = [story('s-1', false)];

    const first = store.toggleFavorite('s-1');
    const second = store.toggleFavorite('s-1');
    // The second tap flips the copies at once but sends nothing yet.
    expect(store.stories[0].isFavorite).toBe(false);
    expect(calls.map(c => [c.id, c.saved])).toEqual([['s-1', true]]);

    calls[0].settle.resolve();
    await flushMicrotasks();
    expect(calls.map(c => [c.id, c.saved])).toEqual([
      ['s-1', true],
      ['s-1', false],
    ]);
    calls[1].settle.resolve();

    await expect(first).resolves.toBe('superseded');
    await expect(second).resolves.toBe('done');
    expect(store.stories[0].isFavorite).toBe(false);
    expect(store.favoriteStories).toEqual([]);
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('three quick taps cost one request: the server already has the last wish', async () => {
    const calls = controlledRequests();
    const store = new StoryStore();
    store.stories = [story('s-1', false)];

    const taps = [store.toggleFavorite('s-1'), store.toggleFavorite('s-1'), store.toggleFavorite('s-1')];
    calls[0].settle.resolve();

    await expect(Promise.all(taps)).resolves.toEqual(['superseded', 'superseded', 'done']);
    expect(calls).toHaveLength(1);
    expect(store.stories[0].isFavorite).toBe(true);
    expect(ids(store.favoriteStories)).toEqual(['s-1']);
  });

  it('rolls back to the server state when the last request fails', async () => {
    const calls = controlledRequests();
    const store = new StoryStore();
    store.stories = [story('s-1', false)];

    const first = store.toggleFavorite('s-1');
    const second = store.toggleFavorite('s-1');
    calls[0].settle.resolve();
    await flushMicrotasks();
    calls[1].settle.reject(apiErrorFromResponse(500, {}));

    await expect(second).resolves.toBe('failed');
    await expect(first).resolves.toBe('superseded');
    // The save went through, the unsave did not: saved, as on the server.
    expect(store.stories[0].isFavorite).toBe(true);
    expect(ids(store.favoriteStories)).toEqual(['s-1']);
    expect(showToast.error).toHaveBeenCalledTimes(1);
  });

  it('a failed request is forgiven when a later tap asked for the server state again', async () => {
    const calls = controlledRequests();
    const store = new StoryStore();
    store.stories = [story('s-1', false)];

    const first = store.toggleFavorite('s-1');
    const second = store.toggleFavorite('s-1');
    calls[0].settle.reject(apiErrorFromResponse(500, {}));

    await expect(second).resolves.toBe('done');
    await expect(first).resolves.toBe('superseded');
    expect(calls).toHaveLength(1);
    expect(store.stories[0].isFavorite).toBe(false);
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('quiet leaves the error message to the caller', async () => {
    mockToggleFavorite.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = new StoryStore();
    store.stories = [story('s-1', false)];

    await expect(store.toggleFavorite('s-1', { quiet: true })).resolves.toBe('failed');
    expect(store.stories[0].isFavorite).toBe(false);
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('getFavoriteState answers the wanted state while a request runs', async () => {
    const calls = controlledRequests();
    const store = new StoryStore();
    // No copy at all: only the wanted state knows the story is being saved.
    const tap = store.toggleFavorite('ghost');
    expect(store.getFavoriteState('ghost')).toBe(true);
    calls[0].settle.resolve();
    await tap;
    expect(calls.map(c => c.saved)).toEqual([true]);
  });

  it('a detail that loads while a save runs shows the wanted state', async () => {
    const calls = controlledRequests();
    mockGetStoryById.mockReset().mockResolvedValue(detail('s-1', false));
    const store = new StoryStore();
    store.stories = [story('s-1', false)];

    const tap = store.toggleFavorite('s-1');
    await store.getStoryDetail('s-1');
    expect(store.currentStory?.isFavorite).toBe(true);

    calls[0].settle.resolve();
    await tap;
  });

  it('unsaving during a burst removes every saved version seen', async () => {
    const calls = controlledRequests();
    const store = new StoryStore();
    store.favoriteStories = [{ ...story('tr', true), favoriteStoryIds: ['tr', 'en'] }];

    const tap = store.toggleFavorite('tr');
    expect(calls.map(c => [c.id, c.saved])).toEqual([
      ['tr', false],
      ['en', false],
    ]);
    calls.forEach(c => c.settle.resolve());
    await expect(tap).resolves.toBe('done');
    expect(store.favoriteStories).toEqual([]);
  });
});

// ============================================================================
// Undo an unsave (lib-5)
// ============================================================================

describe('StoryStore.restoreFavorite', () => {
  beforeEach(() => {
    mockToggleFavorite.mockReset().mockResolvedValue(undefined);
    silenceConsole();
  });

  it('puts the row back at its old index and saves every version again', async () => {
    const store = new StoryStore();
    const saved = { ...story('tr', true), isFavoriteAnyLanguage: true, favoriteStoryIds: ['tr', 'en'] };
    store.favoriteStories = [story('f-1', true), saved, story('f-3', true)];

    await store.toggleFavorite('tr');
    expect(ids(store.favoriteStories)).toEqual(['f-1', 'f-3']);
    mockToggleFavorite.mockClear();

    await expect(store.restoreFavorite(saved, 1)).resolves.toBe('done');

    expect(ids(store.favoriteStories)).toEqual(['f-1', 'tr', 'f-3']);
    expect(mockToggleFavorite.mock.calls).toEqual([
      ['tr', true],
      ['en', true],
    ]);
    expect(store.getFavoriteState('tr')).toBe(true);
  });

  it('restores a story that is in no other list, and clamps the index', async () => {
    const store = new StoryStore();
    const only = story('lonely', true);

    await store.restoreFavorite(only, 5);

    expect(ids(store.favoriteStories)).toEqual(['lonely']);
    expect(mockToggleFavorite).toHaveBeenCalledWith('lonely', true);
  });

  it('takes the row out again and says so when the save fails', async () => {
    mockToggleFavorite.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = new StoryStore();
    store.favoriteStories = [story('f-1', true)];

    await expect(store.restoreFavorite(story('s-2', true), 0)).resolves.toBe('failed');

    expect(ids(store.favoriteStories)).toEqual(['f-1']);
    expect(showToast.error).toHaveBeenCalledTimes(1);
  });

  it('an undo while the unsave is still running saves once the unsave settled', async () => {
    const settles: ReturnType<typeof deferred<void>>[] = [];
    mockToggleFavorite.mockImplementation(() => {
      const settle = deferred<void>();
      settles.push(settle);
      return settle.promise;
    });
    const store = new StoryStore();
    const saved = story('s-1', true);
    store.favoriteStories = [saved];

    const unsave = store.toggleFavorite('s-1');
    const undo = store.restoreFavorite(saved, 0);
    expect(mockToggleFavorite.mock.calls).toEqual([['s-1', false]]);
    settles[0].resolve();
    await flushMicrotasks();
    expect(mockToggleFavorite.mock.calls).toEqual([
      ['s-1', false],
      ['s-1', true],
    ]);
    settles[1].resolve();

    await expect(undo).resolves.toBe('done');
    await expect(unsave).resolves.toBe('superseded');
    expect(ids(store.favoriteStories)).toEqual(['s-1']);
  });
});

// ============================================================================
// Favourite change log (perf-15)
// ============================================================================

describe('StoryStore favoriteChanges', () => {
  beforeEach(() => {
    mockToggleFavorite.mockReset().mockResolvedValue(undefined);
    silenceConsole();
  });

  it('records the version, the tale and the saved state of every change', async () => {
    const store = new StoryStore();
    store.stories = [{ ...story('s-1', false), translationGroupId: 'g-1' }];

    await store.toggleFavorite('s-1');
    await store.toggleFavorite('s-1');

    expect(store.favoritesVersion).toBe(2);
    expect(store.favoriteChanges).toEqual([
      { version: 1, story: { id: 's-1', translationGroupId: 'g-1' }, saved: true },
      { version: 2, story: { id: 's-1', translationGroupId: 'g-1' }, saved: false },
    ]);
  });

  it('records the rollback of a failed request too', async () => {
    mockToggleFavorite.mockRejectedValue(apiErrorFromResponse(500, {}));
    const store = new StoryStore();
    store.stories = [story('s-1', false)];

    await store.toggleFavorite('s-1');

    expect(store.favoriteChanges.map(c => [c.version, c.saved])).toEqual([
      [1, true],
      [2, false],
    ]);
  });

  it(`keeps the last ${FAVORITE_CHANGES_KEPT} changes`, () => {
    const store = new StoryStore();
    for (let i = 0; i < FAVORITE_CHANGES_KEPT + 5; i += 1) {
      store.recordFavoriteChange({ id: `s-${i}`, translationGroupId: null }, true);
    }
    expect(store.favoriteChanges).toHaveLength(FAVORITE_CHANGES_KEPT);
    expect(store.favoriteChanges[0].version).toBe(6);
    expect(store.favoritesVersion).toBe(FAVORITE_CHANGES_KEPT + 5);
  });
});

// ============================================================================
// Narrations of one story (perf-13)
// ============================================================================

describe('StoryStore.loadNarrationsForStory', () => {
  beforeEach(() => {
    mockGetNarrationsByStory.mockReset();
    silenceConsole();
  });

  it('stores every narration of the story and fills in a missing storyId', async () => {
    const store = new StoryStore();
    mockGetNarrationsByStory.mockResolvedValue([narration('n-1', ''), narration('n-2', 's-1')]);

    await store.loadNarrationsForStory('s-1');

    expect(mockGetNarrationsByStory).toHaveBeenCalledWith('s-1');
    expect(store.narrationsByStory.get('s-1')?.map(n => [n.id, n.storyId])).toEqual([
      ['n-1', 's-1'],
      ['n-2', 's-1'],
    ]);
    expect(ids(store.getNarrationsForStory('s-1'))).toEqual(['n-1', 'n-2']);
  });

  it('drops an older answer that lands after a newer one', async () => {
    const store = new StoryStore();
    const older = deferred<StoryNarration[]>();
    mockGetNarrationsByStory
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce([narration('n-new', 's-1')]);

    const first = store.loadNarrationsForStory('s-1');
    await store.loadNarrationsForStory('s-1');
    older.resolve([narration('n-old', 's-1')]);
    await first;

    expect(ids(store.narrationsByStory.get('s-1') ?? [])).toEqual(['n-new']);
  });

  it('keeps the list it had when a reload fails, and never throws', async () => {
    const store = new StoryStore();
    mockGetNarrationsByStory.mockResolvedValueOnce([narration('n-1', 's-1')]);
    await store.loadNarrationsForStory('s-1');

    mockGetNarrationsByStory.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await expect(store.loadNarrationsForStory('s-1')).resolves.toBeUndefined();
    expect(ids(store.narrationsByStory.get('s-1') ?? [])).toEqual(['n-1']);
  });

  it('knows the narrations of a story only once its own list arrived (V3-04)', async () => {
    const store = new StoryStore();
    const answer = deferred<StoryNarration[]>();
    mockGetNarrationsByStory.mockReturnValueOnce(answer.promise);
    // A narration of the newest page alone does not make the list known.
    store.userNarrations = [narration('n-1', 's-1')];
    expect(store.narrationsKnownFor('s-1')).toBe(false);

    const load = store.loadNarrationsForStory('s-1');
    expect(store.narrationsKnownFor('s-1')).toBe(false);
    answer.resolve([]);
    await load;
    // An empty list is an answer too.
    expect(store.narrationsKnownFor('s-1')).toBe(true);
    expect(store.narrationsKnownFor('s-2')).toBe(false);
  });

  it('a failed request still makes the story known, so a page never waits on it; a later answer replaces it', async () => {
    const store = new StoryStore();
    mockGetNarrationsByStory.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadNarrationsForStory('s-1');
    expect(store.narrationsKnownFor('s-1')).toBe(true);
    expect(store.narrationsFailedFor.has('s-1')).toBe(true);
    expect(store.narrationsByStory.has('s-1')).toBe(false);

    mockGetNarrationsByStory.mockResolvedValueOnce([narration('n-1', 's-1')]);
    await store.loadNarrationsForStory('s-1');
    expect(store.narrationsFailedFor.has('s-1')).toBe(false);
    expect(ids(store.getNarrationsForStory('s-1'))).toEqual(['n-1']);

    // A failed reload keeps the list: nothing is marked failed.
    mockGetNarrationsByStory.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadNarrationsForStory('s-1');
    expect(store.narrationsFailedFor.has('s-1')).toBe(false);
    expect(store.narrationsKnownFor('s-1')).toBe(true);
  });

  it('an older failure that lands after a newer request, or a failure after a reset, marks nothing', async () => {
    const store = new StoryStore();
    const older = deferred<StoryNarration[]>();
    const newer = deferred<StoryNarration[]>();
    mockGetNarrationsByStory.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first = store.loadNarrationsForStory('s-1');
    const second = store.loadNarrationsForStory('s-1');
    // The older request fails while the newer one is still out.
    older.reject(apiErrorFromResponse(500, {}));
    await first;
    expect(store.narrationsKnownFor('s-1')).toBe(false);
    newer.resolve([narration('n-1', 's-1')]);
    await second;
    expect(store.narrationsKnownFor('s-1')).toBe(true);

    // The account left while the request was out: its failure is not the next account's.
    const late = deferred<StoryNarration[]>();
    mockGetNarrationsByStory.mockReturnValueOnce(late.promise);
    const load = store.loadNarrationsForStory('s-2');
    store.reset();
    late.reject(apiErrorFromResponse(500, {}));
    await load;
    expect(store.narrationsKnownFor('s-2')).toBe(false);
    expect(store.narrationsKnownFor('s-1')).toBe(false);
  });

  it('reset forgets which stories failed', async () => {
    const store = new StoryStore();
    mockGetNarrationsByStory.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.loadNarrationsForStory('s-1');
    expect(store.narrationsKnownFor('s-1')).toBe(true);
    store.reset();
    expect(store.narrationsKnownFor('s-1')).toBe(false);
    expect(store.narrationsFailedFor.size).toBe(0);
  });

  it('getNarrationsForStory falls back to the newest page before the story list arrived', () => {
    const store = new StoryStore();
    store.userNarrations = [narration('n-1', 's-1'), narration('n-2', 's-2')];
    expect(ids(store.getNarrationsForStory('s-1'))).toEqual(['n-1']);
  });

  it('a refreshed page of the user narrations updates the story lists it touches', async () => {
    const store = new StoryStore();
    const generating = { ...narration('n-1', 's-1'), status: NarrationStatus.GENERATING };
    mockGetNarrationsByStory.mockResolvedValueOnce([generating, narration('n-0', 's-1')]);
    await store.loadNarrationsForStory('s-1');

    // A push says n-1 is ready (the page is refreshed), and n-2 was made of s-1 meanwhile.
    mockGetMyNarrations.mockResolvedValueOnce(
      narrationPage([narration('n-2', 's-1'), narration('n-1', 's-1'), narration('n-9', 's-9')], 1, 1),
    );
    await store.loadUserNarrations();

    const list = store.getNarrationsForStory('s-1');
    expect(ids(list)).toEqual(['n-2', 'n-1', 'n-0']);
    expect(list[1].status).toBe(NarrationStatus.READY);
    // A story with no list of its own is left to the page.
    expect(store.narrationsByStory.has('s-9')).toBe(false);
  });
});

// ============================================================================
// Home category shelves (ui-21)
// ============================================================================

describe('StoryStore.loadCategoryShelves', () => {
  beforeEach(() => {
    mockGetStories.mockReset();
    silenceConsole();
  });

  const byCategory = (impl: Record<string, () => Promise<PaginatedStories>>) =>
    mockGetStories.mockImplementation(({ category }: { category: string }) => impl[category]());

  it('asks for every category on its own, flat, in the content language only', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValue(page([], 1, 1));
    mockContentLanguage.effective = 'en';
    try {
      await store.loadCategoryShelves(['BEDTIME', 'EDUCATIONAL']);
    } finally {
      mockContentLanguage.effective = 'tr';
    }

    expect(mockGetStories.mock.calls.map(call => call[0])).toEqual([
      { page: 1, limit: CATEGORY_SHELF_LIMIT, category: 'BEDTIME', language: 'en' },
      { page: 1, limit: CATEGORY_SHELF_LIMIT, category: 'EDUCATIONAL', language: 'en' },
    ]);
    expect(store.hasLoadedShelves).toBe(true);
  });

  it('keeps the fulfilled shelves when one category fails', async () => {
    const store = new StoryStore();
    byCategory({
      BEDTIME: () => Promise.resolve(page([story('b-1', false), story('b-2', false)], 1, 1)),
      EDUCATIONAL: () => Promise.reject(apiErrorFromResponse(500, {})),
      WORLD_CLASSICS: () => Promise.resolve(page([], 1, 0)),
    });

    const pending = store.loadCategoryShelves(['BEDTIME', 'EDUCATIONAL', 'WORLD_CLASSICS']);
    expect(store.isLoadingShelves).toBe(true);
    await pending;

    expect(ids(store.shelfByCategory.get('BEDTIME') ?? [])).toEqual(['b-1', 'b-2']);
    expect(store.shelfByCategory.has('EDUCATIONAL')).toBe(false);
    expect(store.shelfByCategory.get('WORLD_CLASSICS')).toEqual([]);
    expect(store.shelvesErrorKind).toBeNull();
    expect(store.isLoadingShelves).toBe(false);
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('a failed refresh keeps the shelf the category had; every category failing sets the kind', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValue(page([story('b-1', false)], 1, 1));
    await store.loadCategoryShelves(['BEDTIME']);

    mockGetStories.mockRejectedValue(apiErrorFromResponse(undefined, null));
    await store.refreshCategoryShelves();

    expect(ids(store.shelfByCategory.get('BEDTIME') ?? [])).toEqual(['b-1']);
    expect(store.shelvesErrorKind).toBe('offline');
    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'BEDTIME' }));
  });

  it('drops the answers of an older round', async () => {
    const store = new StoryStore();
    const slow = deferred<PaginatedStories>();
    mockGetStories
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(page([story('fresh', false)], 1, 1));

    const first = store.loadCategoryShelves(['BEDTIME']);
    await store.loadCategoryShelves(['BEDTIME']);
    slow.resolve(page([story('stale', false)], 1, 1));
    await first;

    expect(ids(store.shelfByCategory.get('BEDTIME') ?? [])).toEqual(['fresh']);
  });

  it('refreshCategoryShelves does nothing before a first load', async () => {
    const store = new StoryStore();
    await store.refreshCategoryShelves();
    expect(mockGetStories).not.toHaveBeenCalled();
  });

  it('a save patches the shelves too', async () => {
    mockToggleFavorite.mockReset().mockResolvedValue(undefined);
    const store = new StoryStore();
    mockGetStories.mockResolvedValue(page([story('b-1', false)], 1, 1));
    await store.loadCategoryShelves(['BEDTIME']);

    await store.toggleFavorite('b-1');

    expect(store.shelfByCategory.get('BEDTIME')?.[0].isFavorite).toBe(true);
    expect(ids(store.favoriteStories)).toEqual(['b-1']);
  });

  it('a saved story that is only on a shelf is unsaved, not saved again', async () => {
    mockToggleFavorite.mockReset().mockResolvedValue(undefined);
    const store = new StoryStore();
    // Saved, but beyond the first page of the saved list (not loaded).
    mockGetStories.mockResolvedValue(page([story('b-1', true)], 1, 1));
    await store.loadCategoryShelves(['BEDTIME']);

    expect(store.getFavoriteState('b-1')).toBe(true);
    await store.toggleFavorite('b-1');

    expect(mockToggleFavorite).toHaveBeenCalledWith('b-1', false);
    expect(store.shelfByCategory.get('BEDTIME')?.[0].isFavorite).toBe(false);
  });

  it('a refresh asks with the limit of the first load', async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValue(page([], 1, 1));
    await store.loadCategoryShelves(['BEDTIME'], { limit: 6 });
    await store.refreshCategoryShelves();

    expect(mockGetStories).toHaveBeenCalledTimes(2);
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ category: 'BEDTIME', limit: 6 }),
    );
  });
});

// ============================================================================
// User narrations (Library tab)
// ============================================================================

describe('StoryStore user narrations', () => {
  beforeEach(() => {
    mockGetMyNarrations.mockReset();
    silenceConsole();
  });

  it('first page replaces and remembers the search term, loadMore carries it', async () => {
    const store = new StoryStore();
    store.userNarrations = [narration('old', 's-0')];
    mockGetMyNarrations.mockResolvedValueOnce(narrationPage([narration('n-1', 's-1')], 1, 2));

    await store.loadUserNarrations(1, 'ayı');
    expect(mockGetMyNarrations).toHaveBeenCalledWith({ page: 1, limit: 20, search: 'ayı' });
    expect(ids(store.userNarrations)).toEqual(['n-1']);
    expect(store.narrationsSearch).toBe('ayı');
    expect(store.hasMoreNarrations).toBe(true);
    expect(store.isLoadingNarrations).toBe(false);

    mockGetMyNarrations.mockResolvedValueOnce(narrationPage([narration('n-2', 's-2')], 2, 2));
    await store.loadMoreNarrations();
    expect(mockGetMyNarrations).toHaveBeenLastCalledWith({ page: 2, limit: 20, search: 'ayı' });
    expect(ids(store.userNarrations)).toEqual(['n-1', 'n-2']);
    expect(store.narrationsPage).toBe(2);
    expect(store.narrationsTotalPages).toBe(2);
    expect(store.hasMoreNarrations).toBe(false);

    await store.loadMoreNarrations();
    expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
  });

  it('ignores loadMoreNarrations while a page is loading', async () => {
    const store = new StoryStore();
    mockGetMyNarrations.mockResolvedValueOnce(narrationPage([narration('n-1', 's-1')], 1, 3));
    await store.loadUserNarrations();

    const pending = deferred<ReturnType<typeof narrationPage>>();
    mockGetMyNarrations.mockReturnValueOnce(pending.promise);
    const first = store.loadMoreNarrations();
    const second = store.loadMoreNarrations();
    expect(store.isLoadingMoreNarrations).toBe(true);
    pending.resolve(narrationPage([narration('n-2', 's-2')], 2, 3));
    await Promise.all([first, second]);

    expect(mockGetMyNarrations).toHaveBeenCalledTimes(2);
    expect(store.isLoadingMoreNarrations).toBe(false);
  });

  it('keeps the list and resets the loading flags when loading fails (no toast)', async () => {
    const store = new StoryStore();
    store.userNarrations = [narration('n-1', 's-1')];
    mockGetMyNarrations.mockRejectedValue(apiErrorFromResponse(500, {}));

    await store.loadUserNarrations();

    expect(ids(store.userNarrations)).toEqual(['n-1']);
    expect(store.isLoadingNarrations).toBe(false);
    expect(store.isLoadingMoreNarrations).toBe(false);
    expect(showToast.error).not.toHaveBeenCalled();
  });

  it('getNarrationsForStory filters by story id', () => {
    const store = new StoryStore();
    store.userNarrations = [
      narration('n-1', 's-1'),
      narration('n-2', 's-2'),
      narration('n-3', 's-1'),
    ];

    expect(ids(store.getNarrationsForStory('s-1'))).toEqual(['n-1', 'n-3']);
    expect(store.getNarrationsForStory('s-9')).toEqual([]);
  });

  // Regression (fixed 2026-09-28, was BUG): src/hooks/useStory.ts:82-91 - page-1 responses are applied without
  // checking that they still match `narrationsSearch`. The Library search is
  // debounced (400 ms) but not cancelled, so when the request for an older
  // term resolves after the newer one, the list shows the older term's
  // results while the search box (and narrationsSearch) holds the newer term.
  it('ignores a slower response for an outdated search term', async () => {
    const store = new StoryStore();
    const older = deferred<ReturnType<typeof narrationPage>>();
    mockGetMyNarrations.mockReturnValueOnce(older.promise);
    const first = store.loadUserNarrations(1, 'ay');

    mockGetMyNarrations.mockResolvedValueOnce(narrationPage([narration('n-ayi', 's-1')], 1, 1));
    await store.loadUserNarrations(1, 'ayı');

    older.resolve(narrationPage([narration('n-ay', 's-2'), narration('n-ayna', 's-3')], 1, 1));
    await first;

    expect(store.narrationsSearch).toBe('ayı');
    expect(ids(store.userNarrations)).toEqual(['n-ayi']);
  });
});

// ============================================================================
// Session end
// ============================================================================

describe('StoryStore.reset', () => {
  beforeEach(() => {
    mockToggleFavorite.mockReset();
    mockGetStories.mockReset();
    mockGetStoryById.mockReset();
    mockGetFavoriteStories.mockReset();
    mockGetMyNarrations.mockReset();
    mockGetNarrationsByStory.mockReset();
    silenceConsole();
  });

  const narration = (id: string, storyId: string) =>
    ({ id, storyId, status: NarrationStatus.READY }) as unknown as StoryNarration;

  it("empties every list, saved mark, narration, shelf and cached detail of the account", async () => {
    const store = new StoryStore();
    mockGetStories.mockResolvedValue(page([story('s-1', true)], 1, 3));
    mockGetFavoriteStories.mockResolvedValue({ ...page([story('f-1', true)], 1, 2), meta: { page: 1, limit: 20, total: 7, totalPages: 2 } });
    mockGetMyNarrations.mockResolvedValue(page([narration('n-1', 's-1')] as never, 1, 2));
    mockGetNarrationsByStory.mockResolvedValue([narration('n-1', 's-1')]);
    mockGetStoryById.mockResolvedValue(detail('s-1', true));
    await store.loadStories();
    await store.loadFavorites();
    await store.loadUserNarrations();
    await store.loadNarrationsForStory('s-1');
    await store.loadCategoryShelves(['BEDTIME']);
    await store.getStoryDetail('s-1');
    mockToggleFavorite.mockResolvedValue(undefined);
    await store.toggleFavorite('s-1');
    const versionBefore = store.favoritesVersion;
    expect(store.favoriteChanges.length).toBeGreaterThan(0);

    store.reset();

    expect(store.stories).toEqual([]);
    expect(store.hasMore).toBe(true);
    expect(store.favoriteStories).toEqual([]);
    expect(store.favoritesTotal).toBe(0);
    expect(store.hasMoreFavorites).toBe(true);
    expect(store.userNarrations).toEqual([]);
    expect(store.narrationsByStory.size).toBe(0);
    expect(store.getNarrationsForStory('s-1')).toEqual([]);
    expect(store.shelfByCategory.size).toBe(0);
    expect(store.hasLoadedShelves).toBe(false);
    expect(store.currentStory).toBeNull();
    expect(store.cachedDetail('s-1')).toBeNull();
    expect(store.peekStory('s-1')).toBeNull();
    expect(store.getFavoriteState('s-1')).toBe(false);
    expect(store.favoriteChanges).toEqual([]);
    // Lists that remember a version still see later changes as new.
    expect(store.favoritesVersion).toBe(versionBefore);
  });

  it("answers of the first account that land after the reset are dropped", async () => {
    const store = new StoryStore();
    const stories = deferred<PaginatedStories>();
    const favorites = deferred<PaginatedStories>();
    const narrations = deferred<unknown>();
    const byStory = deferred<StoryNarration[]>();
    const shelf = deferred<PaginatedStories>();
    const storyDetail = deferred<StoryDetail>();
    mockGetStories.mockReturnValueOnce(stories.promise).mockReturnValueOnce(shelf.promise);
    mockGetFavoriteStories.mockReturnValue(favorites.promise);
    mockGetMyNarrations.mockReturnValue(narrations.promise);
    mockGetNarrationsByStory.mockReturnValue(byStory.promise);
    mockGetStoryById.mockReturnValue(storyDetail.promise);

    const loads = [
      store.loadStories(),
      store.loadFavorites(),
      store.loadUserNarrations(),
      store.loadNarrationsForStory('s-1'),
      store.loadCategoryShelves(['BEDTIME']),
      store.getStoryDetail('s-1'),
    ];
    store.reset();

    stories.resolve(page([story('s-1', true)], 1, 1));
    favorites.resolve(page([story('f-1', true)], 1, 1));
    narrations.resolve(page([narration('n-old', 's-1')] as never, 1, 1));
    byStory.resolve([narration('n-old', 's-1')]);
    shelf.resolve(page([story('shelf-1', true)], 1, 1));
    storyDetail.resolve(detail('s-1', true));
    await Promise.all(loads);

    expect(store.stories).toEqual([]);
    expect(store.favoriteStories).toEqual([]);
    expect(store.userNarrations).toEqual([]);
    expect(store.getNarrationsForStory('s-1')).toEqual([]);
    expect(store.shelfByCategory.size).toBe(0);
    expect(store.currentStory).toBeNull();
    expect(store.cachedDetail('s-1')).toBeNull();
    expect(store.getFavoriteState('s-1')).toBe(false);

    // The second account opens the same story's narrations: its own answer lands.
    mockGetNarrationsByStory.mockResolvedValue([narration('n-new', 's-1')]);
    await store.loadNarrationsForStory('s-1');
    expect(store.getNarrationsForStory('s-1').map(n => n.id)).toEqual(['n-new']);
  });

  it('a save still being sent for the first account neither rolls back nor reaches the second', async () => {
    const store = new StoryStore();
    store.stories = [story('s-1', false)];
    const request = deferred<undefined>();
    mockToggleFavorite.mockReturnValue(request.promise);

    const tap = store.toggleFavorite('s-1');
    expect(store.getFavoriteState('s-1')).toBe(true);
    store.reset();

    // The second account saves the same story while the first request runs.
    const secondRequest = deferred<undefined>();
    mockToggleFavorite.mockReturnValue(secondRequest.promise);
    store.stories = [story('s-1', false)];
    const secondTap = store.toggleFavorite('s-1');

    request.reject(apiErrorFromResponse(500, {}));
    await expect(tap).resolves.toBe('superseded');
    // No rollback and no message from the first account's failure.
    expect(store.getFavoriteState('s-1')).toBe(true);
    expect(showToast.error).not.toHaveBeenCalled();

    secondRequest.resolve(undefined);
    await expect(secondTap).resolves.toBe('done');
    expect(store.getFavoriteState('s-1')).toBe(true);
    expect(mockToggleFavorite).toHaveBeenCalledTimes(2);
  });
});

// ============================================================================
// Hook singleton
// ============================================================================

describe('useStory singleton', () => {
  it('creates the store once and exposes it through getStoryStore', () => {
    expect(getStoryStore()).toBeNull();

    const first = renderHook(() => useStory());
    const second = renderHook(() => useStory());

    expect(first.result.current).toBeInstanceOf(StoryStore);
    expect(second.result.current).toBe(first.result.current);
    expect(getStoryStore()).toBe(first.result.current);
  });

  it('the singleton resets when the session ends and when another account signs in', async () => {
    const { result } = renderHook(() => useStory());
    const store = result.current;

    // Sign-out and session expiry run the end handlers before the user goes.
    store.stories = [story('a-1', true)];
    store.favoriteStories = [story('a-1', true)];
    await runSessionEndHandlers();
    expect(store.stories).toEqual([]);
    expect(store.favoriteStories).toEqual([]);

    // A user arriving (a sign-in, the cached user at launch) keeps what loaded.
    store.stories = [story('a-2', true)];
    setSessionUserId('u-a');
    expect(ids(store.stories)).toEqual(['a-2']);

    // Another account without a sign-out in between: B starts empty.
    setSessionUserId('u-b');
    expect(store.stories).toEqual([]);
    expect(store.getFavoriteState('a-2')).toBe(false);

    // The same account again (the live answer for a cached user) keeps its data.
    store.stories = [story('b-1', true)];
    setSessionUserId('u-b');
    expect(ids(store.stories)).toEqual(['b-1']);
    setSessionUserId(null);
    expect(store.stories).toEqual([]);
  });
});

describe('content language change', () => {
  it('fetches again, in the new language, only the lists that were asked for', async () => {
    const fresh = new StoryStore();
    fresh.contentLanguageChanged();
    expect(mockGetStories).not.toHaveBeenCalled();
    expect(mockGetFavoriteStories).not.toHaveBeenCalled();

    const store = new StoryStore();
    mockGetStories.mockResolvedValue(page([], 1, 1));
    mockGetFavoriteStories.mockResolvedValue(page([], 1, 1));
    await store.loadStories();
    await store.loadFavorites();
    await store.loadCategoryShelves(['BEDTIME']);
    mockGetStories.mockClear();
    mockGetFavoriteStories.mockClear();

    mockContentLanguage.effective = 'en';
    try {
      // Every request leaves at once, in the language of that moment.
      store.contentLanguageChanged();
    } finally {
      mockContentLanguage.effective = 'tr';
    }
    expect(mockGetStories.mock.calls.map(call => call[0])).toEqual([
      { page: 1, limit: 20, category: undefined, language: 'en' },
      { page: 1, limit: CATEGORY_SHELF_LIMIT, category: 'BEDTIME', language: 'en' },
    ]);
    expect(mockGetFavoriteStories).toHaveBeenCalledWith({ page: 1, limit: 20, grouped: true, prefer: 'en' });

    // After a sign-out nothing is asked for until a screen asks again.
    store.reset();
    mockGetStories.mockClear();
    mockGetFavoriteStories.mockClear();
    store.contentLanguageChanged();
    expect(mockGetStories).not.toHaveBeenCalled();
    expect(mockGetFavoriteStories).not.toHaveBeenCalled();
  });
});
