/**
 * ShelfCover: one cover card of a horizontal shelf (design/v4/playful,
 * `.shelf .cv`): the Home shelves and "İlgili masallar" on the story page.
 *
 *   A 100 x 146 cover on its lip with everything it says ON the picture:
 *   the duration as a glass chip at the bottom left, the AI translation
 *   mark (the sparkles) on the same glass at the bottom right, and a lock on
 *   glass at the top right for a premium story the plan does not play. The
 *   title takes at most SHELF_TITLE_LINES lines under it and nothing else
 *   follows, so every card of every shelf is equally tall and a shelf never
 *   grows when a mark scrolls in (HOME-SHIFT).
 *
 * Memoised: shelves pass a stable `onOpen(story)`.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { CoverCard } from '../design';
import { coverCardHeight } from '../design/PictureCover';
import { Story, getStoryTranslationKind } from '../../models/Story';
import { storyDurationLabel } from '../../utils/storyLabels';

/** Shelf cover (`.shelf .cv`, 100 x 146). */
export const SHELF_COVER_WIDTH = 100;
export const SHELF_COVER_HEIGHT = 146;
/**
 * Lines a shelf title may take. Every shelf reserves exactly this many, so a
 * longer title scrolling in never makes its shelf taller (HOME-SHIFT).
 */
export const SHELF_TITLE_LINES = 2;

/**
 * The fixed height of a shelf's cover list: the cover on its lip, the gap
 * and SHELF_TITLE_LINES lines of the title at the font scale. The marks sit
 * on the cover, so no shelf needs a row for them. Its skeleton
 * (ShelfSkeleton) is just as tall.
 */
export function shelfListHeight(fontScale = 1, pixelRatio = 1): number {
  return coverCardHeight({
    width: SHELF_COVER_WIDTH,
    coverHeight: SHELF_COVER_HEIGHT,
    titleLines: SHELF_TITLE_LINES,
    fontScale,
    pixelRatio,
  });
}

export interface ShelfCoverProps {
  story: Story;
  placeholderIndex?: number;
  /** A premium story the plan does not play: the lock, and the card says so. */
  locked: boolean;
  onOpen: (story: Story) => void;
  testID?: string;
}

export const ShelfCover = React.memo(function ShelfCover({
  story,
  placeholderIndex,
  locked,
  onOpen,
  testID,
}: ShelfCoverProps) {
  const { t } = useTranslation('home');
  const duration = storyDurationLabel(story.estimatedDuration);
  return (
    <CoverCard
      story={story}
      title={story.title}
      width={SHELF_COVER_WIDTH}
      coverHeight={SHELF_COVER_HEIGHT}
      titleLines={SHELF_TITLE_LINES}
      placeholderIndex={placeholderIndex}
      durationLabel={duration || undefined}
      translation={getStoryTranslationKind(story)}
      locked={locked}
      onPress={() => onOpen(story)}
      accessibilityLabel={
        locked
          ? t('discover:a11y.locked', { title: story.title })
          : t('a11y.openStory', { title: story.title })
      }
      testID={testID}
    />
  );
});
