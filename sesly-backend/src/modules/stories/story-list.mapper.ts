import { StorageService } from '../storage/storage.service';
import { ContentWarning, normalizeContentWarnings } from '../../common/constants/content-warnings';
import type { StoryGroupInfo } from './story-groups';
import { coverKeyOf } from './story-covers';
import { coverCreditLine } from './cover-credit';

/**
 * Shared client shape for a story in any list (GET /stories, /stories/search,
 * /stories/favorites, /collections/:slug/stories, narration.story).
 *
 * The full narrative (`content`) and the TTS internals
 * (`preprocessedSegments`, which also contains the full text, emotion/speed
 * defaults, pronunciation dict) are NEVER sent to clients. Clients get the
 * short `summary` / `description` instead.
 *
 * The internal rights-audit fields (sourceRetrievedAt, rightsBasis,
 * rightsNote, rightsVerifiedAt, rightsVerifiedBy) and the
 * workflow fields (status, slug, translationGroupId, languageLevelSource,
 * languageLevelNote, ...) never leave the server either: the mapper builds
 * the response field by field, so a new column is private until added here.
 */
export interface StoryListSource {
  id: string;
  title: string;
  content?: string | null;
  summary?: string | null;
  ageGroup: string;
  category: string;
  language: string;
  languageLevel?: string | null;
  estimatedDuration: number;
  coverImageUrl: string | null;
  isPremium: boolean;
  hasPreGeneratedNarration?: boolean;
  createdAt: Date;
  updatedAt: Date;

  // Public credit
  originalTitle?: string | null;
  originalLanguage?: string | null;
  authorName?: string | null;
  authorDeathYear?: number | null;
  collectorName?: string | null;
  collectorDeathYear?: number | null;
  translatorName?: string | null;
  translatorDeathYear?: number | null;
  adaptedBy?: string | null;
  firstPublishedYear?: number | null;
  editionYear?: number | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  origin?: string | null;
  textFidelity?: string | null;
  translationMethod?: string | null;
  // Licence credit (CC BY needs the attribution, the licence name and a link to it)
  attribution?: string | null;
  licenseName?: string | null;
  licenseUrl?: string | null;
  contentWarnings?: string[] | null;
  // Credit of the cover picture (JSON, cover-credit.ts); public as one line.
  coverCredit?: unknown;
  // Only read to share covers and placeholder pictures; never serialised.
  translationGroupId?: string | null;
  partGroupId?: string | null;
}

/** Attribution a client may show under a story. Every field is nullable. */
export interface StoryCredit {
  originalTitle: string | null;
  originalLanguage: string | null;
  authorName: string | null;
  authorDeathYear: number | null;
  collectorName: string | null;
  collectorDeathYear: number | null;
  translatorName: string | null;
  translatorDeathYear: number | null;
  adaptedBy: string | null;
  firstPublishedYear: number | null;
  editionYear: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  origin: string | null;
  textFidelity: string | null;
  translationMethod: string | null;
  /** Attribution line the licence asks for (CC BY), shown as is. */
  attribution: string | null;
  /** Licence name (for example CC BY 4.0), linked to `licenseUrl`. */
  licenseName: string | null;
  licenseUrl: string | null;
  /**
   * Credit of the cover picture shown ("Kapak resmi: ..."), plain text:
   * an illustration under CC BY or from the public domain. Null when the
   * cover needs none or there is no cover. Links in it are text only.
   */
  coverCredit: string | null;
}

