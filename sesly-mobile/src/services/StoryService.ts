/**
 * Story Service
 * Handles story listing, search, detail and favorites
 */

import ApiClient from './ApiClient';
import {
  CatalogueLanguages,
  StoryDetail,
  parseStoryDetailFromJSON,
  PaginatedStories,
  parsePaginatedStoriesFromJSON,
  parseCatalogueLanguagesFromJSON,
  TranslationRequestResult,
  parseTranslationRequestResultFromJSON,
  RelatedStories,
  parseRelatedStoriesFromJSON,
} from '../models/Story';
import {hasApiStatus} from './ApiError';

// ============================================================================
// List scope (GET /stories, GET /stories/search)
// ============================================================================

/** Sort keys the backend accepts; absent means newest first. */
export type StorySort = 'newest' | 'oldest' | 'title' | 'duration' | 'level';

/**
 * Which stories a list covers (backend "One story per list"):
 *   - `language` (one or several): flat, one row per story per language.
 *     A language wins over `grouped`.
 *   - `grouped: true` without a language: one item per tale, shown in the
 *     user's content language when that version exists.
 *   - neither: the default content language only (old behaviour).
 */
export interface StoryScopeParams {
  grouped?: boolean;
  language?: string | readonly string[];
  /** Content language to prefer in a grouped list (wins over the stored preference). */
  prefer?: string;
  languageLevel?: string | readonly string[];
  ageGroup?: string;
  category?: string;
  isPremium?: boolean;
  sort?: StorySort;
}

function commaList(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const list = (typeof value === 'string' ? [value] : [...value])
    .map(item => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list.join(',') : undefined;
}

/**
 * Query params for a scoped list. Empty filters are left out, lists become
 * comma separated, and `grouped` is dropped when a language is selected.
 */
export function storyScopeQuery(scope: StoryScopeParams): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {};
  const language = commaList(scope.language);
  const languageLevel = commaList(scope.languageLevel);
  if (language) {
    query.language = language;
  } else if (scope.grouped) {
    query.grouped = true;
    if (scope.prefer) query.prefer = scope.prefer;
  }
  if (languageLevel) query.languageLevel = languageLevel;
  if (scope.ageGroup) query.ageGroup = scope.ageGroup;
  if (scope.category) query.category = scope.category;
  if (typeof scope.isPremium === 'boolean') query.isPremium = scope.isPremium;
  if (scope.sort) query.sort = scope.sort;
  return query;
}

// ============================================================================
// Story Service Class (Singleton)
// ============================================================================

class StoryService {
  private static instance: StoryService;

  private constructor() {}

  public static getInstance(): StoryService {
    if (!StoryService.instance) {
      StoryService.instance = new StoryService();
    }
    return StoryService.instance;
  }

  // ============================================================================
  // Story CRUD
  // ============================================================================

  /**
   * Get paginated stories with filters
   */
  public async getStories(
    params?: {page?: number; limit?: number} & StoryScopeParams,
  ): Promise<PaginatedStories> {
    try {
      let query: Record<string, string | number | boolean> | undefined;
      if (params) {
        const {page, limit, ...scope} = params;
        query = storyScopeQuery(scope);
        if (page !== undefined) query.page = page;
        if (limit !== undefined) query.limit = limit;
      }
      const response = await ApiClient.get<unknown>('/stories', {params: query});
      return parsePaginatedStoriesFromJSON(response);
    } catch (error) {
      console.error('Failed to get stories:', error);
      throw error;
    }
  }

  /**
   * Search stories by query
   */
  public async searchStories(
    query: string,
    params?: {
      page?: number;
      limit?: number;
    } & Pick<StoryScopeParams, 'grouped' | 'language' | 'prefer' | 'languageLevel'>,
  ): Promise<PaginatedStories> {
    if (!query || query.trim() === '') {
      throw new Error('Search query is required');
    }

    try {
      const response = await ApiClient.get<unknown>('/stories/search', {
        params: {
          q: query,
          page: params?.page || 1,
          limit: params?.limit || 20,
          ...storyScopeQuery({
            grouped: params?.grouped,
            language: params?.language,
            prefer: params?.prefer,
            languageLevel: params?.languageLevel,
          }),
        },
      });
      return parsePaginatedStoriesFromJSON(response);
    } catch (error) {
      console.error('Failed to search stories:', error);
      throw error;
    }
  }

