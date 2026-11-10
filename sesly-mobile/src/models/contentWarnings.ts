/**
 * Content warnings of a story (`contentWarnings` of the story API): the
 * values of the backend enum, shown next to the age group on the story page and,
 * as one calm sentence, before a narration plays (the preparation screen,
 * and the player once per narration), so a parent knows before listening.
 *
 * Contract: the backend's Prisma enum ContentWarning (sesly-backend
 * prisma/schema.prisma, mirrored in src/common/enums/prisma.enums.ts), in its
 * order. The i18n keys are the enum values (story:contentWarning.label.SCARY);
 * the labels are the copy. A value this build does not know (a newer
 * backend, an old Turkish key such as "korkutucu") is ignored.
 */

import i18n from '../i18n';
import { storyAgeRange } from '../utils/storyLabels';

export const CONTENT_WARNINGS = [
  'SCARY',
  'VIOLENCE',
  'DEATH',
  'SAD_ENDING',
  'BAD_EXAMPLE',
  'OLD_LANGUAGE',
  'LONELINESS',
] as const;

export type ContentWarning = (typeof CONTENT_WARNINGS)[number];

export function isContentWarning(value: unknown): value is ContentWarning {
  return typeof value === 'string' && (CONTENT_WARNINGS as readonly string[]).includes(value);
}

/** Known values only, once each, in enum order; anything else is ignored. */
export function parseContentWarnings(value: unknown): ContentWarning[] {
  if (!Array.isArray(value)) return [];
  const given = new Set(value.filter(isContentWarning));
  return CONTENT_WARNINGS.filter(key => given.has(key));
}

/** The short label of a warning ("Korkutucu sahne"), for the story page. */
export function contentWarningLabel(key: ContentWarning): string {
  return i18n.t(`story:contentWarning.label.${key}`);
}

/**
 * The note before listening: the age group, then one sentence per warning
 * ("3-6 yaş için. Korkutucu bir sahne içeriyor."). Empty without warnings.
 */
export function contentNoteText(
  ageGroup: string | null | undefined,
  warnings: readonly string[] | null | undefined,
): string {
  const keys = parseContentWarnings(warnings ?? []);
  if (keys.length === 0) return '';
  const range = storyAgeRange(ageGroup);
  const age =
    ageGroup === 'ALL_AGES'
      ? i18n.t('story:contentNote.allAges')
      : range
        ? i18n.t('story:contentNote.forAge', { range })
        : '';
  const sentences = keys.map(key => i18n.t(`story:contentWarning.sentence.${key}`));
  return [age, ...sentences].filter(Boolean).join(' ');
}
