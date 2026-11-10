/**
 * Translated labels derived from story data: age range, category, duration
 * and the meta line the v3 design prints under a title ("Uyku masalı, 3-6
 * yaş, 5 dk").
 *
 * These replace the Turkish-only helpers in storyFormat.ts for rebuilt
 * screens. They read the current UI language from i18n; a component that
 * calls them must also call `useTranslation()` so it re-renders when the
 * language changes.
 */

import i18n from '../i18n';

const AGE_RANGES: Record<string, string> = {
  UNDER_THREE: '0-3',
  ZERO_TO_THREE: '0-3',
  THREE_TO_SIX: '3-6',
  FOUR_TO_EIGHT: '4-8',
  FIVE_TO_SEVEN: '5-7',
  SIX_TO_TEN: '6-10',
  SEVEN_TO_TEN: '7-10',
  EIGHT_TO_TWELVE: '8-12',
  TEN_PLUS: '10+',
};

/** "3-6" for THREE_TO_SIX; '' for ALL_AGES or an unknown value. */
export function storyAgeRange(ageGroup: string | null | undefined): string {
  return (ageGroup && AGE_RANGES[ageGroup]) || '';
}

/** "3-6 yaş" / "Ages 3-6"; "Her yaş" for ALL_AGES; '' for an unknown value. */
export function storyAgeLabel(ageGroup: string | null | undefined): string {
  if (!ageGroup) return '';
  if (ageGroup === 'ALL_AGES') return i18n.t('story:age.all');
  const range = AGE_RANGES[ageGroup];
  return range ? i18n.t('story:age.range', { range }) : '';
}

/** Readable fallback for a category the app has no translation for yet. */
function humanizeEnum(value: string): string {
  const words = value.replace(/_/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

function categoryLabel(form: 'item' | 'shelf', category: string | null | undefined): string {
  if (!category) return '';
  const key = `story:category.${form}.${category}`;
  return i18n.exists(key) ? i18n.t(key) : humanizeEnum(category);
}

/** One story of the category: "Uyku masalı", "Dünya klasiği". */
export function storyCategoryLabel(category: string | null | undefined): string {
  return categoryLabel('item', category);
}

/** The category as a shelf title: "Uyku masalları", "Türk masalları". */
export function storyShelfLabel(category: string | null | undefined): string {
  return categoryLabel('shelf', category);
}

/** "5 dk" / "5 min"; '' when the duration is unknown. */
export function storyDurationLabel(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return '';
  return i18n.t('story:duration', { minutes: Math.round(minutes) });
}

export interface StoryMetaSource {
  readonly category?: string | null;
  readonly ageGroup?: string | null;
  readonly estimatedDuration?: number | null;
}

/**
 * The meta line under a title. `withCategory` adds the category in front
 * (featured story, detail); shelf captions leave it out because the shelf
 * already names it.
 */
export function storyMetaLine(
  story: StoryMetaSource,
  options: { withCategory?: boolean } = {},
): string {
  const parts = [
    options.withCategory ? storyCategoryLabel(story.category) : '',
    storyAgeLabel(story.ageGroup),
    storyDurationLabel(story.estimatedDuration),
  ];
  return parts.filter(Boolean).join(', ');
}
