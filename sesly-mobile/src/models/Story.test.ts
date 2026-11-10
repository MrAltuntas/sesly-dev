/**
 * Story parsers: the fields the v3 design reads (language, level, summary,
 * credit, translations) and the placeholders that wait for the backend.
 */

import {
  DEFAULT_STORY_EXTRAS,
  EMPTY_STORY_CREDIT,
  NO_RELATED_STORIES,
  getStoryTranslationKind,
  parseRelatedStoriesFromJSON,
  relatedStoryList,
  parseStoryChunkFromJSON,
  parseStoryCreditFromJSON,
  parseStoryDetailFromJSON,
  parseStoryFromJSON,
  parseStoryTranslationSourceFromJSON,
  parseStoryTranslationsFromJSON,
} from './Story';
import { getNarratorDisplay } from './Narrator';

const base = {
  id: 's-1',
  title: 'Parmak Kız',
  description: 'Bir ceviz kabuğunda uyuyan minik bir kız.',
  ageGroup: 'THREE_TO_SIX',
  category: 'WORLD_CLASSICS',
  estimatedDuration: 6,
  coverImageUrl: null,
  isPremium: false,
  isFavorite: true,
};

describe('parseStoryFromJSON: v3 fields', () => {
  it('reads language, level, summary and credit', () => {
    const story = parseStoryFromJSON({
      ...base,
      language: 'EN',
      languageLevel: 'a2',
      summary: 'A tiny girl who sleeps in a walnut shell.',
      credit: {
        originalTitle: 'Tommelise',
        originalLanguage: 'da',
        authorName: 'Hans Christian Andersen',
        authorDeathYear: 1875,
        translatorName: 'Sesly Yayın Kurulu',
        firstPublishedYear: 1835,
        translationMethod: 'machine',
      },
    });
    expect(story.language).toBe('en');
    expect(story.languageLevel).toBe('A2');
    expect(story.summary).toBe('A tiny girl who sleeps in a walnut shell.');
    expect(story.credit).toEqual({
      ...EMPTY_STORY_CREDIT,
      originalTitle: 'Tommelise',
      originalLanguage: 'da',
      authorName: 'Hans Christian Andersen',
      authorDeathYear: 1875,
      translatorName: 'Sesly Yayın Kurulu',
      firstPublishedYear: 1835,
      translationMethod: 'MACHINE',
    });
    expect(story.isFavorite).toBe(true);
  });

  it('an older payload without the new fields still parses with safe values', () => {
    const story = parseStoryFromJSON(base);
    expect(story.language).toBe('tr');
    expect(story.languageLevel).toBeNull();
    // Without `summary` the description stands in.
    expect(story.summary).toBe('Bir ceviz kabuğunda uyuyan minik bir kız.');
    expect(story.credit).toBe(EMPTY_STORY_CREDIT);
  });

  it('placeholders: no group id and only the own language until the backend sends them', () => {
    const story = parseStoryFromJSON({ ...base, language: 'en' });
    expect(story.translationGroupId).toBeNull();
    expect(story.availableLanguages).toEqual(['en']);
  });

  it('reads the placeholder fields as soon as the backend sends them', () => {
    const story = parseStoryFromJSON({
      ...base,
      language: 'tr',
      translationGroupId: 'grp-parmak',
      availableLanguages: ['TR', 'en', 'de', 'en', ''],
    });
    expect(story.translationGroupId).toBe('grp-parmak');
    expect(story.availableLanguages).toEqual(['tr', 'en', 'de']);
  });

  it('DEFAULT_STORY_EXTRAS describes a Turkish story without credit', () => {
    expect(DEFAULT_STORY_EXTRAS).toEqual({
      language: 'tr',
      languageLevel: null,
      summary: null,
      credit: EMPTY_STORY_CREDIT,
      translationGroupId: null,
      coverKey: null,
      contentWarnings: [],
      availableLanguages: ['tr'],
      isFavoriteAnyLanguage: false,
    });
  });
});

