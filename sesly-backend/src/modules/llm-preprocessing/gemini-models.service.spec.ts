import { Logger } from '@nestjs/common';
import {
  GEMINI_MODELS_CACHE_TTL_MS,
  GEMINI_MODELS_TIMEOUT_MS,
  GeminiModelsService,
} from './gemini-models.service';

const model = (name: string, methods: unknown = ['generateContent', 'countTokens']) => ({
  name,
  supportedGenerationMethods: methods,
});

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn().mockResolvedValue(body),
});

describe('GeminiModelsService', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  let config: Record<string, unknown>;
  let warn: jest.SpyInstance;

  const build = () => new GeminiModelsService({ get: (key: string) => config[key] } as any);

  beforeAll(() => {
    (global as any).fetch = fetchMock;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  beforeEach(() => {
    config = { 'gemini.apiKey': 'test-gemini-key' };
    fetchMock.mockReset();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns the text-generation model ids, sorted, without the models/ prefix', async () => {
    fetchMock.mockResolvedValue(
      response(200, {
        models: [
          model('models/gemini-3.8-flash'),
          model('models/gemini-3-flash-preview'),
          model('models/gemini-embedding-001', ['embedContent']),
          model('models/gemini-3.8-flash-preview-tts'),
          model('models/gemini-3.8-flash-image'),
          model('models/gemini-live-3.8-flash'),
          model('models/gemini-3.8-flash-native-audio'),
          model('models/broken', 'generateContent'),
          { supportedGenerationMethods: ['generateContent'] },
          null,
          model('gemini-3.5-flash-lite'),
        ],
      }),
    );

    const result = await build().listTextModels();

    expect(result.models).toEqual(['gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-3.8-flash']);
    expect(result.reason).toBeNull();
    expect(typeof result.fetchedAt).toBe('string');
  });

  it('sends the key in a header, never in the URL, to the configured host', async () => {
    config['gemini.apiUrl'] = 'https://gemini.test';
    fetchMock.mockResolvedValue(response(200, { models: [model('models/a')] }));

    await build().listTextModels();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gemini.test/v1beta/models?pageSize=1000');
    expect(url).not.toContain('test-gemini-key');
    expect(init.headers).toEqual({ 'x-goog-api-key': 'test-gemini-key' });
    expect(init.method).toBe('GET');
  });

  it('follows nextPageToken', async () => {
    fetchMock
      .mockResolvedValueOnce(response(200, { models: [model('models/b')], nextPageToken: 'p 2' }))
      .mockResolvedValueOnce(response(200, { models: [model('models/a')] }));

    const result = await build().listTextModels();

    expect(result.models).toEqual(['a', 'b']);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    );
    expect(fetchMock.mock.calls[1][0]).toContain('&pageToken=p%202');
  });

  it('stops after five pages even if the API keeps returning a token', async () => {
    fetchMock.mockImplementation(async () => response(200, { models: [model('models/a')], nextPageToken: 'again' }));
    const result = await build().listTextModels();
    expect(result.models).toEqual(['a']);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('caches a successful list for about ten minutes', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-13T10:00:00Z'));
    fetchMock.mockResolvedValue(response(200, { models: [model('models/a')] }));
    const service = build();

    const first = await service.listTextModels();
    jest.setSystemTime(Date.now() + GEMINI_MODELS_CACHE_TTL_MS - 1);
    const second = await service.listTextModels();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.fetchedAt).toBe('2026-10-13T10:00:00.000Z');

    // The cached array is not handed out by reference.
    second.models.push('mutated');
    expect((await service.listTextModels()).models).toEqual(['a']);

    jest.setSystemTime(Date.now() + 2);
    fetchMock.mockResolvedValue(response(200, { models: [model('models/b')] }));
    expect((await service.listTextModels()).models).toEqual(['b']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  describe('failures are a 200-shaped empty list with a reason (never a throw, never cached)', () => {
    it('no API key: no request is made', async () => {
      config = {};
      await expect(build().listTextModels()).resolves.toEqual({
        models: [],
        reason: 'Gemini API anahtarı sunucuda tanımlı değil.',
        fetchedAt: null,
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('HTTP error, then recovery on the next call', async () => {
      const service = build();
      fetchMock.mockResolvedValueOnce(response(403, { error: { message: 'API key not valid' } }));
      await expect(service.listTextModels()).resolves.toEqual({
        models: [],
        reason: 'Gemini model listesi alınamadı (HTTP 403).',
        fetchedAt: null,
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('test-gemini-key');

      fetchMock.mockResolvedValueOnce(response(200, { models: [model('models/a')] }));
      expect((await service.listTextModels()).models).toEqual(['a']);
    });

    it.each([
      [{ models: [] }],
      [{}],
      [null],
      [{ models: [model('models/gemini-embedding-001', ['embedContent'])] }],
    ])('no usable model in %j', async (body) => {
      fetchMock.mockResolvedValue(response(200, body));
      await expect(build().listTextModels()).resolves.toEqual({
        models: [],
        reason: 'Gemini bu anahtar için metin üretebilen bir model döndürmedi.',
        fetchedAt: null,
      });
    });

    it('network error', async () => {
      fetchMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
      await expect(build().listTextModels()).resolves.toMatchObject({
        models: [],
        reason: 'Gemini model listesi alınamadı: bağlantı hatası.',
      });
    });

    it('a non-Error rejection and a non-JSON body are handled', async () => {
      fetchMock.mockRejectedValueOnce('weird');
      await expect(build().listTextModels()).resolves.toMatchObject({ models: [] });

      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: jest.fn().mockRejectedValue(new Error('bad json')) });
      await expect(build().listTextModels()).resolves.toMatchObject({
        reason: 'Gemini model listesi alınamadı: bağlantı hatası.',
      });
    });

    it('times out instead of hanging', async () => {
      jest.useFakeTimers();
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
            );
          }),
      );

      const pending = build().listTextModels();
      await jest.advanceTimersByTimeAsync(GEMINI_MODELS_TIMEOUT_MS);

      await expect(pending).resolves.toEqual({
        models: [],
        reason: 'Gemini model listesi alınamadı: istek zaman aşımına uğradı.',
        fetchedAt: null,
      });
    });
  });
});
