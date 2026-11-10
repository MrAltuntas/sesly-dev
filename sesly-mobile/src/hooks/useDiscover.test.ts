/**
 * Discover store: list scope (grouped or flat), search, filters, pagination,
 * stale answers, and saving a tale from a row.
 */

import { apiErrorFromResponse } from '../services/ApiError';

const mockGetStories = jest.fn();
const mockSearchStories = jest.fn();
const mockToggleFavorite = jest.fn();
const mockGetStoryById = jest.fn();
// The content language store: `effective` is the default Dil filter and the
// prefer of a grouped list.
const mockContentLanguage: { effective: string } = { effective: 'tr' };

jest.mock('./useContentLanguage', () => ({
  getContentLanguageStore: () => mockContentLanguage,
}));
jest.mock('../services/StoryService', () => ({
  __esModule: true,
  default: {
    getStories: (...args: unknown[]) => mockGetStories(...args),
    searchStories: (...args: unknown[]) => mockSearchStories(...args),
    toggleFavorite: (...args: unknown[]) => mockToggleFavorite(...args),
    getStoryById: (...args: unknown[]) => mockGetStoryById(...args),
  },
}));

import { DEFAULT_STORY_EXTRAS, Story } from '../models/Story';
import { AgeGroup, StoryCategory } from '../types/enums';
import type { StoryStore } from './useStory';
import { runInAction } from 'mobx';
import {
  DISCOVER_PAGE_SIZE,
  DiscoverStore,
  getDiscoverStore,
  patchSaved,
  toggleStorySaved,
} from './useDiscover';

const story = (id: string, patch: Partial<Story> = {}): Story => ({
  id,
  title: `Masal ${id}`,
  description: null,
  ageGroup: AgeGroup.THREE_TO_SIX,
  category: StoryCategory.WORLD_CLASSICS,
  estimatedDuration: 6,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: false,
  ...DEFAULT_STORY_EXTRAS,
  ...patch,
});

const pageOf = (data: Story[], page = 1, totalPages = 1, total = data.length) => ({
  data,
  meta: { page, limit: DISCOVER_PAGE_SIZE, total, totalPages },
});

interface FakeStoryStore {
  stories: Story[];
  favoriteStories: Story[];
  currentStory: { id: string } | null;
  getFavoriteState: jest.Mock;
  toggleFavorite: jest.Mock;
  loadFavorites: jest.Mock;
  refresh: jest.Mock;
  recordFavoriteChange: jest.Mock;
}

function fakeStoryStore(patch: Partial<FakeStoryStore> = {}): FakeStoryStore {
  return {
    stories: [],
    favoriteStories: [],
    currentStory: null,
    getFavoriteState: jest.fn(() => false),
    toggleFavorite: jest.fn(() => Promise.resolve()),
    loadFavorites: jest.fn(() => Promise.resolve()),
    refresh: jest.fn(() => Promise.resolve()),
    recordFavoriteChange: jest.fn(),
    ...patch,
  };
}

const asStore = (fake: FakeStoryStore) => fake as unknown as StoryStore;

/** A store on the whole catalogue (every language unpicked): one row per tale. */
function talesStore(): DiscoverStore {
  const store = new DiscoverStore();
  runInAction(() => {
    store.languagePicks = [];
  });
  return store;
}

