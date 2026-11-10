/**
 * "İlgili masallar" on the story page (GET /stories/:id/related).
 *
 *   - `useRelatedStories(storyId, enabled)`: the backend's groups for a
 *     story, kept for the session (a story page opened again draws them at
 *     once). A failed request hides the section; nothing on the page
 *     depends on it.
 *   - `RelatedSection`: the sub-head with "Tümü" (like the narrators' link)
 *     and the first RELATED_PREVIEW_COUNT stories as shelf cover cards
 *     (100 x 146, the duration, the AI translation mark and the lock on the
 *     picture), the other language versions first, then the other parts,
 *     then more of the category. Each card has one caption line under its
 *     title, the language of a version or "Bölüm 2" of a part (empty for
 *     the rest), so the row is as tall as its skeleton and nothing moves
 *     when it arrives. Hidden when nothing is related.
 *   - `RelatedStoriesSheet`: everything related, grouped under headings
 *     ("Başka dillerde", "Diğer bölümler", "Aynı türden masallar"), empty
 *     groups left out, three or more cards a row (`storyGridLayout`).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Bone,
  BottomSheet,
  CoverCard,
  CoverMeta,
  SectionHeader,
  SkeletonPulse,
  useCoverSpread,
} from '../design';
import { coverCardHeight, coverLip, coverRadius } from '../design/PictureCover';
import { SHELF_COVER_HEIGHT, SHELF_COVER_WIDTH, SHELF_TITLE_LINES } from '../story/ShelfCover';
import { storyGridLayout, GRID_COLUMN_GAP, GRID_ROW_GAP } from '../story/StoryCard';
import { RADIUS, SCREEN_PAD_H, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import {
  NO_RELATED_STORIES,
  RelatedStories,
  Story,
  getStoryTranslationKind,
  relatedStoryList,
} from '../../models/Story';
import StoryService from '../../services/StoryService';
import { contentLanguageNativeName } from '../../hooks/useContentLanguage';
import { storyDurationLabel } from '../../utils/storyLabels';

/** Cards the story page shows before "Tümü". */
export const RELATED_PREVIEW_COUNT = 3;
/** Gap between the cards of the preview row (the shelves' 12). */
const RELATED_GAP = SPACE.md;

// ─────────────────────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────────────────────

const relatedCache = new Map<string, RelatedStories>();

/** Tests only: forget what the story pages loaded. */
export function resetRelatedStoriesForTests(): void {
  relatedCache.clear();
}

export interface RelatedState {
  /** The groups once known; null while loading. */
  readonly related: RelatedStories | null;
  readonly loading: boolean;
}

/**
 * The related stories of `storyId`, asked for once `enabled` (the story
 * page waits for the end of its push). A failure counts as nothing related.
 */
export function useRelatedStories(storyId: string | null, enabled: boolean): RelatedState {
  const [loaded, setLoaded] = useState<{ id: string; related: RelatedStories } | null>(() =>
    storyId && relatedCache.has(storyId) ? { id: storyId, related: relatedCache.get(storyId)! } : null,
  );
  const cached = storyId ? relatedCache.get(storyId) : undefined;
  const current = loaded && loaded.id === storyId ? loaded.related : (cached ?? null);

  useEffect(() => {
    if (!storyId || !enabled || relatedCache.has(storyId)) return undefined;
    let active = true;
    Promise.resolve()
      .then(() => StoryService.getRelatedStories(storyId))
      .then(related => {
        relatedCache.set(storyId, related);
        if (active) setLoaded({ id: storyId, related });
      })
      .catch(() => {
        // Quiet: the section is an extra and simply stays away.
        if (active) setLoaded({ id: storyId, related: NO_RELATED_STORIES });
      });
    return () => {
      active = false;
    };
  }, [storyId, enabled]);

  return { related: current, loading: !!storyId && current === null };
}

// ─────────────────────────────────────────────────────────────
// One card
// ─────────────────────────────────────────────────────────────

/** What a related story is to the one on the page, for its caption. */
type RelatedKind = { kind: 'language' } | { kind: 'part'; number: number } | { kind: 'category' };