export interface StoryListItem {
  id: string;
  title: string;
  /** Same text as `summary`; kept because app versions in the field read it. */
  description: string;
  /** Editor-written summary, or the first 150 characters of the text when there is none. */
  summary: string;
  ageGroup: string;
  category: string;
  language: string;
  /** CEFR level (A1..C2) or null when the story has not been assessed. */
  languageLevel: string | null;
  estimatedDuration: number;
  /** The story's cover, else the cover of another language version or part of the tale. */
  coverImageUrl: string | null;
  /**
   * Opaque key shared by the language versions (else the parts) of a tale:
   * the app picks the same placeholder picture for them when no cover exists.
   */
  coverKey: string;
  isPremium: boolean;
  hasPreGeneratedNarration: boolean;
  isFavorite: boolean;
  /**
   * Languages this tale can be opened in: the language of this item first,
   * then the other published versions of its translation group. Never empty.
   */
  availableLanguages: string[];
  /** True when this story or any other language version of the tale is a favourite. */
  isFavoriteAnyLanguage: boolean;
  credit: StoryCredit;
  /** The text is a machine (AI) translation (`credit.translationMethod` MACHINE). */
  isMachineTranslation: boolean;
  /**
   * Shown next to the age group (enum ContentWarning, enum order): SCARY,
   * VIOLENCE, DEATH, SAD_ENDING, BAD_EXAMPLE, OLD_LANGUAGE, LONELINESS.
   */
  contentWarnings: ContentWarning[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Short description shown in the mobile "Hikaye hakkında" section and list
 * previews. Capped at `maxLength`, truncated at a word boundary, with "..."
 * (three literal periods) appended only when truncation occurred.
 */
export function generateStoryDescription(
  content: string | null | undefined,
  maxLength: number = 150,
): string {
  if (!content) return '';
  if (content.length <= maxLength) return content;

  const truncated = content.substring(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(' ');

  if (lastSpaceIndex > 0) {
    return truncated.substring(0, lastSpaceIndex) + '...';
  }
  return truncated + '...';
}

/** The editor-written summary when there is one, else the truncated text. */
export function resolveStorySummary(story: Pick<StoryListSource, 'summary' | 'content'>): string {
  const summary = story.summary?.trim();
  return summary ? summary : generateStoryDescription(story.content);
}

/**
 * Built only from the public credit columns; never add an audit field here.
 * The cover credit follows the cover actually shown: the story's own, else
 * the one borrowed from another story of the tale (`extras`).
 */
export function toStoryCredit(story: StoryListSource, extras: StoryListExtras = {}): StoryCredit {
  const coverCredit = story.coverImageUrl
    ? coverCreditLine(story.coverCredit)
    : extras.sharedCoverImageUrl
      ? coverCreditLine(extras.sharedCoverCredit)
      : null;
  return {
    originalTitle: story.originalTitle ?? null,
    originalLanguage: story.originalLanguage ?? null,
    authorName: story.authorName ?? null,
    authorDeathYear: story.authorDeathYear ?? null,
    collectorName: story.collectorName ?? null,
    collectorDeathYear: story.collectorDeathYear ?? null,
    translatorName: story.translatorName ?? null,
    translatorDeathYear: story.translatorDeathYear ?? null,
    adaptedBy: story.adaptedBy ?? null,
    firstPublishedYear: story.firstPublishedYear ?? null,
    editionYear: story.editionYear ?? null,
    sourceName: story.sourceName ?? null,
    sourceUrl: story.sourceUrl ?? null,
    origin: story.origin ?? null,
    textFidelity: story.textFidelity ?? null,
    translationMethod: story.translationMethod ?? null,
    attribution: story.attribution ?? null,
    licenseName: story.licenseName ?? null,
    licenseUrl: story.licenseUrl ?? null,
    coverCredit,
  };
}

/** Group-derived fields of an item; a story without group info is a tale of its own. */
export interface StoryListExtras {
  availableLanguages?: string[];
  isFavoriteAnyLanguage?: boolean;
  /** Cover of another story of the tale, used when the story has none. */
  sharedCoverImageUrl?: string | null;
  /** Credit of that shared cover (it travels with the picture). */
  sharedCoverCredit?: unknown;
}

export async function toStoryListItem(
  story: StoryListSource,
  storage: StorageService,
  isFavorite: boolean,
  extras: StoryListExtras = {},
): Promise<StoryListItem> {
  const summary = resolveStorySummary(story);
  return {
    id: story.id,
    title: story.title,
    description: summary,
    summary,
    ageGroup: story.ageGroup,
    category: story.category,
    language: story.language,
    languageLevel: story.languageLevel ?? null,
    estimatedDuration: story.estimatedDuration,
    coverImageUrl: await storage.getReadUrl(story.coverImageUrl ?? extras.sharedCoverImageUrl ?? null),
    coverKey: coverKeyOf(story),
    isPremium: story.isPremium,
    hasPreGeneratedNarration: story.hasPreGeneratedNarration ?? false,
    isFavorite,
    availableLanguages:
      extras.availableLanguages && extras.availableLanguages.length > 0
        ? extras.availableLanguages
        : [story.language],
    isFavoriteAnyLanguage: isFavorite || extras.isFavoriteAnyLanguage === true,
    credit: toStoryCredit(story, extras),
    isMachineTranslation: story.translationMethod === 'MACHINE',
    contentWarnings: normalizeContentWarnings(story.contentWarnings),
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
}

/** Extras of one story from a page of group info and the user's favourite ids. */
export function storyListExtras(
  storyId: string,
  favoriteStoryIds: Set<string>,
  groupInfo?: Map<string, StoryGroupInfo>,
): StoryListExtras {
  const info = groupInfo?.get(storyId);
  if (!info) return {};
  return {
    availableLanguages: info.availableLanguages,
    isFavoriteAnyLanguage: info.memberIds.some((id) => favoriteStoryIds.has(id)),
    sharedCoverImageUrl: info.sharedCoverImageUrl,
    sharedCoverCredit: info.sharedCoverCredit,
  };
}

/**
 * `favoriteStoryIds` should cover every member id of `groupInfo` (see
 * allMemberIds) so isFavoriteAnyLanguage sees the other language versions.
 */
export function toStoryListItems(
  stories: StoryListSource[],
  storage: StorageService,
  favoriteStoryIds: Set<string>,
  groupInfo?: Map<string, StoryGroupInfo>,
): Promise<StoryListItem[]> {
  return Promise.all(
    stories.map((s) =>
      toStoryListItem(
        s,
        storage,
        favoriteStoryIds.has(s.id),
        storyListExtras(s.id, favoriteStoryIds, groupInfo),
      ),
    ),
  );
}
