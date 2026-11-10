import { createHash } from 'crypto';
import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import {
  LEVEL_ASSESSMENT_ATTEMPTS,
  LEVEL_ASSESSMENT_MAX_CHARS,
  LlmPreprocessingService,
} from './llm-preprocessing.service';
import { LlmOutputRejectedError } from './translation-guards';
import {
  LANGUAGE_LEVELS,
  SEGMENTATION_PROMPT_EN,
  SEGMENTATION_PROMPT_TR,
  describeLanguage,
  genericSegmentationPrompt,
  levelAssessmentPrompt,
  segmentationPromptFor,
  translationPrompt,
} from './story-llm.prompts';
import { CONTENT_LANGUAGES } from '../../common/constants/content-languages';
import { createSettingsStub, SettingsStub } from '../../test-utils/settings-stub';

/**
 * Language-aware segmentation, CEFR level assessment and translation.
 * The HTTP layer (global fetch) is mocked; nothing here reaches Gemini.
 */

const TR_P1 =
  'Bir varmış bir yokmuş, evvel zaman içinde, uzak bir köyde Keloğlan adında bir çocuk yaşarmış.';
const TR_P2 =
  'Bir sabah annesi ona ormana gitmesini, odun toplamasını ve karanlık çökmeden dönmesini söylemiş.';
const TR_P3 =
  'Keloğlan yola çıkmış, odunları toplamış, akşam olmadan eve dönmüş ve mutlu bir şekilde uyumuş.';
const TR_STORY = `${TR_P1}\n\n${TR_P2}\n\n${TR_P3}`;

const EN_P1 =
  'Once upon a time, long ago, in a faraway village, there lived a boy whose name was Keloglan.';
const EN_P2 =
  'One morning his mother told him to go to the forest, gather firewood and come back before dark.';
const EN_P3 =
  'Keloglan set off, gathered the wood, came home before evening and fell happily asleep.';
const EN_STORY = `${EN_P1}\n\n${EN_P2}\n\n${EN_P3}`;

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

function httpError(status: number, message: string) {
  return {
    ok: false,
    status,
    json: jest.fn().mockResolvedValue({ error: { message } }),
    text: jest.fn().mockResolvedValue(''),
  };
}

