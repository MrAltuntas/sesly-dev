import {
  GroupCandidate,
  allMemberIds,
  groupKeyOf,
  loadStoryGroupInfo,
  orderLanguages,
  pickGroupVersion,
  pickGroupVersionIds,
} from './story-groups';
import { storyListExtras, toStoryListItem, toStoryListItems } from './story-list.mapper';
import { createSettingsStub } from '../../test-utils/settings-stub';

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date('2026-01-01T00:00:00.000Z');

const candidate = (over: Partial<GroupCandidate> = {}): GroupCandidate => ({
  id: 's1',
  language: 'tr',
  translationGroupId: null,
  originalLanguage: null,
  translatedFromId: null,
  createdAt: T0,
  ...over,
});

describe('story-groups', () => {
  describe('groupKeyOf', () => {
    it('is the translation group, or the story itself when it has none', () => {
      expect(groupKeyOf({ id: 's1', translationGroupId: 'g1' })).toBe('g1');
      expect(groupKeyOf({ id: 's1', translationGroupId: null })).toBe('s1');
      expect(groupKeyOf({ id: 's1' })).toBe('s1');
    });
  });

  describe('orderLanguages', () => {
    it('catalogue order, no duplicates, unknown codes last', () => {
      expect(orderLanguages(['de', 'en', 'tr', 'en'])).toEqual(['tr', 'en', 'de']);
      expect(orderLanguages(['zz', 'en', 'aa'])).toEqual(['en', 'aa', 'zz']);
      expect(orderLanguages([])).toEqual([]);
    });

    it('puts the given language first, also when it is not in the list', () => {
      expect(orderLanguages(['tr', 'de', 'en'], 'en')).toEqual(['en', 'tr', 'de']);
      expect(orderLanguages(['tr'], 'de')).toEqual(['de', 'tr']);
    });
  });

  describe('pickGroupVersion', () => {
    const preference = { preferred: 'en', defaultLanguage: 'tr' };
    const tr = candidate({ id: 'tr', language: 'tr', translationGroupId: 'g' });
    const en = candidate({ id: 'en', language: 'en', translationGroupId: 'g', translatedFromId: 'tr' });
    const de = candidate({ id: 'de', language: 'de', translationGroupId: 'g', translatedFromId: 'tr' });

    it('the version in the preferred content language wins', () => {
      expect(pickGroupVersion([tr, en, de], preference).id).toBe('en');
      expect(pickGroupVersion([de, tr], { preferred: 'de', defaultLanguage: 'tr' }).id).toBe('de');
    });

    it('otherwise the version in the original language: originalLanguage when stated', () => {
      const grimmTr = candidate({ id: 'tr', language: 'tr', originalLanguage: 'de', translationGroupId: 'g' });
      const grimmDe = candidate({ id: 'de', language: 'de', originalLanguage: 'de', translationGroupId: 'g' });

      expect(pickGroupVersion([grimmTr, grimmDe], { preferred: 'fr', defaultLanguage: 'tr' }).id).toBe('de');
    });

    it('a story that states no original language is the original when it is not a translation', () => {
      expect(pickGroupVersion([en, tr], { preferred: 'fr', defaultLanguage: 'en' }).id).toBe('tr');
    });

    it('with no original among them the default content language is shown', () => {
      const a = candidate({ id: 'a', language: 'en', originalLanguage: 'da', translationGroupId: 'g' });
      const b = candidate({ id: 'b', language: 'tr', originalLanguage: 'da', translationGroupId: 'g' });

      expect(pickGroupVersion([a, b], { preferred: 'fr', defaultLanguage: 'tr' }).id).toBe('b');
    });

    it('last resort is stable: catalogue order, then the oldest, then the lowest id', () => {
      const es = candidate({ id: 'es', language: 'es', originalLanguage: 'da' });
      const it = candidate({ id: 'it', language: 'it', originalLanguage: 'da' });
      const pref = { preferred: 'fr', defaultLanguage: 'tr' };
      expect(pickGroupVersion([it, es], pref).id).toBe('es');
      expect(pickGroupVersion([es, it], pref).id).toBe('es');

      const older = candidate({ id: 'z', language: 'es', originalLanguage: 'da', createdAt: T0 });
      const newer = candidate({ id: 'a', language: 'es', originalLanguage: 'da', createdAt: new Date(T0.getTime() + DAY) });
      expect(pickGroupVersion([newer, older], pref).id).toBe('z');

      const twinA = candidate({ id: 'a', language: 'es', originalLanguage: 'da' });
      const twinB = candidate({ id: 'b', language: 'es', originalLanguage: 'da' });
      expect(pickGroupVersion([twinB, twinA], pref).id).toBe('a');
    });

    it('does not reorder the list it was given', () => {
      const members = [tr, en, de];
      pickGroupVersion(members, preference);
      expect(members.map((m) => m.id)).toEqual(['tr', 'en', 'de']);
    });
  });

  describe('pickGroupVersionIds', () => {
    it('one id per tale; a story without a group is a tale of its own', () => {
      const rows = [
        candidate({ id: 'a-tr', language: 'tr', translationGroupId: 'a' }),
        candidate({ id: 'a-en', language: 'en', translationGroupId: 'a', translatedFromId: 'a-tr' }),
        candidate({ id: 'solo-en', language: 'en' }),
        candidate({ id: 'solo-tr', language: 'tr' }),
        candidate({ id: 'b-de', language: 'de', translationGroupId: 'b' }),
      ];

      expect(pickGroupVersionIds(rows, { preferred: 'en', defaultLanguage: 'tr' })).toEqual([
        'a-en',
        'solo-en',
        'solo-tr',
        'b-de',
      ]);
      expect(pickGroupVersionIds(rows, { preferred: 'tr', defaultLanguage: 'tr' })).toEqual([
        'a-tr',
        'solo-en',
        'solo-tr',
        'b-de',
      ]);
      expect(pickGroupVersionIds([], { preferred: 'tr', defaultLanguage: 'tr' })).toEqual([]);
    });
  });

  describe('loadStoryGroupInfo', () => {
    const settings = createSettingsStub({ 'content.enabledLanguages': ['tr', 'en', 'de'] });

    it('no query when no story of the page has a group; each story lists its own language', async () => {
      const prisma = { story: { findMany: jest.fn() } };

      const info = await loadStoryGroupInfo(prisma, settings as any, [
        { id: 's1', language: 'tr', translationGroupId: null },
        { id: 's2', language: 'en' },
      ]);

      expect(prisma.story.findMany).not.toHaveBeenCalled();
      expect(info.get('s1')).toEqual({ availableLanguages: ['tr'], memberIds: ['s1'] });
      expect(info.get('s2')).toEqual({ availableLanguages: ['en'], memberIds: ['s2'] });
    });

    it('reads the published versions in enabled languages of every group in one query', async () => {
      const prisma = {
        story: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'a-de', language: 'de', translationGroupId: 'a' },
            { id: 'a-tr', language: 'tr', translationGroupId: 'a' },
            { id: 'a-en', language: 'en', translationGroupId: 'a' },
            { id: 'b-tr', language: 'tr', translationGroupId: 'b' },
          ]),
        },
      };

      const info = await loadStoryGroupInfo(prisma, settings as any, [
        { id: 'a-en', language: 'en', translationGroupId: 'a' },
        { id: 'b-tr', language: 'tr', translationGroupId: 'b' },
        { id: 'a-tr', language: 'tr', translationGroupId: 'a' },
      ]);

      expect(prisma.story.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.story.findMany).toHaveBeenCalledWith({
        where: {
          translationGroupId: { in: ['a', 'b'] },
          status: 'PUBLISHED',
          language: { in: ['tr', 'en', 'de'] },
        },
        select: expect.objectContaining({ id: true, language: true, translationGroupId: true, coverImageUrl: true }),
      });
      // The shown language first, the others in catalogue order.
      expect(info.get('a-en')).toEqual({
        availableLanguages: ['en', 'tr', 'de'],
        memberIds: ['a-en', 'a-tr', 'a-de'],
      });
      expect(info.get('a-tr')).toEqual({
        availableLanguages: ['tr', 'en', 'de'],
        memberIds: ['a-tr', 'a-en', 'a-de'],
      });
      expect(info.get('b-tr')).toEqual({ availableLanguages: ['tr'], memberIds: ['b-tr'] });
    });

    it('an archived story (not among the published members) still lists its own language first', async () => {
      const prisma = {
        story: { findMany: jest.fn().mockResolvedValue([{ id: 'a-en', language: 'en', translationGroupId: 'a' }]) },
      };

      const info = await loadStoryGroupInfo(prisma, settings as any, [
        { id: 'a-tr-old', language: 'tr', translationGroupId: 'a' },
      ]);

      expect(info.get('a-tr-old')).toEqual({
        availableLanguages: ['tr', 'en'],
        memberIds: ['a-tr-old', 'a-en'],
      });
    });

    it('allMemberIds: every id named by a page, once', async () => {
      const prisma = {
        story: {
          findMany: jest.fn().mockResolvedValue([
            { id: 'a-tr', language: 'tr', translationGroupId: 'a' },
            { id: 'a-en', language: 'en', translationGroupId: 'a' },
          ]),
        },
      };
      const info = await loadStoryGroupInfo(prisma, settings as any, [
        { id: 'a-tr', language: 'tr', translationGroupId: 'a' },
        { id: 'a-en', language: 'en', translationGroupId: 'a' },
        { id: 'solo', language: 'tr' },
      ]);

      expect(allMemberIds(info).sort()).toEqual(['a-en', 'a-tr', 'solo']);
      expect(allMemberIds(new Map())).toEqual([]);
    });
  });

  describe('list items carry the group fields', () => {
    const storage = { getReadUrl: jest.fn(async (v: string | null) => v) };
    const row = (id: string, language: string) => ({
      id,
      title: id,
      content: 'Metin.',
      ageGroup: 'THREE_TO_SIX',
      category: 'BEDTIME',
      language,
      estimatedDuration: 3,
      coverImageUrl: null,
      isPremium: false,
      createdAt: T0,
      updatedAt: T0,
    });

    it('without extras a story is a tale of its own', async () => {
      const item = await toStoryListItem(row('s1', 'en'), storage as any, false);
      expect(item.availableLanguages).toEqual(['en']);
      expect(item.isFavoriteAnyLanguage).toBe(false);

      const empty = await toStoryListItem(row('s1', 'en'), storage as any, false, { availableLanguages: [] });
      expect(empty.availableLanguages).toEqual(['en']);
    });

    it('isFavoriteAnyLanguage is true for the favourite itself and for a favourite on another version', async () => {
      const own = await toStoryListItem(row('s1', 'tr'), storage as any, true);
      expect(own.isFavoriteAnyLanguage).toBe(true);

      const other = await toStoryListItem(row('s1', 'tr'), storage as any, false, {
        availableLanguages: ['tr', 'en'],
        isFavoriteAnyLanguage: true,
      });
      expect(other).toMatchObject({
        isFavorite: false,
        isFavoriteAnyLanguage: true,
        availableLanguages: ['tr', 'en'],
      });
    });

    it('storyListExtras reads a page of group info; a story that is not in it has none', () => {
      const info = new Map([['a-tr', { availableLanguages: ['tr', 'en'], memberIds: ['a-tr', 'a-en'] }]]);

      expect(storyListExtras('a-tr', new Set(['a-en']), info)).toEqual({
        availableLanguages: ['tr', 'en'],
        isFavoriteAnyLanguage: true,
      });
      expect(storyListExtras('a-tr', new Set(), info)).toEqual({
        availableLanguages: ['tr', 'en'],
        isFavoriteAnyLanguage: false,
      });
      expect(storyListExtras('other', new Set(), info)).toEqual({});
      expect(storyListExtras('a-tr', new Set())).toEqual({});
    });

    it('toStoryListItems applies the group info to every row', async () => {
      const info = new Map([
        ['a-tr', { availableLanguages: ['tr', 'en'], memberIds: ['a-tr', 'a-en'] }],
        ['solo', { availableLanguages: ['tr'], memberIds: ['solo'] }],
      ]);

      const items = await toStoryListItems(
        [row('a-tr', 'tr'), row('solo', 'tr')],
        storage as any,
        new Set(['a-en']),
        info,
      );

      expect(items.map((i) => [i.id, i.isFavorite, i.isFavoriteAnyLanguage, i.availableLanguages])).toEqual([
        ['a-tr', false, true, ['tr', 'en']],
        ['solo', false, false, ['tr']],
      ]);
    });
  });
});
