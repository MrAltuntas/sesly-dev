import { apiErrorFromResponse } from './ApiError';
import { AgeGroup, StoryCategory } from '../types/enums';
import { DEFAULT_STORY_EXTRAS } from '../models/Story';

const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

// Imported after the mock so the service picks up the mocked client.
import StoryService, { storyScopeQuery } from './StoryService';

// ----------------------------------------------------------------------------
// Fixtures: backend StoryListItem (story-list.mapper.ts) inside the standard
// PaginatedResult envelope { data, total, page, limit, totalPages }.
// ----------------------------------------------------------------------------

const storyListItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'st-1',
  title: 'Kirmizi Baslikli Kiz',
  description: 'Bir varmis bir yokmus, ormanin kiyisinda kucuk bir kiz yasarmis...',
  ageGroup: 'THREE_TO_SIX',
  category: 'WORLD_CLASSICS',
  language: 'tr',
  estimatedDuration: 8,
  coverImageUrl: 'https://storage.googleapis.com/sesly/covers/st-1.jpg?sig=abc',
  isPremium: false,
  hasPreGeneratedNarration: true,
  isFavorite: true,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
  ...overrides,
});

const paginated = (data: unknown[], overrides: Record<string, unknown> = {}) => ({
  data,
  total: data.length,
  page: 1,
  limit: 20,
  totalPages: 1,
  ...overrides,
});

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockDelete.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('StoryService.getStories', () => {
  it('passes the filter params and parses the paginated backend payload', async () => {
    mockGet.mockResolvedValue(
      paginated(
        [
          storyListItem(),
          storyListItem({
            id: 'st-2',
            title: 'Uyuyan Guzel',
            isPremium: true,
            isFavorite: false,
            coverImageUrl: null,
            description: '',
          }),
        ],
        { total: 42, page: 2, limit: 2, totalPages: 21 },
      ),
    );

    const params = { page: 2, limit: 2, category: 'WORLD_CLASSICS', ageGroup: 'THREE_TO_SIX', isPremium: false };
    const result = await StoryService.getStories(params);

    expect(mockGet).toHaveBeenCalledWith('/stories', { params });
    expect(result.meta).toEqual({ page: 2, limit: 2, total: 42, totalPages: 21 });
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toEqual({
      id: 'st-1',
      title: 'Kirmizi Baslikli Kiz',
      description: 'Bir varmis bir yokmus, ormanin kiyisinda kucuk bir kiz yasarmis...',
      ageGroup: AgeGroup.THREE_TO_SIX,
      category: StoryCategory.WORLD_CLASSICS,
      estimatedDuration: 8,
      coverImageUrl: 'https://storage.googleapis.com/sesly/covers/st-1.jpg?sig=abc',
      isPremium: false,
      isFavorite: true,
      // v3 fields: an item without `summary` / `credit` gets safe values.
      ...DEFAULT_STORY_EXTRAS,
      summary: 'Bir varmis bir yokmus, ormanin kiyisinda kucuk bir kiz yasarmis...',
      isFavoriteAnyLanguage: true,
    });
    expect(result.data[1]).toMatchObject({
      id: 'st-2',
      isPremium: true,
      isFavorite: false,
      coverImageUrl: null,
      description: null,
    });
  });

  it('sends undefined params when called without filters', async () => {
    mockGet.mockResolvedValue(paginated([]));
    await StoryService.getStories();
    expect(mockGet).toHaveBeenCalledWith('/stories', { params: undefined });
  });

  it('skips invalid items and defaults missing meta', async () => {
    mockGet.mockResolvedValue({
      data: [storyListItem(), { id: 'broken' }, null, storyListItem({ id: 'st-3', estimatedDuration: '8' })],
    });

    const result = await StoryService.getStories();

    expect(result.data.map(s => s.id)).toEqual(['st-1']);
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 1 });
  });

  it('throws on a non-object body and rethrows client errors', async () => {
    mockGet.mockResolvedValue(null);
    await expect(StoryService.getStories()).rejects.toThrow(/expected object/);

    const error = apiErrorFromResponse(500, { message: 'Internal server error' });
    mockGet.mockRejectedValue(error);
    await expect(StoryService.getStories()).rejects.toBe(error);
  });
});

