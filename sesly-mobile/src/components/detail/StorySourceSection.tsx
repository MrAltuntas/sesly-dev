/**
 * "Kaynak ve lisans": the last section of the story page, folded by default.
 *
 *   A full-width row (the sub-head's title and a chevron) opens and closes
 *   the card of rows under it: source address, attribution, licence,
 *   licence address and the cover picture's credit (`storySourceRows`).
 *   Information only: every value is plain selectable text, never a link
 *   that leaves the app. One tap away is enough for CC BY 4.0 3(a)(2)
 *   ("in any reasonable manner").
 *
 *   The row has no lip, so it dims while held (`usePressTint`); a screen
 *   reader hears a button with its expanded state.
 */

import React, { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card, Icon, usePressTint } from '../design';
import { PRESS_DELAY_MS } from '../../theme/motion';
import { RADIUS, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';

export interface StorySourceRow {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface StorySourceSectionProps {
  rows: readonly StorySourceRow[];
  /** Open on the first frame (default folded). */
  initiallyOpen?: boolean;
}

export const StorySourceSection: React.FC<StorySourceSectionProps> = ({ rows, initiallyOpen = false }) => {
  const T = useT();
  const styles = stylesFor(T);
  const text = textStylesFor(T);
  const { t } = useTranslation('detail');
  const [open, setOpen] = useState(initiallyOpen);
  const tint = usePressTint();
  if (rows.length === 0) return null;
  return (
    <View testID="story-source" style={styles.section}>
      <Pressable
        onPress={() => setOpen(value => !value)}
        onPressIn={tint.onPressIn}
        onPressOut={tint.onPressOut}
        unstable_pressDelay={PRESS_DELAY_MS}
        accessibilityRole="button"
        accessibilityLabel={t('source.title')}
        accessibilityState={{ expanded: open }}
        testID="story-source-toggle"
      >
        <Animated.View style={[styles.toggle, { opacity: tint.opacity }]}>
          <Text style={[text.subheading, styles.title]} numberOfLines={2}>
            {t('source.title')}
          </Text>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={20} color={T.text2} />
        </Animated.View>
      </Pressable>
      {open ? (
        <Card radius={RADIUS.lg} contentStyle={styles.content} testID="story-source-rows">
          <View style={styles.list}>
            {rows.map(row => (
              <View key={row.key} style={styles.row} testID={`source-${row.key}`}>
                <Text style={styles.label}>{row.label}</Text>
                <Text selectable style={styles.value}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    section: { marginTop: SPACE.xl },
    // A 48dp target across the page.
    toggle: {
      minHeight: T.touch,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: SPACE.md,
    },
    title: { flex: 1, minWidth: 0 },
    // A content card: padding 16 (SPEC-design 1.5).
    content: { padding: SPACE.lg },
    list: { gap: SPACE.xs },
    // Label above the value: a URL needs the whole width.
    row: { gap: SPACE.xxs },
    label: { fontFamily: T.fontBody, fontSize: 13, lineHeight: 20, color: T.text3 },
    value: { fontFamily: T.fontBody, fontSize: 13, lineHeight: 20, color: T.text },
  });

const stylesFor = themedStyles(makeStyles);
