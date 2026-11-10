/**
 * Collection Service
 *
 * Thin client over the backend /collections endpoints (public, no auth
 * required — but we still pipe through ApiClient so auth headers and the
 * shared error pipeline remain consistent).
 *
 * Backend endpoints (Wave 1+2):
 *   GET /collections                          → Collection[]
 *   GET /collections/:slug                    → Collection
 *   GET /collections/:slug/stories?page&limit → PaginatedStories
 *
 * Collections are unique per (slug, language). Every endpoint takes an
 * optional `language` (the content language, "Masal dili"); without it the
 * backend answers in its default language.
 */

import ApiClient from './ApiClient';
import {
  Collection,
  parseCollectionFromJSON,
  parseCollectionsFromJSON,
} from '../models/Collection';
import {
  PaginatedStories,
  parsePaginatedStoriesFromJSON,
} from '../models/Story';

/** Request config with the content language, or none when it is not known. */
function languageConfig(language: string | undefined): { params: { language: string } } | undefined {
  return language ? { params: { language } } : undefined;
}

// ============================================================================
// Collection Service Class (Singleton)
// ============================================================================

class CollectionService {
  private static instance: CollectionService;

  private constructor() {}

  public static getInstance(): CollectionService {
    if (!CollectionService.instance) {
      CollectionService.instance = new CollectionService();
    }
    return CollectionService.instance;
  }

  /**
   * List all active collections of a content language (sorted by sortOrder
   * ascending).
   */
  public async list(language?: string): Promise<Collection[]> {
    try {
      const response = await ApiClient.get<unknown>('/collections', languageConfig(language));
      return parseCollectionsFromJSON(response);
    } catch (error) {
      console.error('Failed to list collections:', error);
      throw error;
    }
  }

  /**
   * Fetch a single collection by slug, in a content language.
   */
  public async getBySlug(slug: string, language?: string): Promise<Collection> {
    if (!slug) {
      throw new Error('Collection slug is required');
    }

    try {
      const response = await ApiClient.get<unknown>(
        `/collections/${encodeURIComponent(slug)}`,
        languageConfig(language),
      );
      return parseCollectionFromJSON(response);
    } catch (error) {
      console.error(`Failed to get collection "${slug}":`, error);
      throw error;
    }
  }

  /**
   * Paginated list of stories belonging to a collection (ordered by the
   * curator-set `position` field).
   */
  public async getStories(
    slug: string,
    page: number = 1,
    limit: number = 20,
    language?: string,
  ): Promise<PaginatedStories> {
    if (!slug) {
      throw new Error('Collection slug is required');
    }

    try {
      const response = await ApiClient.get<unknown>(
        `/collections/${encodeURIComponent(slug)}/stories`,
        { params: { page, limit, ...(language ? { language } : {}) } },
      );
      return parsePaginatedStoriesFromJSON(response);
    } catch (error) {
      console.error(`Failed to get stories for collection "${slug}":`, error);
      throw error;
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default CollectionService.getInstance();