describe('StoryService.searchStories', () => {
  it.each([[''], ['   '], ['\n\t']])('rejects a blank query %j without a request', async q => {
    await expect(StoryService.searchStories(q)).rejects.toThrow('Search query is required');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('sends q with default page 1 and limit 20', async () => {
    mockGet.mockResolvedValue(paginated([storyListItem()]));

    const result = await StoryService.searchStories('kiz');

    expect(mockGet).toHaveBeenCalledWith('/stories/search', {
      params: { q: 'kiz', page: 1, limit: 20 },
    });
    expect(result.data[0].id).toBe('st-1');
  });

  it('forwards explicit paging', async () => {
    mockGet.mockResolvedValue(paginated([], { page: 3, limit: 10, totalPages: 3 }));
    const result = await StoryService.searchStories('orman', { page: 3, limit: 10 });
    expect(mockGet).toHaveBeenCalledWith('/stories/search', {
      params: { q: 'orman', page: 3, limit: 10 },
    });
    expect(result.meta.page).toBe(3);
  });

  it('rethrows client errors', async () => {
    const error = apiErrorFromResponse(429, {});
    mockGet.mockRejectedValue(error);
    await expect(StoryService.searchStories('kiz')).rejects.toBe(error);
  });
});

describe('StoryService.getStoryById', () => {
  it('validates the id', async () => {
    await expect(StoryService.getStoryById('')).rejects.toThrow('Story ID is required');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('GETs /stories/:id and parses the detail with chunks and progress', async () => {
    mockGet.mockResolvedValue({
      ...storyListItem(),
      chunks: [
        { id: 'ch-1', chunkIndex: 0, content: 'Bir varmis bir yokmus.', startTime: 0, endTime: 4.2 },
        { id: 'ch-2', index: 1, text: 'Ormanin kiyisinda...' },
      ],
      userProgress: { lastChunkIndex: 1, completedAt: '2026-09-10T20:00:00.000Z' },
    });

    const detail = await StoryService.getStoryById('st-1');

    expect(mockGet).toHaveBeenCalledWith('/stories/st-1');
    expect(detail).toMatchObject({
      id: 'st-1',
      title: 'Kirmizi Baslikli Kiz',
      language: 'tr',
      estimatedDuration: 8,
      isFavorite: true,
      isPremium: false,
    });
    expect(detail.chunks).toEqual([
      { id: 'ch-1', index: 0, text: 'Bir varmis bir yokmus.', startPosition: 0, endPosition: 4.2 },
      { id: 'ch-2', index: 1, text: 'Ormanin kiyisinda...', startPosition: 0, endPosition: 0 },
    ]);
    expect(detail.userProgress).toEqual({
      lastChunkIndex: 1,
      completedAt: new Date('2026-09-10T20:00:00.000Z'),
    });
  });

  it('defaults a sparse detail (no chunks, no progress)', async () => {
    mockGet.mockResolvedValue({ id: 'st-9' });
    const detail = await StoryService.getStoryById('st-9');
    expect(detail).toMatchObject({
      id: 'st-9',
      title: '',
      description: null,
      language: 'tr',
      estimatedDuration: 0,
      coverImageUrl: null,
      chunks: [],
      userProgress: null,
    });
  });

  it('throws when the detail has no id, and rethrows 404', async () => {
    mockGet.mockResolvedValue({ title: 'x' });
    await expect(StoryService.getStoryById('st-1')).rejects.toThrow(/missing or invalid id/);

    const error = apiErrorFromResponse(404, { message: 'Hikaye bulunamadi.' });
    mockGet.mockRejectedValue(error);
    await expect(StoryService.getStoryById('st-x')).rejects.toBe(error);
  });
});

describe('StoryService.toggleFavorite', () => {
  it('POSTs /stories/:id/favorite to add', async () => {
    mockPost.mockResolvedValue({ success: true });
    await StoryService.toggleFavorite('st-1', true);
    expect(mockPost).toHaveBeenCalledWith('/stories/st-1/favorite');
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('DELETEs /stories/:id/favorite to remove', async () => {
    mockDelete.mockResolvedValue({ success: true });
    await StoryService.toggleFavorite('st-1', false);
    expect(mockDelete).toHaveBeenCalledWith('/stories/st-1/favorite');
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('validates the id and rethrows errors', async () => {
    await expect(StoryService.toggleFavorite('', true)).rejects.toThrow('Story ID is required');

    const error = apiErrorFromResponse(409, { message: 'Zaten favorilerde.' });
    mockPost.mockRejectedValue(error);
    await expect(StoryService.toggleFavorite('st-1', true)).rejects.toBe(error);

    const deleteError = apiErrorFromResponse(undefined, null);
    mockDelete.mockRejectedValue(deleteError);
    await expect(StoryService.toggleFavorite('st-1', false)).rejects.toBe(deleteError);
  });
});

describe('StoryService.getFavoriteStories', () => {
  it('GETs /stories/favorites with default paging', async () => {
    mockGet.mockResolvedValue(paginated([storyListItem()], { total: 1 }));

    const result = await StoryService.getFavoriteStories();

    expect(mockGet).toHaveBeenCalledWith('/stories/favorites', {
      params: { page: 1, limit: 20 },
    });
    expect(result.data.map(s => s.id)).toEqual(['st-1']);
    expect(result.meta.total).toBe(1);
  });

  it('returns an empty page on 404 using the requested paging', async () => {
    mockGet.mockRejectedValue(apiErrorFromResponse(404, {}));

    await expect(StoryService.getFavoriteStories({ page: 2, limit: 10 })).resolves.toEqual({
      data: [],
      meta: { page: 2, limit: 10, total: 0, totalPages: 0 },
    });
    await expect(StoryService.getFavoriteStories()).resolves.toEqual({
      data: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  it('rethrows every other error', async () => {
    const serverError = apiErrorFromResponse(500, {});
    mockGet.mockRejectedValue(serverError);
    await expect(StoryService.getFavoriteStories()).rejects.toBe(serverError);

    const network = apiErrorFromResponse(undefined, null);
    mockGet.mockRejectedValue(network);
    await expect(StoryService.getFavoriteStories()).rejects.toBe(network);

    const plain = new Error('boom');
    mockGet.mockRejectedValue(plain);
    await expect(StoryService.getFavoriteStories()).rejects.toBe(plain);
  });
});

describe('StoryService: grouped catalogue, languages, translation requests', () => {
  it('storyScopeQuery drops grouped when a language is selected and joins lists', () => {
    expect(storyScopeQuery({ grouped: true, prefer: 'en' })).toEqual({ grouped: true, prefer: 'en' });
    expect(storyScopeQuery({ grouped: true, language: ['tr', 'en'], languageLevel: ['A1', 'A2'] })).toEqual({
      language: 'tr,en',
      languageLevel: 'A1,A2',
    });
    expect(storyScopeQuery({ language: [], grouped: true, sort: 'title', ageGroup: 'THREE_TO_SIX' })).toEqual({
      grouped: true,
      sort: 'title',
      ageGroup: 'THREE_TO_SIX',
    });
    expect(storyScopeQuery({ language: ' ', category: 'BEDTIME', isPremium: false })).toEqual({
      category: 'BEDTIME',
      isPremium: false,
    });
  });

  it('getStories sends the grouped scope and parses the tale fields', async () => {
    mockGet.mockResolvedValue(
      paginated([
        storyListItem({ isFavorite: false, isFavoriteAnyLanguage: true, availableLanguages: ['tr', 'en'] }),
      ]),
    );
    const result = await StoryService.getStories({ page: 1, limit: 20, grouped: true, sort: 'title' });
    expect(mockGet).toHaveBeenCalledWith('/stories', {
      params: { grouped: true, sort: 'title', page: 1, limit: 20 },
    });
    expect(result.data[0].availableLanguages).toEqual(['tr', 'en']);
    expect(result.data[0].isFavorite).toBe(false);
    expect(result.data[0].isFavoriteAnyLanguage).toBe(true);
  });

  it('searchStories forwards the scope next to q', async () => {
    mockGet.mockResolvedValue(paginated([]));
    await StoryService.searchStories('ay', { language: ['tr', 'en'], languageLevel: ['A2'] });
    expect(mockGet).toHaveBeenCalledWith('/stories/search', {
      params: { q: 'ay', page: 1, limit: 20, language: 'tr,en', languageLevel: 'A2' },
    });
  });

  it('getFavoriteStories can ask for one item per tale', async () => {
    mockGet.mockResolvedValue(
      paginated([storyListItem({ favoriteStoryIds: ['st-1', 'st-9'], favoriteLanguages: ['tr', 'EN'] })]),
    );
    const result = await StoryService.getFavoriteStories({ grouped: true });
    expect(mockGet).toHaveBeenCalledWith('/stories/favorites', {
      params: { page: 1, limit: 20, grouped: true },
    });
    expect(result.data[0].favoriteStoryIds).toEqual(['st-1', 'st-9']);
    expect(result.data[0].favoriteLanguages).toEqual(['tr', 'en']);
  });

  it('getFavoriteStories sends prefer with a grouped list only', async () => {
    mockGet.mockResolvedValue(paginated([]));
    await StoryService.getFavoriteStories({ grouped: true, prefer: 'en' });
    expect(mockGet).toHaveBeenLastCalledWith('/stories/favorites', {
      params: { page: 1, limit: 20, grouped: true, prefer: 'en' },
    });

    // A flat list has no version to pick: prefer is not sent.
    await StoryService.getFavoriteStories({ page: 2, prefer: 'en' });
    expect(mockGet).toHaveBeenLastCalledWith('/stories/favorites', {
      params: { page: 2, limit: 20 },
    });

    // An empty prefer is left out.
    await StoryService.getFavoriteStories({ grouped: true, prefer: '' });
    expect(mockGet).toHaveBeenLastCalledWith('/stories/favorites', {
      params: { page: 1, limit: 20, grouped: true },
    });
  });

  it('getLanguages parses the enabled languages', async () => {
    mockGet.mockResolvedValue({
      defaultLanguage: 'tr',
      languages: [
        { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', isDefault: true, storyCount: 29, levels: ['A1', 'a2'] },
        { code: 'EN', nativeName: 'English', englishName: 'English', isDefault: false, storyCount: 3, levels: [] },
        { nativeName: 'broken' },
      ],
    });
    const result = await StoryService.getLanguages();
    expect(mockGet).toHaveBeenCalledWith('/stories/languages');
    expect(result.defaultLanguage).toBe('tr');
    expect(result.languages.map(l => l.code)).toEqual(['tr', 'en']);
    expect(result.languages[0].levels).toEqual(['A1', 'A2']);
  });

  it('getLanguages rethrows and tolerates an empty body', async () => {
    mockGet.mockResolvedValueOnce(null);
    expect(await StoryService.getLanguages()).toEqual({ defaultLanguage: 'tr', languages: [] });
    mockGet.mockRejectedValueOnce(apiErrorFromResponse(500, {}));
    await expect(StoryService.getLanguages()).rejects.toMatchObject({ status: 500 });
  });

  it('requests and withdraws a translation', async () => {
    mockPost.mockResolvedValue({ storyId: 'st-1', language: 'de', requested: true, requestedLanguages: ['de'] });
    expect(await StoryService.requestTranslation('st-1', 'de')).toEqual({
      storyId: 'st-1',
      language: 'de',
      requested: true,
      requestedLanguages: ['de'],
    });
    expect(mockPost).toHaveBeenCalledWith('/stories/st-1/translation-requests', { language: 'de' });

    mockDelete.mockResolvedValue(undefined);
    expect(await StoryService.cancelTranslationRequest('st-1', 'de')).toEqual({
      storyId: 'st-1',
      language: 'de',
      requested: false,
      requestedLanguages: [],
    });
    expect(mockDelete).toHaveBeenCalledWith('/stories/st-1/translation-requests/de');
  });

  it('a request without a body in the answer still reports the language', async () => {
    mockPost.mockResolvedValue(undefined);
    expect((await StoryService.requestTranslation('st-1', 'fr')).requestedLanguages).toEqual(['fr']);
    await expect(StoryService.requestTranslation('', 'fr')).rejects.toThrow('Story ID is required');
    await expect(StoryService.requestTranslation('st-1', '')).rejects.toThrow('Language is required');
    await expect(StoryService.cancelTranslationRequest('', 'fr')).rejects.toThrow('Story ID is required');
    await expect(StoryService.cancelTranslationRequest('st-1', '')).rejects.toThrow('Language is required');
  });
});
