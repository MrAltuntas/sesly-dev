/**
 * Empty state of the Kütüphane tab (design/v4/playful): a little shelf drawn
 * from the system's own shapes, one Baloo 2 title, one sentence and the
 * primary action.
 *
 * The shelf is three chunky books on their lips in the Uyku, Türk and Dünya
 * colours, each with its category glyph, leaning on a line-coloured plank. It
 * is deliberately not a story cover: nothing is in the library yet.
 */

import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Button, Icon, IconName } from '../design';
import { LIP, RADIUS, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import type { CategoryKey } from '../../theme/palettes';

interface ShelfBook {
  slot: CategoryKey;
  icon: IconName;
  height: number;
  tilt: string;
}

/** The three books, left to right: short and leaning, tall, short and leaning. */
export const SHELF_BOOKS: readonly ShelfBook[] = [
  { slot: 'uyku', icon: 'moon', height: 66, tilt: '-7deg' },
  { slot: 'turk', icon: 'rose', height: 82, tilt: '0deg' },
  { slot: 'dunya', icon: 'globe', height: 60, tilt: '8deg' },
];

const BOOK_WIDTH = 46;
/** One lip for the whole shelf: the tallest book's (82dp, SPEC-design 1.3). */
const BOOK_LIP = LIP.lg;
const PLANK_HEIGHT = 10;

export const EmptyShelf: React.FC<{ testID?: string }> = ({ testID }) => {
  const T = useT();
  const styles = stylesFor(T);
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.shelf}
    >
      <View style={styles.books}>
        {SHELF_BOOKS.map(book => {
          const colors = T.cat[book.slot];
          return (
            <View
              key={book.slot}
              testID={testID ? `${testID}-${book.slot}` : undefined}
              style={[
                styles.book,
                {
                  height: book.height + BOOK_LIP,
                  backgroundColor: colors.color,
                  borderBottomColor: colors.lip,
                  transform: [{ rotate: book.tilt }],
                },
              ]}
            >
              <Icon name={book.icon} size={22} color={colors.on} />
            </View>
          );
        })}
      </View>
      <View style={styles.plank} testID={testID ? `${testID}-plank` : undefined} />
    </View>
  );
};

export interface LibraryEmptyStateProps {
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const LibraryEmptyState: React.FC<LibraryEmptyStateProps> = ({
  title,
  message,
  actionLabel,
  onAction,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  return (
    <View testID={testID} style={[styles.state, style]}>
      <EmptyShelf testID={testID ? `${testID}-shelf` : undefined} />
      <Text accessibilityRole="header" style={[text.heading, styles.title]}>
        {title}
      </Text>
      <Text style={[text.bodySmall, styles.message]}>{message}</Text>
      <Button
        label={actionLabel}
        onPress={onAction}
        style={styles.action}
        testID={testID ? `${testID}-action` : undefined}
      />
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: SPACE.xxxl,
      paddingTop: SPACE.xxl,
      // A little more room below: the block sits just above the centre.
      paddingBottom: SPACE.xxxl,
    },
    shelf: { alignItems: 'center' },
    books: { flexDirection: 'row', alignItems: 'flex-end', gap: SPACE.sm, paddingHorizontal: SPACE.md },
    book: {
      width: BOOK_WIDTH,
      borderRadius: RADIUS.sm,
      borderBottomWidth: BOOK_LIP,
      alignItems: 'center',
      justifyContent: 'flex-start',
      paddingTop: SPACE.md,
    },
    plank: {
      alignSelf: 'stretch',
      height: PLANK_HEIGHT,
      marginTop: SPACE.xxs,
      borderRadius: PLANK_HEIGHT / 2,
      backgroundColor: T.line,
      borderBottomWidth: 2,
      borderBottomColor: T.lineLip,
    },
    title: { marginTop: SPACE.xxl, textAlign: 'center' },
    message: { marginTop: SPACE.sm, maxWidth: 280, textAlign: 'center' },
    action: { marginTop: SPACE.xxl, alignSelf: 'center' },
  });

const stylesFor = themedStyles(makeStyles);

export default LibraryEmptyState;