beforeEach(() => {
  mockGetStories.mockReset().mockResolvedValue(pageOf([story('a'), story('b')]));
  mockSearchStories.mockReset().mockResolvedValue(pageOf([story('s')]));
  mockToggleFavorite.mockReset().mockResolvedValue(undefined);
  mockGetStoryById.mockReset();
  mockContentLanguage.effective = 'tr';
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('scope', () => {
  it('starts on the content language: flat, and not counted as a filter', async () => {
    const store = new DiscoverStore();
    await store.load();

    expect(mockGetStories).toHaveBeenCalledWith({
      page: 1,
      limit: DISCOVER_PAGE_SIZE,
      language: ['tr'],
      languageLevel: undefined,
      ageGroup: undefined,
      sort: undefined,
    });
    expect(store.items.map(item => item.id)).toEqual(['a', 'b']);
    expect(store.total).toBe(2);
    expect(store.isFlat).toBe(true);
    expect(store.languagePicks).toBeNull();
    expect(store.languageFilterActive).toBe(false);
    expect(store.hasLoaded).toBe(true);
    expect(store.hasFilters).toBe(false);
  });

  it('the default follows the content language (an English UI starts on English)', async () => {
    mockContentLanguage.effective = 'en';
    const store = new DiscoverStore();
    expect(store.languages).toEqual(['en']);
    await store.load();
    expect(mockGetStories.mock.calls[0][0].language).toEqual(['en']);

    // A language change reloads a list on the default...
    mockContentLanguage.effective = 'tr';
    store.contentLanguageChanged();
    expect(mockGetStories.mock.calls[1][0].language).toEqual(['tr']);

    // ...but not one the user picked languages for.
    store.toggleLanguage('en');
    const calls = mockGetStories.mock.calls.length;
    mockContentLanguage.effective = 'en';
    store.contentLanguageChanged();
    expect(mockGetStories).toHaveBeenCalledTimes(calls);
    expect(store.languages).toEqual(['tr', 'en']);
  });

  it('picks languages from the default; every language unpicked is one row per tale', async () => {
    const store = new DiscoverStore();
    store.toggleLanguage('en');
    await Promise.resolve();

    const last = mockGetStories.mock.calls[mockGetStories.mock.calls.length - 1][0];
    expect(last.language).toEqual(['tr', 'en']);
    expect(last.grouped).toBeUndefined();
    expect(store.isFlat).toBe(true);
    expect(store.hasFilters).toBe(true);
    expect(store.languageFilterActive).toBe(true);

    store.toggleLanguage('tr');
    store.toggleLanguage('en');
    expect(store.isFlat).toBe(false);
    expect(store.languages).toEqual([]);
    expect(mockGetStories.mock.calls[mockGetStories.mock.calls.length - 1][0]).toMatchObject({
      grouped: true,
      prefer: 'tr',
    });
    // The whole catalogue narrows nothing: not a filter either.
    expect(store.languageFilterActive).toBe(false);
    expect(store.hasFilters).toBe(false);

    // Picking the default language again is the default.
    store.toggleLanguage('tr');
    expect(store.languageFilterActive).toBe(false);
    expect(store.hasFilters).toBe(false);
  });

  it('sends levels, age group and sort', async () => {
    const store = new DiscoverStore();
    store.toggleLevel('A1');
    store.toggleLevel('A2');
    store.setAgeGroup('THREE_TO_SIX');
    store.setSort('title');
    await store.load();

    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({
        language: ['tr'],
        languageLevel: ['A1', 'A2'],
        ageGroup: 'THREE_TO_SIX',
        sort: 'title',
      }),
    );

    const calls = mockGetStories.mock.calls.length;
    store.setAgeGroup('THREE_TO_SIX');
    store.setSort('title');
    expect(mockGetStories).toHaveBeenCalledTimes(calls);

    store.toggleLevel('A1');
    expect(store.levels).toEqual(['A2']);
  });

  it('filters by one story category, counts it as a filter and clears it', async () => {
    const store = new DiscoverStore();
    store.setCategory('WORLD_CLASSICS');
    await store.load();
    expect(store.category).toBe('WORLD_CLASSICS');
    expect(store.hasFilters).toBe(true);
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: ['tr'], category: 'WORLD_CLASSICS' }),
    );

    const calls = mockGetStories.mock.calls.length;
    store.setCategory('WORLD_CLASSICS');
    expect(mockGetStories).toHaveBeenCalledTimes(calls);

    store.clearFilters();
    expect(store.category).toBeNull();
    store.setCategory('BEDTIME');
    store.reset();
    expect(store.category).toBeNull();
  });

  it('starts with a given sort ("Yeni eklenenler")', async () => {
    const store = new DiscoverStore({ sort: 'newest' });
    await store.load();
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: ['tr'], sort: 'newest' }),
    );
  });
});