  /**
   * Get story by ID with full details
   */
  public async getStoryById(id: string): Promise<StoryDetail> {
    if (!id) {
      throw new Error('Story ID is required');
    }

    try {
      const response = await ApiClient.get<unknown>(`/stories/${id}`);
      return parseStoryDetailFromJSON(response);
    } catch (error) {
      console.error(`Failed to get story ${id}:`, error);
      throw error;
    }
  }

  /**
   * The stories related to one (GET /stories/:id/related): its other
   * language versions, its other parts and more of its category.
   */
  public async getRelatedStories(id: string): Promise<RelatedStories> {
    if (!id) {
      throw new Error('Story ID is required');
    }
    const response = await ApiClient.get<unknown>(`/stories/${id}/related`);
    return parseRelatedStoriesFromJSON(response);
  }

  /**
   * Toggle favorite status for a story
   */
  public async toggleFavorite(
    storyId: string,
    isFavorite: boolean,
  ): Promise<void> {
    if (!storyId) {
      throw new Error('Story ID is required');
    }

    try {
      if (isFavorite) {
        await ApiClient.post(`/stories/${storyId}/favorite`);
      } else {
        await ApiClient.delete(`/stories/${storyId}/favorite`);
      }
      console.log(`✅ Story ${storyId} favorite status: ${isFavorite}`);
    } catch (error) {
      console.error(`Failed to toggle favorite for ${storyId}:`, error);
      throw error;
    }
  }

  /**
   * Get user's favorite stories with pagination
   */
  public async getFavoriteStories(params?: {
    page?: number;
    limit?: number;
    /** One item per tale, whatever the number of saved language versions. */
    grouped?: boolean;
    /** Content language to show a grouped tale in (wins over the stored preference). */
    prefer?: string;
  }): Promise<PaginatedStories> {
    try {
      const response = await ApiClient.get<unknown>('/stories/favorites', {
        params: {
          page: params?.page || 1,
          limit: params?.limit || 20,
          ...(params?.grouped ? {grouped: true} : {}),
          // Only a grouped list picks a version per tale.
          ...(params?.grouped && params.prefer ? {prefer: params.prefer} : {}),
        },
      });
      return parsePaginatedStoriesFromJSON(response);
    } catch (error) {
      console.error('Failed to get favorite stories:', error);
      // Return empty list for 404 (no favorites yet)
      if (hasApiStatus(error, 404)) {
        return {
          data: [],
          meta: {
            page: params?.page || 1,
            limit: params?.limit || 20,
            total: 0,
            totalPages: 0,
          },
        };
      }
      throw error;
    }
  }

  // ============================================================================
  // Catalogue languages and translation requests
  // ============================================================================

  /** Enabled content languages with story counts and the levels present. */
  public async getLanguages(): Promise<CatalogueLanguages> {
    try {
      const response = await ApiClient.get<unknown>('/stories/languages');
      return parseCatalogueLanguagesFromJSON(response);
    } catch (error) {
      console.error('Failed to get story languages:', error);
      throw error;
    }
  }

  /** Ask for this tale in another language. Idempotent on the backend. */
  public async requestTranslation(
    storyId: string,
    language: string,
  ): Promise<TranslationRequestResult> {
    if (!storyId) throw new Error('Story ID is required');
    if (!language) throw new Error('Language is required');
    const response = await ApiClient.post<unknown>(
      `/stories/${storyId}/translation-requests`,
      {language},
    );
    return parseTranslationRequestResultFromJSON(response, {storyId, language, requested: true});
  }

  /** Withdraw a translation request. */
  public async cancelTranslationRequest(
    storyId: string,
    language: string,
  ): Promise<TranslationRequestResult> {
    if (!storyId) throw new Error('Story ID is required');
    if (!language) throw new Error('Language is required');
    const response = await ApiClient.delete<unknown>(
      `/stories/${storyId}/translation-requests/${encodeURIComponent(language)}`,
    );
    return parseTranslationRequestResultFromJSON(response, {storyId, language, requested: false});
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default StoryService.getInstance();