describe('credit and translations', () => {
  it('ignores malformed credit values', () => {
    expect(parseStoryCreditFromJSON(null)).toBe(EMPTY_STORY_CREDIT);
    expect(parseStoryCreditFromJSON('x')).toBe(EMPTY_STORY_CREDIT);
    expect(
      parseStoryCreditFromJSON({ authorName: '  ', authorDeathYear: '1875', translationMethod: 'ROBOT' }),
    ).toEqual(EMPTY_STORY_CREDIT);
  });

  it('keeps only well-formed translation refs', () => {
    expect(
      parseStoryTranslationsFromJSON([
        { id: 's-2', language: 'EN', title: 'Thumbelina' },
        { id: '', language: 'de', title: 'Däumelinchen' },
        { id: 's-4', language: ' ', title: 'x' },
        { id: 's-5', language: 'de' },
        null,
        'x',
      ]),
    ).toEqual([
      { id: 's-2', language: 'en', title: 'Thumbelina' },
      { id: 's-5', language: 'de', title: '' },
    ]);
    expect(parseStoryTranslationsFromJSON(undefined)).toEqual([]);
  });

  it('translation kind: only our AI translation gets the mark, a human translation none', () => {
    const credit = (patch: object) => ({ credit: { ...EMPTY_STORY_CREDIT, ...patch } });
    expect(getStoryTranslationKind(credit({ translationMethod: 'MACHINE', translatorName: 'Ada' }))).toBe('machine');
    expect(getStoryTranslationKind(credit({ translationMethod: 'HUMAN' }))).toBeNull();
    expect(getStoryTranslationKind(credit({ translatorName: 'Sesly Yayın Kurulu' }))).toBeNull();
    expect(getStoryTranslationKind(credit({}))).toBeNull();
    // The list item flag counts too.
    expect(getStoryTranslationKind({ ...credit({}), isMachineTranslation: true })).toBe('machine');
  });

  it('reads the CC BY credit: attribution, licence name and an http(s) licence link only', () => {
    expect(
      parseStoryCreditFromJSON({
        attribution: 'The Fox by A. Writer, CC BY 4.0',
        licenseName: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      }),
    ).toEqual({
      ...EMPTY_STORY_CREDIT,
      attribution: 'The Fox by A. Writer, CC BY 4.0',
      licenseName: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    });
    for (const licenseUrl of ['javascript:alert(1)', 'ftp://x.org/l', 'creativecommons.org', '  ', 42]) {
      expect(parseStoryCreditFromJSON({ licenseUrl }).licenseUrl).toBeNull();
    }
  });

  it('reads the cover picture credit as a plain line; anything but text is none', () => {
    const line = 'Illustration by Greystroke, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)';
    expect(parseStoryCreditFromJSON({ coverCredit: line }).coverCredit).toBe(line);
    for (const coverCredit of [null, undefined, '  ', 7, { illustrator: 'x' }]) {
      expect(parseStoryCreditFromJSON({ coverCredit }).coverCredit).toBeNull();
    }
    expect(parseStoryCreditFromJSON(null).coverCredit).toBeNull();
  });
});

describe('parseStoryDetailFromJSON: translation source', () => {
  it('a machine translation with its published original', () => {
    const detail = parseStoryDetailFromJSON({
      ...base,
      translation: {
        isMachineTranslation: true,
        method: 'MACHINE',
        fromLanguage: 'EN',
        original: { id: 's-en', title: 'The Fox', language: 'en' },
      },
    });
    expect(detail.translation).toEqual({
      isMachineTranslation: true,
      fromLanguage: 'en',
      original: { id: 's-en', title: 'The Fox', language: 'en' },
    });
  });

  it('no original to open; the language falls back to the original; not a translation is null', () => {
    expect(parseStoryTranslationSourceFromJSON({ method: 'MACHINE', fromLanguage: null, original: null })).toEqual({
      isMachineTranslation: true,
      fromLanguage: null,
      original: null,
    });
    expect(
      parseStoryTranslationSourceFromJSON({ method: 'HUMAN', original: { id: 's-de', title: 'Der Fuchs', language: 'DE' } }),
    ).toEqual({ isMachineTranslation: false, fromLanguage: 'de', original: { id: 's-de', title: 'Der Fuchs', language: 'de' } });
    expect(parseStoryTranslationSourceFromJSON({ original: { id: '', language: 'en' } })?.original).toBeNull();
    expect(parseStoryTranslationSourceFromJSON(null)).toBeNull();
    expect(parseStoryDetailFromJSON(base).translation).toBeNull();
  });
});

describe('parseStoryDetailFromJSON: translations', () => {
  it('lists the own language first, then the languages of the translations', () => {
    const detail = parseStoryDetailFromJSON({
      ...base,
      language: 'tr',
      languageLevel: 'A2',
      translations: [
        { id: 's-2', language: 'en', title: 'Thumbelina' },
        { id: 's-3', language: 'de', title: 'Däumelinchen' },
      ],
    });
    expect(detail.translations).toHaveLength(2);
    expect(detail.availableLanguages).toEqual(['tr', 'en', 'de']);
    expect(detail.languageLevel).toBe('A2');
    expect(detail.language).toBe('tr');
    expect(detail.credit).toBe(EMPTY_STORY_CREDIT);
  });

  it('a story without translations has only its own language', () => {
    const detail = parseStoryDetailFromJSON({ ...base, language: 'en' });
    expect(detail.translations).toEqual([]);
    expect(detail.availableLanguages).toEqual(['en']);
  });
});

