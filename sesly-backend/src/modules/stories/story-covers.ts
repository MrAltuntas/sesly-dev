import { createHash } from 'crypto';
import { StoryStatus } from '../../common/enums/prisma.enums';

/**
 * Covers are language free (no text on them), so one cover serves every
 * language and every part of a tale.
 *
 *   - Public API: a story without a cover of its own shows the cover of
 *     another story of its translation group, else of another part of its
 *     part group (`sharedCoverFor`, resolved once per page in
 *     loadStoryGroupInfo). Published stories win over drafts, then the first
 *     part, then catalogue order.
 *   - Admin: an uploaded cover can be written to the whole tale
 *     (`loadTaleStoryIds`: every story reachable through translation and
 *     part groups), "Bu kapağı tüm dillere ve bölümlere uygula".
 *   - `coverKey`: the same opaque key for the language versions (else the
 *     parts) of a tale, so the app draws the same placeholder picture for
 *     them when no cover exists at all. Group ids themselves stay private.
 */

interface StoryReader {
  story: { findMany: (args: any) => Promise<any[]> };
}

export interface CoverCandidate {
  id: string;
  coverImageUrl: string | null;
  /** Credit of the picture (cover-credit.ts); borrowed with it. */
  coverCredit?: unknown;
  translationGroupId: string | null;
  partGroupId: string | null;
  partNumber: number | null;
  status: string;
  createdAt?: Date;
}

export interface CoverSubject {
  id: string;
  /** Undefined: the caller did not load it (no fallback is looked for). */
  coverImageUrl?: string | null;
  translationGroupId?: string | null;
  partGroupId?: string | null;
}

const rank = (c: CoverCandidate) => [
  c.status === StoryStatus.PUBLISHED ? 0 : 1,
  c.partNumber ?? 0,
  c.createdAt ? c.createdAt.getTime() : 0,
];

function best(candidates: CoverCandidate[]): CoverCandidate | null {
  let winner: CoverCandidate | null = null;
  for (const c of candidates) {
    if (!c.coverImageUrl) continue;
    if (!winner) {
      winner = c;
      continue;
    }
    const [a, b] = [rank(c), rank(winner)];
    const better = a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || c.id.localeCompare(winner.id);
    if (better < 0) winner = c;
  }
  return winner;
}

/**
 * The story whose cover a story without one borrows: translation group
 * first, then part group. Null when the story has a cover or none is found.
 */
export function sharedCoverSource(story: CoverSubject, candidates: CoverCandidate[]): CoverCandidate | null {
  if (story.coverImageUrl !== null) return null;
  const others = candidates.filter((c) => c.id !== story.id);
  const fromLanguages = story.translationGroupId
    ? best(others.filter((c) => c.translationGroupId === story.translationGroupId))
    : null;
  if (fromLanguages) return fromLanguages;
  return story.partGroupId ? best(others.filter((c) => c.partGroupId === story.partGroupId)) : null;
}

/** The cover a story without one borrows: translation group first, then part group. */
export function sharedCoverFor(story: CoverSubject, candidates: CoverCandidate[]): string | null {
  return sharedCoverSource(story, candidates)?.coverImageUrl ?? null;
}

/** The fields a cover candidate needs (added to the group member query). */
export const COVER_CANDIDATE_SELECT = {
  id: true,
  coverImageUrl: true,
  coverCredit: true,
  translationGroupId: true,
  partGroupId: true,
  partNumber: true,
  status: true,
  createdAt: true,
} as const;

/**
 * Other parts with a cover, for stories whose language versions have none:
 * one query, none without part groups.
 */
export async function loadPartCoverCandidates(prisma: StoryReader, partGroupIds: string[]): Promise<CoverCandidate[]> {
  if (partGroupIds.length === 0) return [];
  return (
    (await prisma.story.findMany({
      where: { coverImageUrl: { not: null }, partGroupId: { in: partGroupIds } },
      select: COVER_CANDIDATE_SELECT,
    })) ?? []
  );
}

/** Opaque placeholder key shared by a tale's language versions (else its parts). */
export function coverKeyOf(story: CoverSubject): string {
  const basis = story.translationGroupId
    ? `t:${story.translationGroupId}`
    : story.partGroupId
      ? `p:${story.partGroupId}`
      : `s:${story.id}`;
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

/** At most this many stories are reached from one tale (a guard, tales are small). */
export const TALE_MAX_STORIES = 200;

/**
 * Every story of a tale: the story, its language versions, their parts,
 * the language versions of those parts, and so on (both group kinds,
 * followed until nothing new is found).
 */
export async function loadTaleStoryIds(
  prisma: StoryReader,
  story: { id: string; translationGroupId?: string | null; partGroupId?: string | null },
): Promise<string[]> {
  const ids = new Set<string>([story.id]);
  const translationGroups = new Set<string>(story.translationGroupId ? [story.translationGroupId] : []);
  const partGroups = new Set<string>(story.partGroupId ? [story.partGroupId] : []);
  let pending = translationGroups.size + partGroups.size;
  while (pending > 0 && ids.size < TALE_MAX_STORIES) {
    const rows: Array<{ id: string; translationGroupId: string | null; partGroupId: string | null }> =
      await prisma.story.findMany({
        where: {
          OR: [
            ...(translationGroups.size ? [{ translationGroupId: { in: [...translationGroups] } }] : []),
            ...(partGroups.size ? [{ partGroupId: { in: [...partGroups] } }] : []),
          ],
        },
        select: { id: true, translationGroupId: true, partGroupId: true },
        take: TALE_MAX_STORIES,
      });
    const before = translationGroups.size + partGroups.size;
    for (const row of rows ?? []) {
      ids.add(row.id);
      if (row.translationGroupId) translationGroups.add(row.translationGroupId);
      if (row.partGroupId) partGroups.add(row.partGroupId);
    }
    pending = translationGroups.size + partGroups.size - before;
  }
  return [...ids];
}
