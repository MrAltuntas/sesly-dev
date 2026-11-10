/**
 * Story Models with Strict TypeScript Typing
 */

import {
  AgeGroup,
  StoryCategory,
  AudioGenerationStatus,
} from '../types/enums';
import { type ContentWarning, parseContentWarnings } from './contentWarnings';

// ============================================================================
// Story Model (List View)
// ============================================================================

export interface Story {
  readonly id: string;
  readonly title: string;
  /** Short description (max 150 chars) computed by the backend from story content. */
  readonly description: string | null;
  readonly ageGroup: AgeGroup;
  readonly category: StoryCategory;
  readonly estimatedDuration: number; // Minutes
  readonly coverImageUrl: string | null;
  readonly isPremium: boolean;
  readonly isFavorite: boolean;
  /** Content language of this version (ISO code, lower case). */
  readonly language: string;
  /** CEFR level (A1..C2), or null when the story has not been assessed. */
  readonly languageLevel: string | null;
  /** Editor-written summary, or the opening of the text when there is none. */
  readonly summary: string | null;
  /** Public attribution. Every field may be null. */
  readonly credit: StoryCredit;
  /**
   * BACKEND PLACEHOLDER (tale key): id shared by every language version of
   * one tale. The API keeps the translation group id private, so this is
   * null and the cover picker falls back to the story id (see
   * components/design/covers.ts): two language versions of a tale without a
   * cover image may draw different placeholder pictures.
   */
  readonly translationGroupId: string | null;
  /**
   * `coverKey` of the API: the same for the language versions (else the
   * parts) of a tale, so they draw the same placeholder picture. Null from
   * an older backend.
   */
  readonly coverKey: string | null;
  /** Content warnings (models/contentWarnings, backend enum values), enum order; [] when none. */
  readonly contentWarnings: readonly ContentWarning[];
  /**
   * Every language this tale is published in, this version's language first
   * (`availableLanguages` of the API; never empty).
   */
  readonly availableLanguages: readonly string[];
  /** True when this version or any other language version of the tale is saved. */
  readonly isFavoriteAnyLanguage: boolean;
  /**
   * Grouped favourites only (`GET /stories/favorites?grouped=true`): every
   * saved version of the tale, so unsaving removes all of them.
   */
  readonly favoriteStoryIds?: readonly string[];
  readonly favoriteLanguages?: readonly string[];
}

/** How a translated version was made (credit.translationMethod). */
export type TranslationMethod = 'HUMAN' | 'MACHINE';

/** Attribution of a story (backend `StoryCredit`). */
export interface StoryCredit {
  readonly originalTitle: string | null;
  readonly originalLanguage: string | null;
  readonly authorName: string | null;
  readonly authorDeathYear: number | null;
  readonly collectorName: string | null;
  readonly collectorDeathYear: number | null;
  readonly translatorName: string | null;
  readonly translatorDeathYear: number | null;
  readonly adaptedBy: string | null;
  readonly firstPublishedYear: number | null;
  readonly editionYear: number | null;
  readonly sourceName: string | null;
  readonly sourceUrl: string | null;
  readonly origin: string | null;
  readonly textFidelity: string | null;
  readonly translationMethod: TranslationMethod | null;
  /** The attribution line a licence asks for (CC BY), shown as it is. */
  readonly attribution: string | null;
  /** Licence name (for example CC BY 4.0), linked to `licenseUrl`. */
  readonly licenseName: string | null;
  /** http(s) link to the licence text; anything else is dropped. */
  readonly licenseUrl: string | null;
  /**
   * Credit of the cover picture (an illustration under CC BY or from the
   * public domain), one plain line shown as "Kapak resmi". Links in it stay
   * text. Null when the cover needs none.
   */
  readonly coverCredit: string | null;
}

