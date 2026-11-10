import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateStoryDto } from './create-story.dto';
import { UpdateStoryDto } from './update-story.dto';
import { AdminStoriesQueryDto } from './admin-stories-query.dto';
import { LinkTranslationDto } from './link-translation.dto';
import { AdminCollectionsQueryDto } from './admin-collections-query.dto';
import { CreateCollectionDto } from '../../collections/dto/create-collection.dto';
import { UpdateCollectionDto } from '../../collections/dto/update-collection.dto';
import { YEAR_MAX, YEAR_MIN, blankToNull, toEnumOrNull, toIntOrNull } from './story-field.decorators';
import { CONTENT_LANGUAGE_MESSAGE } from '../../../common/constants/content-languages';

/** Same options as the global ValidationPipe in main.ts. */
async function check<T extends object>(cls: new () => T, plain: Record<string, any>) {
  const instance = plainToInstance(cls, plain);
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  const flat = (errs: any[], prefix = ''): Array<{ path: string; messages: string[] }> =>
    errs.flatMap((e) => [
      ...(e.constraints ? [{ path: `${prefix}${e.property}`, messages: Object.values(e.constraints) as string[] }] : []),
      ...flat(e.children ?? [], `${prefix}${e.property}.`),
    ]);
  const found = flat(errors);
  return { instance, invalid: found.map((f) => f.path), messages: found.flatMap((f) => f.messages) };
}

const base = {
  title: 'Kırmızı Başlıklı Kız',
  content: 'Bir varmış bir yokmuş.',
  ageGroup: 'THREE_TO_SIX',
  category: 'WORLD_CLASSICS',
};

/** No emoji, no em-dash, no arrows or decorative glyphs in anything the panel shows. */
const CLEAN_COPY = /^[\p{L}\p{N} _,.:;()"'\-*?/]+$/u;

describe('story field transforms (multipart bodies arrive as strings)', () => {
  it('blankToNull trims; a blank clears the field', () => {
    expect(blankToNull('  Grimm  ')).toBe('Grimm');
    expect(blankToNull('')).toBeNull();
    expect(blankToNull('   ')).toBeNull();
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull(undefined)).toBeUndefined();
    expect(blankToNull(5)).toBe(5);
  });

  it('toIntOrNull parses numeric strings, clears on blank, leaves junk for the validator', () => {
    expect(toIntOrNull('1875')).toBe(1875);
    expect(toIntOrNull(' -350 ')).toBe(-350);
    expect(toIntOrNull(1875)).toBe(1875);
    expect(toIntOrNull('')).toBeNull();
    expect(toIntOrNull(null)).toBeNull();
    expect(toIntOrNull(undefined)).toBeUndefined();
    expect(toIntOrNull('18a5')).toBe('18a5');
    expect(toIntOrNull(true)).toBe(true);
  });

  it('toEnumOrNull upper-cases, clears on blank', () => {
    expect(toEnumOrNull(' public_domain ')).toBe('PUBLIC_DOMAIN');
    expect(toEnumOrNull('')).toBeNull();
    expect(toEnumOrNull(undefined)).toBeUndefined();
    expect(toEnumOrNull(3)).toBe(3);
  });
});