describe('search', () => {
  it('uses the search endpoint with the same scope, without age and sort', async () => {
    const store = new DiscoverStore();
    store.toggleLanguage('tr');
    store.toggleLanguage('en');
    store.toggleLevel('A2');
    store.setAgeGroup('SIX_TO_TEN');
    store.setSort('level');
    store.setQuery('  grimm ');
    await Promise.resolve();
    await Promise.resolve();

    expect(mockSearchStories).toHaveBeenLastCalledWith('grimm', {
      page: 1,
      limit: DISCOVER_PAGE_SIZE,
      language: ['en'],
      languageLevel: ['A2'],
    });
    expect(store.isSearching).toBe(true);
    expect(store.items.map(item => item.id)).toEqual(['s']);
  });

  it('searches the default language and ignores the age filter in hasFilters', async () => {
    const store = new DiscoverStore();
    store.setAgeGroup('SIX_TO_TEN');
    expect(store.hasFilters).toBe(true);
    store.setQuery('ay');
    expect(mockSearchStories).toHaveBeenLastCalledWith(
      'ay',
      expect.objectContaining({ language: ['tr'] }),
    );
    expect(store.hasFilters).toBe(false);
    // Nothing in that language may still be a tale in another one.
    expect(store.canWidenSearch).toBe(true);
  });

  it('showAllLanguages searches the whole catalogue, one row per tale', () => {
    const store = new DiscoverStore();
    store.setQuery('keloğlan');
    store.showAllLanguages();
    expect(mockSearchStories).toHaveBeenLastCalledWith(
      'keloğlan',
      expect.objectContaining({ grouped: true, prefer: 'tr' }),
    );
    expect(store.canWidenSearch).toBe(false);
    const calls = mockSearchStories.mock.calls.length;
    store.showAllLanguages();
    expect(mockSearchStories).toHaveBeenCalledTimes(calls);
    // "Clear" goes back to the default language.
    store.clearFilters();
    expect(store.languages).toEqual(['tr']);
  });

  it('does not reload when only the whitespace of the term changes', () => {
    const store = new DiscoverStore();
    store.setQuery('ay');
    store.setQuery('ay ');
    expect(mockSearchStories).toHaveBeenCalledTimes(1);
    expect(store.query).toBe('ay ');
  });

  it('clearFilters drops the term and every filter and reloads', async () => {
    const store = new DiscoverStore();
    store.setQuery('ay');
    store.toggleLanguage('en');
    store.toggleLevel('B1');
    store.setAgeGroup('TEN_PLUS');
    store.clearFilters();
    await Promise.resolve();

    expect(store.query).toBe('');
    expect(store.languagePicks).toBeNull();
    expect(store.languages).toEqual(['tr']);
    expect(store.levels).toEqual([]);
    expect(store.ageGroup).toBeNull();
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: ['tr'], languageLevel: undefined, ageGroup: undefined }),
    );
  });
});

