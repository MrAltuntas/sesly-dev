/**
 * Narration Service
 * Handles narration (audio generation) management
 */

import ApiClient from './ApiClient';
import { ApiError, isApiError } from './ApiError';
import {
  StoryNarration,
  parseStoryNarrationFromJSON,
} from '../models/Narration';
import { msg } from '../i18n/messages';

/**
 * Conflict codes the backend uses for "this user already has a narration for
 * this (story, voice) pair". NARRATION_EXISTS is the current contract;
 * NARRATION_ALREADY_EXISTS is the previous spelling, still accepted.
 */
const NARRATION_EXISTS_CODES = new Set([
  'NARRATION_EXISTS',
  'NARRATION_ALREADY_EXISTS',
]);

/**
 * Backend signals "this user already narrated this story with this voice"
 * via 409 + payload `{ code: 'NARRATION_EXISTS', existingNarrationId,
 * status }`. FAILED/PENDING duplicates are replaced server-side, so a 409
 * only ever means the existing narration is READY (offer to listen) or
 * GENERATING (show that it is being prepared).
 *
 * The unique-on-(user,story,voice) check lives on the backend so paginated
 * mobile state can't desync (we never see every narration page at once).
 */
export class NarrationAlreadyExistsError extends Error {
  constructor(
    public readonly existingNarrationId: string,
    public readonly existingStatus: string,
    message?: string,
  ) {
    super(message || msg('narration.alreadyExists'));
    this.name = 'NarrationAlreadyExistsError';
    Object.setPrototypeOf(this, NarrationAlreadyExistsError.prototype);
  }

  get isReady(): boolean {
    return this.existingStatus === 'READY';
  }

  get isInProgress(): boolean {
    return (
      this.existingStatus === 'GENERATING' || this.existingStatus === 'PENDING'
    );
  }
}

/**
 * Pure helper: turn an ApiError from POST /narrations into a
 * NarrationAlreadyExistsError when it is the structured 409 conflict.
 * Returns null for every other error.
 */
