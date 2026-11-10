import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { parseBooleanParam, parseLanguageList } from './story-query.util';
import { StoryQueryDto } from './dto/story-query.dto';
import { StorySearchDto } from './dto/story-search.dto';
import { FavoritesQueryDto, TranslationRequestDto } from './dto/favorites-query.dto';
import { CONTENT_LANGUAGE_MESSAGE } from '../../common/constants/content-languages';

const check = async <T extends object>(cls: new () => T, plain: Record<string, unknown>) => {
  const dto = plainToInstance(cls, plain);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, errors, messages: errors.flatMap((e) => Object.values(e.constraints ?? {})) };
};

describe('story-query.util (grouped lists)', () => {
  describe('parseLanguageList', () => {
    it('one code, a comma separated list and a repeated parameter all become a list', () => {
      expect(parseLanguageList('tr')).toEqual(['tr']);
      expect(parseLanguageList('tr,en')).toEqual(['tr', 'en']);
      expect(parseLanguageList(['tr', 'en'])).toEqual(['tr', 'en']);
      expect(parseLanguageList(['tr,de', 'en'])).toEqual(['tr', 'de', 'en']);
    });

    it('normalises each code like a single one and removes duplicates and blanks', () => {
      expect(parseLanguageList(' TR , en-GB ,,tr_TR')).toEqual(['tr', 'en']);
    });

    it('nothing usable means "not sent"', () => {
      expect(parseLanguageList(undefined)).toBeUndefined();
      expect(parseLanguageList(null)).toBeUndefined();
      expect(parseLanguageList('')).toBeUndefined();
      expect(parseLanguageList(' , ')).toBeUndefined();
      expect(parseLanguageList([])).toBeUndefined();
    });

    it('non-strings are left for the validator', () => {
      expect(parseLanguageList(5)).toEqual([5]);
      expect(parseLanguageList(['tr', 7])).toEqual(['tr', 7]);
    });
  });

  describe('parseBooleanParam', () => {
    it('reads the literals of a query string, case-insensitively', () => {
      expect(parseBooleanParam('true')).toBe(true);
      expect(parseBooleanParam(' TRUE ')).toBe(true);
      expect(parseBooleanParam('false')).toBe(false);
      expect(parseBooleanParam(true)).toBe(true);
      expect(parseBooleanParam(false)).toBe(false);
    });

    it('blank is "not sent"; anything else is left for the validator', () => {
      expect(parseBooleanParam('')).toBeUndefined();
      expect(parseBooleanParam('  ')).toBeUndefined();
      expect(parseBooleanParam('yes')).toBe('yes');
      expect(parseBooleanParam(1)).toBe(1);
      expect(parseBooleanParam(undefined)).toBeUndefined();
    });
  });
});

describe('StoryQueryDto / StorySearchDto (grouped, several languages)', () => {
  it('language takes a list; one code is a list of one', async () => {
    const several = await check(StoryQueryDto, { language: 'tr,EN' });
    expect(several.errors).toHaveLength(0);
    expect(several.dto.language).toEqual(['tr', 'en']);

    const repeated = await check(StorySearchDto, { q: 'ay', language: ['tr', 'de'] });
    expect(repeated.errors).toHaveLength(0);
    expect(repeated.dto.language).toEqual(['tr', 'de']);
  });

  it('one unknown code in the list is a 400 with the shared Turkish message', async () => {
    expect((await check(StoryQueryDto, { language: 'tr,da' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
    expect((await check(StoryQueryDto, { language: 5 })).messages).toContain(CONTENT_LANGUAGE_MESSAGE);
  });

  it('grouped and prefer are read from the query string', async () => {
    const { dto, errors } = await check(StoryQueryDto, { grouped: 'true', prefer: 'EN-us' });
    expect(errors).toHaveLength(0);
    expect(dto.grouped).toBe(true);
    expect(dto.prefer).toBe('en');
    expect(dto.language).toBeUndefined();

    const off = await check(StorySearchDto, { q: 'ay', grouped: 'false' });
    expect(off.errors).toHaveLength(0);
    expect(off.dto.grouped).toBe(false);
  });

  it('rejects a grouped value that is not a boolean and an unknown prefer', async () => {
    expect((await check(StoryQueryDto, { grouped: 'yes' })).messages).toEqual([
      'errors.validation.groupedBoolean',
    ]);
    expect((await check(StoryQueryDto, { prefer: 'da' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
  });

  it('an old client that sends none of them is still valid', async () => {
    const { dto, errors } = await check(StoryQueryDto, { page: '1', limit: '20' });
    expect(errors).toHaveLength(0);
    expect(dto.grouped).toBeUndefined();
    expect(dto.prefer).toBeUndefined();
    expect(dto.language).toBeUndefined();
  });
});

describe('FavoritesQueryDto (GET /stories/favorites)', () => {
  it('page and limit only (old clients) is valid', async () => {
    const { dto, errors } = await check(FavoritesQueryDto, { page: '2', limit: '10' });
    expect(errors).toHaveLength(0);
    expect(dto).toMatchObject({ page: 2, limit: 10 });
    expect(dto.grouped).toBeUndefined();
  });

  it('takes grouped and prefer; rejects junk and unknown parameters', async () => {
    const ok = await check(FavoritesQueryDto, { grouped: 'true', prefer: 'de' });
    expect(ok.errors).toHaveLength(0);
    expect(ok.dto).toMatchObject({ grouped: true, prefer: 'de' });

    expect((await check(FavoritesQueryDto, { grouped: 'maybe' })).messages).toEqual([
      'errors.validation.groupedBoolean',
    ]);
    expect((await check(FavoritesQueryDto, { prefer: 'xx' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
    expect((await check(FavoritesQueryDto, { language: 'tr' })).errors).toHaveLength(1);
  });
});

describe('TranslationRequestDto (POST /stories/:id/translation-requests)', () => {
  it('normalises the language', async () => {
    const { dto, errors } = await check(TranslationRequestDto, { language: ' DE-at ' });
    expect(errors).toHaveLength(0);
    expect(dto.language).toBe('de');
  });

  it('the language is required and must be a content language', async () => {
    expect((await check(TranslationRequestDto, {})).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
    expect((await check(TranslationRequestDto, { language: 'da' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
    expect((await check(TranslationRequestDto, { language: 'en', storyId: 'x' })).errors).toHaveLength(1);
  });
});
