import {
  generateStoryDescription,
  resolveStorySummary,
  storyListExtras,
  toStoryCredit,
  toStoryListItem,
  toStoryListItems,
} from './story-list.mapper';

const EMPTY_CREDIT = {
  originalTitle: null,
  originalLanguage: null,
  authorName: null,
  authorDeathYear: null,
  collectorName: null,
  collectorDeathYear: null,
  translatorName: null,
  translatorDeathYear: null,
  adaptedBy: null,
  firstPublishedYear: null,
  editionYear: null,
  sourceName: null,
  sourceUrl: null,
  origin: null,
  textFidelity: null,
  translationMethod: null,
  attribution: null,
  licenseName: null,
  licenseUrl: null,
  coverCredit: null,
};

const CREDITED = {
  originalTitle: 'Rotkäppchen',
  originalLanguage: 'de',
  authorName: 'Jacob Grimm',
  authorDeathYear: 1863,
  collectorName: 'Wilhelm Grimm',
  collectorDeathYear: 1859,
  translatorName: 'Ayşe Çevirmen',
  translatorDeathYear: 1950,
  adaptedBy: 'Sesly',
  firstPublishedYear: 1812,
  editionYear: 1857,
  sourceName: 'Kinder- und Hausmärchen',
  sourceUrl: 'https://example.org/khm',
  origin: 'PUBLIC_DOMAIN',
  textFidelity: 'TRANSLATED',
  translationMethod: 'HUMAN',
};

/**
 * The list-item shape is the public contract for every story list
 * (GET /stories, /stories/search, /stories/favorites, /stories/:id,
 * /collections/:slug/stories, narration.story). Mobile parses it verbatim.
 */
const STORY_LIST_ITEM_KEYS = [
  'ageGroup',
  'availableLanguages',
  'category',
  'coverImageUrl',
  'coverKey',
  'createdAt',
  'credit',
  'description',
  'estimatedDuration',
  'hasPreGeneratedNarration',
  'id',
  'isFavorite',
  'isFavoriteAnyLanguage',
  'isMachineTranslation',
  'contentWarnings',
  'isPremium',
  'language',
  'languageLevel',
  'summary',
  'title',
  'updatedAt',
].sort();

