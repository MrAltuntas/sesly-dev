import { apiErrorFromResponse } from './ApiError';

const mockGet = jest.fn();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

import CollectionService from './CollectionService';

// Backend CollectionResponseDto (collections.service.ts toResponseDto).
const collection = (overrides: Record<string, unknown> = {}) => ({
  id: 'col-1',
  slug: 'uyku-oncesi',
  title: 'Uyku oncesi',
  subtitle: 'Sakin masallar',
  description: null,
  tone: 'TRUST',
  coverImageUrl: 'https://storage.googleapis.com/sesly/collections/col-1.jpg?sig=1',
  isActive: true,
  sortOrder: 2,
  storyCount: 12,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-02T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mockGet.mockReset();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('CollectionService.list', () => {
  it('GETs /collections and parses every collection, skipping invalid rows', async () => {
    mockGet.mockResolvedValue([
      collection(),
      collection({ id: 'col-2', slug: 'klasikler', tone: 'UNKNOWN', subtitle: '', storyCount: undefined }),
      { id: 'col-3' },
    ]);

    const list = await CollectionService.list();

    expect(mockGet).toHaveBeenCalledWith('/collections', undefined);
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({
      id: 'col-1',
      slug: 'uyku-oncesi',
      title: 'Uyku oncesi',
      subtitle: 'Sakin masallar',
      description: null,
      tone: 'TRUST',
      coverImageUrl: 'https://storage.googleapis.com/sesly/collections/col-1.jpg?sig=1',
      isActive: true,
      sortOrder: 2,
      storyCount: 12,
      createdAt: '2026-08-01T10:00:00.000Z',
      updatedAt: '2026-08-02T10:00:00.000Z',
    });
    // Unknown tone falls back to ACCENT, missing counts to 0.
    expect(list[1]).toMatchObject({ tone: 'ACCENT', subtitle: null, storyCount: 0 });
  });

  it('throws when the body is not an array, and rethrows client errors', async () => {
    mockGet.mockResolvedValue({ data: [] });
    await expect(CollectionService.list()).rejects.toThrow(/expected array/);

    const error = apiErrorFromResponse(500, {});
    mockGet.mockRejectedValue(error);
    await expect(CollectionService.list()).rejects.toBe(error);
  });
});

describe('CollectionService.getBySlug', () => {
  it('URL-encodes the slug', async () => {
    mockGet.mockResolvedValue(collection({ slug: 'a b/c' }));
    const result = await CollectionService.getBySlug('a b/c');
    expect(mockGet).toHaveBeenCalledWith('/collections/a%20b%2Fc', undefined);
    expect(result.slug).toBe('a b/c');
  });

  it('validates the slug and rethrows 404', async () => {
    await expect(CollectionService.getBySlug('')).rejects.toThrow('Collection slug is required');
    expect(mockGet).not.toHaveBeenCalled();

    const error = apiErrorFromResponse(404, { message: 'Koleksiyon bulunamadi.' });
    mockGet.mockRejectedValue(error);
    await expect(CollectionService.getBySlug('yok')).rejects.toBe(error);
  });

  it('rejects a collection without a title', async () => {
    mockGet.mockResolvedValue(collection({ title: '' }));
    await expect(CollectionService.getBySlug('uyku-oncesi')).rejects.toThrow(/title/);
  });
});

describe('CollectionService.getStories', () => {
  it('GETs the paginated stories of a collection with default paging', async () => {
    mockGet.mockResolvedValue({
      data: [
        {
          id: 'st-1',
          title: 'Kirmizi Baslikli Kiz',
          description: 'Bir varmis...',
          ageGroup: 'THREE_TO_SIX',
          category: 'WORLD_CLASSICS',
          language: 'tr',
          estimatedDuration: 8,
          coverImageUrl: null,
          isPremium: false,
          hasPreGeneratedNarration: false,
          isFavorite: false,
          createdAt: '2026-09-01T10:00:00.000Z',
          updatedAt: '2026-09-01T10:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const result = await CollectionService.getStories('uyku-oncesi');

    expect(mockGet).toHaveBeenCalledWith('/collections/uyku-oncesi/stories', {
      params: { page: 1, limit: 20 },
    });
    expect(result.data.map(s => s.id)).toEqual(['st-1']);
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('forwards explicit paging and rethrows errors', async () => {
    mockGet.mockResolvedValue({ data: [], total: 0, page: 2, limit: 5, totalPages: 0 });
    await CollectionService.getStories('klasikler', 2, 5);
    expect(mockGet).toHaveBeenCalledWith('/collections/klasikler/stories', {
      params: { page: 2, limit: 5 },
    });

    await expect(CollectionService.getStories('')).rejects.toThrow('Collection slug is required');

    const error = apiErrorFromResponse(undefined, null);
    mockGet.mockRejectedValue(error);
    await expect(CollectionService.getStories('klasikler')).rejects.toBe(error);
  });
});

describe('CollectionService: content language', () => {
  it('list sends the language as a query param', async () => {
    mockGet.mockResolvedValue([collection()]);
    await CollectionService.list('en');
    expect(mockGet).toHaveBeenCalledWith('/collections', { params: { language: 'en' } });

    // An empty language is the same as none: the backend default.
    await CollectionService.list('');
    expect(mockGet).toHaveBeenLastCalledWith('/collections', undefined);
  });

  it('getBySlug sends the language next to the slug', async () => {
    mockGet.mockResolvedValue(collection({ slug: 'bedtime' }));
    await CollectionService.getBySlug('bedtime', 'en');
    expect(mockGet).toHaveBeenCalledWith('/collections/bedtime', { params: { language: 'en' } });
  });

  it('getStories passes the language with the paging', async () => {
    mockGet.mockResolvedValue({ data: [], total: 0, page: 3, limit: 10, totalPages: 0 });
    await CollectionService.getStories('bedtime', 3, 10, 'en');
    expect(mockGet).toHaveBeenCalledWith('/collections/bedtime/stories', {
      params: { page: 3, limit: 10, language: 'en' },
    });

    await CollectionService.getStories('bedtime', 1, 20, undefined);
    expect(mockGet).toHaveBeenLastCalledWith('/collections/bedtime/stories', {
      params: { page: 1, limit: 20 },
    });
  });
});