describe('LlmPreprocessingService: language, level, translation', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;
  let config: Record<string, unknown>;
  let settings: SettingsStub;

  const build = () =>
    new LlmPreprocessingService({ get: jest.fn((key: string) => config[key]) } as any, settings as any);

  const requestBody = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);
  const systemPrompt = (call = 0): string => requestBody(call).systemInstruction.parts[0].text;
  const userText = (call = 0): string => requestBody(call).contents[0].parts[0].text;

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
  });

  // ---------------------------------------------------------------------
  describe('segmentation prompt per language', () => {
    const segmentsOf = (paragraphs: string[]) =>
      geminiJson({
        segments: paragraphs.map((text, i) => ({
          text: i < paragraphs.length - 1 ? `${text}\n\n` : text,
          emotion: 'peaceful',
          speed: 0.8,
        })),
      });

    it('Turkish stories get the measured Turkish prompt, also when no language is passed', async () => {
      fetchMock.mockResolvedValue(segmentsOf([TR_P1, TR_P2, TR_P3]));
      const service = build();

      await service.preprocessStory(TR_STORY);
      await service.preprocessStory(TR_STORY, 'tr');
      await service.preprocessStory(TR_STORY, null);
      await service.preprocessStory(TR_STORY, 'xx');

      for (const call of [0, 1, 2, 3]) {
        expect(systemPrompt(call)).toBe(SEGMENTATION_PROMPT_TR);
        expect(userText(call)).toBe(`HIKAYE:\n\n${TR_STORY}`);
      }
    });

    it('the Turkish prompt is unchanged (what Turkish stories produce must not move)', () => {
      expect(SEGMENTATION_PROMPT_TR.startsWith('ROL\nSen Sesly platformunun masal onislemcisisin.')).toBe(true);
      expect(SEGMENTATION_PROMPT_TR).toContain('Verilen Turkce cocuk masalini');
      expect(SEGMENTATION_PROMPT_TR).toContain('EN ONEMLI KURAL: GIRDIYI ASLA DEGISTIRME');
      expect(SEGMENTATION_PROMPT_TR).toContain('VARSAYILAN: Suphede kalirsan "peaceful" sec.');
      expect(SEGMENTATION_PROMPT_TR.endsWith('birlestirilmis text === girdi mi? Hayirsa duzelt.\n')).toBe(true);
      // Byte-identical to the prompt that was in the service before it became per language.
      expect(SEGMENTATION_PROMPT_TR).toHaveLength(2495);
      expect(createHash('sha256').update(SEGMENTATION_PROMPT_TR).digest('hex')).toBe(
        '9898db39caab4ef97ec6ea45c2ab9f52ab0e74b311b189caa253d4be8684b7a1',
      );
    });

    it('an English story gets the English prompt and keeps the zero-drift guard', async () => {
      fetchMock.mockResolvedValue(segmentsOf([EN_P1, EN_P2, EN_P3]));

      const result = await build().preprocessStory(EN_STORY, 'EN');

      expect(systemPrompt()).toBe(SEGMENTATION_PROMPT_EN);
      expect(systemPrompt()).toContain("children's story written in English");
      expect(systemPrompt()).toContain('NEVER CHANGE THE INPUT');
      expect(systemPrompt()).not.toContain('Turkce');
      expect(userText()).toBe(`STORY:\n\n${EN_STORY}`);
      expect(result.segments.map((s) => s.text).join('')).toBe(EN_STORY);
    });

    it.each(CONTENT_LANGUAGES.filter((l) => l.code !== 'tr' && l.code !== 'en'))(
      '$code gets the parameterised prompt naming $englishName',
      async (language) => {
        fetchMock.mockResolvedValue(segmentsOf([EN_P1, EN_P2, EN_P3]));

        await build().preprocessStory(EN_STORY, language.code);

        expect(systemPrompt()).toBe(genericSegmentationPrompt(language));
        expect(systemPrompt()).toContain(
          `children's story written in ${language.englishName} (${language.nativeName})`,
        );
        expect(systemPrompt()).toContain('NEVER CHANGE THE INPUT');
        expect(userText().startsWith('STORY:\n\n')).toBe(true);
      },
    );

    it('every language prompt lists the same emotions and speed range as the Turkish one', () => {
      const emotions = 'neutral, peaceful, calm, content, curious, mysterious, nostalgic, happy, excited, sad, scared';
      for (const language of CONTENT_LANGUAGES) {
        const { system } = segmentationPromptFor(language.code);
        expect(system).toContain(emotions);
        expect(system).toContain('0.65 - 1.05');
        expect(system).toContain('80-400');
      }
    });
  });

  // ---------------------------------------------------------------------
  describe('assessLanguageLevel', () => {
    const answer = (over: Record<string, unknown> = {}) =>
      geminiJson({
        level: 'A2',
        confidence: 0.82,
        note: 'Kelimeler gündelik ve cümleler kısa. Geçmiş zaman anlatımı dışında zor bir yapı yok.',
        ...over,
      });

    it('asks for the level of the text as listening material for a learner of that language', async () => {
      fetchMock.mockResolvedValue(answer());

      const result = await build().assessLanguageLevel(EN_STORY, 'en');

      expect(result).toEqual({
        level: 'A2',
        confidence: 0.82,
        note: 'Kelimeler gündelik ve cümleler kısa. Geçmiş zaman anlatımı dışında zor bir yapı yok.',
        modelUsed: 'gemini-3-flash-preview',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const prompt = systemPrompt();
      expect(prompt).toBe(levelAssessmentPrompt('en'));
      expect(prompt).toContain('CEFR examiner for English (English)');
      expect(prompt).toContain('LISTENING material');
      expect(prompt).toContain("children's story");
      expect(prompt).toContain('Vocabulary frequency');
      expect(prompt).toContain('Sentence length and structure');
      expect(prompt).toContain('Tense, aspect and mood');
      expect(prompt).toContain('Idiom');
      expect(prompt).toContain('IN TURKISH');
      expect(userText()).toBe(`STORY (English (English)):\n\n${EN_STORY}`);

      const schema = requestBody().generationConfig.responseSchema;
      expect(schema.required).toEqual(['level', 'confidence', 'note']);
      expect(schema.properties.level.enum).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
      expect(requestBody().generationConfig.responseMimeType).toBe('application/json');
    });

    it.each(CONTENT_LANGUAGES)('the prompt carries the language: $code', (language) => {
      const prompt = levelAssessmentPrompt(language.code);
      expect(prompt).toContain(`${language.englishName} (${language.nativeName})`);
      expect(describeLanguage('xx')).toBe('xx');
    });

    it('normalises the answer: level case, rounded confidence, clean note', async () => {
      fetchMock.mockResolvedValue(
        answer({ level: ' b1 ', confidence: 0.8349, note: '  Uzun cümleler var — deyimler de.\n✨ ' }),
      );

      const result = await build().assessLanguageLevel(TR_STORY, 'tr');

      expect(result.level).toBe('B1');
      expect(result.confidence).toBe(0.83);
      expect(result.note).toBe('Uzun cümleler var - deyimler de.');
    });

    it('reads at most the first 20000 characters of a long story', async () => {
      fetchMock.mockResolvedValue(answer());
      const long = 'kelime '.repeat(5000);

      await build().assessLanguageLevel(long, 'tr');

      expect(userText().length).toBe('STORY (Turkish (Türkçe)):\n\n'.length + LEVEL_ASSESSMENT_MAX_CHARS);
    });

    it.each([
      ['not JSON', geminiText('seviye A2'), 'yanıt JSON değil'],
      ['an array', geminiJson(['A2']), 'yanıt bir nesne değil'],
      ['null', geminiText('null'), 'yanıt bir nesne değil'],
      ['an unknown level', answer({ level: 'D1' }), 'seviye A1 ile C2 arasında değil'],
      ['a missing level', answer({ level: undefined }), 'seviye A1 ile C2 arasında değil'],
      ['confidence above 1', answer({ confidence: 85 }), 'güven değeri 0 ile 1 arasında bir sayı değil'],
      ['negative confidence', answer({ confidence: -0.1 }), 'güven değeri 0 ile 1 arasında bir sayı değil'],
      ['confidence as text', answer({ confidence: '0.8' }), 'güven değeri 0 ile 1 arasında bir sayı değil'],
      ['an empty note', answer({ note: '  ' }), 'açıklama boş'],
      ['a note that is not text', answer({ note: 5 }), 'açıklama boş'],
    ])('an invalid answer (%s) is retried once, then the call fails', async (_label, bad, problem) => {
      fetchMock.mockResolvedValue(bad);

      const err = await build()
        .assessLanguageLevel(EN_STORY, 'en')
        .then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e as LlmOutputRejectedError);

      expect(err).toBeInstanceOf(LlmOutputRejectedError);
      expect(err.reason).toBe('INVALID_ANSWER');
      expect(err.message).toBe(`Model geçerli bir seviye yanıtı vermedi (${problem}).`);
      expect(fetchMock).toHaveBeenCalledTimes(LEVEL_ASSESSMENT_ATTEMPTS);
      expect(LEVEL_ASSESSMENT_ATTEMPTS).toBe(2);
    });

    it('a valid answer on the second try is accepted', async () => {
      fetchMock.mockResolvedValueOnce(answer({ level: 'Z9' })).mockResolvedValueOnce(answer({ level: 'C1' }));

      const result = await build().assessLanguageLevel(EN_STORY, 'en');

      expect(result.level).toBe('C1');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('an empty text is rejected without calling the model', async () => {
      await expect(build().assessLanguageLevel('   ', 'tr')).rejects.toThrow('Masal metni boş, seviye değerlendirilemez.');
      await expect(build().assessLanguageLevel(undefined as any, 'tr')).rejects.toBeInstanceOf(LlmOutputRejectedError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('provider errors are not retried here (the queue retries them)', async () => {
      fetchMock.mockResolvedValue(httpError(429, 'quota'));
      await expect(build().assessLanguageLevel(EN_STORY, 'en')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      fetchMock.mockReset();
      fetchMock.mockResolvedValue(httpError(400, 'bad model'));
      await expect(build().assessLanguageLevel(EN_STORY, 'en')).rejects.toBeInstanceOf(BadGatewayException);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('503 and no call when the API key is missing', async () => {
      config = {};
      await expect(build().assessLanguageLevel(EN_STORY, 'en')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('LANGUAGE_LEVELS is the CEFR scale, easiest first', () => {
      expect(LANGUAGE_LEVELS).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    });
  });

  // ---------------------------------------------------------------------
  describe('translateStory', () => {
    const story = (over: Record<string, unknown> = {}) => ({
      title: 'Keloğlan ve Orman',
      summary: 'Keloğlan ormana odun toplamaya gider.',
      content: TR_STORY,
      language: 'tr',
      ...over,
    });

    const translated = (over: Record<string, unknown> = {}) =>
      geminiJson({
        title: 'Keloglan and the Forest',
        summary: 'Keloglan goes to the forest to gather firewood.',
        paragraphs: [EN_P1, EN_P2, EN_P3],
        ...over,
      });

    it('returns title, summary and content with the paragraph structure of the source', async () => {
      fetchMock.mockResolvedValue(translated());

      const result = await build().translateStory(story(), 'en');

      expect(result).toEqual({
        title: 'Keloglan and the Forest',
        summary: 'Keloglan goes to the forest to gather firewood.',
        content: EN_STORY,
        modelUsed: 'gemini-3-flash-preview',
        durationMs: expect.any(Number),
        sourceParagraphs: 3,
        translatedParagraphs: 3,
        lengthRatio: expect.any(Number),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('the prompt names both languages and states every translation rule', async () => {
      fetchMock.mockResolvedValue(translated());

      await build().translateStory(story(), 'en');

      const prompt = systemPrompt();
      expect(prompt).toBe(translationPrompt('tr', 'en'));
      expect(prompt).toContain('from\nTurkish (Türkçe) into English (English)');
      expect(prompt).toContain("literary translator of children's literature");
      expect(prompt).toContain('add NOTHING and leave NOTHING out');
      expect(prompt).toContain('PARAGRAPHS ONE TO ONE');
      expect(prompt).toContain('ESTABLISHED in English (English)');
      expect(prompt).toContain("No translator's notes");
      expect(prompt).toContain('Do not use emoji');

      expect(userText().startsWith('STORY (Turkish (Türkçe), translate into English (English)):\n\n')).toBe(true);
      const sent = JSON.parse(userText().slice(userText().indexOf('{')));
      expect(sent).toEqual({
        title: 'Keloğlan ve Orman',
        summary: 'Keloğlan ormana odun toplamaya gider.',
        paragraphs: [TR_P1, TR_P2, TR_P3],
      });

      const schema = requestBody().generationConfig.responseSchema;
      expect(schema.required).toEqual(['title', 'summary', 'paragraphs']);
      expect(schema.properties.paragraphs.type).toBe('ARRAY');
    });

    it.each([
      ['tr', 'de', 'from\nTurkish (Türkçe) into German (Deutsch)'],
      ['en', 'tr', 'from\nEnglish (English) into Turkish (Türkçe)'],
      ['de', 'ar', 'from\nGerman (Deutsch) into Arabic (العربية)'],
    ])('prompt for %s to %s carries both languages', (source, target, line) => {
      expect(translationPrompt(source, target)).toContain(line);
    });

    it('keeps single-line-break paragraphs joined the way the source had them', async () => {
      fetchMock.mockResolvedValue(translated());

      const result = await build().translateStory(story({ content: `${TR_P1}\n${TR_P2}\n${TR_P3}` }), 'en');

      expect(result.content).toBe(`${EN_P1}\n${EN_P2}\n${EN_P3}`);
    });

    it('normalises typography before saving: no em dash, no emoji, no unicode ellipsis, no quoted title', async () => {
      fetchMock.mockResolvedValue(
        translated({
          title: '  "Keloglan — and the Forest"  ',
          summary: 'Keloglan goes… \u{1F332}',
          paragraphs: [`— ${EN_P1}`, `${EN_P2} ✨`, EN_P3.replace(', came', '—came')],
        }),
      );

      const result = await build().translateStory(story(), 'en');

      expect(result.title).toBe('Keloglan - and the Forest');
      expect(result.summary).toBe('Keloglan goes...');
      expect(result.content).toBe(`- ${EN_P1}\n\n${EN_P2}\n\n${EN_P3.replace(', came', ' - came')}`);
      expect(`${result.title}${result.summary}${result.content}`).not.toMatch(
        /[—―…\p{Extended_Pictographic}]/u,
      );
    });

    it('never invents a summary: no source summary means null, whatever the model returns', async () => {
      fetchMock.mockResolvedValue(translated({ summary: 'A summary the model made up.' }));
      const withNull = await build().translateStory(story({ summary: null }), 'en');
      expect(withNull.summary).toBeNull();
      expect(JSON.parse(userText().slice(userText().indexOf('{'))).summary).toBe('');

      const withBlank = await build().translateStory(story({ summary: '   ' }), 'en');
      expect(withBlank.summary).toBeNull();

      fetchMock.mockResolvedValue(translated({ summary: undefined }));
      const missing = await build().translateStory(story(), 'en');
      expect(missing.summary).toBeNull();
    });

    it.each([
      ['not JSON', geminiText('Here is the translation')],
      ['null', geminiText('null')],
      ['no title', translated({ title: undefined })],
      ['paragraphs not a list', translated({ paragraphs: EN_STORY })],
      ['a paragraph that is not text', translated({ paragraphs: [EN_P1, 5, EN_P3] })],
    ])('a malformed answer (%s) is rejected', async (_label, bad) => {
      fetchMock.mockResolvedValue(bad);

      const err = await build().translateStory(story(), 'en').then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e as LlmOutputRejectedError);

      expect(err).toBeInstanceOf(LlmOutputRejectedError);
      expect(err.reason).toBe('INVALID_ANSWER');
      expect(err.message).toBe('Model geçerli bir çeviri yanıtı vermedi (başlık ya da paragraf listesi eksik).');
    });

    it.each([
      ['a merged paragraph', { paragraphs: [`${EN_P1} ${EN_P2}`, EN_P3] }, /paragraf sayısı tutmuyor \(kaynak 3, çeviri 2\)/],
      ['an added paragraph', { paragraphs: [EN_P1, EN_P2, EN_P3, 'The end.'] }, /paragraf sayısı tutmuyor \(kaynak 3, çeviri 4\)/],
      ['the source handed back', { paragraphs: [TR_P1, TR_P2, TR_P3] }, /metin çevrilmeden geri döndü/],
      ['text left out', { paragraphs: ['A boy.', 'He went.', 'He slept.'] }, /çok kısa/],
      ['text added', { paragraphs: [EN_P1, EN_P2, EN_P3].map((p) => `${p} ${p} ${p}`) }, /çok uzun/],
      ['untranslated paragraphs', { paragraphs: [EN_P1, TR_P2, TR_P3] }, /2 paragraf çevrilmeden bırakılmış/],
      ['an empty paragraph', { paragraphs: [EN_P1, ' ', EN_P3] }, /2\. paragraf boş döndü/],
      ['an empty title', { title: ' "" ' }, /başlık boş döndü/],
      ['a translator note', { paragraphs: [EN_P1, `${EN_P2} (Translator's note: a folk hero.)`, EN_P3] }, /çevirmen notu/],
    ])('guard: %s fails the translation with a readable reason', async (_label, over, reason) => {
      fetchMock.mockResolvedValue(translated(over));

      const err = await build().translateStory(story(), 'en').then(() => { throw new Error('expected a rejection'); }, (e: unknown) => e as LlmOutputRejectedError);

      expect(err).toBeInstanceOf(LlmOutputRejectedError);
      expect(err.reason).toBe('TRANSLATION_GUARD');
      expect(err.message).toMatch(/^Çeviri reddedildi: /);
      expect(err.message).toMatch(reason);
    });

    it('an empty story is rejected without calling the model', async () => {
      await expect(build().translateStory(story({ content: ' \n ' }), 'en')).rejects.toThrow(
        'Masal metni boş, çevrilemez.',
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('503 and no call when the API key is missing; provider errors propagate', async () => {
      config = {};
      await expect(build().translateStory(story(), 'en')).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();

      config = { 'gemini.apiKey': 'k' };
      fetchMock.mockResolvedValue(httpError(503, 'overloaded'));
      await expect(build().translateStory(story(), 'en')).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('uses the model, temperature and thinking budget settings at call time', async () => {
      fetchMock.mockResolvedValue(translated());
      settings.values = {
        'llm.gemini.model': 'gemini-pro-test',
        'llm.gemini.temperature': 0.4,
        'llm.gemini.thinkingBudget': -1,
      };

      const result = await build().translateStory(story(), 'en');

      expect(result.modelUsed).toBe('gemini-pro-test');
      expect(fetchMock.mock.calls[0][0]).toContain('/models/gemini-pro-test:generateContent');
      expect(requestBody().generationConfig).toMatchObject({
        temperature: 0.4,
        thinkingConfig: { thinkingBudget: -1 },
      });
    });
  });
});