describe('pagination and errors', () => {
  it('appends the next page and stops at the last one', async () => {
    mockGetStories
      .mockResolvedValueOnce(pageOf([story('a')], 1, 2, 2))
      .mockResolvedValueOnce(pageOf([story('b')], 2, 2, 2));
    const store = new DiscoverStore();
    await store.load();
    expect(store.hasMore).toBe(true);

    await store.loadMore();
    expect(mockGetStories).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    expect(store.items.map(item => item.id)).toEqual(['a', 'b']);
    expect(store.hasMore).toBe(false);

    await store.loadMore();
    expect(mockGetStories).toHaveBeenCalledTimes(2);
  });

  it('drops the answer of an older scope', async () => {
    let resolveSlow: (value: unknown) => void = () => undefined;
    mockGetStories
      .mockImplementationOnce(() => new Promise(resolve => (resolveSlow = resolve)))
      .mockResolvedValueOnce(pageOf([story('fresh')]));
    const store = new DiscoverStore();
    const slow = store.load();
    await store.refresh();
    resolveSlow(pageOf([story('stale')]));
    await slow;

    expect(store.items.map(item => item.id)).toEqual(['fresh']);
    expect(store.isLoading).toBe(false);
  });

  it('marks a failed first page and recovers on retry', async () => {
    mockGetStories.mockRejectedValueOnce(new Error('offline'));
    const store = new DiscoverStore();
    await store.load();
    expect(store.hasError).toBe(true);
    expect(store.hasLoaded).toBe(true);
    expect(store.items).toEqual([]);

    await store.load();
    expect(store.hasError).toBe(false);
    expect(store.items).toHaveLength(2);
  });

  it('keeps the rows when a next page fails', async () => {
    mockGetStories
      .mockResolvedValueOnce(pageOf([story('a')], 1, 2, 2))
      .mockRejectedValueOnce(new Error('offline'));
    const store = new DiscoverStore();
    await store.load();
    await store.loadMore();
    expect(store.items.map(item => item.id)).toEqual(['a']);
    expect(store.hasError).toBe(false);
    expect(store.isLoadingMore).toBe(false);
  });

  it('resync fetches the loaded pages again without a loading state', async () => {
    mockGetStories
      .mockResolvedValueOnce(pageOf([story('a')], 1, 2, 2))
      .mockResolvedValueOnce(pageOf([story('b')], 2, 2, 2));
    const store = new DiscoverStore();
    await store.resync();
    expect(mockGetStories).not.toHaveBeenCalled();

    await store.load();
    await store.loadMore();
    mockGetStories
      .mockResolvedValueOnce(pageOf([story('a', { isFavoriteAnyLanguage: true })], 1, 2, 2))
      .mockResolvedValueOnce(pageOf([story('b')], 2, 2, 2));
    const pending = store.resync();
    expect(store.isLoading).toBe(false);
    await pending;

    expect(store.items.map(item => [item.id, item.isFavoriteAnyLanguage])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect(store.page).toBe(2);

    mockGetStories.mockRejectedValueOnce(new Error('offline'));
    await store.resync();
    expect(store.items).toHaveLength(2);
  });

  it('reset empties the store', async () => {
    const store = new DiscoverStore();
    store.toggleLanguage('en');
    store.setQuery('ay');
    await store.load();
    store.reset();
    expect(store.items).toEqual([]);
    expect(store.languagePicks).toBeNull();
    expect(store.languages).toEqual(['tr']);
    expect(store.query).toBe('');
    expect(store.hasLoaded).toBe(false);
  });

  it('hands out one shared store for the tab', () => {
    expect(getDiscoverStore()).toBe(getDiscoverStore());
  });
});

describe('patchSaved', () => {
  it('marks the story, and its other language rows when the tale key is known', () => {
    const list = [
      story('tr', { translationGroupId: 'g-1' }),
      story('en', { translationGroupId: 'g-1' }),
      story('other'),
    ];
    const saved = patchSaved(list, list[0], true);
    expect(saved.map(item => [item.isFavorite, item.isFavoriteAnyLanguage])).toEqual([
      [true, true],
      [false, true],
      [false, false],
    ]);
    const removed = patchSaved(saved, saved[1], false);
    expect(removed.every(item => !item.isFavorite && !item.isFavoriteAnyLanguage)).toBe(true);
  });

  it('touches only the row itself without a tale key', () => {
    const list = [story('tr'), story('en')];
    expect(patchSaved(list, list[0], true).map(item => item.isFavoriteAnyLanguage)).toEqual([
      true,
      false,
    ]);
  });
});

describe('toggleStorySaved', () => {
  it('goes through StoryStore when it holds a copy', async () => {
    const row = story('a');
    const fake = fakeStoryStore({ stories: [row] });
    fake.toggleFavorite.mockImplementation(async () => {
      fake.getFavoriteState.mockReturnValue(true);
    });

    await expect(toggleStorySaved(row, asStore(fake))).resolves.toBe('saved');
    // Quiet: the caller announces the outcome, so a failure is said once.
    expect(fake.toggleFavorite).toHaveBeenCalledWith('a', { quiet: true });
    expect(mockToggleFavorite).not.toHaveBeenCalled();
  });

  it('goes through StoryStore for a story only a home shelf holds', async () => {
    const row = story('a');
    const fake = {
      ...fakeStoryStore(),
      shelfByCategory: new Map([['WORLD_CLASSICS', [row]]]),
    };
    fake.toggleFavorite.mockImplementation(async () => {
      fake.getFavoriteState.mockReturnValue(true);
    });

    await expect(toggleStorySaved(row, asStore(fake))).resolves.toBe('saved');
    // The store patches the shelf copy; a direct request would leave it stale.
    expect(fake.toggleFavorite).toHaveBeenCalledWith('a', { quiet: true });
    expect(mockToggleFavorite).not.toHaveBeenCalled();
  });

  it('reports a failure when StoryStore rolled back', async () => {
    const row = story('a');
    const fake = fakeStoryStore({ stories: [row] });
    await expect(toggleStorySaved(row, asStore(fake))).resolves.toBe('failed');
  });

  it('unsaves through StoryStore when the saved list names the story', async () => {
    const row = story('a', { isFavorite: true, isFavoriteAnyLanguage: true });
    const fake = fakeStoryStore({
      favoriteStories: [story('x', { favoriteStoryIds: ['a'] })],
      getFavoriteState: jest.fn(() => true),
    });
    fake.toggleFavorite.mockImplementation(async () => {
      fake.getFavoriteState.mockReturnValue(false);
    });
    await expect(toggleStorySaved(row, asStore(fake))).resolves.toBe('removed');
  });

  it('talks to the backend itself when StoryStore has no copy', async () => {
    const row = story('a');
    const fake = fakeStoryStore();
    await expect(toggleStorySaved(row, asStore(fake))).resolves.toBe('saved');
    expect(mockToggleFavorite).toHaveBeenCalledWith('a', true);
    expect(fake.toggleFavorite).not.toHaveBeenCalled();
    expect(fake.loadFavorites).toHaveBeenCalled();
  });

  it('fails quietly when the backend refuses', async () => {
    mockToggleFavorite.mockRejectedValueOnce(new Error('offline'));
    await expect(toggleStorySaved(story('a'), asStore(fakeStoryStore()))).resolves.toBe('failed');
  });

  it('removes a tale saved through another language, using the grouped favourites', async () => {
    const row = story('tr', { isFavorite: false, isFavoriteAnyLanguage: true });
    const fake = fakeStoryStore({
      favoriteStories: [story('tr', { favoriteStoryIds: ['en'] })],
    });
    // The Turkish version itself was never saved.
    mockToggleFavorite.mockImplementation((id: string) =>
      id === 'tr'
        ? Promise.reject(apiErrorFromResponse(404, { message: 'Story not in favorites' }))
        : Promise.resolve(),
    );

    await expect(toggleStorySaved(row, asStore(fake))).resolves.toBe('removed');
    expect(mockToggleFavorite).toHaveBeenCalledWith('en', false);
    expect(mockGetStoryById).not.toHaveBeenCalled();
    expect(fake.loadFavorites).toHaveBeenCalled();
    expect(fake.refresh).toHaveBeenCalled();
  });

  it('reads the versions from the story detail when the favourites do not name it', async () => {
    const row = story('tr', { isFavorite: false, isFavoriteAnyLanguage: true });
    mockGetStoryById.mockResolvedValue({ translations: [{ id: 'en' }, { id: 'de' }] });

    await expect(toggleStorySaved(row, asStore(fakeStoryStore()))).resolves.toBe('removed');
    expect(mockToggleFavorite.mock.calls.map(call => call[0]).sort()).toEqual(['de', 'en', 'tr']);
  });

  it('fails when a version cannot be removed for another reason than "not saved"', async () => {
    const row = story('tr', { isFavorite: false, isFavoriteAnyLanguage: true });
    mockGetStoryById.mockResolvedValue({ translations: [{ id: 'en' }] });
    mockToggleFavorite.mockRejectedValue(new Error('offline'));
    await expect(toggleStorySaved(row, asStore(fakeStoryStore()))).resolves.toBe('failed');
  });
});

describe('DiscoverStore.toggleSaved', () => {
  it('a list of one language holds each tale once: a save asks nothing again', async () => {
    const store = new DiscoverStore();
    await store.load();
    expect(store.showsSeveralLanguages).toBe(false);
    const calls = mockGetStories.mock.calls.length;
    await store.toggleSaved(store.items[0], asStore(fakeStoryStore()));
    await Promise.resolve();
    await Promise.resolve();
    expect(mockGetStories).toHaveBeenCalledTimes(calls);
    expect(store.items[0].isFavoriteAnyLanguage).toBe(true);
  });

  it('fills the bookmark at once and keeps it after success', async () => {
    const store = talesStore();
    await store.load();
    let release: () => void = () => undefined;
    mockToggleFavorite.mockImplementationOnce(() => new Promise<void>(resolve => (release = resolve)));

    const pending = store.toggleSaved(store.items[0], asStore(fakeStoryStore()));
    expect(store.items[0].isFavoriteAnyLanguage).toBe(true);
    release();
    await expect(pending).resolves.toBe('saved');
    expect(store.items[0].isFavorite).toBe(true);
    expect(store.items[1].isFavoriteAnyLanguage).toBe(false);
  });

  it('rolls the row back when saving fails', async () => {
    const store = new DiscoverStore();
    await store.load();
    mockToggleFavorite.mockRejectedValueOnce(new Error('offline'));

    await expect(store.toggleSaved(store.items[0], asStore(fakeStoryStore()))).resolves.toBe('failed');
    expect(store.items[0].isFavorite).toBe(false);
    expect(store.items[0].isFavoriteAnyLanguage).toBe(false);
  });

  it('asks the server which rows are saved after a save in a flat list', async () => {
    const store = new DiscoverStore();
    mockGetStories.mockResolvedValue(pageOf([story('tr'), story('en', { language: 'en' })]));
    // Turkish (the default) and English: a tale can be on it twice.
    store.toggleLanguage('en');
    await store.load();

    mockGetStories.mockResolvedValue(
      pageOf([
        story('tr', { isFavorite: true, isFavoriteAnyLanguage: true }),
        story('en', { language: 'en', isFavoriteAnyLanguage: true }),
      ]),
    );
    await store.toggleSaved(store.items[0], asStore(fakeStoryStore()));
    await Promise.resolve();
    await Promise.resolve();

    expect(store.items.map(item => item.isFavoriteAnyLanguage)).toEqual([true, true]);
  });
});

describe('content language (ui-9)', () => {
  it('grouped loads and searches send prefer equal to the content language', async () => {
    mockContentLanguage.effective = 'en';
    const store = talesStore();
    await store.load();
    expect(mockGetStories).toHaveBeenLastCalledWith(
      expect.objectContaining({ grouped: true, prefer: 'en' }),
    );

    store.setQuery('ay');
    expect(mockSearchStories).toHaveBeenLastCalledWith(
      'ay',
      expect.objectContaining({ grouped: true, prefer: 'en' }),
    );
  });

  it('a "Masal dili" change is in the very next reload, saved or not', async () => {
    const store = talesStore();
    await store.load();
    // setContentLanguage sets the new language at once, before the PATCH.
    mockContentLanguage.effective = 'de';
    await store.refresh();
    expect(mockGetStories.mock.calls[mockGetStories.mock.calls.length - 1][0].prefer).toBe('de');
  });

  it('flat loads do not send prefer', async () => {
    mockContentLanguage.effective = 'en';
    const store = new DiscoverStore();
    store.toggleLanguage('tr');
    await Promise.resolve();
    const last = mockGetStories.mock.calls[mockGetStories.mock.calls.length - 1][0];
    expect(last.language).toEqual(['en', 'tr']);
    expect(last).not.toHaveProperty('prefer');
  });
});

describe('listErrorKind', () => {
  it('names why the first page failed and clears on the next load', async () => {
    const store = new DiscoverStore();
    mockGetStories.mockRejectedValueOnce(apiErrorFromResponse(undefined, null));
    await store.load();
    expect(store.listErrorKind).toBe('offline');

    mockGetStories.mockRejectedValueOnce(apiErrorFromResponse(503, {}));
    await store.load();
    expect(store.listErrorKind).toBe('maintenance');

    await store.load();
    expect(store.listErrorKind).toBeNull();
    expect(store.hasError).toBe(false);

    mockGetStories.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await store.load();
    store.reset();
    expect(store.listErrorKind).toBeNull();
  });
});

describe('showCategory (ui-22)', () => {
  it('drops the term, languages, levels and age group, then loads once', async () => {
    const store = new DiscoverStore();
    store.toggleLanguage('en');
    store.toggleLevel('A2');
    store.setAgeGroup('SIX_TO_TEN');
    store.setQuery('ay');
    store.setSort('title');
    await store.load();
    mockGetStories.mockClear();
    mockSearchStories.mockClear();

    store.showCategory('BEDTIME');

    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(mockSearchStories).not.toHaveBeenCalled();
    const call = mockGetStories.mock.calls[0][0];
    // Back on the default language, as the home shelf it came from.
    expect(call).toMatchObject({ category: 'BEDTIME', language: ['tr'], sort: 'title' });
    expect(call.grouped).toBeUndefined();
    expect(call.languageLevel).toBeUndefined();
    expect(call.ageGroup).toBeUndefined();
    expect(store.query).toBe('');
    expect(store.languagePicks).toBeNull();
    expect(store.levels).toEqual([]);
    expect(store.ageGroup).toBeNull();
    expect(store.category).toBe('BEDTIME');
  });

  it('reloads the current category when earlier filters were picked', async () => {
    const store = new DiscoverStore();
    store.setCategory('BEDTIME');
    store.toggleLanguage('en');
    await store.load();
    mockGetStories.mockClear();

    store.showCategory('BEDTIME');
    expect(mockGetStories).toHaveBeenCalledTimes(1);
    expect(store.languages).toEqual(['tr']);
  });

  it('makes no request when that exact list is already on screen', async () => {
    const store = new DiscoverStore();
    store.showCategory('BEDTIME');
    await Promise.resolve();
    await Promise.resolve();
    mockGetStories.mockClear();

    store.showCategory('BEDTIME');
    expect(mockGetStories).not.toHaveBeenCalled();
  });
});

describe('syncSaved (ui-8)', () => {
  it('patches the row and its other language rows without a fetch', async () => {
    mockGetStories.mockResolvedValue(
      pageOf([
        story('tr', { translationGroupId: 'g-1' }),
        story('en', { translationGroupId: 'g-1', language: 'en' }),
        story('other'),
      ]),
    );
    const store = new DiscoverStore();
    await store.load();
    mockGetStories.mockClear();

    store.syncSaved({ id: 'tr', translationGroupId: 'g-1', isFavorite: true, isFavoriteAnyLanguage: true });

    expect(store.items.map(item => [item.id, item.isFavorite, item.isFavoriteAnyLanguage])).toEqual([
      ['tr', true, true],
      ['en', false, true],
      ['other', false, false],
    ]);
    expect(mockGetStories).not.toHaveBeenCalled();

    store.syncSaved({ id: 'en', translationGroupId: 'g-1', isFavorite: false, isFavoriteAnyLanguage: false });
    expect(store.items.every(item => !item.isFavorite && !item.isFavoriteAnyLanguage)).toBe(true);
  });

  it('keeps the same list when nothing changes', async () => {
    const store = new DiscoverStore();
    await store.load();
    const before = store.items;
    store.syncSaved({ id: 'a', translationGroupId: null, isFavorite: false, isFavoriteAnyLanguage: false });
    store.syncSaved({ id: 'unknown', translationGroupId: null, isFavorite: true, isFavoriteAnyLanguage: true });
    expect(store.items).toBe(before);
  });
});

describe('DiscoverStore.toggleSaved serialised per story (ui-19)', () => {
  const settleAll = async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };

  function controlledRequests() {
    const calls: { id: string; saved: boolean; resolve: () => void; reject: (e: unknown) => void }[] = [];
    mockToggleFavorite.mockImplementation(
      (id: string, saved: boolean) =>
        new Promise<void>((resolve, reject) => calls.push({ id, saved, resolve, reject })),
    );
    return calls;
  }

  it('a second tap waits for the first request, then sends the other state', async () => {
    const calls = controlledRequests();
    const store = new DiscoverStore();
    await store.load();
    const fake = fakeStoryStore();

    const first = store.toggleSaved(store.items[0], asStore(fake));
    const second = store.toggleSaved(store.items[0], asStore(fake));
    // Both taps show at once; one request is in flight.
    expect(store.items[0].isFavoriteAnyLanguage).toBe(false);
    expect(calls.map(c => [c.id, c.saved])).toEqual([['a', true]]);

    calls[0].resolve();
    await settleAll();
    expect(calls.map(c => [c.id, c.saved])).toEqual([
      ['a', true],
      ['a', false],
    ]);
    calls[1].resolve();

    await expect(first).resolves.toBe('superseded');
    await expect(second).resolves.toBe('removed');
    expect(store.items[0].isFavorite).toBe(false);
    expect(store.items[0].isFavoriteAnyLanguage).toBe(false);
  });

  it('taps that cancel out send no second request', async () => {
    const calls = controlledRequests();
    const store = talesStore();
    await store.load();
    const fake = fakeStoryStore();

    const taps = [
      store.toggleSaved(store.items[0], asStore(fake)),
      store.toggleSaved(store.items[0], asStore(fake)),
      store.toggleSaved(store.items[0], asStore(fake)),
    ];
    calls[0].resolve();

    await expect(Promise.all(taps)).resolves.toEqual(['superseded', 'superseded', 'saved']);
    expect(calls).toHaveLength(1);
    expect(store.items[0].isFavoriteAnyLanguage).toBe(true);
  });

  it('rolls the row back to the server state when the last request fails', async () => {
    const calls = controlledRequests();
    const store = new DiscoverStore();
    await store.load();
    const fake = fakeStoryStore();

    const first = store.toggleSaved(store.items[0], asStore(fake));
    const second = store.toggleSaved(store.items[0], asStore(fake));
    calls[0].resolve();
    await settleAll();
    calls[1].reject(new Error('offline'));

    await expect(second).resolves.toBe('failed');
    await expect(first).resolves.toBe('superseded');
    // Saved on the server (the first request), so the row shows saved.
    expect(store.items[0].isFavorite).toBe(true);
    expect(store.items[0].isFavoriteAnyLanguage).toBe(true);
  });

  it('different stories do not wait for each other', async () => {
    const calls = controlledRequests();
    const store = new DiscoverStore();
    await store.load();
    const fake = fakeStoryStore();

    void store.toggleSaved(store.items[0], asStore(fake));
    void store.toggleSaved(store.items[1], asStore(fake));
    expect(calls.map(c => c.id)).toEqual(['a', 'b']);
    calls.forEach(c => c.resolve());
    await settleAll();
  });

  it('tells StoryStore about a save made straight through the service', async () => {
    const store = new DiscoverStore();
    await store.load();
    const fake = fakeStoryStore();

    await store.toggleSaved(store.items[0], asStore(fake));

    expect(fake.recordFavoriteChange).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a' }),
      true,
    );
  });
});

describe('toggleStorySaved outcomes', () => {
  it('passes a superseded tap on, and reports a failure from the store result', async () => {
    const row = story('a');
    const fake = fakeStoryStore({ stories: [row] });
    fake.toggleFavorite.mockResolvedValueOnce('superseded');
    await expect(toggleStorySaved(row, asStore(fake))).resolves.toBe('superseded');

    fake.toggleFavorite.mockResolvedValueOnce('failed');
    await expect(toggleStorySaved(row, asStore(fake))).resolves.toBe('failed');
  });
});
