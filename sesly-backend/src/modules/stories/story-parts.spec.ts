import { loadStoryPart } from './story-parts';

describe('loadStoryPart', () => {
  const prisma = { story: { findMany: jest.fn() } };

  beforeEach(() => prisma.story.findMany.mockReset());

  it('a single-part story has no part info and costs no query', async () => {
    await expect(loadStoryPart(prisma as any, { id: 's1', partGroupId: null, partNumber: null })).resolves.toBeNull();
    await expect(loadStoryPart(prisma as any, { id: 's1', partGroupId: 'g', partNumber: null })).resolves.toBeNull();
    expect(prisma.story.findMany).not.toHaveBeenCalled();
  });

  it('middle part: previous and next published part, total of published parts', async () => {
    prisma.story.findMany.mockResolvedValue([
      { id: 'p1', title: 'Bölüm 1', partNumber: 1 },
      { id: 'p2', title: 'Bölüm 2', partNumber: 2 },
      { id: 'p4', title: 'Bölüm 4', partNumber: 4 },
    ]);

    await expect(loadStoryPart(prisma as any, { id: 'p2', partGroupId: 'g', partNumber: 2 })).resolves.toEqual({
      number: 2,
      total: 3,
      next: { id: 'p4', title: 'Bölüm 4', number: 4 },
      previous: { id: 'p1', title: 'Bölüm 1', number: 1 },
    });
    expect(prisma.story.findMany).toHaveBeenCalledWith({
      where: { partGroupId: 'g', status: 'PUBLISHED' },
      select: { id: true, title: true, partNumber: true },
      orderBy: { partNumber: 'asc' },
    });
  });

  it('last part, itself archived: no next, counted in the total', async () => {
    prisma.story.findMany.mockResolvedValue([
      { id: 'p1', title: 'Bir', partNumber: 1 },
      { id: 'px', title: 'Bozuk', partNumber: null },
    ]);

    await expect(loadStoryPart(prisma as any, { id: 'p2', partGroupId: 'g', partNumber: 2 })).resolves.toEqual({
      number: 2,
      total: 2,
      next: null,
      previous: { id: 'p1', title: 'Bir', number: 1 },
    });
  });
});
