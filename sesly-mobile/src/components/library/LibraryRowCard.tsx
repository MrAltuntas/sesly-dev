/**
 * LibraryRowCard: the card a Kütüphane row sits in (design/v4/playful `.nr`,
 * the row card of docs/release-pass/SPEC-design.md 1.4: radius 20, padding
 * 12, gap 12, on a 3dp lip, at least its 48dp cover plus the padding tall).
 *
 * The main area (cover and text) is one button that sinks the whole card
 * onto its lip while pressed; the trailing controls (play, unsave, and on a
 * narration "Sıraya ekle" and the "more" button) are siblings of that
 * button, so a screen reader reaches each and a press on a control never
 * opens the row. There is no long press: every action of a row is a visible
 * control (owner feedback: nobody found the long press). Without `onPress`
 * the main area is a single accessible block.
 *
 * The continue-listening card uses it too, so it lines up with the rows.
 */

import React from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { LIP, RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { PRESS_DELAY_MS } from '../../theme/motion';
import { usePressSink } from '../design';

/** Lip under a library card (dp): the row-card lip. */
export const LIBRARY_CARD_LIP = LIP.md;
/** Corner radius of a library card (dp): the row-card radius. */
export const LIBRARY_CARD_RADIUS = RADIUS.lg;
/** Padding inside the card, on every side (dp). */
export const LIBRARY_CARD_PADDING = SPACE.md;
/** Space between two cards of a list (dp). */
export const LIBRARY_CARD_GAP = SPACE.md;
/** Edge of the leading picture of a library card (the row-card picture tile, dp). */
export const LIBRARY_CARD_LEADING = 48;
/** Face height of a card with a one-line body: the leading picture plus the padding (dp). */
export const LIBRARY_CARD_MIN_HEIGHT = LIBRARY_CARD_LEADING + 2 * LIBRARY_CARD_PADDING;

export interface LibraryRowCardProps {
  /** Cover and text: the part that opens the row. */
  children: React.ReactNode;
  /** Controls at the right (play button, unsave, spinner; a narration's queue, play and more). */
  trailing?: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  /** On the main area; the face is `${testID}-face`, the lip `${testID}-lip`, the whole card `${testID}-card`. */
  testID: string;
  /** Margin under the card (default `LIBRARY_CARD_GAP`); the continue card sets its own. */
  spaced?: boolean;
  /**
   * The trailing control is a faceless 48dp target (a plain IconButton): it
   * reaches to the card edge, so its glyph sits on the 12dp inset like the
   * cover on the other side.
   */
  plainTrailing?: boolean;
  /**
   * The trailing controls start with a faceless 44dp target whose glyph is
   * already inset: the gap to the text is the small step, so the title
   * keeps its room on a 360dp phone.
   */
  tightTrailing?: boolean;
}

export const LibraryRowCard: React.FC<LibraryRowCardProps> = ({
  children,
  trailing,
  onPress,
  accessibilityLabel,
  testID,
  spaced = true,
  plainTrailing = false,
  tightTrailing = false,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const interactive = !!onPress;
  const { translateY, onPressIn, onPressOut } = usePressSink(LIBRARY_CARD_LIP, interactive);

  return (
    <View testID={`${testID}-card`} style={[styles.wrap, spaced ? styles.spaced : null]}>
      <View pointerEvents="none" testID={`${testID}-lip`} style={styles.lip} />
      <Animated.View
        testID={`${testID}-face`}
        style={[
          styles.face,
          trailing && plainTrailing ? styles.facePlainTrailing : null,
          { transform: [{ translateY }] },
        ]}
      >
        {interactive ? (
          <Pressable
            onPress={onPress}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            // Inside a scrolling list: a swipe never sinks a card.
            unstable_pressDelay={PRESS_DELAY_MS}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            testID={testID}
            style={styles.main}
          >
            {children}
          </Pressable>
        ) : (
          <View accessible accessibilityLabel={accessibilityLabel} testID={testID} style={styles.main}>
            {children}
          </View>
        )}
        {trailing ? (
          <View
            style={[styles.trailing, tightTrailing ? styles.trailingTight : null]}
            testID={`${testID}-trailing`}
          >
            {trailing}
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    wrap: {
      marginHorizontal: T.screenPadH,
      paddingBottom: LIBRARY_CARD_LIP,
    },
    spaced: { marginBottom: LIBRARY_CARD_GAP },
    lip: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      top: LIBRARY_CARD_LIP,
      borderRadius: LIBRARY_CARD_RADIUS,
      backgroundColor: T.lip,
    },
    face: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: LIBRARY_CARD_MIN_HEIGHT,
      borderRadius: LIBRARY_CARD_RADIUS,
      backgroundColor: T.surface,
      // Symmetric insets: the trailing control's face ends 12dp from the
      // card edge, like the cover starts 12dp from the other one.
      paddingHorizontal: LIBRARY_CARD_PADDING,
      gap: SPACE.md,
    },
    facePlainTrailing: { paddingRight: 0 },
    // Stretched to the face, so the whole height opens the row.
    main: {
      flex: 1,
      minWidth: 0,
      alignSelf: 'stretch',
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      paddingVertical: LIBRARY_CARD_PADDING,
    },
    // The control keeps its own touch target (CircleButton and IconButton
    // reach 48dp through hit slop), so it adds only its face to the row.
    trailing: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    // The face's 12dp gap less 8: the first control's own target pads its glyph.
    trailingTight: { marginLeft: -SPACE.sm },
  });

const stylesFor = themedStyles(makeStyles);

export default LibraryRowCard;