interface RelatedEntry {
  readonly story: Story;
  readonly relation: RelatedKind;
}

function relatedEntries(related: RelatedStories): RelatedEntry[] {
  return [
    ...related.languages.map(story => ({ story, relation: { kind: 'language' } as const })),
    ...related.parts.map(part => ({ story: part.story, relation: { kind: 'part', number: part.number } as const })),
    ...related.category.map(story => ({ story, relation: { kind: 'category' } as const })),
  ];
}

interface RelatedCardProps {
  entry: RelatedEntry;
  width: number;
  coverHeight: number;
  placeholderIndex?: number;
  locked: boolean;
  onOpen: (story: Story) => void;
  testID: string;
}

const RelatedCard = React.memo(function RelatedCard({
  entry,
  width,
  coverHeight,
  placeholderIndex,
  locked,
  onOpen,
  testID,
}: RelatedCardProps) {
  const { t } = useTranslation('detail');
  const { story, relation } = entry;
  const caption =
    relation.kind === 'language'
      ? contentLanguageNativeName(story.language)
      : relation.kind === 'part'
        ? t('related.part', { number: String(relation.number) })
        : '';
  return (
    <CoverCard
      story={story}
      title={story.title}
      width={width}
      coverHeight={coverHeight}
      titleLines={SHELF_TITLE_LINES}
      placeholderIndex={placeholderIndex}
      durationLabel={storyDurationLabel(story.estimatedDuration) || undefined}
      translation={getStoryTranslationKind(story)}
      locked={locked}
      onPress={() => onOpen(story)}
      accessibilityLabel={[
        locked ? t('discover:a11y.locked', { title: story.title }) : t('home:a11y.openStory', { title: story.title }),
        caption,
      ]
        .filter(Boolean)
        .join(', ')}
      testID={testID}
    >
      {/* Always there, so every card of a row is equally tall. */}
      <View style={{ height: CAPTION_LINE }} importantForAccessibility="no-hide-descendants">
        {caption ? <CoverMeta label={caption} /> : null}
      </View>
    </CoverCard>
  );
});

/** The caption line under a related card's title (CoverMeta's 16dp line). */
const CAPTION_LINE = 16;

/** The height of a preview card: cover, lip, two title lines and the caption line. */
export function relatedCardHeight(fontScale = 1, pixelRatio = 1): number {
  return coverCardHeight({
    width: SHELF_COVER_WIDTH,
    coverHeight: SHELF_COVER_HEIGHT,
    titleLines: SHELF_TITLE_LINES,
    marks: true,
    fontScale,
    pixelRatio,
  });
}

// ─────────────────────────────────────────────────────────────
// The section on the page
// ─────────────────────────────────────────────────────────────

export interface RelatedSectionProps {
  state: RelatedState;
  isLocked: (story: Story) => boolean;
  onOpen: (story: Story) => void;
  onSeeAll: () => void;
}

