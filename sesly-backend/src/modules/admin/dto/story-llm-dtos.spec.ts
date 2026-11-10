import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AssessLevelBatchDto,
  AssessLevelDto,
  STORY_LLM_BATCH_IDS_MAX,
  StoryLlmTasksQueryDto,
  TranslateBatchDto,
  TranslateStoryDto,
} from './story-llm.dto';
import { CONTENT_LANGUAGE_MESSAGE } from '../../../common/constants/content-languages';

/** Same options as the global ValidationPipe in main.ts. */
async function check<T extends object>(cls: new () => T, plain: Record<string, any>) {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  return {
    instance,
    invalid: errors.map((e) => e.property),
    messages: errors.flatMap((e) => Object.values(e.constraints ?? {})),
  };
}

/** No emoji, no em-dash, no arrows or decorative glyphs in anything the panel shows. */
const CLEAN_COPY = /^[\p{L}\p{N} _,.:;()"'\-*?/]+$/u;

describe('story LLM DTOs', () => {
  describe('TranslateStoryDto', () => {
    it('accepts a content language (any case, region dropped) and an optional replaceDraft', async () => {
      const plain = await check(TranslateStoryDto, { targetLanguage: 'en' });
      expect(plain.invalid).toEqual([]);
      expect(plain.instance.replaceDraft).toBeUndefined();

      const regional = await check(TranslateStoryDto, { targetLanguage: 'EN-us', replaceDraft: true });
      expect(regional.invalid).toEqual([]);
      expect(regional.instance.targetLanguage).toBe('en');
      expect(regional.instance.replaceDraft).toBe(true);
    });

    it.each([
      ['true', true],
      ['FALSE', false],
      [' true ', true],
    ])('replaceDraft %p (form value) becomes %p', async (raw, expected) => {
      const { instance, invalid } = await check(TranslateStoryDto, { targetLanguage: 'de', replaceDraft: raw });
      expect(invalid).toEqual([]);
      expect(instance.replaceDraft).toBe(expected);
    });

    it.each([[undefined], [''], ['xx'], ['klingon'], [5]])(
      'rejects target language %p with the shared Turkish message',
      async (targetLanguage) => {
        const { invalid, messages } = await check(TranslateStoryDto, { targetLanguage });
        expect(invalid).toEqual(['targetLanguage']);
        expect(messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
      },
    );

    it('rejects a replaceDraft that is not a boolean, and any unknown property', async () => {
      const bad = await check(TranslateStoryDto, { targetLanguage: 'en', replaceDraft: 'yes' });
      expect(bad.messages).toEqual(['replaceDraft true ya da false olmalıdır.']);

      const extra = await check(TranslateStoryDto, { targetLanguage: 'en', force: true });
      expect(extra.invalid).toEqual(['force']);
    });
  });

  describe('TranslateBatchDto', () => {
    it('accepts 1 to 200 story ids (legacy non-UUID ids too) and a language', async () => {
      const ok = await check(TranslateBatchDto, {
        storyIds: ['11111111-1111-4111-8111-111111111111', 'seed-story-keloglan'],
        targetLanguage: 'fr',
      });
      expect(ok.invalid).toEqual([]);

      const max = await check(TranslateBatchDto, {
        storyIds: Array.from({ length: STORY_LLM_BATCH_IDS_MAX }, (_, i) => `s${i}`),
        targetLanguage: 'fr',
      });
      expect(max.invalid).toEqual([]);
    });

    it.each([
      ['a missing list', undefined],
      ['an empty list', []],
      ['too many ids', Array.from({ length: STORY_LLM_BATCH_IDS_MAX + 1 }, (_, i) => `s${i}`)],
      ['a non-list', 's1'],
      ['an empty id', ['s1', '']],
      ['a non-text id', ['s1', 7]],
      ['an over-long id', ['x'.repeat(101)]],
    ])('rejects %s', async (_label, storyIds) => {
      const { invalid, messages } = await check(TranslateBatchDto, { storyIds, targetLanguage: 'en' });
      expect(invalid).toEqual(['storyIds']);
      for (const message of messages) expect(message).toMatch(CLEAN_COPY);
    });

    it('needs a valid target language', async () => {
      const { invalid } = await check(TranslateBatchDto, { storyIds: ['s1'] });
      expect(invalid).toEqual(['targetLanguage']);
    });
  });

  describe('AssessLevelDto', () => {
    it('an empty body is fine; force is an optional boolean', async () => {
      expect((await check(AssessLevelDto, {})).invalid).toEqual([]);
      expect((await check(AssessLevelDto, { force: 'true' })).instance.force).toBe(true);
      expect((await check(AssessLevelDto, { force: false })).instance.force).toBe(false);

      const bad = await check(AssessLevelDto, { force: 1 });
      expect(bad.messages).toEqual(['force true ya da false olmalıdır.']);
      expect((await check(AssessLevelDto, { onlyMissing: true })).invalid).toEqual(['onlyMissing']);
    });
  });

  describe('AssessLevelBatchDto', () => {
    it('every field is optional', async () => {
      const empty = await check(AssessLevelBatchDto, {});
      expect(empty.invalid).toEqual([]);

      const full = await check(AssessLevelBatchDto, { storyIds: ['s1'], language: 'TR', onlyMissing: 'true' });
      expect(full.invalid).toEqual([]);
      expect(full.instance).toMatchObject({ storyIds: ['s1'], language: 'tr', onlyMissing: true });

      // An empty language means "all languages".
      expect((await check(AssessLevelBatchDto, { language: '' })).instance.language).toBeUndefined();
      // An empty list means "every story".
      expect((await check(AssessLevelBatchDto, { storyIds: [] })).invalid).toEqual([]);
    });

    it('rejects a bad language, a bad flag, bad ids and unknown properties', async () => {
      expect((await check(AssessLevelBatchDto, { language: 'xx' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
      expect((await check(AssessLevelBatchDto, { onlyMissing: 'maybe' })).messages).toEqual([
        'onlyMissing true ya da false olmalıdır.',
      ]);
      expect((await check(AssessLevelBatchDto, { storyIds: [''] })).invalid).toEqual(['storyIds']);
      expect((await check(AssessLevelBatchDto, { force: true })).invalid).toEqual(['force']);
    });
  });

  describe('StoryLlmTasksQueryDto', () => {
    it('no filter is fine; pagination comes from the shared PaginationDto', async () => {
      const { instance, invalid } = await check(StoryLlmTasksQueryDto, {});
      expect(invalid).toEqual([]);
      expect(instance.page).toBe(1);
      expect(instance.limit).toBe(20);

      const paged = await check(StoryLlmTasksQueryDto, { page: '3', limit: '50' });
      expect(paged.instance).toMatchObject({ page: 3, limit: 50 });
      expect((await check(StoryLlmTasksQueryDto, { limit: '500' })).invalid).toEqual(['limit']);
    });

    it('status and type are case-insensitive; an empty value means "all"', async () => {
      const { instance, invalid } = await check(StoryLlmTasksQueryDto, {
        storyId: ' s1 ',
        status: 'failed',
        type: 'translate',
      });
      expect(invalid).toEqual([]);
      expect(instance).toMatchObject({ storyId: 's1', status: 'FAILED', type: 'TRANSLATE' });

      const blank = await check(StoryLlmTasksQueryDto, { storyId: '', status: '', type: '' });
      expect(blank.invalid).toEqual([]);
      expect(blank.instance.storyId).toBeUndefined();
      expect(blank.instance.status).toBeUndefined();
      expect(blank.instance.type).toBeUndefined();
    });

    it('rejects unknown values with Turkish messages', async () => {
      const { invalid, messages } = await check(StoryLlmTasksQueryDto, {
        status: 'STUCK',
        type: 'SUMMARISE',
        storyId: 5,
      });
      expect(invalid.sort()).toEqual(['status', 'storyId', 'type']);
      expect(messages).toContain('Durum şu değerlerden biri olmalıdır: PENDING, RUNNING, DONE, FAILED.');
      expect(messages).toContain('Görev türü şu değerlerden biri olmalıdır: TRANSLATE, ASSESS_LEVEL, ASSESS_AGE_GROUP.');
      for (const message of messages) expect(message).toMatch(CLEAN_COPY);
    });
  });
});