export const EMPTY_STORY_CREDIT: StoryCredit = {
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

/**
 * Where a translated story comes from (story detail `translation`, null when
 * the story is not a translation).
 */
export interface StoryTranslationSource {
  /** The text is an AI (machine) translation. */
  readonly isMachineTranslation: boolean;
  /** Language the text was translated from (ISO code), when known. */
  readonly fromLanguage: string | null;
  /** The published story it was translated from, in the same tale. */
  readonly original: StoryTranslationRef | null;
}

/**
 * Where a story stands in a tale told in several parts (story detail
 * `part`, null for a single-part story): "Bölüm 2 / 3".
 */
export interface StoryPart {
  readonly number: number;
  readonly total: number;
}

/** Another published language version of the same tale (story detail). */
export interface StoryTranslationRef {
  readonly id: string;
  readonly language: string;
  readonly title: string;
}

/** The new fields a list item and a detail share. */
export type StoryExtras = Pick<
  Story,
  | 'language'
  | 'languageLevel'
  | 'summary'
  | 'credit'
  | 'translationGroupId'
  | 'coverKey'
  | 'contentWarnings'
  | 'availableLanguages'
  | 'isFavoriteAnyLanguage'
>;

/** Values for a story built by hand (tests, optimistic placeholders). */
export const DEFAULT_STORY_EXTRAS: StoryExtras = {
  language: 'tr',
  languageLevel: null,
  summary: null,
  credit: EMPTY_STORY_CREDIT,
  translationGroupId: null,
  coverKey: null,
  contentWarnings: [],
  availableLanguages: ['tr'],
  isFavoriteAnyLanguage: false,
};

const DEFAULT_STORY_LANGUAGE = 'tr';

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asYear(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asLanguage(value: unknown): string {
  return typeof value === 'string' && value.trim()
    ? value.trim().toLowerCase()
    : DEFAULT_STORY_LANGUAGE;
}

export function parseStoryCreditFromJSON(json: unknown): StoryCredit {
  if (!json || typeof json !== 'object') return EMPTY_STORY_CREDIT;
  const data = json as Record<string, unknown>;
  const method =
    typeof data.translationMethod === 'string' ? data.translationMethod.toUpperCase() : '';
  return {
    originalTitle: asText(data.originalTitle),
    originalLanguage: asText(data.originalLanguage),
    authorName: asText(data.authorName),
    authorDeathYear: asYear(data.authorDeathYear),
    collectorName: asText(data.collectorName),
    collectorDeathYear: asYear(data.collectorDeathYear),
    translatorName: asText(data.translatorName),
    translatorDeathYear: asYear(data.translatorDeathYear),
    adaptedBy: asText(data.adaptedBy),
    firstPublishedYear: asYear(data.firstPublishedYear),
    editionYear: asYear(data.editionYear),
    sourceName: asText(data.sourceName),
    sourceUrl: asText(data.sourceUrl),
    origin: asText(data.origin),
    textFidelity: asText(data.textFidelity),
    translationMethod: method === 'HUMAN' || method === 'MACHINE' ? method : null,
    attribution: asText(data.attribution),
    licenseName: asText(data.licenseName),
    licenseUrl: asWebUrl(data.licenseUrl),
    coverCredit: asText(data.coverCredit),
  };
}

/** An http(s) link, or null (never a javascript: or any other scheme). */
function asWebUrl(value: unknown): string | null {
  const text = asText(value)?.trim();
  return text && /^https?:\/\/\S+$/i.test(text) ? text : null;
}

export function parseStoryTranslationSourceFromJSON(json: unknown): StoryTranslationSource | null {
  if (!json || typeof json !== 'object') return null;
  const data = json as Record<string, unknown>;
  const method = typeof data.method === 'string' ? data.method.toUpperCase() : '';
  const fromLanguage = asText(data.fromLanguage)?.trim().toLowerCase() ?? null;
  const [original] = parseStoryTranslationsFromJSON(data.original ? [data.original] : []);
  return {
    isMachineTranslation: data.isMachineTranslation === true || method === 'MACHINE',
    fromLanguage: fromLanguage ?? original?.language ?? null,
    original: original ?? null,
  };
}

/** `part` of the story detail; null for a single-part story or a malformed value. */
export function parseStoryPartFromJSON(json: unknown): StoryPart | null {
  if (!json || typeof json !== 'object') return null;
  const data = json as Record<string, unknown>;
  const { number, total } = data;
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 2) return null;
  return { number, total: Math.max(total, number) };
}

export function parseStoryTranslationsFromJSON(json: unknown): StoryTranslationRef[] {
  if (!Array.isArray(json)) return [];
  const out: StoryTranslationRef[] = [];
  for (const item of json) {
    if (!item || typeof item !== 'object') continue;
    const data = item as Record<string, unknown>;
    if (typeof data.id !== 'string' || !data.id) continue;
    if (typeof data.language !== 'string' || !data.language.trim()) continue;
    out.push({
      id: data.id,
      language: data.language.trim().toLowerCase(),
      title: typeof data.title === 'string' ? data.title : '',
    });
  }
  return out;
}

/**
 * Whether this version is our AI translation, for the translation badge. A
 * human translation (most classic tales in English) gets no badge: its
 * translator is in the credit line, and a second mark next to the AI one only
 * read as noise.
 */
export function getStoryTranslationKind(
  story: Pick<Story, 'credit'> & { readonly isMachineTranslation?: boolean },
): 'machine' | null {
  if (story.credit.translationMethod === 'MACHINE' || story.isMachineTranslation === true) return 'machine';
  return null;
}

function uniqueCodes(codes: readonly string[]): string[] {
  return codes.filter((code, index, all) => all.indexOf(code) === index);
}

function parseStoryExtras(data: Record<string, unknown>): StoryExtras {
  const language = asLanguage(data.language);
  const sent = Array.isArray(data.availableLanguages)
    ? data.availableLanguages.filter((v): v is string => typeof v === 'string' && !!v.trim())
    : [];
  const level = asText(data.languageLevel);
  return {
    language,
    languageLevel: level ? level.toUpperCase() : null,
    summary: asText(data.summary) ?? asText(data.description),
    credit: parseStoryCreditFromJSON(data.credit),
    translationGroupId: asText(data.translationGroupId),
    coverKey: asText(data.coverKey),
    contentWarnings: parseContentWarnings(data.contentWarnings),
    availableLanguages: uniqueCodes([language, ...sent.map(v => v.trim().toLowerCase())]),
    isFavoriteAnyLanguage: Boolean(data.isFavoriteAnyLanguage) || Boolean(data.isFavorite),
  };
}

function asCodeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueCodes(
    value
      .filter((v): v is string => typeof v === 'string' && !!v.trim())
      .map(v => v.trim().toLowerCase()),
  );
}

function asIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && !!v);
}

/** The state a bookmark shows: saved in this or any other language. */
export function isStorySaved(story: Pick<Story, 'isFavorite' | 'isFavoriteAnyLanguage'>): boolean {
  return story.isFavorite || story.isFavoriteAnyLanguage;
}

/** What names a tale across lists: the story and, when known, its tale key. */
export type TaleRef = Pick<Story, 'id' | 'translationGroupId'>;

export interface StoryJSON {
  readonly id: string;
  readonly title: string;
  readonly description?: string | null;
  readonly ageGroup: string;
  readonly category: string;
  readonly estimatedDuration: number;
  readonly coverImageUrl?: string | null;
  readonly isPremium: boolean;
  readonly isFavorite: boolean;
}

// ============================================================================
// Story Helper Functions
// ============================================================================

export function getStoryDurationLabel(estimatedDuration: number): string {
  if (estimatedDuration < 60) {
    return `${estimatedDuration} dakika`;
  }
  const hours = Math.floor(estimatedDuration / 60);
  const remainingMinutes = estimatedDuration % 60;
  if (remainingMinutes === 0) {
    return `${hours} saat`;
  }
  return `${hours} saat ${remainingMinutes} dakika`;
}

// ============================================================================
// Story JSON Parsers
// ============================================================================

