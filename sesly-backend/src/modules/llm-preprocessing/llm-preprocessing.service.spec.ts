import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LlmContentDriftError,
  LlmPreprocessingService,
  LlmStorySegment,
} from './llm-preprocessing.service';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';
import {
  SONIC3_EXTENDED_EMOTIONS,
  SONIC3_SPEED_MAX,
  SONIC3_SPEED_MIN,
  SONIC3_VOLUME_MAX,
  SONIC3_VOLUME_MIN,
} from '../tts-providers/cartesia/cartesia-emotions.constants';

// ---------------------------------------------------------------------------
// Fixtures: every paragraph is >= 80 chars so the "merge undersized" layer
// stays out of the way unless a test wants it.
// ---------------------------------------------------------------------------
const P1 =
  'Bir varmis bir yokmus, evvel zaman icinde kalbur saman icinde, uzak bir koyde Keloglan adinda bir cocuk yasarmis.';
const P2 =
  '"Anne, bugun ormana gidecegim," dedi Keloglan. Annesi ona dikkatli olmasini ve karanlik cokmeden donmesini soyledi.';
const P3 =
  'Orman cok sessizdi. Agaclarin arasindan garip bir isik parliyordu ve Keloglan merakla o isiga dogru yurumeye basladi.';
const P4 =
  'Isik yaklastikca buyudu ve sonunda kocaman, yasli bir agacin kovugundan geldigi anlasildi. Keloglan nefesini tuttu.';
const SHORT = 'Sonra ruzgar esti.';
const CONTENT = `${P1}\n\n${P2}\n\n${P3}`;

type FetchResponseMock = {
  ok: boolean;
  status: number;
  json: jest.Mock;
  text: jest.Mock;
};

function httpResponse(status: number, body: unknown): FetchResponseMock {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
    text: jest.fn().mockResolvedValue(''),
  };
}

function geminiText(text: string, extra: Record<string, unknown> = {}): FetchResponseMock {
  return httpResponse(200, {
    candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    ...extra,
  });
}

function geminiSegments(segments: unknown[], extra: Record<string, unknown> = {}): FetchResponseMock {
  return geminiText(JSON.stringify({ segments }), extra);
}

const joined = (segments: LlmStorySegment[]) => segments.map((s) => s.text).join('');