export const RelatedSection: React.FC<RelatedSectionProps> = ({ state, isLocked, onOpen, onSeeAll }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('detail');
  const { fontScale, scale } = useWindowDimensions();
  const entries = useMemo(
    () => (state.related ? relatedEntries(state.related).slice(0, RELATED_PREVIEW_COUNT) : []),
    [state.related],
  );
  const spread = useCoverSpread(entries.map(entry => entry.story));
  const rowHeight = relatedCardHeight(fontScale, scale);

  if (state.loading) {
    return (
      <SkeletonPulse testID="related-loading">
        <Bone width={150} height={18} radius={RADIUS.xs} style={styles.subhead} />
        <View style={[styles.bleed, styles.row, styles.clip, { height: rowHeight }]}>
          {Array.from({ length: RELATED_PREVIEW_COUNT }, (_, i) => (
            <View key={i} style={{ width: SHELF_COVER_WIDTH }}>
              <Bone
                width={SHELF_COVER_WIDTH}
                height={SHELF_COVER_HEIGHT}
                radius={coverRadius(SHELF_COVER_WIDTH, 'upright')}
                lip={coverLip(SHELF_COVER_WIDTH)}
              />
              <Bone tone="text" width="85%" height={12} radius={RADIUS.xs} style={styles.captionBone} />
              <Bone tone="text" width="55%" height={12} radius={RADIUS.xs} style={styles.captionBone} />
            </View>
          ))}
        </View>
      </SkeletonPulse>
    );
  }
  if (entries.length === 0) return null;
  return (
    <View testID="related-section">
      <SectionHeader
        size="sub"
        title={t('related.title')}
        linkLabel={t('related.all')}
        linkAccessibilityLabel={t('related.allA11y')}
        onLinkPress={onSeeAll}
        testID="related-heading"
        style={styles.subhead}
      />
      {/* Bleeds to the screen edges, like a Home shelf. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.bleed, { height: rowHeight }]}
        contentContainerStyle={styles.row}
        testID="related-list"
      >
        {entries.map(entry => (
          <RelatedCard
            key={entry.story.id}
            entry={entry}
            width={SHELF_COVER_WIDTH}
            coverHeight={SHELF_COVER_HEIGHT}
            placeholderIndex={spread.get(entry.story.id)}
            locked={isLocked(entry.story)}
            onOpen={onOpen}
            testID={`related-${entry.story.id}`}
          />
        ))}
      </ScrollView>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// "Tümü": everything, grouped
// ─────────────────────────────────────────────────────────────

export interface RelatedStoriesSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The tap's story opens once the sheet has gone (`onClosed`). */
  onClosed?: () => void;
  related: RelatedStories | null;
  isLocked: (story: Story) => boolean;
  onOpen: (story: Story) => void;
}

export const RelatedStoriesSheet: React.FC<RelatedStoriesSheetProps> = ({
  visible,
  onClose,
  onClosed,
  related,
  isLocked,
  onOpen,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('detail');
  const { width } = useWindowDimensions();
  const { cardWidth } = storyGridLayout(width - SCREEN_PAD_H * 2);
  const coverHeight = Math.round(cardWidth * 1.5);
  const groups = useMemo(() => {
    if (!related) return [];
    const entries = relatedEntries(related);
    return [
      { key: 'languages', title: t('related.languages'), entries: entries.filter(e => e.relation.kind === 'language') },
      { key: 'parts', title: t('related.parts'), entries: entries.filter(e => e.relation.kind === 'part') },
      { key: 'category', title: t('related.category'), entries: entries.filter(e => e.relation.kind === 'category') },
    ].filter(group => group.entries.length > 0);
  }, [related, t]);
  const spread = useCoverSpread(related ? relatedStoryList(related) : []);
  const open = useCallback((story: Story) => onOpen(story), [onOpen]);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      title={t('related.title')}
      scrollable
      fill
      testID="related-sheet"
    >
      {groups.map((group, index) => (
        <View key={group.key} testID={`related-group-${group.key}`} style={index > 0 ? styles.group : null}>
          <SectionHeader size="sub" title={group.title} style={styles.groupHeader} />
          <View style={styles.grid}>
            {group.entries.map(entry => (
              <View key={entry.story.id} style={{ width: cardWidth }}>
                <RelatedCard
                  entry={entry}
                  width={cardWidth}
                  coverHeight={coverHeight}
                  placeholderIndex={spread.get(entry.story.id)}
                  locked={isLocked(entry.story)}
                  onOpen={open}
                  testID={`related-sheet-${entry.story.id}`}
                />
              </View>
            ))}
          </View>
        </View>
      ))}
    </BottomSheet>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    // The story page's sections: 20 apart, 12 to their content.
    subhead: { marginTop: SPACE.xl, marginBottom: SPACE.md },
    bleed: { marginHorizontal: -T.screenPadH },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: RELATED_GAP, paddingHorizontal: T.screenPadH },
    clip: { overflow: 'hidden' },
    captionBone: { marginTop: SPACE.sm },
    group: { marginTop: SPACE.xl },
    groupHeader: { marginBottom: SPACE.md },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      rowGap: GRID_ROW_GAP,
      columnGap: GRID_COLUMN_GAP,
    },
  });

const stylesFor = themedStyles(makeStyles);