export function parseStoryFromJSON(json: unknown): Story {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid story data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid story data: missing or invalid id');
  }
  if (typeof data.title !== 'string' || !data.title) {
    throw new Error('Invalid story data: missing or invalid title');
  }
  if (typeof data.ageGroup !== 'string') {
    throw new Error('Invalid story data: missing or invalid ageGroup');
  }
  if (typeof data.category !== 'string') {
    throw new Error('Invalid story data: missing or invalid category');
  }
  if (typeof data.estimatedDuration !== 'number') {
    throw new Error('Invalid story data: missing or invalid estimatedDuration');
  }

  return {
    id: data.id,
    title: data.title,
    description:
      typeof data.description === 'string' && data.description
        ? data.description
        : null,
    ageGroup: data.ageGroup as AgeGroup,
    category: data.category as StoryCategory,
    estimatedDuration: data.estimatedDuration,
    coverImageUrl:
      typeof data.coverImageUrl === 'string' && data.coverImageUrl
        ? data.coverImageUrl
        : null,
    isPremium: Boolean(data.isPremium),
    isFavorite: Boolean(data.isFavorite),
    ...parseStoryExtras(data),
    ...(Array.isArray(data.favoriteStoryIds)
      ? {
          favoriteStoryIds: asIdList(data.favoriteStoryIds),
          favoriteLanguages: asCodeList(data.favoriteLanguages),
        }
      : {}),
  };
}

// ============================================================================
// Story Chunk Model
// ============================================================================

export interface StoryChunk {
  readonly id: string;
  readonly index: number;
  readonly text: string;
  readonly startPosition: number;
  readonly endPosition: number;
}

export function parseStoryChunkFromJSON(json: unknown): StoryChunk {
  // Nothing is logged here: a detail carries many chunks and their text is
  // the story itself. The thrown error is enough (the service logs it).
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid story chunk data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid story chunk data: missing or invalid id');
  }

  // Handle chunkIndex (backend) vs index (frontend)
  const index = typeof data.chunkIndex === 'number' ? data.chunkIndex : (typeof data.index === 'number' ? data.index : -1);
  if (index === -1) {
    throw new Error('Invalid story chunk data: missing or invalid index');
  }

  // Handle content (backend) vs text (frontend)
  const text = typeof data.content === 'string' ? data.content : (typeof data.text === 'string' ? data.text : '');
  if (!text) {
    throw new Error('Invalid story chunk data: missing or invalid text');
  }

  // Handle optional positions (might be null from backend)
  const startPosition = typeof data.startTime === 'number' ? data.startTime : (typeof data.startPosition === 'number' ? data.startPosition : 0); // Added startTime check
  const endPosition = typeof data.endTime === 'number' ? data.endTime : (typeof data.endPosition === 'number' ? data.endPosition : 0);     // Added endTime check

  return {
    id: data.id,
    index: index,
    text: text,
    startPosition: startPosition,
    endPosition: endPosition,
  };
}

export function getStoryChunkPreview(chunk: StoryChunk, length = 100): string {
  if (chunk.text.length <= length) {
    return chunk.text;
  }
  return `${chunk.text.substring(0, length)}...`;
}

// ============================================================================
// User Progress Model
// ============================================================================

export interface UserProgress {
  readonly lastChunkIndex: number;
  readonly completedAt: Date | null;
}

export function parseUserProgressFromJSON(json: unknown): UserProgress {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid user progress data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.lastChunkIndex !== 'number') {
    throw new Error(
      'Invalid user progress data: missing or invalid lastChunkIndex',
    );
  }

  return {
    lastChunkIndex: data.lastChunkIndex,
    completedAt:
      typeof data.completedAt === 'string' && data.completedAt
        ? new Date(data.completedAt)
        : null,
  };
}

export function isStoryCompleted(progress: UserProgress): boolean {
  return progress.completedAt !== null;
}

// ============================================================================
// Exports
// ============================================================================

export { StoryCategory, AgeGroup, AudioGenerationStatus };

// ============================================================================
// Story Detail Model (Detail View)
// ============================================================================

