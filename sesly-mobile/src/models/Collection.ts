/**
 * Collection Models with Strict TypeScript Typing
 *
 * Mirrors the backend `CollectionResponseDto` surfaced by:
 *   - GET /collections
 *   - GET /collections/:slug
 *
 * The `tone` field maps onto the Mature Care palette (accent / trust / nature / sun).
 */

// ============================================================================
// Collection Tone (backend enum)
// ============================================================================

export const COLLECTION_TONES = ['ACCENT', 'TRUST', 'NATURE', 'SUN'] as const;
export type CollectionTone = typeof COLLECTION_TONES[number];

export function isCollectionTone(value: unknown): value is CollectionTone {
  return (
    typeof value === 'string' &&
    (COLLECTION_TONES as readonly string[]).includes(value)
  );
}

// ============================================================================
// Collection Model
// ============================================================================

export interface Collection {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly subtitle: string | null;
  readonly description: string | null;
  readonly tone: CollectionTone;
  readonly coverImageUrl: string | null;
  readonly isActive: boolean;
  readonly sortOrder: number;
  readonly storyCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ============================================================================
// Parsers
// ============================================================================

export function parseCollectionFromJSON(raw: unknown): Collection {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid collection data: expected object');
  }

  const data = raw as Record<string, unknown>;

  if (typeof data.id !== 'string' || !data.id) {
    throw new Error('Invalid collection data: missing or invalid id');
  }
  if (typeof data.slug !== 'string' || !data.slug) {
    throw new Error('Invalid collection data: missing or invalid slug');
  }
  if (typeof data.title !== 'string' || !data.title) {
    throw new Error('Invalid collection data: missing or invalid title');
  }

  // Tone: default to ACCENT if unknown value sneaks in, so a bad DB row
  // doesn't crash the list render.
  const tone: CollectionTone = isCollectionTone(data.tone) ? data.tone : 'ACCENT';

  const createdAtRaw = data.createdAt;
  const updatedAtRaw = data.updatedAt;

  return {
    id: data.id,
    slug: data.slug,
    title: data.title,
    subtitle:
      typeof data.subtitle === 'string' && data.subtitle ? data.subtitle : null,
    description:
      typeof data.description === 'string' && data.description
        ? data.description
        : null,
    tone,
    coverImageUrl:
      typeof data.coverImageUrl === 'string' && data.coverImageUrl
        ? data.coverImageUrl
        : null,
    isActive: data.isActive !== false, // default true if backend omits
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    storyCount: typeof data.storyCount === 'number' ? data.storyCount : 0,
    createdAt:
      typeof createdAtRaw === 'string'
        ? createdAtRaw
        : createdAtRaw instanceof Date
          ? createdAtRaw.toISOString()
          : '',
    updatedAt:
      typeof updatedAtRaw === 'string'
        ? updatedAtRaw
        : updatedAtRaw instanceof Date
          ? updatedAtRaw.toISOString()
          : '',
  };
}

export function parseCollectionsFromJSON(raw: unknown): Collection[] {
  if (!Array.isArray(raw)) {
    throw new Error('Invalid collections data: expected array');
  }

  const collections: Collection[] = [];
  for (const item of raw) {
    try {
      collections.push(parseCollectionFromJSON(item));
    } catch (err) {
      console.warn('Failed to parse collection:', err);
    }
  }
  return collections;
}
