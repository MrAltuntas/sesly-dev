import {
  CoverCandidate,
  coverKeyOf,
  loadPartCoverCandidates,
  loadTaleStoryIds,
  sharedCoverFor,
} from './story-covers';
import { loadStoryGroupInfo } from './story-groups';
import { toStoryListItem } from './story-list.mapper';
import { createSettingsStub } from '../../test-utils/settings-stub';

const cand = (overrides: Partial<CoverCandidate>): CoverCandidate => ({
  id: 'x',
  coverImageUrl: 'stories/cover/x.png',
  translationGroupId: null,
  partGroupId: null,
  partNumber: null,
  status: 'PUBLISHED',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  ...overrides,
});

describe('story covers', () => {
  describe('sharedCoverFor', () => {
    const story = { id: 's', coverImageUrl: null, translationGroupId: 'g', partGroupId: 'p' };

    it('a story with its own cover (or one whose cover was not loaded) borrows nothing', () => {
      const all = [cand({ id: 'a', translationGroupId: 'g' })];
      expect(sharedCoverFor({ ...story, coverImageUrl: 'own.png' }, all)).toBeNull();
      expect(sharedCoverFor({ id: 's', translationGroupId: 'g' }, all)).toBeNull();
    });

    it('another language first, a published one before a draft, never itself', () => {
      const all = [
        cand({ id: 's', translationGroupId: 'g', coverImageUrl: 'self.png' }),
        cand({ id: 'draft', translationGroupId: 'g', status: 'DRAFT', coverImageUrl: 'draft.png' }),
        cand({ id: 'pub', translationGroupId: 'g', coverImageUrl: 'pub.png' }),
        cand({ id: 'part', partGroupId: 'p', coverImageUrl: 'part.png' }),
      ];
      expect(sharedCoverFor(story, all)).toBe('pub.png');
    });

    it('then another part, the first part winning; nothing when nobody has a cover', () => {
      const parts = [
        cand({ id: 'p3', partGroupId: 'p', partNumber: 3, coverImageUrl: 'p3.png' }),
        cand({ id: 'p1', partGroupId: 'p', partNumber: 1, coverImageUrl: 'p1.png' }),
        cand({ id: 'p2', partGroupId: 'p', partNumber: 2, coverImageUrl: null }),
      ];
      expect(sharedCoverFor(story, parts)).toBe('p1.png');
      expect(sharedCoverFor(story, [cand({ id: 'o', translationGroupId: 'other' })])).toBeNull();
      expect(sharedCoverFor({ id: 's', coverImageUrl: null }, parts)).toBeNull();
    });

    it('equal rank: the older story, then the id, decides', () => {
      const older = cand({ id: 'b', translationGroupId: 'g', coverImageUrl: 'older.png', createdAt: new Date('2026-01-01') });
      const newer = cand({ id: 'a', translationGroupId: 'g', coverImageUrl: 'newer.png', createdAt: new Date('2026-05-01') });
      expect(sharedCoverFor(story, [newer, older])).toBe('older.png');
      const twinA = cand({ id: 'a', translationGroupId: 'g', coverImageUrl: 'a.png', createdAt: undefined });
      const twinB = cand({ id: 'b', translationGroupId: 'g', coverImageUrl: 'b.png', createdAt: undefined });
      expect(sharedCoverFor(story, [twinB, twinA])).toBe('a.png');
    });
  });

  it('coverKey: the same for the language versions of a tale, else its parts, else the story; never a raw id', () => {
    const a = coverKeyOf({ id: 's1', translationGroupId: 'g1', partGroupId: 'p1' });
    expect(coverKeyOf({ id: 's2', translationGroupId: 'g1', partGroupId: 'p2' })).toBe(a);
    expect(coverKeyOf({ id: 's3', partGroupId: 'p9' })).toBe(coverKeyOf({ id: 's4', partGroupId: 'p9' }));
    expect(coverKeyOf({ id: 's5' })).not.toBe(coverKeyOf({ id: 's6' }));
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toContain('g1');
  });

  it('loadPartCoverCandidates: no query without part groups', async () => {
    const prisma = { story: { findMany: jest.fn().mockResolvedValue(undefined) } };
    await expect(loadPartCoverCandidates(prisma, [])).resolves.toEqual([]);
    expect(prisma.story.findMany).not.toHaveBeenCalled();
    await expect(loadPartCoverCandidates(prisma, ['p'])).resolves.toEqual([]);
    expect(prisma.story.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { coverImageUrl: { not: null }, partGroupId: { in: ['p'] } } }),
    );
  });

  it('loadTaleStoryIds follows translation and part groups until nothing new appears', async () => {
    // tr-1 (g1, ptr) -> en-1 (g1, pen) -> en-2 (g2, pen) -> tr-2 (g2, ptr)
    const rows = [
      { id: 'tr-1', translationGroupId: 'g1', partGroupId: 'ptr' },
      { id: 'en-1', translationGroupId: 'g1', partGroupId: 'pen' },
      { id: 'en-2', translationGroupId: 'g2', partGroupId: 'pen' },
      { id: 'tr-2', translationGroupId: 'g2', partGroupId: 'ptr' },
      { id: 'other', translationGroupId: 'g9', partGroupId: null },
    ];
    const findMany = jest.fn(async ({ where }: any) =>
      rows.filter((r) =>
        where.OR.some(
          (c: any) =>
            (c.translationGroupId && c.translationGroupId.in.includes(r.translationGroupId)) ||
            (c.partGroupId && c.partGroupId.in.includes(r.partGroupId)),
        ),
      ),
    );
    const ids = await loadTaleStoryIds({ story: { findMany } }, rows[0]);
    expect(ids.sort()).toEqual(['en-1', 'en-2', 'tr-1', 'tr-2']);

    findMany.mockClear();
    await expect(loadTaleStoryIds({ story: { findMany } }, { id: 'alone' })).resolves.toEqual(['alone']);
    expect(findMany).not.toHaveBeenCalled();
  });

  describe('in the public API', () => {
    const settings = createSettingsStub();
    const base = { language: 'tr', partGroupId: null as string | null };

    it('loadStoryGroupInfo gives a coverless story the cover of a language version, else of a part', async () => {
      const findMany = jest
        .fn()
        // Group members (published, enabled languages) carry their covers.
        .mockResolvedValueOnce([
          { id: 'en', language: 'en', translationGroupId: 'g', coverImageUrl: 'stories/cover/en.png', coverCredit: { illustrator: 'Ada' }, partGroupId: null, partNumber: null, status: 'PUBLISHED' },
        ])
        // Parts, for the story whose languages have no cover.
        .mockResolvedValueOnce([cand({ id: 'p1', partGroupId: 'p', partNumber: 1, coverImageUrl: 'stories/cover/p1.png' })]);
      const info = await loadStoryGroupInfo({ story: { findMany } }, settings, [
        { ...base, id: 'tr', translationGroupId: 'g', coverImageUrl: null },
        { ...base, id: 'tr-2', translationGroupId: 'g2', partGroupId: 'p', coverImageUrl: null },
        { ...base, id: 'own', translationGroupId: 'g', coverImageUrl: 'stories/cover/own.png' },
      ]);
      expect(info.get('tr')?.sharedCoverImageUrl).toBe('stories/cover/en.png');
      // The credit travels with the picture.
      expect(info.get('tr')?.sharedCoverCredit).toEqual({ illustrator: 'Ada' });
      expect(info.get('tr-2')?.sharedCoverCredit).toBeUndefined();
      expect(info.get('tr-2')?.sharedCoverImageUrl).toBe('stories/cover/p1.png');
      expect(info.get('own')?.sharedCoverImageUrl).toBeUndefined();
      expect(findMany).toHaveBeenCalledTimes(2);
    });

    it('the list item shows its own cover first, the shared one otherwise', async () => {
      const storage = { getReadUrl: jest.fn(async (v: string | null) => (v ? `signed:${v}` : null)) };
      const row = {
        id: 's',
        title: 'T',
        ageGroup: 'THREE_TO_SIX',
        category: 'BEDTIME',
        language: 'tr',
        estimatedDuration: 3,
        coverImageUrl: null,
        isPremium: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const shared = await toStoryListItem(row, storage as any, false, { sharedCoverImageUrl: 'stories/cover/en.png' });
      expect(shared.coverImageUrl).toBe('signed:stories/cover/en.png');
      const own = await toStoryListItem({ ...row, coverImageUrl: 'stories/cover/own.png' }, storage as any, false, {
        sharedCoverImageUrl: 'stories/cover/en.png',
      });
      expect(own.coverImageUrl).toBe('signed:stories/cover/own.png');
      expect((await toStoryListItem(row, storage as any, false)).coverImageUrl).toBeNull();
    });
  });
});
