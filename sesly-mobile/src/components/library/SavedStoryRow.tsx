/**
 * One saved tale in "Kaydedilenler" (design/v4/playful, the `.nr` card): a
 * rounded square cover, the title, who wrote or collected it, level and meta
 * with the translation tag and the language codes, and the filled bookmark
 * in the action colour, which unsaves it.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  IconButton,
  LanguageCodes,
  PictureCover,
  TranslationBadge,
} from '../design';
import { SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { Story, getStoryTranslationKind } from '../../models/Story';
import { storyCategoryLabel, storyMetaLine } from '../../utils/storyLabels';
import { LIBRARY_COVER_RADIUS, LIBRARY_COVER_WIDTH, LIBRARY_META_HEIGHT } from './NarrationRow';
import { LibraryRowCard } from './LibraryRowCard';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Yazan X", else "Derleyen X", else the category ("Türk masalı"). */
export function savedStoryByline(story: Pick<Story, 'credit' | 'category'>, t: Translate): string {
  const author = story.credit.authorName?.trim();
  if (author) return t('library:credit.author', { name: author });
  const collector = story.credit.collectorName?.trim();
  if (collector) return t('library:credit.collector', { name: collector });
  return storyCategoryLabel(story.category);
}

/** "A2, 3-6 yaş, 6 dk": level first when the story has one. */
export function savedStoryMeta(
  story: Pick<Story, 'languageLevel' | 'ageGroup' | 'estimatedDuration'>,
): string {
  return [story.languageLevel ?? '', storyMetaLine(story)].filter(Boolean).join(', ');
}

export interface SavedStoryRowProps {
  story: Story;
  placeholderIndex?: number;
  onOpen: (story: Story) => void;
  onUnsave: (story: Story) => void;
}

export const SavedStoryRow: React.FC<SavedStoryRowProps> = ({
  story,
  placeholderIndex,
  onOpen,
  onUnsave,
}) => {
  const T = useT();
  const { t } = useTranslation('library');
  const styles = stylesFor(T);
  const text = textStylesFor(T);

  const translation = getStoryTranslationKind(story);
  const byline = savedStoryByline(story, t);
  const meta = savedStoryMeta(story);

  return (
    <LibraryRowCard
      onPress={() => onOpen(story)}
      accessibilityLabel={t('a11y.openStory', { title: story.title })}
      testID={`library-saved-${story.id}`}
      // The bookmark is a faceless 48dp target: its glyph on the 12dp inset.
      plainTrailing
      trailing={
        <IconButton
          icon="bookmarkOn"
          color={T.action}
          onPress={() => onUnsave(story)}
          accessibilityLabel={t('a11y.unsave', { title: story.title })}
          testID={`library-unsave-${story.id}`}
        />
      }
    >
      <PictureCover
        story={story}
        width={LIBRARY_COVER_WIDTH}
        shape="square"
        radius={LIBRARY_COVER_RADIUS}
        flat
        placeholderIndex={placeholderIndex}
      />
      <View style={styles.mid}>
        <Text style={text.labelLarge} numberOfLines={2}>
          {story.title}
        </Text>
        {byline ? (
          <Text style={styles.by} numberOfLines={1}>
            {byline}
          </Text>
        ) : null}
        <View style={styles.meta}>
          {translation ? <TranslationBadge kind={translation} /> : null}
          {meta ? (
            <Text style={styles.metaText} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          <LanguageCodes codes={story.availableLanguages} shown={story.language} style={styles.codes} />
        </View>
      </View>
    </LibraryRowCard>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    mid: { flex: 1, minWidth: 0 },
    by: {
      fontFamily: T.fontBody,
      fontSize: 12.5,
      lineHeight: 18,
      color: T.text2,
      marginTop: SPACE.xxs,
    },
    meta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.tight,
      marginTop: SPACE.xs,
      minHeight: LIBRARY_META_HEIGHT,
    },
    metaText: {
      fontFamily: T.fontBody,
      fontSize: 12,
      lineHeight: 16,
      color: T.text3,
      flexShrink: 1,
    },
    codes: { alignSelf: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default SavedStoryRow;
