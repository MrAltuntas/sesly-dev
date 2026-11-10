import { ContentWarning } from '../enums/prisma.enums';

export { ContentWarning };

/**
 * Content warnings of a story (Story.contentWarnings, Prisma enum
 * ContentWarning): shown next to the age group, so a parent knows before
 * listening. The values are English enum names (the app maps them to its own
 * copy); the Turkish labels are for the admin panel. Adding a value: the
 * Prisma enum + a migration, the mirror in prisma.enums.ts, a label here, the
 * mobile vocabulary (src/models/contentWarnings.ts) and docs/story-pipeline.md.
 */
export const CONTENT_WARNINGS = Object.values(ContentWarning) as ContentWarning[];

export const CONTENT_WARNING_LABELS: Record<ContentWarning, string> = {
  SCARY: 'Korkutucu sahne',
  VIOLENCE: 'Şiddet',
  DEATH: 'Ölüm',
  SAD_ENDING: 'Üzücü son',
  BAD_EXAMPLE: 'Kötü davranış örneği',
  OLD_LANGUAGE: 'Eski dil / ağır anlatım',
  LONELINESS: 'Yalnızlık / ayrılık',
};

export function isContentWarning(value: unknown): value is ContentWarning {
  return typeof value === 'string' && (CONTENT_WARNINGS as readonly string[]).includes(value);
}

/** Known values only, once each, in enum order (never trust a stored array blindly). */
export function normalizeContentWarnings(values: unknown): ContentWarning[] {
  if (!Array.isArray(values)) return [];
  const given = new Set(values.filter(isContentWarning));
  return CONTENT_WARNINGS.filter((key) => given.has(key));
}
