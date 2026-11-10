import { apiErrorFromResponse } from './ApiError';

const mockGet = jest.fn();

jest.mock('./ApiClient', () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

// Local AsyncStorage with getAllKeys / multiGet (the global mock has no
// getAllKeys, which the offline list fallback relies on).
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  const api = {
    getItem: jest.fn(async (k: string) => (store.has(k) ? (store.get(k) as string) : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      store.delete(k);
    }),
    getAllKeys: jest.fn(async () => Array.from(store.keys())),
    multiGet: jest.fn(async (keys: string[]) =>
      keys.map(k => [k, store.has(k) ? (store.get(k) as string) : null]),
    ),
    clear: jest.fn(async () => {
      store.clear();
    }),
  };
  return { __esModule: true, default: api, ...api };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import LegalService, { LEGAL_PREFETCH_FRESH_MS } from './LegalService';
import type { LegalLanguage, LegalRefresh } from '../models/Legal';

const storage = AsyncStorage as unknown as Record<string, jest.Mock>;

// Backend PublicLegalDocumentDto.
const doc = (overrides: Record<string, unknown> = {}) => ({
  slug: 'privacy',
  language: 'tr',
  title: 'Gizlilik Politikasi',
  contentMd: '## Gizlilik\n\n- Verilerini korumak onceligimizdir.',
  version: 3,
  publishedAt: '2026-09-01T00:00:00.000Z',
  ...overrides,
});

const NOW = new Date('2026-09-28T12:00:00.000Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

const TR = { language: 'tr' } as const;
const EN = { language: 'en' } as const;

/** The query every request sends: the language asked for. */
const asked = (language: LegalLanguage) => ({ params: { language } });

/** A request the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets the promise chains of a background refresh run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** The storage key of a slug asked for in a language. */
const keyOf = (slug: string, language: LegalLanguage = 'tr') => `legal:${language}:${slug}`;

/** A saved copy as an earlier session left it (not in memory). */
async function saveCopy(
  slug: string,
  cachedAt: number,
  overrides: Record<string, unknown> = {},
  language: LegalLanguage = 'tr',
) {
  await AsyncStorage.setItem(keyOf(slug, language), JSON.stringify({ cachedAt, doc: doc({ slug, ...overrides }) }));
}

async function saved(slug: string, language: LegalLanguage = 'tr') {
  const raw = await AsyncStorage.getItem(keyOf(slug, language));
  return raw ? JSON.parse(raw) : null;
}

beforeEach(async () => {
  mockGet.mockReset();
  LegalService.resetForTests();
  await AsyncStorage.clear();
  jest.setSystemTime(new Date(NOW));
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('LegalService.list', () => {
  it('GETs /legal in the language, parses the docs and caches each one by slug and language', async () => {
    mockGet.mockResolvedValue([doc(), doc({ slug: 'tos', title: 'Kullanim Kosullari', version: 'x' }), { slug: 'bad' }]);

    const docs = await LegalService.list('tr');

    expect(mockGet).toHaveBeenCalledWith('/legal', asked('tr'));
    expect(docs.map(d => d.slug)).toEqual(['privacy', 'tos']);
    expect(docs[1].version).toBe(1); // invalid version falls back to 1
    expect(docs[0].fromCache).toBe(false);

    const cached = await saved('privacy');
    expect(cached).toEqual({
      cachedAt: NOW,
      doc: {
        slug: 'privacy',
        language: 'tr',
        title: 'Gizlilik Politikasi',
        contentMd: '## Gizlilik\n\n- Verilerini korumak onceligimizdir.',
        version: 3,
        publishedAt: '2026-09-01T00:00:00.000Z',
      },
    });
    expect(cached.doc).not.toHaveProperty('fromCache');
    // The listed documents are known at once afterwards, in that language only.
    expect(LegalService.peek('tos', 'tr')).toMatchObject({ slug: 'tos', title: 'Kullanim Kosullari' });
    expect(LegalService.peek('tos', 'en')).toBeNull();
  });

  it('an English list keeps a Turkish fallback under English', async () => {
    mockGet.mockResolvedValue([doc({ slug: 'tos', language: 'en', title: 'Terms' }), doc({ language: 'tr' })]);

    const docs = await LegalService.list('en');

    expect(mockGet).toHaveBeenCalledWith('/legal', asked('en'));
    expect(docs.map(d => [d.slug, d.language])).toEqual([
      ['tos', 'en'],
      ['privacy', 'tr'],
    ]);
    expect((await saved('privacy', 'en')).doc.language).toBe('tr');
    expect(await saved('privacy', 'tr')).toBeNull();
  });

  it('serves every cached doc of the language (flagged fromCache) when offline', async () => {
    mockGet.mockResolvedValueOnce([doc(), doc({ slug: 'tos', title: 'Kosullar' })]);
    await LegalService.list('tr');
    mockGet.mockResolvedValueOnce([doc({ slug: 'tos', language: 'en', title: 'Terms' })]);
    await LegalService.list('en');
    await AsyncStorage.setItem('legal:tr:broken', '{not json');
    await AsyncStorage.setItem('other:key', JSON.stringify({ doc: doc({ slug: 'other' }) }));
    // A copy saved before documents had languages is not one of them.
    await AsyncStorage.setItem('legal:old', JSON.stringify({ cachedAt: NOW, doc: doc({ slug: 'old' }) }));

    mockGet.mockRejectedValue(apiErrorFromResponse(undefined, null));
    const docs = await LegalService.list('tr');
    expect(docs.map(d => d.slug).sort()).toEqual(['privacy', 'tos']);
    expect(docs.every(d => d.fromCache === true && d.language === 'tr')).toBe(true);

    const english = await LegalService.list('en');
    expect(english).toEqual([expect.objectContaining({ slug: 'tos', language: 'en', title: 'Terms', fromCache: true })]);
  });

  it('rethrows the network error when nothing is cached', async () => {
    const error = apiErrorFromResponse(503, { message: 'Bakimdayiz.' });
    mockGet.mockRejectedValue(error);
    await expect(LegalService.list('tr')).rejects.toBe(error);
  });

  it('rethrows when the cache itself cannot be listed', async () => {
    storage.getAllKeys.mockRejectedValueOnce(new Error('storage down'));
    const error = apiErrorFromResponse(undefined, null);
    mockGet.mockRejectedValue(error);
    await expect(LegalService.list('tr')).rejects.toBe(error);
  });

  it('still returns fresh docs when the cache write fails', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('disk full'));
    mockGet.mockResolvedValue([doc()]);
    await expect(LegalService.list('tr')).resolves.toHaveLength(1);
  });
});

describe('LegalService.read without a saved copy (network-first)', () => {
  it('GETs /legal/:slug (encoded) in the language, caches the doc and does not report a refresh', async () => {
    mockGet.mockResolvedValue(doc({ slug: 'data-deletion', title: 'Veri Silme' }));
    const onRefresh = jest.fn();

    const result = await LegalService.read('data-deletion', { language: 'tr', onRefresh });

    expect(mockGet).toHaveBeenCalledWith('/legal/data-deletion', asked('tr'));
    expect(result).toEqual({
      status: 'document',
      doc: expect.objectContaining({ slug: 'data-deletion', language: 'tr', title: 'Veri Silme', fromCache: false }),
    });
    expect((await saved('data-deletion')).cachedAt).toBe(NOW);
    await flush();
    expect(onRefresh).not.toHaveBeenCalled();

    mockGet.mockResolvedValue(doc({ slug: 'a/b' }));
    await LegalService.read('a/b', TR);
    expect(mockGet).toHaveBeenLastCalledWith('/legal/a%2Fb', asked('tr'));
  });

  it('asks for the language it is given', async () => {
    mockGet.mockResolvedValue(doc({ slug: 'tos', language: 'en', title: 'Terms of Use' }));

    const result = await LegalService.read('tos', EN);

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0]).toEqual(['/legal/tos', { params: { language: 'en' } }]);
    expect(result).toEqual({
      status: 'document',
      doc: expect.objectContaining({ language: 'en', title: 'Terms of Use' }),
    });
    expect((await saved('tos', 'en')).doc).toMatchObject({ language: 'en', title: 'Terms of Use' });
  });

  it('an English read served in Turkish says so and is kept under English', async () => {
    mockGet.mockResolvedValue(doc({ slug: 'tos', language: 'tr', title: 'Kullanim Kosullari' }));

    const result = await LegalService.read('tos', EN);

    expect(result).toMatchObject({ status: 'document', doc: { language: 'tr', fromCache: false } });
    expect((await saved('tos', 'en')).doc.language).toBe('tr');
    expect(await saved('tos', 'tr')).toBeNull();
    expect(LegalService.peek('tos', 'en')).toMatchObject({ language: 'tr', fromCache: true });
    expect(LegalService.peek('tos', 'tr')).toBeNull();
  });

  it('waits for the network: nothing resolves before the request does', async () => {
    const request = deferred<unknown>();
    mockGet.mockReturnValue(request.promise);
    const done = jest.fn();
    void LegalService.read('tos', TR).then(done);
    await flush();
    expect(done).not.toHaveBeenCalled();

    request.resolve(doc({ slug: 'tos' }));
    await flush();
    expect(done).toHaveBeenCalledWith({ status: 'document', doc: expect.objectContaining({ slug: 'tos' }) });
  });

  it('maps the 404 of an unpublished document to its own result', async () => {
    mockGet.mockRejectedValue(apiErrorFromResponse(404, { message: 'Belge bulunamadi.' }));
    await expect(LegalService.read('tos', TR)).resolves.toEqual({ status: 'unpublished' });
    expect(await saved('tos')).toBeNull();
  });

  it('rethrows any other failure when there is no usable saved copy', async () => {
    const error = apiErrorFromResponse(undefined, null);
    mockGet.mockRejectedValue(error);
    await expect(LegalService.read('tos', TR)).rejects.toBe(error);

    // A malformed saved copy counts as none.
    await AsyncStorage.setItem(keyOf('tos'), JSON.stringify({ cachedAt: 'yesterday', doc: doc() }));
    await expect(LegalService.read('tos', TR)).rejects.toBe(error);

    await AsyncStorage.setItem(keyOf('tos'), '{corrupt');
    await expect(LegalService.read('tos', TR)).rejects.toBe(error);

    await AsyncStorage.setItem(keyOf('tos'), JSON.stringify({ cachedAt: NOW, doc: { slug: 'tos' } }));
    await expect(LegalService.read('tos', TR)).rejects.toBe(error);

    // A copy saved before documents had languages is not read.
    await AsyncStorage.setItem('legal:tos', JSON.stringify({ cachedAt: NOW, doc: doc({ slug: 'tos' }) }));
    await expect(LegalService.read('tos', TR)).rejects.toBe(error);
  });

  it('rejects an invalid document and an empty slug', async () => {
    mockGet.mockResolvedValue({ slug: 'tos', title: 'Kosullar' }); // no contentMd
    await expect(LegalService.read('tos', TR)).rejects.toThrow(/contentMd/);

    await expect(LegalService.read('', TR)).rejects.toThrow('Legal document slug is required');
  });
});

