import { PrismaService } from '../../prisma/prisma.service';
import { StoryStatus } from '../../common/enums/prisma.enums';

/**
 * Where a story stands in a tale told in several parts (`partGroupId` +
 * `partNumber`, one group per tale and language). Only PUBLISHED parts are
 * counted and linked, so a draft part 3 never shows up in the app.
 *
 * Contract (GET /stories/:id -> `part`, null for a single-part story):
 *   { number, total, next: { id, title } | null, previous: { id, title } | null }
 * The app offers the next part at the end of a narration
 * ("Devamı var: Bölüm 2, seslendirmek ister misin?").
 */
export interface StoryPartLink {
  id: string;
  title: string;
  number: number;
}

export interface StoryPartInfo {
  number: number;
  total: number;
  next: StoryPartLink | null;
  previous: StoryPartLink | null;
}

export async function loadStoryPart(
  prisma: PrismaService,
  story: { id: string; partGroupId?: string | null; partNumber?: number | null },
): Promise<StoryPartInfo | null> {
  if (!story.partGroupId || !story.partNumber) return null;
  const parts = await prisma.story.findMany({
    where: { partGroupId: story.partGroupId, status: StoryStatus.PUBLISHED as any },
    select: { id: true, title: true, partNumber: true },
    orderBy: { partNumber: 'asc' },
  });
  const links: StoryPartLink[] = parts
    .filter((p) => typeof p.partNumber === 'number')
    .map((p) => ({ id: p.id, title: p.title, number: p.partNumber as number }));
  const own = story.partNumber;
  const after = links.filter((p) => p.number > own);
  const before = links.filter((p) => p.number < own);
  const total = Math.max(links.length + (links.some((p) => p.id === story.id) ? 0 : 1), own);
  return {
    number: own,
    total,
    next: after.length > 0 ? after[0] : null,
    previous: before.length > 0 ? before[before.length - 1] : null,
  };
}