export interface StoryDetail {
  readonly id: string;
  readonly title: string;
  /** Short description (max 150 chars) shown in "Hikaye hakkında" card.
   *  The full story text is never sent by the backend. */
  readonly description: string | null;
  readonly ageGroup: AgeGroup;
  readonly category: StoryCategory;
  readonly language: string;
  readonly languageLevel: string | null;
  readonly summary: string | null;
  readonly credit: StoryCredit;
  /** BACKEND PLACEHOLDER (tale key), see `Story.translationGroupId`. */
  readonly translationGroupId: string | null;
  /** See `Story.coverKey`. */
  readonly coverKey: string | null;
  /** See `Story.contentWarnings`. */
  readonly contentWarnings: readonly ContentWarning[];
  /** This version's language first, then the languages of `translations`. */
  readonly availableLanguages: readonly string[];
  readonly isFavoriteAnyLanguage: boolean;
  /**
   * Languages the signed-in user asked this tale to be translated into and
   * that are not published yet.
   */
  readonly requestedLanguages: readonly string[];
  /** Other published language versions of this tale. */
  readonly translations: readonly StoryTranslationRef[];
  /** Machine translation mark and the original to open; null for a story that is not a translation. */
  readonly translation: StoryTranslationSource | null;
  /** Position in a tale told in several parts; null for a single-part story. */
  readonly part: StoryPart | null;
  readonly estimatedDuration: number;
  readonly coverImageUrl: string | null;
  readonly isPremium: boolean;
  readonly isFavorite: boolean;
  readonly chunks: readonly StoryChunk[];
  readonly userProgress: UserProgress | null;
}

export function parseStoryDetailFromJSON(json: unknown): StoryDetail {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid story detail data: expected object');
  }

  const data = json as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid story detail data: missing or invalid id');
  }
  const extras = parseStoryExtras(data);
  const translations = parseStoryTranslationsFromJSON(data.translations);

  return {
    ...extras,
    availableLanguages: uniqueCodes([
      ...extras.availableLanguages,
      ...translations.map(ref => ref.language),
    ]),
    translations,
    translation: parseStoryTranslationSourceFromJSON(data.translation),
    part: parseStoryPartFromJSON(data.part),
    requestedLanguages: asCodeList(data.requestedLanguages),
    id: data.id,
    title: typeof data.title === 'string' ? data.title : '',
    description: typeof data.description === 'string' ? data.description : null,
    ageGroup: data.ageGroup as AgeGroup,
    category: data.category as StoryCategory,
    estimatedDuration: typeof data.estimatedDuration === 'number' ? data.estimatedDuration : 0,
    coverImageUrl: typeof data.coverImageUrl === 'string' ? data.coverImageUrl : null,
    isPremium: Boolean(data.isPremium),
    isFavorite: Boolean(data.isFavorite),
    chunks: Array.isArray(data.chunks) ? data.chunks.map(parseStoryChunkFromJSON) : [],
    userProgress: data.userProgress ? parseUserProgressFromJSON(data.userProgress) : null,
  };
}

export function getStoryReadingTime(content: string): string {
  const words = content.split(/\s+/).length;
  const minutes = Math.ceil(words / 200); // Average reading speed: 200 words/min
  return `${minutes} dk okuma`;
}

// ============================================================================
// Catalogue languages (GET /stories/languages)
// ============================================================================

export interface CatalogueLanguage {
  readonly code: string;
  /** The language in its own name ("Türkçe", "English", "Deutsch"). */
  readonly nativeName: string;
  readonly englishName: string;
  readonly isDefault: boolean;
  /** Published stories in this language. */
  readonly storyCount: number;
  /** CEFR levels present in this language, easiest first. */
  readonly levels: readonly string[];
}

export interface CatalogueLanguages {
  readonly defaultLanguage: string;
  readonly languages: readonly CatalogueLanguage[];
}

export function parseCatalogueLanguagesFromJSON(json: unknown): CatalogueLanguages {
  const data = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  const languages: CatalogueLanguage[] = [];
  if (Array.isArray(data.languages)) {
    for (const item of data.languages) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      if (typeof row.code !== 'string' || !row.code.trim()) continue;
      const code = row.code.trim().toLowerCase();
      languages.push({
        code,
        nativeName: asText(row.nativeName) ?? code.toUpperCase(),
        englishName: asText(row.englishName) ?? code.toUpperCase(),
        isDefault: Boolean(row.isDefault),
        storyCount: typeof row.storyCount === 'number' ? row.storyCount : 0,
        levels: Array.isArray(row.levels)
          ? row.levels.filter((v): v is string => typeof v === 'string').map(v => v.toUpperCase())
          : [],
      });
    }
  }
  const fallback = languages.find(l => l.isDefault)?.code ?? languages[0]?.code ?? DEFAULT_STORY_LANGUAGE;
  return {
    defaultLanguage: asText(data.defaultLanguage)?.toLowerCase() ?? fallback,
    languages,
  };
}

