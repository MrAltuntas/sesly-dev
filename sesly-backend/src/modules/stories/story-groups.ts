import { CONTENT_LANGUAGE_CODES } from '../../common/constants/content-languages';
import { StoryStatus } from '../../common/enums/prisma.enums';
import type { SettingsService } from '../settings/settings.service';
import { resolveContentLanguages } from './content-language';
import {
  COVER_CANDIDATE_SELECT,
  CoverCandidate,
  loadPartCoverCandidates,
  sharedCoverSource,
} from './story-covers';

const MEMBER_SELECT = { id: true, language: true, translationGroupId: true } as const;

/**
 * Translation groups as clients see them: "one tale" is every published
 * story that shares a translationGroupId; a story without a group is a tale
 * of its own. Shared by the catalogue, favourites, the library and
 * playlists, so `availableLanguages` means the same thing everywhere.
 */

/** What picking the version of a tale needs to know about each story. */
export interface GroupCandidate {
  id: string;
  language: string;
  translationGroupId: string | null;
  originalLanguage?: string | null;
  translatedFromId?: string | null;
  createdAt: Date;
}

export const GROUP_CANDIDATE_SELECT = {
  id: true,
  language: true,
  translationGroupId: true,
  originalLanguage: true,
  translatedFromId: true,
  createdAt: true,
} as const;

/** Key of the tale a story belongs to: its group, or the story itself. */
export function groupKeyOf(story: { id: string; translationGroupId?: string | null }): string {
  return story.translationGroupId ?? story.id;
}

function catalogueIndex(code: string): number {
  const index = CONTENT_LANGUAGE_CODES.indexOf(code);
  return index === -1 ? CONTENT_LANGUAGE_CODES.length : index;
}

/** Language codes in catalogue order, without duplicates, `first` leading when given. */
export function orderLanguages(codes: string[], first?: string): string[] {
  const rest = [...new Set(codes)]
    .filter((code) => code !== first)
    .sort((a, b) => catalogueIndex(a) - catalogueIndex(b) || a.localeCompare(b));
  return first === undefined ? rest : [first, ...rest];
}

/** True when the story is written in the language the tale was first told in. */
function isOriginalVersion(story: GroupCandidate): boolean {
  if (story.originalLanguage) return story.originalLanguage === story.language;
  return !story.translatedFromId;
}

export interface VersionPreference {
  /** The user's content language. */
  preferred: string;
  /** The content.defaultLanguage setting. */
  defaultLanguage: string;
}

/**
 * The version of one tale a grouped list shows: the user's content language,
 * else the original-language version, else the default content language,
 * else the first in catalogue order (oldest, then lowest id, on a tie). The
 * choice only depends on the rows, so it is the same on every page.
 */
export function pickGroupVersion<T extends GroupCandidate>(
  members: T[],
  preference: VersionPreference,
): T {
  const rank = (story: T): number => {
    if (story.language === preference.preferred) return 0;
    if (isOriginalVersion(story)) return 1;
    if (story.language === preference.defaultLanguage) return 2;
    return 3;
  };
  return [...members].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      catalogueIndex(a.language) - catalogueIndex(b.language) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  )[0];
}

/** Ids of the chosen version of every tale among `candidates`. */
export function pickGroupVersionIds(
  candidates: GroupCandidate[],
  preference: VersionPreference,
): string[] {
  const groups = new Map<string, GroupCandidate[]>();
  for (const story of candidates) {
    const key = groupKeyOf(story);
    const members = groups.get(key);
    if (members) members.push(story);
    else groups.set(key, [story]);
  }
  return [...groups.values()].map((members) => pickGroupVersion(members, preference).id);
}

export interface StoryGroupInfo {
  /**
   * Languages the tale can be opened in: the story's own first, then the
   * other published versions of its group in catalogue order (enabled
   * languages only).
   */
  availableLanguages: string[];
  /** The story's own id first, then the ids of those other versions. */
  memberIds: string[];
  /**
   * The cover the story shows when it has none of its own: another language
   * version's, else another part's (story-covers.ts). Null when it has one.
   */
  sharedCoverImageUrl?: string | null;
  /** Credit of that cover (cover-credit.ts), borrowed with the picture. */
  sharedCoverCredit?: unknown;
}

interface GroupReader {
  story: { findMany: (args: any) => Promise<any[]> };
}

/**
 * Group info for a page of stories, in one query (none when no story of the
 * page has a group). A story that is itself archived or in a language that
 * was switched off still lists its own language first, so the array is never
 * empty.
 */
export async function loadStoryGroupInfo(
  prisma: GroupReader,
  settings: Pick<SettingsService, 'get'>,
  stories: Array<{
    id: string;
    language: string;
    translationGroupId?: string | null;
    partGroupId?: string | null;
    coverImageUrl?: string | null;
  }>,
): Promise<Map<string, StoryGroupInfo>> {
  const groupIds = [
    ...new Set(stories.map((s) => s.translationGroupId).filter(Boolean) as string[]),
  ];
  const members: Array<{ id: string; language: string; translationGroupId: string | null }> =
    groupIds.length > 0
      ? await prisma.story.findMany({
          where: {
            translationGroupId: { in: groupIds },
            status: StoryStatus.PUBLISHED,
            language: { in: resolveContentLanguages(settings).enabled },
          },
          // The cover fields let a story without a cover borrow a sibling's.
          select: { ...MEMBER_SELECT, ...COVER_CANDIDATE_SELECT },
        })
      : [];
  // Translation group first (from the query above), then the part group
  // (one more query, only for stories still without a cover).
  const fromLanguages = new Map<string, CoverCandidate | null>();
  for (const story of stories) fromLanguages.set(story.id, sharedCoverSource(story, members as unknown as CoverCandidate[]));
  const partGroupIds = [
    ...new Set(
      stories
        .filter((s) => s.coverImageUrl === null && !fromLanguages.get(s.id) && s.partGroupId)
        .map((s) => s.partGroupId as string),
    ),
  ];
  const partCandidates = await loadPartCoverCandidates(prisma, partGroupIds);

  const info = new Map<string, StoryGroupInfo>();
  for (const story of stories) {
    const siblings = story.translationGroupId
      ? members
          .filter((m) => m.translationGroupId === story.translationGroupId && m.id !== story.id)
          .filter((m) => m.language !== story.language)
          .sort((a, b) => catalogueIndex(a.language) - catalogueIndex(b.language))
      : [];
    info.set(story.id, {
      availableLanguages: orderLanguages(
        siblings.map((m) => m.language),
        story.language,
      ),
      memberIds: [story.id, ...siblings.map((m) => m.id)],
    });
    const sharedCover =
      fromLanguages.get(story.id) ?? sharedCoverSource({ ...story, translationGroupId: null }, partCandidates);
    if (sharedCover?.coverImageUrl) {
      const entry = info.get(story.id)!;
      entry.sharedCoverImageUrl = sharedCover.coverImageUrl;
      if (sharedCover.coverCredit) entry.sharedCoverCredit = sharedCover.coverCredit;
    }
  }
  return info;
}

/** Every story id named by a page of group info (for one favourites lookup). */
export function allMemberIds(info: Map<string, StoryGroupInfo>): string[] {
  return [...new Set([...info.values()].flatMap((entry) => entry.memberIds))];
}