export function toNarrationConflict(
  error: unknown,
): NarrationAlreadyExistsError | null {
  if (!isApiError(error) || error.status !== 409) return null;
  const data = error.data ?? {};
  const code = error.code ?? (typeof data.code === 'string' ? data.code : null);
  const existingNarrationId =
    typeof data.existingNarrationId === 'string' ? data.existingNarrationId : '';
  if (!existingNarrationId) return null;
  if (code && !NARRATION_EXISTS_CODES.has(code)) return null;
  const status =
    typeof data.status === 'string' ? data.status.toUpperCase() : 'UNKNOWN';
  return new NarrationAlreadyExistsError(
    existingNarrationId,
    status,
    error.message,
  );
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export interface PaginatedNarrations {
  data: StoryNarration[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const emptyPaginated = (page: number, limit: number): PaginatedNarrations => ({
  data: [],
  meta: { page, limit, total: 0, totalPages: 0 },
});

// ============================================================================
// Narration Service Class (Singleton)
// ============================================================================

class NarrationService {
  private static instance: NarrationService;

  private constructor() { }

  public static getInstance(): NarrationService {
    if (!NarrationService.instance) {
      NarrationService.instance = new NarrationService();
    }
    return NarrationService.instance;
  }

  // ============================================================================
  // Narration CRUD
  // ============================================================================

  /**
   * Create a new narration.
   *
   * If a READY/GENERATING narration already exists for this (story, voice)
   * pair, the backend returns 409 with `{ code: 'NARRATION_EXISTS',
   * existingNarrationId, status }`; this surfaces as a typed
   * NarrationAlreadyExistsError. Pass `replace: true` to drop an existing
   * READY narration (and its audio) before creating fresh, used by the
   * "Yeniden oluştur" path. `replace` is only sent when true.
   */
  public async createNarration(
    storyId: string,
    voiceProfileId: string,
    options?: { title?: string; replace?: boolean },
  ): Promise<StoryNarration> {
    if (!storyId || !voiceProfileId) {
      throw new Error('Story ID and Voice Profile ID are required');
    }

    const body: Record<string, unknown> = { storyId, voiceProfileId };
    if (options?.title) body.title = options.title;
    if (options?.replace) body.replace = true;

    try {
      const response = await ApiClient.post<unknown>('/narrations', body);
      return parseStoryNarrationFromJSON(response);
    } catch (error) {
      const conflict = toNarrationConflict(error);
      if (conflict) {
        throw conflict;
      }
      console.error('Failed to create narration:', error);
      throw error;
    }
  }

  /**
   * Get a page of narrations for the current user. Backend now returns the
   * standard `PaginatedResponse<T>` shape (`{ data, total, page, limit,
   * totalPages }`), so callers driving infinite-scroll lists can wire
   * `onEndReached` against `meta.totalPages`.
   */
  public async getMyNarrations(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<PaginatedNarrations> {
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 20;
    const search = params?.search?.trim() ?? '';

    // Only send `search` when there is something to search for; an empty
    // param is noise in logs and caches.
    const query: Record<string, string | number> = { page, limit };
    if (search) query.search = search;

    try {
      const response = await ApiClient.get<unknown>('/narrations', {
        params: query,
      });

      if (!response || typeof response !== 'object') {
        throw new Error('Invalid response: expected paginated object');
      }

      const data = response as Record<string, unknown>;

      const items: StoryNarration[] = [];
      if (Array.isArray(data.data)) {
        for (const item of data.data) {
          try {
            items.push(parseStoryNarrationFromJSON(item));
          } catch (err) {
            console.warn('Failed to parse narration:', err);
          }
        }
      }

      return {
        data: items,
        meta: {
          page: typeof data.page === 'number' ? data.page : page,
          limit: typeof data.limit === 'number' ? data.limit : limit,
          total: typeof data.total === 'number' ? data.total : items.length,
          totalPages:
            typeof data.totalPages === 'number' ? data.totalPages : 1,
        },
      };
    } catch (error) {
      console.error('Failed to get narrations:', error);
      if (isNotFound(error)) {
        return emptyPaginated(page, limit);
      }
      throw error;
    }
  }

  /**
   * Every narration the signed-in user made of one story, newest first
   * (`GET /narrations/story/:storyId`, not paginated).
   *
   * The items of this route carry no `storyId` (narrations.service.ts
   * findByStory), so the requested id is filled in: callers match
   * narrations to stories by that field. An item that cannot be parsed is
   * skipped instead of failing the whole list.
   */
  public async getNarrationsByStory(storyId: string): Promise<StoryNarration[]> {
    if (!storyId) {
      throw new Error('Story ID is required');
    }

    try {
      const response = await ApiClient.get<unknown>(`/narrations/story/${storyId}`);

      if (!Array.isArray(response)) {
        throw new Error('Invalid response: expected array');
      }

      const items: StoryNarration[] = [];
      for (const item of response) {
        try {
          const narration = parseStoryNarrationFromJSON(item);
          items.push(narration.storyId ? narration : { ...narration, storyId });
        } catch (err) {
          console.warn('Failed to parse narration:', err);
        }
      }
      return items;
    } catch (error) {
      console.error(`Failed to get narrations for story ${storyId}:`, error);
      // Return empty list for 404
      if (isNotFound(error)) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get narration by ID (full record)
   */
  public async getNarrationById(id: string): Promise<StoryNarration> {
    if (!id) {
      throw new Error('Narration ID is required');
    }

    try {
      const response = await ApiClient.get<unknown>(`/narrations/${id}`);
      return parseStoryNarrationFromJSON(response);
    } catch (error) {
      console.error(`Failed to get narration ${id}:`, error);
      throw error;
    }
  }

  /**
   * Get a lightweight status snapshot for a narration.
   * Backed by GET /narrations/:id/status which returns only
   * { status, progress, audioUrl?, errorMessage? } — cheaper than
   * the full getNarrationById when polling.
   */
  public async getNarrationStatus(id: string): Promise<{
    status: string;
    progress: number;
    audioUrl: string | null;
    errorMessage: string | null;
  }> {
    if (!id) {
      throw new Error('Narration ID is required');
    }

    try {
      const response = await ApiClient.get<unknown>(`/narrations/${id}/status`);
      if (!response || typeof response !== 'object') {
        throw new Error('Invalid narration status response');
      }
      const data = response as Record<string, unknown>;
      return {
        status: typeof data.status === 'string' ? data.status : 'PENDING',
        progress: typeof data.progress === 'number' ? data.progress : 0,
        audioUrl:
          typeof data.audioUrl === 'string' && data.audioUrl
            ? data.audioUrl
            : null,
        errorMessage:
          typeof data.errorMessage === 'string' && data.errorMessage
            ? data.errorMessage
            : null,
      };
    } catch (error) {
      console.error(`Failed to get narration status ${id}:`, error);
      throw error;
    }
  }

  /**
   * Generate audio for a narration
   */
  public async generateAudio(id: string): Promise<void> {
    if (!id) {
      throw new Error('Narration ID is required');
    }

    try {
      await ApiClient.post(`/narrations/${id}/generate`);
      console.log(`✅ Audio generation started for narration ${id}`);
    } catch (error) {
      console.error(`Failed to generate audio for narration ${id}:`, error);
      throw error;
    }
  }

  /**
   * Delete a narration
   */
  public async deleteNarration(id: string): Promise<void> {
    if (!id) {
      throw new Error('Narration ID is required');
    }

    try {
      await ApiClient.delete(`/narrations/${id}`);
      console.log(`✅ Narration ${id} deleted`);
    } catch (error) {
      console.error(`Failed to delete narration ${id}:`, error);
      throw error;
    }
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export default NarrationService.getInstance();
