import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { LEVEL_ASSESSMENT_MAX_CHARS, LlmPreprocessingService } from './llm-preprocessing.service';
import { LlmOutputRejectedError } from './translation-guards';
import {
  AGE_GROUPS,
  AGE_GROUP_ASSESSMENT_SCHEMA,
  ageGroupAssessmentPrompt,
} from './story-llm.prompts';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

/**
 * Age group assessment. The HTTP layer (global fetch) is mocked; nothing
 * here reaches Gemini.
 */

const STORY = 'Bir varmış bir yokmuş. Küçük bir tavşan ormanda yaşarmış.';

function geminiText(text: string) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    }),
    text: jest.fn().mockResolvedValue(''),
  };
}
const geminiJson = (value: unknown) => geminiText(JSON.stringify(value));

describe('LlmPreprocessingService.assessAgeGroup', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  let config: Record<string, unknown>;
  let settings: SettingsStub;

  const build = () =>
    new LlmPreprocessingService({ get: jest.fn((key: string) => config[key]) } as any, settings as any);
  const requestBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

  beforeAll(() => {
    (global as any).fetch = fetchMock;
  });
  afterAll(() => {
    (global as any).fetch = originalFetch;
  });
  beforeEach(() => {
    fetchMock.mockReset();
    config = { 'gemini.apiKey': 'test-key', 'gemini.apiUrl': 'https://gemini.test' };
    settings = createSettingsStub({ 'llm.gemini.model': 'gemini-test' });
  });

  const valid = { ageGroup: 'THREE_TO_SIX', confidence: 0.8, note: 'Kısa ve yalın bir masal.' };

  it('asks which age band the text suits as a bedtime story and returns the validated answer', async () => {
    fetchMock.mockResolvedValue(geminiJson(valid));

    const result = await build().assessAgeGroup(STORY, 'tr');

    expect(result).toEqual({ ...valid, modelUsed: 'gemini-test' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://gemini.test/v1beta/models/gemini-test:generateContent');
    const body = requestBody();
    expect(body.systemInstruction.parts[0].text).toBe(ageGroupAssessmentPrompt('tr'));
    expect(body.contents[0].parts[0].text).toBe(`STORY (Turkish (Türkçe)):\n\n${STORY}`);
    expect(body.generationConfig.responseSchema).toEqual(AGE_GROUP_ASSESSMENT_SCHEMA);
  });

  it('the prompt names the language, the four bands and asks for a Turkish note', () => {
    const prompt = ageGroupAssessmentPrompt('en');

    expect(prompt).toContain('English (English)');
    for (const band of ['ZERO_TO_THREE', 'THREE_TO_SIX', 'SIX_TO_TEN', 'TEN_PLUS']) {
      expect(prompt).toContain(band);
    }
    expect(prompt).toContain('IN TURKISH');
    expect(prompt).toContain('YOUNGEST band');
    expect([...AGE_GROUPS]).toEqual(['ZERO_TO_THREE', 'THREE_TO_SIX', 'SIX_TO_TEN', 'TEN_PLUS']);
    expect(AGE_GROUP_ASSESSMENT_SCHEMA.properties.ageGroup.enum).toEqual([...AGE_GROUPS]);
    expect(AGE_GROUP_ASSESSMENT_SCHEMA.required).toEqual(['ageGroup', 'confidence', 'note']);
  });

  it('normalises the answer: band case, rounded confidence, clean note', async () => {
    fetchMock.mockResolvedValue(
      geminiJson({ ageGroup: ' six_to_ten ', confidence: 0.6789, note: '  Uzun   cümleler — soyut  temalar… ' }),
    );

    const result = await build().assessAgeGroup(STORY, 'tr');

    expect(result.ageGroup).toBe('SIX_TO_TEN');
    expect(result.confidence).toBe(0.68);
    expect(result.note).not.toMatch(/[—…]|\s{2,}/);
    expect(result.note.startsWith('Uzun cümleler')).toBe(true);
  });

  it('reads at most the first 20000 characters of a long story', async () => {
    fetchMock.mockResolvedValue(geminiJson(valid));

    await build().assessAgeGroup('a'.repeat(LEVEL_ASSESSMENT_MAX_CHARS + 500), 'tr');

    const sent: string = requestBody().contents[0].parts[0].text;
    expect(sent.length).toBe('STORY (Turkish (Türkçe)):\n\n'.length + LEVEL_ASSESSMENT_MAX_CHARS);
  });

  it.each([
    ['not JSON', 'kesinlikle üç yaş', 'yanıt JSON değil'],
    ['an array', '[1]', 'yanıt bir nesne değil'],
    ['null', 'null', 'yanıt bir nesne değil'],
    ['an unknown band', JSON.stringify({ ...valid, ageGroup: 'TEENS' }), 'yaş grubu geçerli değerlerden biri değil'],
    ['a band that is not a string', JSON.stringify({ ...valid, ageGroup: 3 }), 'yaş grubu geçerli değerlerden biri değil'],
    ['confidence above 1', JSON.stringify({ ...valid, confidence: 1.4 }), 'güven değeri 0 ile 1 arasında bir sayı değil'],
    ['confidence below 0', JSON.stringify({ ...valid, confidence: -0.1 }), 'güven değeri 0 ile 1 arasında bir sayı değil'],
    ['confidence as text', JSON.stringify({ ...valid, confidence: 'high' }), 'güven değeri 0 ile 1 arasında bir sayı değil'],
    ['an empty note', JSON.stringify({ ...valid, note: '   ' }), 'açıklama boş'],
    ['a note that is not text', JSON.stringify({ ...valid, note: 5 }), 'açıklama boş'],
  ])('an invalid answer (%s) is asked for once more, then rejected in Turkish', async (_name, answer, problem) => {
    fetchMock.mockResolvedValue(geminiText(answer));

    const error: any = await build()
      .assessAgeGroup(STORY, 'tr')
      .catch((e) => e);

    expect(error).toBeInstanceOf(LlmOutputRejectedError);
    expect(error.message).toBe(`Model geçerli bir yaş grubu yanıtı vermedi (${problem}).`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a valid answer on the second try is accepted', async () => {
    fetchMock.mockResolvedValueOnce(geminiText('oops')).mockResolvedValueOnce(geminiJson(valid));

    await expect(build().assessAgeGroup(STORY, 'tr')).resolves.toMatchObject({ ageGroup: 'THREE_TO_SIX' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('an empty text is rejected without calling the model', async () => {
    await expect(build().assessAgeGroup('   ', 'tr')).rejects.toThrow('Masal metni boş, yaş grubu değerlendirilemez.');
    await expect(build().assessAgeGroup(undefined as any, 'tr')).rejects.toBeInstanceOf(LlmOutputRejectedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('provider errors are not retried here (the queue retries them)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: jest.fn().mockResolvedValue({ error: { message: 'boom' } }),
      text: jest.fn().mockResolvedValue(''),
    });

    const error = await build()
      .assessAgeGroup(STORY, 'tr')
      .catch((e) => e);

    expect(error instanceof ServiceUnavailableException || error instanceof BadGatewayException).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('503 and no call when the API key is missing', async () => {
    config['gemini.apiKey'] = '';

    await expect(build().assessAgeGroup(STORY, 'tr')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