function storyRow(overrides: Partial<any> = {}) {
  return {
    id: 'story-1',
    title: 'Keloglan',
    content: 'Bir varmis bir yokmus. '.repeat(20),
    ageGroup: 'SIX_TO_TEN',
    category: 'TURKISH_CLASSICS',
    language: 'tr',
    estimatedDuration: 7,
    coverImageUrl: 'stories/covers/story-1.png',
    isPremium: false,
    hasPreGeneratedNarration: true,
    // TTS internals that must never leave the server:
    preprocessedSegments: [{ text: 'secret full text', emotion: 'calm' }],
    cartesiaPronunciationDictId: 'dict-secret',
    defaultEmotion: 'calm',
    defaultSpeed: 0.9,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('story-list.mapper', () => {
  let storage: { getReadUrl: jest.Mock };

  beforeEach(() => {
    storage = {
      getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)),
    };
  });

  describe('toStoryListItem', () => {
    it('produces exactly the public key set (renaming or adding a field fails this test)', async () => {
      const item = await toStoryListItem(storyRow() as any, storage as any, false);

      expect(Object.keys(item).sort()).toEqual(STORY_LIST_ITEM_KEYS);
    });

    it('never leaks full content or TTS internals', async () => {
      const item: any = await toStoryListItem(storyRow() as any, storage as any, true);

      expect(item).not.toHaveProperty('content');
      expect(item).not.toHaveProperty('preprocessedSegments');
      expect(item).not.toHaveProperty('cartesiaPronunciationDictId');
      expect(item).not.toHaveProperty('defaultEmotion');
      expect(item).not.toHaveProperty('defaultSpeed');
      expect(JSON.stringify(item)).not.toContain('secret full text');
    });

    it('maps scalar fields and presigns the cover via StorageService.getReadUrl', async () => {
      const row = storyRow();
      const item = await toStoryListItem(row as any, storage as any, true);

      expect(storage.getReadUrl).toHaveBeenCalledWith('stories/covers/story-1.png');
      expect(item).toEqual({
        id: 'story-1',
        title: 'Keloglan',
        description: generateStoryDescription(row.content),
        summary: generateStoryDescription(row.content),
        ageGroup: 'SIX_TO_TEN',
        category: 'TURKISH_CLASSICS',
        language: 'tr',
        languageLevel: null,
        estimatedDuration: 7,
        coverImageUrl: 'signed:stories/covers/story-1.png',
        coverKey: expect.stringMatching(/^[0-9a-f]{16}$/),
        isPremium: false,
        hasPreGeneratedNarration: true,
        isFavorite: true,
        availableLanguages: ['tr'],
        isFavoriteAnyLanguage: true,
        credit: EMPTY_CREDIT,
        isMachineTranslation: false,
        contentWarnings: [],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    });

    it('summary: the editor-written one wins, a blank one falls back to the first 150 characters', async () => {
      const written = await toStoryListItem(
        storyRow({ summary: '  Keloğlan ile devin hikayesi.  ' }) as any,
        storage as any,
        false,
      );
      expect(written.summary).toBe('Keloğlan ile devin hikayesi.');
      // App versions in the field read `description`: it carries the same text.
      expect(written.description).toBe('Keloğlan ile devin hikayesi.');

      for (const summary of [null, undefined, '', '   ']) {
        const row = storyRow({ summary });
        const item = await toStoryListItem(row as any, storage as any, false);
        expect(item.summary).toBe(generateStoryDescription(row.content));
        expect(item.description).toBe(item.summary);
      }
      expect(resolveStorySummary({ summary: null, content: null })).toBe('');
    });

    it('carries language and languageLevel', async () => {
      const item = await toStoryListItem(
        storyRow({ language: 'en', languageLevel: 'B1' }) as any,
        storage as any,
        false,
      );
      expect(item.language).toBe('en');
      expect(item.languageLevel).toBe('B1');
    });

    it('credit is built from the public credit columns plus origin, textFidelity and translationMethod', async () => {
      const item = await toStoryListItem(storyRow(CREDITED) as any, storage as any, false);

      expect(item.credit).toEqual({
        originalTitle: 'Rotkäppchen',
        originalLanguage: 'de',
        authorName: 'Jacob Grimm',
        authorDeathYear: 1863,
        collectorName: 'Wilhelm Grimm',
        collectorDeathYear: 1859,
        translatorName: 'Ayşe Çevirmen',
        translatorDeathYear: 1950,
        adaptedBy: 'Sesly',
        firstPublishedYear: 1812,
        editionYear: 1857,
        sourceName: 'Kinder- und Hausmärchen',
        sourceUrl: 'https://example.org/khm',
        origin: 'PUBLIC_DOMAIN',
        textFidelity: 'TRANSLATED',
        translationMethod: 'HUMAN',
        attribution: null,
        licenseName: null,
        licenseUrl: null,
        coverCredit: null,
      });
      expect(toStoryCredit(storyRow() as any)).toEqual(EMPTY_CREDIT);
    });

    it('the cover credit follows the cover shown: its own, else the borrowed one, never without a cover', async () => {
      const credit = { illustrator: 'Greystroke', licenseName: 'CC BY 4.0', attribution: 'Illustration by Greystroke, CC BY 4.0' };
      const own = await toStoryListItem(
        storyRow({ coverImageUrl: 'stories/cover/a.jpg', coverCredit: credit }) as any,
        storage as any,
        false,
      );
      expect(own.credit.coverCredit).toBe('Illustration by Greystroke, CC BY 4.0');

      const borrowed = await toStoryListItem(storyRow({ coverImageUrl: null, coverCredit: credit }) as any, storage as any, false, {
        sharedCoverImageUrl: 'stories/cover/b.jpg',
        sharedCoverCredit: { illustrator: 'Vilhelm Pedersen', licenseName: 'Kamu malı' },
      });
      expect(borrowed.credit.coverCredit).toBe('Vilhelm Pedersen, Kamu malı');

      const none = await toStoryListItem(storyRow({ coverImageUrl: null, coverCredit: credit }) as any, storage as any, false);
      expect(none.credit.coverCredit).toBeNull();
      expect(
        storyListExtras('s1', new Set(), new Map([['s1', { availableLanguages: ['tr'], memberIds: ['s1'], sharedCoverImageUrl: 'x', sharedCoverCredit: credit }]])),
      ).toMatchObject({ sharedCoverCredit: credit });
    });

    it('a CC BY text carries its attribution, licence name and licence link in credit', async () => {
      const item = await toStoryListItem(
        storyRow({
          attribution: 'The Fox by A. Writer, CC BY 4.0',
          licenseName: 'CC BY 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        }) as any,
        storage as any,
        false,
      );
      expect(item.credit).toMatchObject({
        attribution: 'The Fox by A. Writer, CC BY 4.0',
        licenseName: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      });
    });

    it('content warnings reach the item, known keys only, in vocabulary order', async () => {
      const item = await toStoryListItem(
        storyRow({ contentWarnings: ['DEATH', 'bilinmeyen', 'SCARY'] }) as any,
        storage as any,
        false,
      );
      expect(item.contentWarnings).toEqual(['SCARY', 'DEATH']);
      expect((await toStoryListItem(storyRow() as any, storage as any, false)).contentWarnings).toEqual([]);
    });

    it('isMachineTranslation follows translationMethod MACHINE', async () => {
      const machine = await toStoryListItem(storyRow({ translationMethod: 'MACHINE' }) as any, storage as any, false);
      const human = await toStoryListItem(storyRow({ translationMethod: 'HUMAN' }) as any, storage as any, false);
      expect(machine.isMachineTranslation).toBe(true);
      expect(human.isMachineTranslation).toBe(false);
    });

    it('never serialises the internal rights audit or workflow columns', async () => {
      const item = await toStoryListItem(
        storyRow({
          ...CREDITED,
          sourceRetrievedAt: new Date('2026-05-01T00:00:00Z'),
          rightsBasis: 'AUTHOR_LIFE_PLUS_70',
          rightsNote: 'gizli hak notu',
          rightsVerifiedAt: new Date('2026-05-02T00:00:00Z'),
          rightsVerifiedBy: 'admin@sesly.app',
          status: 'PUBLISHED',
          slug: 'kirmizi-baslikli-kiz',
          publishedAt: new Date('2026-05-03T00:00:00Z'),
          translationGroupId: 'group-1',
          translatedFromId: 'story-0',
          languageLevelSource: 'AI',
          languageLevelNote: 'gizli seviye notu',
          languageLevelAssessedAt: new Date('2026-05-04T00:00:00Z'),
        }) as any,
        storage as any,
        false,
      );

      const json = JSON.stringify(item);
      for (const secret of [
        'sourceRetrievedAt',
        'rightsBasis',
        'AUTHOR_LIFE_PLUS_70',
        'rightsNote',
        'gizli hak notu',
        'rightsVerifiedAt',
        'rightsVerifiedBy',
        'admin@sesly.app',
        'status',
        'slug',
        'publishedAt',
        'translationGroupId',
        'translatedFromId',
        'languageLevelSource',
        'languageLevelNote',
        'gizli seviye notu',
        'languageLevelAssessedAt',
      ]) {
        expect(json).not.toContain(secret);
      }
      expect(Object.keys(item).sort()).toEqual(STORY_LIST_ITEM_KEYS);
      expect(Object.keys(item.credit).sort()).toEqual(Object.keys(EMPTY_CREDIT).sort());
    });

    it('returns null cover when the story has none', async () => {
      const item = await toStoryListItem(storyRow({ coverImageUrl: null }) as any, storage as any, false);

      expect(item.coverImageUrl).toBeNull();
    });

    it('defaults hasPreGeneratedNarration to false when the source omits it', async () => {
      const row: any = storyRow();
      delete row.hasPreGeneratedNarration;

      const item = await toStoryListItem(row, storage as any, false);

      expect(item.hasPreGeneratedNarration).toBe(false);
    });

    it('passes the isFavorite flag through verbatim', async () => {
      expect((await toStoryListItem(storyRow() as any, storage as any, false)).isFavorite).toBe(false);
      expect((await toStoryListItem(storyRow() as any, storage as any, true)).isFavorite).toBe(true);
    });
  });

  describe('toStoryListItems', () => {
    it('keeps input order and flags favorites from the id set', async () => {
      const rows = [storyRow({ id: 'a' }), storyRow({ id: 'b' }), storyRow({ id: 'c' })];

      const items = await toStoryListItems(rows as any, storage as any, new Set(['b']));

      expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
      expect(items.map((i) => i.isFavorite)).toEqual([false, true, false]);
      expect(storage.getReadUrl).toHaveBeenCalledTimes(3);
    });

    it('returns an empty array for no stories', async () => {
      await expect(toStoryListItems([], storage as any, new Set())).resolves.toEqual([]);
    });
  });

  describe('generateStoryDescription', () => {
    it('returns empty string for missing content', () => {
      expect(generateStoryDescription(null)).toBe('');
      expect(generateStoryDescription(undefined)).toBe('');
      expect(generateStoryDescription('')).toBe('');
    });

    it('returns short content unchanged (no ellipsis)', () => {
      expect(generateStoryDescription('Kisa masal.')).toBe('Kisa masal.');
      const exact = 'x'.repeat(150);
      expect(generateStoryDescription(exact)).toBe(exact);
    });

    it('truncates long content at a word boundary and appends three literal periods', () => {
      const content = 'kelime '.repeat(40); // 280 chars
      const desc = generateStoryDescription(content);

      expect(desc.length).toBeLessThanOrEqual(153);
      expect(desc.endsWith('...')).toBe(true);
      expect(desc).not.toContain('\u2026'); // unicode ellipsis is banned in UI text
      expect(desc.slice(0, -3).endsWith(' ')).toBe(false);
      expect(content.startsWith(desc.slice(0, -3))).toBe(true);
    });

    it('hard-cuts when there is no space in the first maxLength chars', () => {
      const content = 'a'.repeat(200);

      expect(generateStoryDescription(content)).toBe('a'.repeat(150) + '...');
    });

    it('honours a custom maxLength', () => {
      expect(generateStoryDescription('bir iki uc dort', 8)).toBe('bir iki...');
    });
  });
});
