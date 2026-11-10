import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  LANGUAGE_LEVEL_MESSAGE,
  STORY_SORTS,
  STORY_SORT_MESSAGE,
  normaliseLanguageParam,
  parseLanguageLevels,
  storyOrderBy,
} from './story-query.util';
import { StoryQueryDto } from './dto/story-query.dto';
import { StorySearchDto } from './dto/story-search.dto';
import {
  CollectionLanguageQueryDto,
  CollectionStoriesQueryDto,
} from '../collections/dto/collection-query.dto';
import { CONTENT_LANGUAGE_MESSAGE } from '../../common/constants/content-languages';

const check = async <T extends object>(cls: new () => T, plain: Record<string, unknown>) => {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors, messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
};

describe('story-query.util', () => {
  describe('normaliseLanguageParam', () => {
    it('lower-cases, trims and drops the region', () => {
      expect(normaliseLanguageParam('tr')).toBe('tr');
      expect(normaliseLanguageParam(' TR ')).toBe('tr');
      expect(normaliseLanguageParam('tr-TR')).toBe('tr');
      expect(normaliseLanguageParam('en_US')).toBe('en');
    });

    it('a blank value means "not sent"; non-strings are left for the validator', () => {
      expect(normaliseLanguageParam('')).toBeUndefined();
      expect(normaliseLanguageParam('   ')).toBeUndefined();
      expect(normaliseLanguageParam(undefined)).toBeUndefined();
      expect(normaliseLanguageParam(5)).toBe(5);
      expect(normaliseLanguageParam(['tr', 'en'])).toEqual(['tr', 'en']);
    });
  });

  describe('parseLanguageLevels', () => {
    it('accepts one value, a comma separated list and a repeated parameter', () => {
      expect(parseLanguageLevels('A1')).toEqual(['A1']);
      expect(parseLanguageLevels('A1,A2')).toEqual(['A1', 'A2']);
      expect(parseLanguageLevels(['A1', 'B2'])).toEqual(['A1', 'B2']);
      expect(parseLanguageLevels(['A1,A2', 'B1'])).toEqual(['A1', 'A2', 'B1']);
    });

    it('is case-insensitive, trims and removes duplicates', () => {
      expect(parseLanguageLevels(' a1 , A1,b2 ')).toEqual(['A1', 'B2']);
    });

    it('nothing usable means "not sent"', () => {
      expect(parseLanguageLevels(undefined)).toBeUndefined();
      expect(parseLanguageLevels(null)).toBeUndefined();
      expect(parseLanguageLevels('')).toBeUndefined();
      expect(parseLanguageLevels(' , ')).toBeUndefined();
    });

    it('keeps non-string items for the validator to reject', () => {
      expect(parseLanguageLevels([1, 'A1'])).toEqual([1, 'A1']);
    });
  });

  describe('storyOrderBy', () => {
    it('absent and "newest" keep the order every list had before sorting existed', () => {
      expect(storyOrderBy()).toEqual([{ createdAt: 'desc' }]);
      expect(storyOrderBy(undefined)).toEqual([{ createdAt: 'desc' }]);
      expect(storyOrderBy('newest')).toEqual([{ createdAt: 'desc' }]);
    });

    it('oldest, title, duration', () => {
      expect(storyOrderBy('oldest')).toEqual([{ createdAt: 'asc' }]);
      expect(storyOrderBy('title')).toEqual([{ title: 'asc' }, { createdAt: 'desc' }]);
      expect(storyOrderBy('duration')).toEqual([{ estimatedDuration: 'asc' }, { createdAt: 'desc' }]);
    });

    it('level: easiest first, stories without a level last', () => {
      expect(storyOrderBy('level')).toEqual([
        { languageLevel: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
      ]);
    });

    it('covers every declared sort key', () => {
      expect([...STORY_SORTS]).toEqual(['newest', 'oldest', 'title', 'duration', 'level']);
      for (const sort of STORY_SORTS) {
        expect(storyOrderBy(sort).length).toBeGreaterThan(0);
      }
    });
  });
});

describe('StoryQueryDto (GET /stories)', () => {
  it('an old client that sends nothing is valid and carries no language, level or sort', async () => {
    const { dto, errors } = await check(StoryQueryDto, {});
    expect(errors).toHaveLength(0);
    expect(dto.language).toBeUndefined();
    expect(dto.languageLevel).toBeUndefined();
    expect(dto.sort).toBeUndefined();
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });

  it('the existing filters keep working', async () => {
    const { dto, errors } = await check(StoryQueryDto, {
      ageGroup: 'THREE_TO_SIX',
      category: 'BEDTIME',
      isPremium: 'false',
      page: '2',
      limit: '10',
    });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ ageGroup: 'THREE_TO_SIX', category: 'BEDTIME', isPremium: false, page: 2, limit: 10 });
  });

  it('accepts language, several levels and a sort', async () => {
    const { dto, errors } = await check(StoryQueryDto, {
      language: 'EN-us',
      languageLevel: 'a1,B2',
      sort: 'level',
    });
    expect(errors).toHaveLength(0);
    expect(dto.language).toEqual(['en']);
    expect(dto.languageLevel).toEqual(['A1', 'B2']);
    expect(dto.sort).toBe('level');
  });

  it('a repeated languageLevel parameter arrives as an array', async () => {
    const { dto, errors } = await check(StoryQueryDto, { languageLevel: ['A1', 'A2'] });
    expect(errors).toHaveLength(0);
    expect(dto.languageLevel).toEqual(['A1', 'A2']);
  });

  it('rejects a language outside CONTENT_LANGUAGES with the Turkish message', async () => {
    const { messages } = await check(StoryQueryDto, { language: 'da' });
    expect(messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
  });

  it('rejects an unknown level and an unknown sort', async () => {
    expect((await check(StoryQueryDto, { languageLevel: 'A1,Z9' })).messages).toContain(LANGUAGE_LEVEL_MESSAGE);
    expect((await check(StoryQueryDto, { sort: 'random' })).messages).toEqual([STORY_SORT_MESSAGE]);
  });

  it('rejects an unknown query parameter', async () => {
    const { errors } = await check(StoryQueryDto, { status: 'DRAFT' });
    expect(errors.map((e) => e.property)).toEqual(['status']);
  });
});