/** Result of POST / DELETE /stories/:id/translation-requests. */
export interface TranslationRequestResult {
  readonly storyId: string;
  readonly language: string;
  readonly requested: boolean;
  readonly requestedLanguages: readonly string[];
}

export function parseTranslationRequestResultFromJSON(
  json: unknown,
  fallback: { storyId: string; language: string; requested: boolean },
): TranslationRequestResult {
  const data = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
  return {
    storyId: typeof data.storyId === 'string' && data.storyId ? data.storyId : fallback.storyId,
    language: asText(data.language)?.toLowerCase() ?? fallback.language,
    requested: typeof data.requested === 'boolean' ? data.requested : fallback.requested,
    requestedLanguages: Array.isArray(data.requestedLanguages)
      ? asCodeList(data.requestedLanguages)
      : fallback.requested
        ? [fallback.language]
        : [],
  };
}

// ============================================================================
// Pagination
// ============================================================================

export interface PaginationMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface PaginatedStories {
  readonly data: readonly Story[];
  readonly meta: PaginationMeta;
}

export function parsePaginatedStoriesFromJSON(
  json: unknown,
): PaginatedStories {
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid paginated stories data: expected object');
  }

  const data = json as Record<string, unknown>;

  const stories: Story[] = [];
  if (Array.isArray(data.data)) {
    data.data.forEach(storyData => {
      try {
        stories.push(parseStoryFromJSON(storyData));
      } catch (err) {
        console.warn('Failed to parse story:', err);
      }
    });
  }

  const meta: PaginationMeta = {
    page: typeof data.page === 'number' ? data.page : 1,
    limit: typeof data.limit === 'number' ? data.limit : 20,
    total: typeof data.total === 'number' ? data.total : 0,
    totalPages: typeof data.totalPages === 'number' ? data.totalPages : 1,
  };

  return {
    data: stories,
    meta,
  };
}

export function hasMoreStories(paginated: PaginatedStories): boolean {
  return paginated.meta.page < paginated.meta.totalPages;
}

// ============================================================================
// Related stories (GET /stories/:id/related)
// ============================================================================

/** Another part of the same tale, with its place in it ("Bölüm 1"). */
export interface RelatedPart {
  readonly story: Story;
  readonly number: number;
}

/**
 * What the story page offers next ("İlgili masallar"), in the backend's
 * groups: the other language versions of the tale, its other parts (part
 * order) and more stories of the same category.
 */
export interface RelatedStories {
  readonly languages: readonly Story[];
  readonly parts: readonly RelatedPart[];
  readonly category: readonly Story[];
}

export const NO_RELATED_STORIES: RelatedStories = { languages: [], parts: [], category: [] };

/** Every related story, in the order of the groups (languages, parts, category). */
export function relatedStoryList(related: RelatedStories): Story[] {
  return [...related.languages, ...related.parts.map(part => part.story), ...related.category];
}

function parseStoryList(json: unknown): Story[] {
  if (!Array.isArray(json)) return [];
  const out: Story[] = [];
  for (const item of json) {
    try {
      out.push(parseStoryFromJSON(item));
    } catch (err) {
      console.warn('Failed to parse related story:', err);
    }
  }
  return out;
}

export function parseRelatedStoriesFromJSON(json: unknown): RelatedStories {
  if (!json || typeof json !== 'object') return NO_RELATED_STORIES;
  const data = json as Record<string, unknown>;
  const parts: RelatedPart[] = [];
  if (Array.isArray(data.parts)) {
    for (const item of data.parts) {
      const number = item && typeof item === 'object' ? (item as Record<string, unknown>).partNumber : null;
      if (typeof number !== 'number' || !Number.isFinite(number)) continue;
      try {
        parts.push({ story: parseStoryFromJSON(item), number });
      } catch (err) {
        console.warn('Failed to parse related part:', err);
      }
    }
  }
  return {
    languages: parseStoryList(data.languages),
    parts,
    category: parseStoryList(data.category),
  };
}