describe('LlmPreprocessingService', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  let config: Record<string, unknown>;
  let settings: SettingsStub;

  const build = () =>
    new LlmPreprocessingService(
      { get: jest.fn((key: string) => config[key]) } as any,
      settings as any,
    );

  beforeAll(() => {
    (global as any).fetch = fetchMock;
  });

  afterAll(() => {
    (global as any).fetch = originalFetch;
  });

  beforeEach(() => {
    config = { 'gemini.apiKey': 'test-gemini-key' };
    settings = createSettingsStub();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(
      geminiSegments([
        { text: `${P1}\n\n`, emotion: 'peaceful', speed: 0.8 },
        { text: `${P2}\n\n`, emotion: 'curious', speed: 0.95 },
        { text: P3, emotion: 'mysterious', speed: 0.82 },
      ]),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fixtures are long enough to not trigger the merge layer', () => {
    for (const p of [P1, P2, P3, P4]) expect(p.length).toBeGreaterThanOrEqual(80);
    expect(SHORT.length).toBeLessThan(80);
  });

  it('exposes the Sonic 3 numeric limits as statics', () => {
    expect(LlmPreprocessingService.SPEED_MIN).toBe(SONIC3_SPEED_MIN);
    expect(LlmPreprocessingService.SPEED_MAX).toBe(SONIC3_SPEED_MAX);
    expect(LlmPreprocessingService.VOLUME_MIN).toBe(SONIC3_VOLUME_MIN);
    expect(LlmPreprocessingService.VOLUME_MAX).toBe(SONIC3_VOLUME_MAX);
  });

  describe('configuration', () => {
    it('isConfigured reflects the API key', () => {
      expect(build().isConfigured()).toBe(true);
      config = {};
      expect(build().isConfigured()).toBe(false);
    });

    it('rejects with 503 and never calls Gemini when the API key is missing', async () => {
      config = {};
      await expect(build().preprocessStory(CONTENT)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('Gemini request', () => {
    it('POSTs the prompt, schema and story to generateContent with default settings', async () => {
      await build().preprocessStory(CONTENT);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
      );
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({
        'Content-Type': 'application/json',
        'x-goog-api-key': 'test-gemini-key',
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);

      const body = JSON.parse(init.body);
      expect(body.contents).toEqual([{ role: 'user', parts: [{ text: `HIKAYE:\n\n${CONTENT}` }] }]);
      expect(body.systemInstruction.parts[0].text).toContain('GIRDIYI ASLA DEGISTIRME');
      expect(body.generationConfig).toMatchObject({
        temperature: 0.2,
        topP: 0.95,
        maxOutputTokens: 32768,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
      });
      const schema = body.generationConfig.responseSchema;
      expect(schema.required).toEqual(['segments']);
      expect(schema.properties.segments.items.required).toEqual(['text', 'emotion', 'speed']);
      expect(schema.properties.segments.items.properties.emotion.enum).toEqual([
        ...SONIC3_EXTENDED_EMOTIONS,
      ]);
    });

    it('never puts the API key in the URL', async () => {
      await build().preprocessStory(CONTENT);
      expect(fetchMock.mock.calls[0][0]).not.toContain('test-gemini-key');
    });

    it('honours the apiUrl config and the model / temperature / thinkingBudget settings (model is URL-encoded)', async () => {
      config['gemini.apiUrl'] = 'https://gemini.test';
      settings.values = {
        'llm.gemini.model': 'gemini x/beta',
        'llm.gemini.temperature': 0.5,
        'llm.gemini.thinkingBudget': 128,
      };

      const result = await build().preprocessStory(CONTENT);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://gemini.test/v1beta/models/gemini%20x%2Fbeta:generateContent');
      const body = JSON.parse(init.body);
      expect(body.generationConfig.temperature).toBe(0.5);
      expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 128, includeThoughts: false });
      expect(result.modelUsed).toBe('gemini x/beta');
    });

    it('reads the settings on every call: a panel change applies without rebuilding the service', async () => {
      const service = build();
      await service.preprocessStory(CONTENT);
      expect(fetchMock.mock.calls[0][0]).toContain('/models/gemini-3-flash-preview:generateContent');

      settings.values['llm.gemini.model'] = 'gemini-next-flash';
      settings.values['llm.gemini.temperature'] = 0.7;
      settings.values['llm.gemini.thinkingBudget'] = -1;
      const result = await service.preprocessStory(CONTENT);

      const [url, init] = fetchMock.mock.calls[1];
      expect(url).toContain('/models/gemini-next-flash:generateContent');
      const body = JSON.parse(init.body);
      expect(body.generationConfig.temperature).toBe(0.7);
      expect(body.generationConfig.thinkingConfig.thinkingBudget).toBe(-1);
      expect(result.modelUsed).toBe('gemini-next-flash');
    });
  });

  describe('valid model output', () => {
    it('returns the segments, raw segments, model, usage and no warnings', async () => {
      fetchMock.mockResolvedValue(
        geminiSegments(
          [
            { text: `${P1}\n\n`, emotion: 'peaceful', speed: 0.8 },
            { text: `${P2}\n\n`, emotion: 'curious', speed: 0.95, volume: 1.1 },
            { text: P3, emotion: 'mysterious', speed: 0.82 },
          ],
          {
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 50,
              thoughtsTokenCount: 0,
              totalTokenCount: 150,
            },
          },
        ),
      );

      const result = await build().preprocessStory(CONTENT);

      expect(result.segments).toEqual([
        { text: `${P1}\n\n`, emotion: 'peaceful', speed: 0.8 },
        { text: `${P2}\n\n`, emotion: 'curious', speed: 0.95, volume: 1.1 },
        { text: P3, emotion: 'mysterious', speed: 0.82 },
      ]);
      expect(result.rawSegments).toEqual(result.segments);
      expect(joined(result.segments)).toBe(CONTENT);
      expect(result.modelUsed).toBe('gemini-3-flash-preview');
      expect(result.usage).toEqual({
        promptTokens: 100,
        candidatesTokens: 50,
        thoughtsTokens: 0,
        totalTokens: 150,
      });
      expect(result.warnings).toEqual([]);
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('usage is undefined when Gemini does not report it', async () => {
      const result = await build().preprocessStory(CONTENT);
      expect(result.usage).toBeUndefined();
    });

    it('drops wrongly-typed optional fields (string speed, numeric emotion)', async () => {
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: `${P1}\n\n`, emotion: 5, speed: '0.8', volume: 1.2 },
          { text: `${P2}\n\n${P3}`, emotion: 'calm', speed: 0.8 },
        ]),
      );
      const result = await build().preprocessStory(CONTENT);
      expect(result.rawSegments[0]).toEqual({ text: `${P1}\n\n`, volume: 1.2 });
      expect(result.segments[0]).toEqual({ text: `${P1}\n\n`, volume: 1.2 });
    });
  });

  describe('content preservation (whitespace re-injection)', () => {
    it('re-attaches boundary whitespace the LLM ate and reports it', async () => {
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: P1, emotion: 'peaceful', speed: 0.8 },
          { text: P2, emotion: 'curious', speed: 0.95 },
          { text: P3, emotion: 'mysterious', speed: 0.82 },
        ]),
      );

      const result = await build().preprocessStory(CONTENT);

      expect(result.segments.map((s) => s.text)).toEqual([`${P1}\n\n`, `${P2}\n\n`, P3]);
      expect(joined(result.segments)).toBe(CONTENT);
      // rawSegments keep what the LLM actually returned
      expect(result.rawSegments.map((s) => s.text)).toEqual([P1, P2, P3]);
      // metadata survives re-injection
      expect(result.segments.map((s) => s.emotion)).toEqual(['peaceful', 'curious', 'mysterious']);
      expect(result.warnings).toEqual([
        '2 segmentin sinirinda eksik bosluk/satir tespit edildi ve orijinal metinden geri eklendi.',
      ]);
    });

    it.each([
      ['no boundary whitespace', [P1, P2, P3]],
      ['whitespace moved to the start of the next segment', [P1, `\n\n${P2}`, `\n\n${P3}`]],
      ['single space instead of blank line', [`${P1} `, `${P2} `, P3]],
      ['exact', [`${P1}\n\n`, `${P2}\n\n`, P3]],
      ['everything in one segment', [`${P1} ${P2} ${P3}`]],
    ])('concatenated segments reproduce the story verbatim (%s)', async (_label, texts) => {
      fetchMock.mockResolvedValue(
        geminiSegments(texts.map((text) => ({ text, emotion: 'peaceful', speed: 0.8 }))),
      );
      const result = await build().preprocessStory(CONTENT);
      expect(joined(result.segments)).toBe(CONTENT);
    });

    it('restores internal whitespace the LLM normalized (double spaces, newlines)', async () => {
      const original = `${P1.replace('bir yokmus', 'bir\n   yokmus')}\n\n${P2}`;
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: P1, emotion: 'peaceful', speed: 0.8 },
          { text: P2, emotion: 'calm', speed: 0.8 },
        ]),
      );
      const result = await build().preprocessStory(original);
      expect(result.segments[0].text).toContain('bir\n   yokmus');
      expect(joined(result.segments)).toBe(original);
    });

    it('flushes trailing whitespace of the story onto the last segment', async () => {
      const original = `${CONTENT}\n`;
      const result = await build().preprocessStory(original);
      expect(result.segments[2].text).toBe(`${P3}\n`);
      expect(joined(result.segments)).toBe(original);
    });
  });

  describe('content drift (LLM changed the story)', () => {
    it('rejects a changed word with LlmContentDriftError carrying distance + diff', async () => {
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: P1.replace('Keloglan', 'Kelogan'), emotion: 'peaceful', speed: 0.8 },
          { text: P2, emotion: 'curious', speed: 0.95 },
          { text: P3, emotion: 'mysterious', speed: 0.82 },
        ]),
      );

      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(LlmContentDriftError);
      const drift = err as LlmContentDriftError;
      expect(drift.name).toBe('LlmContentDriftError');
      expect(drift.editDistance).toBe(1);
      expect(drift.message).toBe('LLM hikayeyi degistirdi (1 karakter farki). Sonuc reddedildi.');
      expect(drift.diffSnippet).toMatch(/^recon: ".*" \| orig: ".*"$/);
      expect(drift.diffSnippet).toContain('Kelogan');
    });

    it('rejects a dropped paragraph (recon shorter than original)', async () => {
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: P1, emotion: 'peaceful', speed: 0.8 },
          { text: P2, emotion: 'curious', speed: 0.95 },
        ]),
      );
      const err = (await build().preprocessStory(CONTENT).catch((e: unknown) => e)) as LlmContentDriftError;
      expect(err).toBeInstanceOf(LlmContentDriftError);
      expect(err.editDistance).toBe(P3.replace(/\s+/g, '').length);
      expect(err.diffSnippet.startsWith('recon: (eos) | orig: "')).toBe(true);
    });

    it('rejects added text (paraphrase / commentary)', async () => {
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: `${P1} Ne guzel!`, emotion: 'peaceful', speed: 0.8 },
          { text: P2, emotion: 'curious', speed: 0.95 },
          { text: P3, emotion: 'mysterious', speed: 0.82 },
        ]),
      );
      const err = (await build().preprocessStory(CONTENT).catch((e: unknown) => e)) as LlmContentDriftError;
      expect(err).toBeInstanceOf(LlmContentDriftError);
      expect(err.editDistance).toBe('Neguzel!'.length);
    });

    it('treats a non-string segment text as missing content (drift)', async () => {
      fetchMock.mockResolvedValue(geminiSegments([{ text: 42, emotion: 'calm', speed: 0.8 }]));
      await expect(build().preprocessStory(CONTENT)).rejects.toBeInstanceOf(LlmContentDriftError);
    });
  });

  describe('defensive layers', () => {
    it('demotes the second of two consecutive scared segments to excited', async () => {
      const story = [P1, P2, P3, P4].join('\n\n');
      fetchMock.mockResolvedValue(
        geminiSegments([P1, P2, P3, P4].map((text) => ({ text, emotion: 'scared', speed: 0.9 }))),
      );

      const result = await build().preprocessStory(story);

      expect(result.segments.map((s) => s.emotion)).toEqual(['scared', 'excited', 'scared', 'excited']);
      expect(result.rawSegments.every((s) => s.emotion === 'scared')).toBe(true);
      expect(result.warnings).toContain("2 ardisik 'scared' segmenti 'excited' olarak degistirildi.");
    });

    it('merges an undersized segment into the previous one (previous metadata wins)', async () => {
      const story = `${P1} ${SHORT}\n\n${P2}`;
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: `${P1} `, emotion: 'peaceful', speed: 0.8 },
          { text: `${SHORT}\n\n`, emotion: 'scared', speed: 0.95, volume: 1.5 },
          { text: P2, emotion: 'happy', speed: 0.9 },
        ]),
      );

      const result = await build().preprocessStory(story);

      expect(result.segments).toHaveLength(2);
      expect(result.segments[0]).toEqual({
        text: `${P1} ${SHORT}\n\n`,
        emotion: 'peaceful',
        speed: 0.8,
        volume: 1.5,
      });
      expect(result.segments[1]).toEqual({ text: P2, emotion: 'happy', speed: 0.9 });
      expect(joined(result.segments)).toBe(story);
      expect(result.warnings).toContain('1 kisa segment (<80 karakter) bir oncekiyle birlestirildi.');
      expect(result.rawSegments).toHaveLength(3);
    });

    it('fills missing metadata of the previous segment from the merged short one', async () => {
      const story = `${P1} ${SHORT}`;
      fetchMock.mockResolvedValue(
        geminiSegments([{ text: `${P1} ` }, { text: SHORT, emotion: 'sad', speed: 0.8 }]),
      );
      const result = await build().preprocessStory(story);
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0]).toMatchObject({ text: story, emotion: 'sad', speed: 0.8 });
    });

    // Fixed (was BUG): the loop only merged into a PREVIOUS segment, so a short
    // FIRST segment (e.g. a title line) stayed a standalone tiny TTS segment.
    // The comment now documents the real metadata rule (target segment wins).
    it('merges an undersized FIRST segment into the next one', async () => {
      const story = `${SHORT} ${P1}`;
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: SHORT, emotion: 'peaceful', speed: 0.8 },
          { text: P1, emotion: 'curious', speed: 0.9 },
        ]),
      );
      const result = await build().preprocessStory(story);
      expect(result.segments).toHaveLength(1);
      expect(result.segments[0].text).toBe(story);
      // The segment it was folded into keeps its metadata.
      expect(result.segments[0]).toMatchObject({ emotion: 'curious', speed: 0.9 });
      expect(result.warnings).toContain('Kisa ilk segment (<80 karakter) bir sonrakiyle birlestirildi.');
    });

    it('a short first segment fills the missing metadata of the next one', async () => {
      const story = `${SHORT} ${P1}`;
      fetchMock.mockResolvedValue(
        geminiSegments([{ text: SHORT, emotion: 'peaceful', speed: 0.8 }, { text: P1 }]),
      );
      const result = await build().preprocessStory(story);
      expect(result.segments).toEqual([{ text: story, emotion: 'peaceful', speed: 0.8 }]);
    });

    it('a single short segment (the whole story) is kept as is', async () => {
      fetchMock.mockResolvedValue(geminiSegments([{ text: SHORT, emotion: 'calm' }]));
      const result = await build().preprocessStory(SHORT);
      expect(result.segments).toEqual([{ text: SHORT, emotion: 'calm' }]);
    });

    it('merging a short first segment preserves the content exactly', async () => {
      const story = `${SHORT} ${P1}`;
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: SHORT, emotion: 'peaceful', speed: 0.8 },
          { text: P1, emotion: 'curious', speed: 0.9 },
        ]),
      );
      const result = await build().preprocessStory(story);
      expect(joined(result.segments)).toBe(story);
    });

    it('warns (but keeps) emotions outside the bedtime whitelist, sampling at most 3', async () => {
      const story = [P1, P2, P3, P4].join('\n\n');
      fetchMock.mockResolvedValue(
        geminiSegments([
          { text: P1, emotion: 'melancholic', speed: 0.8 },
          { text: P2, emotion: 'proud', speed: 0.8 },
          { text: P3, emotion: 'angry', speed: 0.8 },
          { text: P4, emotion: 'bored', speed: 0.8 },
        ]),
      );

      const result = await build().preprocessStory(story);

      expect(result.segments.map((s) => s.emotion)).toEqual(['melancholic', 'proud', 'angry', 'bored']);
      expect(result.warnings).toContain(
        "4 segment 'bedtime' duygu listesi disinda (melancholic, proud, angry). Admin kontrol etmeli.",
      );
    });
  });

  describe('malformed model output -> 502', () => {
    it('non-JSON text', async () => {
      fetchMock.mockResolvedValue(geminiText('Iste cikti: {"segments": []}'));
      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadGatewayException);
      expect((err as Error).message).toMatch(/^Gemini returned non-JSON: /);
    });

    it.each([
      ['missing segments', '{"foo":1}'],
      ['empty segments', '{"segments":[]}'],
      ['segments not an array', '{"segments":"a,b"}'],
      ['a bare array', '[{"text":"x"}]'],
    ])('%s', async (_label, text) => {
      fetchMock.mockResolvedValue(geminiText(text));
      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadGatewayException);
      expect((err as Error).message).toBe('Gemini response had no usable segments array.');
    });

    // Fixed (was BUG): JSON.parse('null') succeeded and `parsed.segments`
    // threw a TypeError (500) instead of the usual 502.
    it.each([['null'], ['42'], ['"segments"']])('JSON %s is a 502 like every other malformed output', async (text) => {
      fetchMock.mockResolvedValue(geminiText(text));
      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadGatewayException);
      expect((err as Error).message).toBe('Gemini response had no usable segments array.');
    });

    it('empty text reports the finish reason', async () => {
      fetchMock.mockResolvedValue(
        httpResponse(200, { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] }),
      );
      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadGatewayException);
      expect((err as Error).message).toBe('Gemini returned empty text (finishReason=SAFETY)');
    });

    it('no candidates at all', async () => {
      fetchMock.mockResolvedValue(httpResponse(200, {}));
      await expect(build().preprocessStory(CONTENT)).rejects.toThrow(
        'Gemini returned empty text (finishReason=undefined)',
      );
    });
  });

  describe('HTTP failures', () => {
    it.each([429, 503])('%i is a retryable 503', async (status) => {
      fetchMock.mockResolvedValue(httpResponse(status, { error: { message: 'Resource exhausted' } }));
      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect((err as Error).message).toBe(`Gemini ${status}: Resource exhausted`);
    });

    it('other statuses are a 502 with the upstream message', async () => {
      fetchMock.mockResolvedValue(httpResponse(400, { error: { message: 'API key not valid' } }));
      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadGatewayException);
      expect((err as Error).message).toBe('Gemini 400: API key not valid');
    });

    it('falls back to the JSON body when there is no error.message', async () => {
      fetchMock.mockResolvedValue(httpResponse(500, { foo: 'bar' }));
      await expect(build().preprocessStory(CONTENT)).rejects.toThrow('Gemini 500: {"foo":"bar"}');
    });

    it('a non-JSON HTTP body is a 502 with the status', async () => {
      const res = httpResponse(502, null);
      res.json.mockRejectedValue(new SyntaxError('Unexpected token <'));
      res.text.mockResolvedValue('<html>Bad Gateway</html>');
      fetchMock.mockResolvedValue(res);

      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadGatewayException);
      expect((err as Error).message).toBe('Gemini non-JSON response (status 502): <html>Bad Gateway</html>');
    });

    it('a non-JSON HTTP body from a real fetch Response is still a 502', async () => {
      fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
      const err = await build().preprocessStory(CONTENT).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadGatewayException);
      expect((err as Error).message).toMatch(/^Gemini non-JSON response \(status 502\)/);
    });

    // Fixed (was BUG): res.json() consumed the body, so the fallback res.text()
    // on a real Response always rejected and the snippet was always empty.
    it('includes the upstream body snippet for a non-JSON real Response', async () => {
      fetchMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 }));
      await expect(build().preprocessStory(CONTENT)).rejects.toThrow('<html>Bad Gateway</html>');
    });

    it('propagates network errors from fetch unchanged', async () => {
      const netErr = new TypeError('fetch failed');
      fetchMock.mockRejectedValue(netErr);
      await expect(build().preprocessStory(CONTENT)).rejects.toBe(netErr);
    });
  });

  describe('timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    });

    it('aborts the request after the llm.gemini.timeoutMs setting (no real waiting)', async () => {
      settings.values['llm.gemini.timeoutMs'] = 1_000;
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal = init.signal;
            init.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })),
            );
          }),
      );

      const pending = build().preprocessStory(CONTENT);
      const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });

      await jest.advanceTimersByTimeAsync(999);
      expect(signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(signal?.aborted).toBe(true);
      await assertion;
    });

    it('uses a 120 s default timeout', async () => {
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal = init.signal;
            init.signal.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      );

      const pending = build().preprocessStory(CONTENT);
      const assertion = expect(pending).rejects.toThrow('aborted');
      await jest.advanceTimersByTimeAsync(119_999);
      expect(signal?.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      await assertion;
    });

    it('clears the abort timer after a successful call', async () => {
      await build().preprocessStory(CONTENT);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('clears the abort timer after an HTTP error', async () => {
      fetchMock.mockResolvedValue(httpResponse(400, { error: { message: 'bad' } }));
      await expect(build().preprocessStory(CONTENT)).rejects.toBeInstanceOf(BadGatewayException);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
