/**
 * StoryCard: one story of the Keşfet grid (design/v4/playful, frame b, `.grid`),
 * also used by "Yeni eklenenler" and the collection screen.
 *
 *   An upright cover (2:3, `.cv`) on its lip with the language level badge
 *   at the top left when the story has one, the duration on a glass chip at
 *   the bottom left and the AI translation mark (the sparkles on the same
 *   glass) at the bottom right, as on the Home shelves; the title under it
 *   (`.ttl`, up to three lines) and a meta row (`.meta`): the category dot
 *   and the category name, and in a language-filtered list the
 *   code of the row's own language. The save bookmark is a 28dp badge 4dp in from
 *   the cover's top right corner (SPEC-design 1.5, 3.12): drawn over the
 *   cover as a sibling of the card button (its own touch target and its own
 *   screen reader stop), and it sinks with the cover. A premium story says
 *   so under the meta; a locked one (a premium story the plan does not play)
 *   carries a lock and has no bookmark.
 *
 *   There is no long press and no card menu: a tale on a card may have no
 *   narration, so "Sıraya ekle" made no sense there (owner feedback). The
 *   tap opens the story page; saving is the visible bookmark.
 *
 * The card is memoised: lists pass stable `onPress(story)` and
 * `onToggleSave(story)` handlers, so a list update re-renders only the
 * cards whose story changed.
 *
 * `useStoryGrid()` gives the column count and card width for the screen
 * width: three columns of 96dp on a 360dp phone (`grid-template-columns:
 * repeat(3, 96px)`, 12dp apart), wider cards or more columns on bigger
 * screens.
 */

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Bone,
  CoverCard,
  CoverMeta,
  Icon,
  IconButton,
  LanguageCodes,
  SkeletonPulse,
  coverLip,
  coverRadius,
} from '../design';
import { SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { categoryColors } from '../../theme/palettes';
import { Story, getStoryTranslationKind, isStorySaved } from '../../models/Story';
import { storyCategoryLabel, storyDurationLabel } from '../../utils/storyLabels';

/** Mockup card width (`.grid .cv`, 96 x 144). */
export const GRID_CARD_MIN_WIDTH = 96;
/** Space between two columns (`gap: 16px 12px`). */
export const GRID_COLUMN_GAP = 12;
/** Space between two rows. */
export const GRID_ROW_GAP = 16;
/** The bookmark badge's distance from the cover's top and right edges. */
export const COVER_BADGE_INSET = SPACE.xs;
/**
 * The text under a grid cover as CoverCard lays it out (its `cardTitle`,
 * `cardMeta` and `metaText` styles): the title 8 under the cover on 18dp
 * lines, the meta row 2 under the title on a 16dp line. The grid skeleton
 * draws its bones in boxes of these heights.
 */
export const GRID_TITLE_GAP = SPACE.sm;
export const GRID_TITLE_LINE_HEIGHT = 18;
export const GRID_META_GAP = SPACE.xxs;
export const GRID_META_LINE_HEIGHT = 16;
/**
 * Title lines the skeleton draws: at the grid's card widths (96 to about
 * 120dp) most titles wrap to two, so the skeleton rows are as tall as the
 * common real row and the rows under the first do not move (V3-06).
 */
export const GRID_SKELETON_TITLE_LINES = 2;
const MIN_COLUMNS = 3;

export interface StoryGridLayout {
  columns: number;
  cardWidth: number;
}

/**
 * Columns and card width for a content width: as many 96dp columns as fit,
 * at least three, sharing the width evenly.
 */
export function storyGridLayout(contentWidth: number): StoryGridLayout {
  const fit = Math.floor((contentWidth + GRID_COLUMN_GAP) / (GRID_CARD_MIN_WIDTH + GRID_COLUMN_GAP));
  const columns = Math.max(MIN_COLUMNS, fit);
  const cardWidth = Math.floor((contentWidth - GRID_COLUMN_GAP * (columns - 1)) / columns);
  return { columns, cardWidth };
}

/** The grid layout of the current window, inside the screen padding. */
export function useStoryGrid(): StoryGridLayout {
  const T = useT();
  const { width } = useWindowDimensions();
  return useMemo(() => storyGridLayout(width - T.screenPadH * 2), [width, T.screenPadH]);
}

export interface StoryCardProps {
  story: Story;
  width: number;
  /**
   * 'all' (one card per tale): no language code, the tale is shown in the
   * content language. 'own' (a language filter is on): the card IS that
   * language and carries its code.
   */
  languages?: 'all' | 'own';
  /** Placeholder picture chosen by the list (`useCoverSpread`). */
  placeholderIndex?: number;
  /** The card's tap (also "Masalın sayfası" in its menu). Keep it stable. */
  onPress: (story: Story) => void;
  /** Leave out to draw the card without a bookmark. Keep it stable. */
  onToggleSave?: (story: Story) => void;
  /** Premium story: a quiet "Premium" mark under the meta. */
  premium?: boolean;
  /** Premium story the plan does not play: the mark carries a lock; no bookmark. */
  locked?: boolean;
  testID?: string;
}

const StoryCardView: React.FC<StoryCardProps> = ({
  story,
  width,
  languages = 'all',
  placeholderIndex,
  onPress,
  onToggleSave,
  premium,
  locked,
  testID,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('discover');
  const cardId = testID ?? `story-card-${story.id}`;
  const translation = getStoryTranslationKind(story);
  const saved = isStorySaved(story);
  const canSave = !!onToggleSave && !locked;
  const open = useCallback(() => onPress(story), [onPress, story]);
  const toggleSave = useCallback(() => onToggleSave?.(story), [onToggleSave, story]);

  const bookmark = canSave ? (
    <IconButton
      variant="badge"
      icon={saved ? 'bookmarkOn' : 'bookmark'}
      color={saved ? T.action : T.text}
      onPress={toggleSave}
      accessibilityLabel={t(saved ? 'a11y.unsave' : 'a11y.save', { title: story.title })}
      testID={`${cardId}-save`}
      style={styles.save}
    />
  ) : null;

  return (
    <View style={{ width }} testID={cardId}>
      <CoverCard
        story={story}
        title={story.title}
        width={width}
        placeholderIndex={placeholderIndex}
        levelLabel={story.languageLevel ?? undefined}
        durationLabel={storyDurationLabel(story.estimatedDuration) || undefined}
        translation={translation}
        onPress={open}
        overlay={bookmark}
        accessibilityLabel={
          locked
            ? t('a11y.locked', { title: story.title })
            : t('a11y.openStory', { title: story.title })
        }
        testID={`${cardId}-open`}
      >
        <CoverMeta
          dotColor={categoryColors(T, story.category).color}
          label={storyCategoryLabel(story.category)}
        >
          {languages === 'own' ? (
            <LanguageCodes codes={[story.language]} shown={story.language} variant="own" />
          ) : null}
        </CoverMeta>
        {premium || locked ? (
          <View style={styles.premium} testID={`${cardId}-premium`}>
            {locked ? <Icon name="lock" size={16} color={T.text2} /> : null}
            <Text style={styles.premiumLabel}>{t('premium.badge')}</Text>
          </View>
        ) : null}
      </CoverCard>
    </View>
  );
};

export const StoryCard = React.memo(StoryCardView);
StoryCard.displayName = 'StoryCard';

/**
 * Quiet shapes in the grid's geometry, shown while the first page loads.
 * The grid starts where the real one does (no top padding of its own). Each
 * card is the cover on its lip, two title lines (85% and 60% wide) and the
 * meta line, each bone centred in a box of the real line's height.
 */
export const StoryGridSkeleton: React.FC<{ rows?: number; testID?: string }> = ({
  rows = 3,
  testID,
}) => {
  const styles = stylesFor(useT());
  const { columns, cardWidth } = useStoryGrid();
  return (
    <SkeletonPulse testID={testID} style={styles.skeleton}>
      {Array.from({ length: rows }, (_, row) => (
        <View key={row} style={styles.skeletonRow}>
          {Array.from({ length: columns }, (__, column) => (
            <View key={column} style={{ width: cardWidth }}>
              <Bone
                height={Math.round(cardWidth * 1.5)}
                radius={coverRadius(cardWidth, 'upright')}
                lip={coverLip(cardWidth)}
              />
              <View style={styles.skeletonTitle}>
                {SKELETON_TITLE_WIDTHS.map(lineWidth => (
                  <View key={lineWidth} style={styles.skeletonTitleLine}>
                    <Bone height={12} width={lineWidth} tone="text" />
                  </View>
                ))}
              </View>
              <View style={styles.skeletonMeta}>
                <Bone height={10} width="45%" tone="text" />
              </View>
            </View>
          ))}
        </View>
      ))}
    </SkeletonPulse>
  );
};

/** The widths of the skeleton's title lines (GRID_SKELETON_TITLE_LINES of them). */
const SKELETON_TITLE_WIDTHS = ['85%', '60%'] as const;

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    save: { position: 'absolute', top: COVER_BADGE_INSET, right: COVER_BADGE_INSET },
    premium: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.xs },
    premiumLabel: { fontFamily: T.fontLabel, fontSize: 12, lineHeight: 16, color: T.text2 },
    skeleton: { paddingHorizontal: T.screenPadH, gap: GRID_ROW_GAP },
    skeletonRow: { flexDirection: 'row', gap: GRID_COLUMN_GAP },
    skeletonTitle: { marginTop: GRID_TITLE_GAP },
    skeletonTitleLine: { height: GRID_TITLE_LINE_HEIGHT, justifyContent: 'center' },
    skeletonMeta: { marginTop: GRID_META_GAP, height: GRID_META_LINE_HEIGHT, justifyContent: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default StoryCard;