describe('getNarratorDisplay (placeholder for friendly narrator names)', () => {
  it('returns the profile name and no description yet', () => {
    expect(getNarratorDisplay({ name: ' Zeynep ' })).toEqual({ name: 'Zeynep', description: null });
  });

  it('returns null without a usable name', () => {
    expect(getNarratorDisplay(null)).toBeNull();
    expect(getNarratorDisplay(undefined)).toBeNull();
    expect(getNarratorDisplay({ name: '   ' })).toBeNull();
  });
});

describe('parseStoryChunkFromJSON', () => {
  const spyConsole = () => ({
    log: jest.spyOn(console, 'log').mockImplementation(() => undefined),
    info: jest.spyOn(console, 'info').mockImplementation(() => undefined),
    debug: jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    error: jest.spyOn(console, 'error').mockImplementation(() => undefined),
  });

  it('reads the backend and the app field names and logs nothing', () => {
    const spies = spyConsole();
    expect(
      parseStoryChunkFromJSON({ id: 'c-1', chunkIndex: 2, content: 'Bir varmış.', startTime: 4, endTime: 9 }),
    ).toEqual({ id: 'c-1', index: 2, text: 'Bir varmış.', startPosition: 4, endPosition: 9 });
    expect(parseStoryChunkFromJSON({ id: 'c-2', index: 0, text: 'Bir yokmuş.' })).toEqual({
      id: 'c-2',
      index: 0,
      text: 'Bir yokmuş.',
      startPosition: 0,
      endPosition: 0,
    });
    // A whole detail with its chunks is parsed in silence too.
    const detail = parseStoryDetailFromJSON({
      ...base,
      chunks: [{ id: 'c-1', chunkIndex: 0, content: 'Bir varmış.' }],
    });
    expect(detail.chunks).toHaveLength(1);
    Object.values(spies).forEach(spy => expect(spy).not.toHaveBeenCalled());
  });

  it('throws on a broken chunk, without dumping it to the console', () => {
    const spies = spyConsole();
    expect(() => parseStoryChunkFromJSON(null)).toThrow('expected object');
    expect(() => parseStoryChunkFromJSON({ index: 0, text: 'x' })).toThrow('invalid id');
    expect(() => parseStoryChunkFromJSON({ id: 'c', text: 'x' })).toThrow('invalid index');
    expect(() => parseStoryChunkFromJSON({ id: 'c', index: 1, content: '' })).toThrow('invalid text');
    Object.values(spies).forEach(spy => expect(spy).not.toHaveBeenCalled());
  });
});

describe('parseRelatedStoriesFromJSON (GET /stories/:id/related)', () => {
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    title: `Masal ${id}`,
    ageGroup: 'THREE_TO_SIX',
    category: 'BEDTIME',
    estimatedDuration: 5,
    ...extra,
  });

  it('keeps the three groups in their order, the parts with their numbers', () => {
    const related = parseRelatedStoriesFromJSON({
      languages: [row('en', { language: 'en' })],
      parts: [row('p1', { partNumber: 1 }), row('p3', { partNumber: 3 })],
      category: [row('c1'), row('c2')],
    });
    expect(related.languages.map(story => story.id)).toEqual(['en']);
    expect(related.parts.map(part => [part.story.id, part.number])).toEqual([
      ['p1', 1],
      ['p3', 3],
    ]);
    expect(related.category.map(story => story.id)).toEqual(['c1', 'c2']);
    expect(relatedStoryList(related).map(story => story.id)).toEqual(['en', 'p1', 'p3', 'c1', 'c2']);
  });

  it('drops what it cannot read and answers nothing for no body', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const related = parseRelatedStoriesFromJSON({
      languages: [{ id: 'broken' }, row('ok')],
      parts: [row('no-number'), row('p2', { partNumber: 2 })],
      category: 'nope',
    });
    expect(related.languages.map(story => story.id)).toEqual(['ok']);
    expect(related.parts.map(part => part.story.id)).toEqual(['p2']);
    expect(related.category).toEqual([]);
    expect(parseRelatedStoriesFromJSON(null)).toBe(NO_RELATED_STORIES);
    warn.mockRestore();
  });
});