describe('StorySearchDto (GET /stories/search)', () => {
  it('q alone is valid (old clients)', async () => {
    const { dto, errors } = await check(StorySearchDto, { q: 'kelo' });
    expect(errors).toHaveLength(0);
    expect(dto.language).toBeUndefined();
  });

  it('takes the same language and languageLevel filters', async () => {
    const { dto, errors } = await check(StorySearchDto, { q: 'wolf', language: 'de', languageLevel: 'B1' });
    expect(errors).toHaveLength(0);
    expect(dto.language).toEqual(['de']);
    expect(dto.languageLevel).toEqual(['B1']);
  });

  it('rejects a bad language, and has no sort', async () => {
    expect((await check(StorySearchDto, { q: 'x', language: 'xx' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
    expect((await check(StorySearchDto, { q: 'x', sort: 'title' })).errors.map((e) => e.property)).toEqual(['sort']);
  });
});

describe('collection query DTOs', () => {
  it('language is optional and validated against CONTENT_LANGUAGES', async () => {
    expect((await check(CollectionLanguageQueryDto, {})).errors).toHaveLength(0);
    expect((await check(CollectionLanguageQueryDto, { language: 'en-GB' })).dto.language).toBe('en');
    expect((await check(CollectionLanguageQueryDto, { language: 'xx' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
  });

  it('the story list keeps pagination and adds language', async () => {
    const { dto, errors } = await check(CollectionStoriesQueryDto, { page: '2', limit: '5', language: 'tr' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 2, limit: 5, language: 'tr' });
    expect((await check(CollectionStoriesQueryDto, { language: 'q1' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
  });
});
