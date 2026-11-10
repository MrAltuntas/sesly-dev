/**
 * Button: the chunky playful button (`.sunbtn`, `.ghostbtn`, `.sec2` in
 * design/v4/playful/index.html). Every filled button sits on its lip and
 * sinks onto it by exactly that lip when pressed (see `Tactile`).
 *
 * Variants (colours in `buttonColors`, docs/release-pass/SPEC-design.md
 * 1.6.1):
 * - primary: the action colour, the one "do it" per screen.
 * - secondary: a neutral card button, one ladder step above the container it
 *   sits on (`SurfaceLevelProvider`), so it never melts into a sheet or card.
 * - ghost: the opaque bar mix over a tinted card, for a second action on it
 *   ("Yeni ses kaydet" on the own-voice card); pass that card's colour as
 *   `parentColor`.
 * - text: no fill ("Hazır anlatıcıyla başla"), for a quiet alternative. It
 *   has no lip, so it never moves: it dims while pressed (`usePressTint`).
 *
 * Sizes (`BUTTON_METRICS`): sm 36, md 44, lg 52dp on lips 2 / 2 / 3. lg is
 * for the one bottom call to action of a screen or form; sheets and dialogs
 * use md. A small button still gets a 48dp touch target through hitSlop.
 *
 * The label wraps to two lines at most with Android's simple line breaker,
 * so a label measured as one line is drawn on one line and never loses its
 * last word to a clipped second line. `singleLine` keeps it on one line:
 * - on a `block` button (a dock action: the face spans the screen, so it has
 *   room) the label keeps its own size and its intrinsic width (no shrink in
 *   the row, no font auto-fit) and ends in an ellipsis only if it ever ran
 *   out of room. Android's auto-fit path turns the ellipsis off and measures
 *   the label shorter than it draws, so "Arka planda devam et" lost "et" to
 *   a clipped second line on the generation dock (NL-03).
 * - on an inline button sharing a row (the story detail dock CTA,
 *   SPEC-design 1.4) it shrinks to fit, down to 85 %.
 *
 * Disabled is a state of its own (`disabledFace`, a `text3` label, no
 * opacity). Loading keeps the face size: the label stays laid out (and stays
 * the accessibility label) at opacity 0 under a centred spinner; a button
 * with an icon shows the spinner in the icon slot instead.
 */

import React from 'react';
import { Animated, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Theme, themedStyles, useT } from '../../theme/theme';
import { PRESS_DELAY_MS } from '../../theme/motion';
import { Icon, IconName } from './Icon';
import { Tactile, usePressTint } from './Tactile';
import { Spinner } from './feedback';
import { useSurfaceLevel } from './SurfaceLevel';
import { ButtonTone, ButtonVariant, buttonColors } from './buttonColors';
import { BUTTON_METRICS, BUTTON_PAD_V, ButtonSize, buttonHitSlop } from './buttonMetrics';

export { buttonColors } from './buttonColors';
export type { ButtonColors, ButtonColorState, ButtonTone, ButtonVariant } from './buttonColors';
export { BUTTON_METRICS, BUTTON_PAD_V, buttonHitSlop } from './buttonMetrics';
export type { ButtonMetrics, ButtonSize } from './buttonMetrics';