describe('LegalService.read with a saved copy (cache-first)', () => {
  it('returns the saved copy at once and refreshes it in the background', async () => {
    await saveCopy('privacy', NOW - 30 * 24 * HOUR_MS, { title: 'Eski Gizlilik' });
    const request = deferred<unknown>();
    mockGet.mockReturnValue(request.promise);
    const refreshes: LegalRefresh[] = [];

    // Resolves although the request is still pending.
    const result = await LegalService.read('privacy', { language: 'tr', onRefresh: r => refreshes.push(r) });
    expect(result).toEqual({
      status: 'document',
      doc: expect.objectContaining({ title: 'Eski Gizlilik', fromCache: true }),
    });
    expect(mockGet).toHaveBeenCalledWith('/legal/privacy', asked('tr'));
    expect(refreshes).toEqual([]);

    request.resolve(doc({ title: 'Yeni Gizlilik', version: 4 }));
    await flush();
    expect(refreshes).toEqual([
      { status: 'document', doc: expect.objectContaining({ title: 'Yeni Gizlilik', version: 4, fromCache: false }) },
    ]);
    expect(await saved('privacy')).toMatchObject({ cachedAt: NOW, doc: { title: 'Yeni Gizlilik', version: 4 } });
    expect(LegalService.peek('privacy', 'tr')).toMatchObject({ title: 'Yeni Gizlilik' });
  });

  it('the cache is keyed by slug and language: a Turkish copy is never an English read', async () => {
    await saveCopy('tos', NOW - HOUR_MS, { title: 'Kosullar' }, 'tr');
    const request = deferred<unknown>();
    mockGet.mockReturnValue(request.promise);
    const done = jest.fn();

    void LegalService.read('tos', EN).then(done);
    await flush();
    // No English copy: the read waits for the English request.
    expect(done).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledWith('/legal/tos', asked('en'));

    request.resolve(doc({ slug: 'tos', language: 'en', title: 'Terms' }));
    await flush();
    expect(done).toHaveBeenCalledWith({
      status: 'document',
      doc: expect.objectContaining({ language: 'en', title: 'Terms', fromCache: false }),
    });
    // Each language keeps its own copy.
    expect((await saved('tos', 'tr')).doc.title).toBe('Kosullar');
    expect((await saved('tos', 'en')).doc.title).toBe('Terms');
    expect(LegalService.peek('tos', 'en')).toMatchObject({ title: 'Terms' });
  });

  it('a Turkish fallback saved under English is served at once and replaced once English is published', async () => {
    await saveCopy('privacy', NOW - HOUR_MS, { language: 'tr', title: 'Gizlilik' }, 'en');
    mockGet.mockResolvedValue(doc({ language: 'en', title: 'Privacy Policy' }));
    const onRefresh = jest.fn();

    const result = await LegalService.read('privacy', { language: 'en', onRefresh });
    expect(result).toMatchObject({ status: 'document', doc: { language: 'tr', title: 'Gizlilik', fromCache: true } });
    expect(mockGet).toHaveBeenCalledWith('/legal/privacy', asked('en'));

    await flush();
    expect(onRefresh).toHaveBeenCalledWith({
      status: 'document',
      doc: expect.objectContaining({ language: 'en', title: 'Privacy Policy' }),
    });
    expect((await saved('privacy', 'en')).doc).toMatchObject({ language: 'en', title: 'Privacy Policy' });
  });

  it('a saved copy without a language (older backend) reads as Turkish', async () => {
    await AsyncStorage.setItem(
      keyOf('tos', 'en'),
      JSON.stringify({ cachedAt: NOW, doc: { slug: 'tos', title: 'Kosullar', contentMd: 'Metin.', version: 2 } }),
    );
    mockGet.mockReturnValue(new Promise(() => undefined));
    await expect(LegalService.read('tos', EN)).resolves.toMatchObject({
      doc: { language: 'tr', title: 'Kosullar', fromCache: true },
    });
  });

  it('keeps the saved copy and reports the failure when the refresh fails', async () => {
    await saveCopy('tos', NOW - HOUR_MS, { title: 'Kosullar' });
    const error = apiErrorFromResponse(undefined, null);
    mockGet.mockRejectedValue(error);
    const onRefresh = jest.fn();

    await expect(LegalService.read('tos', { language: 'tr', onRefresh })).resolves.toMatchObject({
      status: 'document',
      doc: { title: 'Kosullar', fromCache: true },
    });
    await flush();
    expect(onRefresh).toHaveBeenCalledWith({ status: 'failed', error });
    expect(await saved('tos')).not.toBeNull();
    expect(LegalService.peek('tos', 'tr')).toMatchObject({ title: 'Kosullar' });
  });

  it('a document unpublished since it was saved: the refresh says so and the copy is removed', async () => {
    await saveCopy('tos', NOW - HOUR_MS);
    await saveCopy('tos', NOW - HOUR_MS, { language: 'en' }, 'en');
    mockGet.mockRejectedValue(apiErrorFromResponse(404, null));
    const onRefresh = jest.fn();

    await LegalService.read('tos', { language: 'tr', onRefresh });
    await flush();

    expect(onRefresh).toHaveBeenCalledWith({ status: 'unpublished' });
    expect(await saved('tos')).toBeNull();
    expect(LegalService.peek('tos', 'tr')).toBeNull();
    // Only the copy of the language that was asked for.
    expect(await saved('tos', 'en')).not.toBeNull();
    // The next read waits for the network again.
    mockGet.mockResolvedValue(doc({ slug: 'tos', title: 'Yayinda' }));
    await expect(LegalService.read('tos', TR)).resolves.toMatchObject({ doc: { title: 'Yayinda', fromCache: false } });
  });

  it('a read in the same session uses the copy in memory without touching storage', async () => {
    mockGet.mockResolvedValue(doc({ slug: 'tos' }));
    await LegalService.read('tos', TR);
    storage.getItem.mockClear();

    await expect(LegalService.read('tos', TR)).resolves.toMatchObject({ doc: { fromCache: true } });
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it('an unreadable storage falls back to the network', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('storage down'));
    mockGet.mockResolvedValue(doc({ slug: 'tos' }));
    await expect(LegalService.read('tos', TR)).resolves.toMatchObject({ doc: { fromCache: false } });
  });
});