describe('CreateStoryDto / UpdateStoryDto (POST, PATCH /admin/stories)', () => {
  it('the body the current admin panel sends (no new field) is still valid', async () => {
    const { instance, invalid } = await check(CreateStoryDto, { ...base, language: 'tr', isPremium: 'false' });
    expect(invalid).toEqual([]);
    expect(instance.status).toBeUndefined();
    expect(instance.slug).toBeUndefined();
    expect(instance.origin).toBeUndefined();
  });

  it('accepts every new field and coerces multipart strings', async () => {
    const { instance, invalid } = await check(CreateStoryDto, {
      ...base,
      language: 'EN-gb',
      slug: 'little-red-riding-hood',
      status: 'published',
      summary: '  A girl, a wolf.  ',
      originalTitle: 'Le Petit Chaperon rouge',
      originalLanguage: 'FR',
      authorName: 'Charles Perrault',
      authorDeathYear: '1703',
      collectorName: 'Jacob Grimm',
      collectorDeathYear: '1863',
      translatorName: 'A. Translator',
      translatorDeathYear: '1950',
      adaptedBy: 'Sesly',
      firstPublishedYear: '1697',
      editionYear: 1857,
      sourceName: 'Histoires ou contes du temps passé',
      sourceUrl: 'https://example.org/perrault',
      origin: 'public_domain',
      textFidelity: 'TRANSLATED',
      sourceRetrievedAt: '2026-10-01',
      rightsBasis: 'AUTHOR_LIFE_PLUS_70',
      rightsNote: 'Yazar 1703 yılında öldü.',
      licenseUrl: 'https://example.org/licence',
      rightsVerifiedAt: '2026-10-13T08:00:00.000Z',
      rightsVerifiedBy: 'Hukuk danışmanı',
      translatedFromId: 'story-tr-1',
      translationMethod: 'human',
      languageLevel: 'b1',
      languageLevelNote: 'Uzun cümleler var.',
    });

    expect(invalid).toEqual([]);
    expect(instance).toMatchObject({
      language: 'en',
      status: 'PUBLISHED',
      summary: 'A girl, a wolf.',
      originalLanguage: 'fr',
      authorDeathYear: 1703,
      collectorDeathYear: 1863,
      translatorDeathYear: 1950,
      firstPublishedYear: 1697,
      editionYear: 1857,
      origin: 'PUBLIC_DOMAIN',
      textFidelity: 'TRANSLATED',
      rightsBasis: 'AUTHOR_LIFE_PLUS_70',
      translationMethod: 'HUMAN',
      languageLevel: 'B1',
    });
  });

  it('an empty string clears a nullable field (multipart cannot send null)', async () => {
    const { instance, invalid } = await check(UpdateStoryDto, {
      slug: '',
      summary: '',
      authorName: '   ',
      authorDeathYear: '',
      sourceUrl: '',
      origin: '',
      rightsBasis: '',
      sourceRetrievedAt: '',
      translatedFromId: '',
      languageLevel: '',
      originalLanguage: '',
    });

    expect(invalid).toEqual([]);
    expect(instance).toMatchObject({
      slug: null,
      summary: null,
      authorName: null,
      authorDeathYear: null,
      sourceUrl: null,
      origin: null,
      rightsBasis: null,
      sourceRetrievedAt: null,
      translatedFromId: null,
      languageLevel: null,
      originalLanguage: null,
    });
  });

  it('PATCH with nothing is valid; a blank language means "not sent"', async () => {
    expect((await check(UpdateStoryDto, {})).invalid).toEqual([]);
    const { instance, invalid } = await check(UpdateStoryDto, { language: '' });
    expect(invalid).toEqual([]);
    expect(instance.language).toBeUndefined();
  });

  it.each([
    ['language outside CONTENT_LANGUAGES', { language: 'da' }, 'language'],
    ['language that is not a code', { language: 'turkish' }, 'language'],
    ['slug with upper case or spaces', { slug: 'Kırmızı Başlık' }, 'slug'],
    ['slug with a trailing dash', { slug: 'masal-' }, 'slug'],
    ['slug too long', { slug: 'a'.repeat(81) }, 'slug'],
    ['unknown status', { status: 'LIVE' }, 'status'],
    ['summary too long', { summary: 'x'.repeat(1001) }, 'summary'],
    ['original language that is not a code', { originalLanguage: 'danish' }, 'originalLanguage'],
    ['author name too long', { authorName: 'x'.repeat(201) }, 'authorName'],
    ['year that is not a number', { authorDeathYear: '18a5' }, 'authorDeathYear'],
    ['fractional year', { firstPublishedYear: '1812.5' }, 'firstPublishedYear'],
    ['year out of range', { editionYear: String(YEAR_MAX + 1) }, 'editionYear'],
    ['year below the range', { collectorDeathYear: String(YEAR_MIN - 1) }, 'collectorDeathYear'],
    ['source url without protocol', { sourceUrl: 'example.org/eser' }, 'sourceUrl'],
    ['source url with another protocol', { sourceUrl: 'ftp://example.org/eser' }, 'sourceUrl'],
    ['licence url that is not a url', { licenseUrl: 'lisans' }, 'licenseUrl'],
    ['unknown origin', { origin: 'STOLEN' }, 'origin'],
    ['unknown text fidelity', { textFidelity: 'LOOSE' }, 'textFidelity'],
    ['unknown rights basis', { rightsBasis: 'FAIR_USE' }, 'rightsBasis'],
    ['unknown translation method', { translationMethod: 'AI' }, 'translationMethod'],
    ['unknown language level', { languageLevel: 'D1' }, 'languageLevel'],
    ['date that is not a date', { sourceRetrievedAt: 'dün' }, 'sourceRetrievedAt'],
    ['rights verified date that is not a date', { rightsVerifiedAt: '13/10/2026x' }, 'rightsVerifiedAt'],
    ['rights note too long', { rightsNote: 'x'.repeat(4001) }, 'rightsNote'],
    ['translatedFromId too long', { translatedFromId: 'x'.repeat(101) }, 'translatedFromId'],
  ])('rejects %s', async (_label, over, field) => {
    const { invalid, messages } = await check(CreateStoryDto, { ...base, ...over });
    expect(invalid).toEqual([field]);
    for (const message of messages) {
      expect(message).toMatch(CLEAN_COPY);
    }
  });

  it('derived and internal columns cannot be set from the body', async () => {
    for (const forbidden of ['languageLevelSource', 'languageLevelAssessedAt', 'publishedAt', 'translationGroupId']) {
      const { invalid } = await check(UpdateStoryDto, { [forbidden]: 'x' });
      expect(invalid).toEqual([forbidden]);
    }
  });

  it('messages are Turkish and name the field', async () => {
    expect((await check(UpdateStoryDto, { language: 'xx' })).messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
    expect((await check(UpdateStoryDto, { authorDeathYear: 'x' })).messages).toContain(
      'Yazarın ölüm yılı tam sayı olmalıdır.',
    );
    expect((await check(UpdateStoryDto, { origin: 'X' })).messages).toEqual([
      'Köken şu değerlerden biri olmalıdır: PUBLIC_DOMAIN, FOLK_ANONYMOUS, LICENSED, ORIGINAL_HUMAN, AI_GENERATED.',
    ]);
    expect((await check(UpdateStoryDto, { sourceUrl: 'x' })).messages).toContain(
      'Kaynak bağlantısı http ya da https ile başlayan geçerli bir bağlantı olmalıdır.',
    );
  });
});

describe('AdminStoriesQueryDto (GET /admin/stories)', () => {
  it('no parameter is valid (pagination defaults)', async () => {
    const { instance, invalid } = await check(AdminStoriesQueryDto, {});
    expect(invalid).toEqual([]);
    expect(instance).toMatchObject({ page: 1, limit: 20 });
  });

  it('accepts and normalises every filter', async () => {
    const { instance, invalid } = await check(AdminStoriesQueryDto, {
      language: 'TR',
      status: 'draft',
      languageLevel: 'a1,B2',
      category: 'bedtime',
      ageGroup: 'ten_plus',
      origin: 'public_domain',
      q: 'kurt',
      missingLanguage: 'en-US',
      sort: 'level',
      page: '2',
      limit: '50',
    });

    expect(invalid).toEqual([]);
    expect(instance).toMatchObject({
      language: 'tr',
      status: 'DRAFT',
      languageLevel: ['A1', 'B2'],
      category: 'BEDTIME',
      ageGroup: 'TEN_PLUS',
      origin: 'PUBLIC_DOMAIN',
      q: 'kurt',
      missingLanguage: 'en',
      sort: 'level',
      page: 2,
      limit: 50,
    });
  });

  it('blank filters (an empty select in the panel) mean "all"', async () => {
    const { instance, invalid } = await check(AdminStoriesQueryDto, {
      language: '',
      status: '',
      languageLevel: '',
      category: '',
      ageGroup: '',
      origin: '',
      missingLanguage: '',
    });
    expect(invalid).toEqual([]);
    expect(instance.status).toBeUndefined();
    expect(instance.languageLevel).toBeUndefined();
    expect(instance.missingLanguage).toBeUndefined();
  });

  it.each([
    ['language', { language: 'xx' }],
    ['status', { status: 'LIVE' }],
    ['languageLevel', { languageLevel: 'A1,X1' }],
    ['category', { category: 'HORROR' }],
    ['ageGroup', { ageGroup: 'ADULT' }],
    ['origin', { origin: 'STOLEN' }],
    ['q', { q: 'x'.repeat(201) }],
    ['missingLanguage', { missingLanguage: 'klingon' }],
    ['sort', { sort: 'popular' }],
    ['unknown', { unknown: '1' }],
  ])('rejects a bad %s', async (field, plain) => {
    expect((await check(AdminStoriesQueryDto, plain)).invalid).toEqual([field]);
  });

  it('a non-string enum filter is left for the validator', async () => {
    expect((await check(AdminStoriesQueryDto, { status: 5 })).invalid).toEqual(['status']);
  });
});

describe('LinkTranslationDto (POST /admin/stories/:id/link-translation)', () => {
  it('needs otherStoryId; legacy non-UUID ids are accepted', async () => {
    expect((await check(LinkTranslationDto, { otherStoryId: 'seed-story-keloglan' })).invalid).toEqual([]);
    expect((await check(LinkTranslationDto, {})).invalid).toEqual(['otherStoryId']);
    expect((await check(LinkTranslationDto, { otherStoryId: '' })).invalid).toEqual(['otherStoryId']);
    expect((await check(LinkTranslationDto, { otherStoryId: 5 })).invalid).toEqual(['otherStoryId']);
    expect((await check(LinkTranslationDto, { otherStoryId: 'a', extra: 1 })).invalid).toEqual(['extra']);
  });
});

describe('collection DTOs: language', () => {
  const collection = { slug: 'sleep', title: 'Uyku Vakti', tone: 'TRUST' };

  it('language is optional on create and validated against CONTENT_LANGUAGES', async () => {
    expect((await check(CreateCollectionDto, collection)).invalid).toEqual([]);
    expect((await check(CreateCollectionDto, { ...collection, language: 'en' })).invalid).toEqual([]);
    const bad = await check(CreateCollectionDto, { ...collection, language: 'tr-TR' });
    expect(bad.invalid).toEqual(['language']);
    expect(bad.messages).toEqual([CONTENT_LANGUAGE_MESSAGE]);
  });

  it('language can be patched', async () => {
    expect((await check(UpdateCollectionDto, { language: 'de' })).invalid).toEqual([]);
    expect((await check(UpdateCollectionDto, { language: 'xx' })).invalid).toEqual(['language']);
  });

  it('the admin collection list filters by language', async () => {
    expect((await check(AdminCollectionsQueryDto, { language: 'en', search: 'sleep' })).invalid).toEqual([]);
    expect((await check(AdminCollectionsQueryDto, { language: 'xx' })).invalid).toEqual(['language']);
  });
});