/** Horizontal padding of a text button (it has no face to pad). */
const TEXT_PAD_H = 12;

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  tone?: ButtonTone;
  /** Leading icon from the icon family. */
  icon?: IconName;
  /** Leading custom node (brand mark). Wins over `icon`. */
  leading?: React.ReactNode;
  /**
   * Stretch to the container width (`alignSelf: 'stretch'`). Only `block`
   * stretches, whatever the size. In a row that would stretch the button
   * vertically too, so a button that shares a row passes
   * `style={{ flex: 1, alignSelf: 'center' }}` instead.
   */
  block?: boolean;
  /** Not pressable, drawn on the disabled face with a `text3` label. */
  disabled?: boolean;
  /** Shows a spinner, keeps the face size and blocks presses. */
  loading?: boolean;
  /**
   * One line instead of two. With `block` the label keeps its size and its
   * full width (the generation dock); without, it shrinks to fit (down to
   * 85 %, the story detail dock CTA). Labels wrap to two lines otherwise.
   */
  singleLine?: boolean;
  /**
   * Colour of the tinted card a ghost button sits on; its face is the opaque
   * ghost mix over it (a translucent face would show the lip through it).
   */
  parentColor?: string;
  /** Delay before the sink or tint starts (Tactile default 100 ms; 0 for docks). */
  pressDelay?: number;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  tone = 'default',
  icon,
  leading,
  block,
  disabled,
  loading,
  singleLine,
  parentColor,
  pressDelay,
  accessibilityLabel,
  testID,
  style,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const level = useSurfaceLevel();
  const colors = buttonColors(T, variant, tone, level, { disabled: !!disabled, parentColor });
  const inactive = !!disabled || !!loading;
  const m = BUTTON_METRICS[size];
  const hasGlyph = !!leading || !!icon;
  const spinnerID = testID ? `${testID}-spinner` : undefined;
  // Font auto-fit only for a single line in a shared row; a block face has room.
  const fit = !!singleLine && !block;
  const fullLabel = !!singleLine && !!block;

  const glyph =
    loading && hasGlyph ? (
      <Spinner size={m.icon} color={colors.label} testID={spinnerID} />
    ) : leading ? (
      leading
    ) : icon ? (
      <Icon name={icon} size={m.icon} color={colors.label} />
    ) : null;

  const content = (
    <>
      {glyph}
      <Text
        numberOfLines={singleLine ? 1 : 2}
        // The fallback when a line runs out of room. Android drops it while
        // adjustsFontSizeToFit is on, so a block label never auto-fits.
        ellipsizeMode="tail"
        adjustsFontSizeToFit={fit ? true : undefined}
        minimumFontScale={fit ? 0.85 : undefined}
        // Android only: greedy line breaks, as the label box is measured. The
        // default high-quality breaker could push the last word of a label
        // measured as one line onto a second line the box clips ("Arka
        // planda devam" without "et" on a block button).
        textBreakStrategy="simple"
        style={[
          styles.label,
          fullLabel ? styles.labelFull : null,
          { color: colors.label, fontSize: m.font, lineHeight: m.lineHeight },
          loading && !hasGlyph ? styles.hidden : null,
        ]}
      >
        {label}
      </Text>
      {loading && !hasGlyph ? (
        <View pointerEvents="none" testID={spinnerID} style={styles.spinner}>
          <Spinner size={m.icon} color={colors.label} />
        </View>
      ) : null}
    </>
  );

  const a11y = {
    accessibilityLabel: accessibilityLabel ?? label,
    accessibilityState: { disabled: inactive, busy: !!loading },
  };
  const outer: StyleProp<ViewStyle> = [{ alignSelf: block ? 'stretch' : 'flex-start' }, style];

  if (variant === 'text') {
    return (
      <TextButton
        onPress={inactive ? undefined : onPress}
        disabled={inactive}
        pressDelay={pressDelay}
        testID={testID}
        style={outer}
        faceStyle={[styles.face, { minHeight: Math.max(m.height, T.touch), paddingHorizontal: TEXT_PAD_H, gap: m.gap }]}
        {...a11y}
      >
        {content}
      </TextButton>
    );
  }

  return (
    <Tactile
      color={colors.background}
      lipColor={colors.lip}
      lip={m.lip}
      radius={m.radius}
      onPress={inactive ? undefined : onPress ?? noop}
      disabled={inactive}
      dimWhenDisabled={false}
      pressDelay={pressDelay}
      hitSlop={buttonHitSlop(size, T.touch)}
      testID={testID}
      style={outer}
      faceStyle={[styles.face, { minHeight: m.height, paddingHorizontal: m.padH, gap: m.gap }]}
      {...a11y}
    >
      {content}
    </Tactile>
  );
};

function noop() {}

/**
 * A text button has no face and no lip, so it never moves: it dims while
 * pressed, like every faceless target (SPEC-design 1.3, rule 2).
 */
const TextButton: React.FC<{
  onPress?: () => void;
  disabled?: boolean;
  pressDelay?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  faceStyle?: StyleProp<ViewStyle>;
  accessibilityLabel: string;
  accessibilityState: { disabled: boolean; busy: boolean };
  children: React.ReactNode;
}> = ({ onPress, disabled, pressDelay, testID, style, faceStyle, accessibilityLabel, accessibilityState, children }) => {
  const { opacity, onPressIn, onPressOut } = usePressTint(!!disabled);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      unstable_pressDelay={pressDelay ?? PRESS_DELAY_MS}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      testID={testID}
      style={style}
    >
      <Animated.View testID={testID ? `${testID}-face` : undefined} style={[faceStyle, { opacity }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    face: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: BUTTON_PAD_V,
    },
    label: {
      fontFamily: T.fontLabel,
      flexShrink: 1,
      textAlign: 'center',
    },
    // A single-line block label is never squeezed below its intrinsic width.
    labelFull: { flexShrink: 0 },
    hidden: { opacity: 0 },
    spinner: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

const stylesFor = themedStyles(makeStyles);