describe('LegalService.peek', () => {
  it('is null before the first read and the copy (from cache) after it, per language', async () => {
    expect(LegalService.peek('privacy', 'tr')).toBeNull();
    await saveCopy('privacy', NOW);
    // Storage alone is not read synchronously.
    expect(LegalService.peek('privacy', 'tr')).toBeNull();
    mockGet.mockReturnValue(new Promise(() => undefined));
    await LegalService.read('privacy', TR);
    expect(LegalService.peek('privacy', 'tr')).toEqual({ ...doc(), fromCache: true });
    expect(LegalService.peek('privacy', 'en')).toBeNull();
  });
});

describe('LegalService.prefetch', () => {
  it('fills the cache of the language so the next read is instant', async () => {
    mockGet.mockResolvedValue(doc({ slug: 'tos', title: 'Kosullar' }));

    await LegalService.prefetch('tos', 'tr');

    expect(mockGet).toHaveBeenCalledWith('/legal/tos', asked('tr'));
    expect((await saved('tos')).doc.title).toBe('Kosullar');
    expect(LegalService.peek('tos', 'tr')).toMatchObject({ title: 'Kosullar' });

    // The read returns the prefetched copy without waiting for a request.
    mockGet.mockReset();
    mockGet.mockReturnValue(new Promise(() => undefined));
    await expect(LegalService.read('tos', TR)).resolves.toMatchObject({ doc: { title: 'Kosullar', fromCache: true } });
  });

  it('prefetches in the language it is given', async () => {
    mockGet.mockResolvedValue(doc({ slug: 'privacy', language: 'en', title: 'Privacy Policy' }));
    await LegalService.prefetch('privacy', 'en');
    expect(mockGet).toHaveBeenCalledWith('/legal/privacy', asked('en'));
    expect(LegalService.peek('privacy', 'en')).toMatchObject({ language: 'en', title: 'Privacy Policy' });
    expect(LegalService.peek('privacy', 'tr')).toBeNull();
  });

  it('skips a copy saved within the fresh window and refreshes an older one', async () => {
    await saveCopy('tos', NOW - LEGAL_PREFETCH_FRESH_MS + HOUR_MS);
    await LegalService.prefetch('tos', 'tr');
    expect(mockGet).not.toHaveBeenCalled();

    // A fresh Turkish copy does not stand in for English.
    mockGet.mockResolvedValue(doc({ slug: 'tos', language: 'en' }));
    await LegalService.prefetch('tos', 'en');
    expect(mockGet).toHaveBeenCalledWith('/legal/tos', asked('en'));

    LegalService.resetForTests();
    mockGet.mockReset();
    await saveCopy('privacy', NOW - LEGAL_PREFETCH_FRESH_MS - HOUR_MS);
    mockGet.mockResolvedValue(doc({ title: 'Yeni' }));
    await LegalService.prefetch('privacy', 'tr');
    expect(mockGet).toHaveBeenCalledWith('/legal/privacy', asked('tr'));
    expect(await saved('privacy')).toMatchObject({ cachedAt: NOW, doc: { title: 'Yeni' } });
  });

  it('asks again for a fresh Turkish fallback kept under English, so a published translation replaces it', async () => {
    await saveCopy('tos', NOW - HOUR_MS, { language: 'tr', title: 'Kosullar' }, 'en');
    mockGet.mockResolvedValue(doc({ slug: 'tos', language: 'en', title: 'Terms' }));

    await LegalService.prefetch('tos', 'en');

    expect(mockGet).toHaveBeenCalledWith('/legal/tos', asked('en'));
    expect((await saved('tos', 'en')).doc).toMatchObject({ language: 'en', title: 'Terms' });
    expect(LegalService.peek('tos', 'en')).toMatchObject({ language: 'en', title: 'Terms' });

    // Once the English copy is saved, the next prefetch in the window skips it.
    mockGet.mockClear();
    await LegalService.prefetch('tos', 'en');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('a fallback that is still Turkish stays saved under English (with its new timestamp)', async () => {
    await saveCopy('privacy', NOW - HOUR_MS, { language: 'tr', title: 'Gizlilik' }, 'en');
    mockGet.mockResolvedValue(doc({ language: 'tr', title: 'Gizlilik', version: 4 }));

    await LegalService.prefetch('privacy', 'en');

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(await saved('privacy', 'en')).toMatchObject({ cachedAt: NOW, doc: { language: 'tr', version: 4 } });
    expect(await saved('privacy', 'tr')).toBeNull();
  });

  it('never throws, and an empty slug does nothing', async () => {
    mockGet.mockRejectedValue(apiErrorFromResponse(500, null));
    await expect(LegalService.prefetch('tos', 'tr')).resolves.toBeUndefined();
    mockGet.mockResolvedValue({ slug: 'tos' }); // invalid document
    await expect(LegalService.prefetch('tos', 'tr')).resolves.toBeUndefined();
    expect(await saved('tos')).toBeNull();

    mockGet.mockClear();
    await LegalService.prefetch('', 'tr');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('shares one request with a read of the same language that starts meanwhile', async () => {
    const request = deferred<unknown>();
    mockGet.mockReturnValue(request.promise);

    const prefetched = LegalService.prefetch('tos', 'tr');
    await flush();
    const read = LegalService.read('tos', TR);
    await flush();
    request.resolve(doc({ slug: 'tos' }));

    await prefetched;
    await expect(read).resolves.toMatchObject({ status: 'document', doc: { slug: 'tos' } });
    expect(mockGet).toHaveBeenCalledTimes(1);

    // Once settled, a later fetch is a new request.
    mockGet.mockResolvedValue(doc({ slug: 'tos' }));
    jest.setSystemTime(new Date(NOW + LEGAL_PREFETCH_FRESH_MS + HOUR_MS));
    await LegalService.prefetch('tos', 'tr');
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('a read in another language is its own request', async () => {
    const turkish = deferred<unknown>();
    const english = deferred<unknown>();
    mockGet.mockReturnValueOnce(turkish.promise).mockReturnValueOnce(english.promise);

    const prefetched = LegalService.prefetch('tos', 'tr');
    await flush();
    const read = LegalService.read('tos', EN);
    await flush();
    expect(mockGet.mock.calls).toEqual([
      ['/legal/tos', asked('tr')],
      ['/legal/tos', asked('en')],
    ]);

    turkish.resolve(doc({ slug: 'tos', language: 'tr', title: 'Kosullar' }));
    english.resolve(doc({ slug: 'tos', language: 'en', title: 'Terms' }));
    await prefetched;
    await expect(read).resolves.toMatchObject({ doc: { language: 'en', title: 'Terms' } });
  });
});
