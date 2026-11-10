/**
 * Small shared pieces of the playful design that several screens draw the
 * same way: the waveform of a sample (`.wave`), the fat progress bar
 * (`.track`), the round play button of rows (`.pb`), section headings
 * (`h2.sec`) and the spinner.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  LayoutChangeEvent,
  Platform,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { LIP, useT, useTextStyles } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { DURATION, EASE, PRESS_DELAY_MS, animateTo, useReducedMotion } from '../../theme/motion';
import { WAVE_IDLE_ALPHA } from '../../theme/surfaces';
import { Icon, IconName } from './Icon';
import { Tactile } from './Tactile';
import { usePressTint } from './usePressTint';

// ─────────────────────────────────────────────────────────────
// Waveform
// ─────────────────────────────────────────────────────────────

/**
 * Bar heights (0.18 to 1) of a waveform. Deterministic for a seed, so a
 * sample always draws the same shape. This is a drawing, not the measured
 * audio: the app has no amplitude data for samples.
 */
export function waveformBars(count: number, seed = 1): number[] {
  const out: number[] = [];
  let state = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  for (let i = 0; i < count; i++) {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const noise = (state % 1000) / 1000;
    const envelope = 0.55 + 0.45 * Math.abs(Math.sin((i / Math.max(1, count)) * Math.PI * 3.1 + seed));
    out.push(Math.max(0.18, Math.min(1, (0.25 + noise * 0.75) * envelope)));
  }
  return out;
}

export interface WaveformProps {
  /** Number of bars; 2dp bars with a 2dp gap fit `width / 4`. */
  bars?: number;
  height?: number;
  /** Played part, 0 to 1. Bars before it take `playedColor`. */
  progress?: number;
  seed?: number;
  /** Unplayed bars; default `text` at `WAVE_IDLE_ALPHA` (3:1 on surface). */
  color?: string;
  playedColor?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const Waveform: React.FC<WaveformProps> = ({
  bars = 40,
  height = 28,
  progress = 0,
  seed = 1,
  color,
  playedColor,
  testID,
  style,
}) => {
  const T = useT();
  const heights = useMemo(() => waveformBars(bars, seed), [bars, seed]);
  const playedCount = Math.round(Math.max(0, Math.min(1, progress)) * bars);
  const idle = color ?? withAlpha(T.text, WAVE_IDLE_ALPHA);
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ flexDirection: 'row', alignItems: 'center', height, flex: 1, overflow: 'hidden' }, style]}
    >
      {heights.map((h, i) => (
        <View
          key={i}
          style={{
            flex: 1,
            maxWidth: 4,
            minWidth: 2,
            marginHorizontal: 1.5, // geometry: bar spacing
            height: Math.max(4, Math.round(h * height)),
            borderRadius: 2, // geometry: half the narrowest bar
            backgroundColor: i < playedCount ? playedColor ?? T.action : idle,
          }}
        />
      ))}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// ProgressBar
// ─────────────────────────────────────────────────────────────

/** A 0 to 1 value that is animated on the native driver. */
export type AnimatedProgress = Animated.Value | Animated.AnimatedInterpolation<number>;

/**
 * The filled part of a track, moved with a transform so the native driver can
 * animate it (a width cannot be). The fill is as wide as the track and slides
 * in from the left; the track must clip (`overflow: 'hidden'`).
 */
export const AnimatedFill: React.FC<{
  progress: AnimatedProgress;
  /** Measured width of the track; nothing is drawn until it is known. */
  trackWidth: number;
  height: number;
  color: string;
  radius?: number;
  testID?: string;
}> = ({ progress, trackWidth, height, color, radius = 0, testID }) => {
  const translateX = useMemo(
    () =>
      progress.interpolate({
        inputRange: [0, 1],
        outputRange: [-trackWidth, 0],
        extrapolate: 'clamp',
      }),
    [progress, trackWidth],
  );
  if (trackWidth <= 0) return null;
  return (
    <Animated.View
      testID={testID}
      style={{
        width: trackWidth,
        height,
        borderRadius: radius,
        backgroundColor: color,
        transform: [{ translateX }],
      }}
    />
  );
};

/**
 * An `AnimatedFill` that eases to each new `value` in `DURATION.base` on the
 * native driver (at once under reduced motion). It starts at the first value
 * without a motion.
 */
const EasedFill: React.FC<{
  value: number;
  trackWidth: number;
  height: number;
  color: string;
  testID?: string;
}> = ({ value, trackWidth, height, color, testID }) => {
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(value)).current;
  const last = useRef(value);
  useEffect(() => {
    if (last.current === value) return;
    last.current = value;
    animateTo(fill, value, 'base', reduced);
  }, [value, reduced, fill]);
  useEffect(() => () => fill.stopAnimation(), [fill]);
  return (
    <AnimatedFill
      progress={fill}
      trackWidth={trackWidth}
      height={height}
      radius={height / 2}
      color={color}
      testID={testID}
    />
  );
};

export interface ProgressBarProps {
  /** 0 to 1. Leave undefined for an indeterminate bar. */
  value?: number;
  /**
   * A native-driven 0 to 1 value (the playing narration, see
   * `utils/playbackProgress`). Wins over `value` for the drawing; `value`
   * still feeds the accessibility value.
   */
  progress?: AnimatedProgress;
  /**
   * Ease the fill to each new `value` (generation progress) instead of
   * jumping. Off by default; ignored with `progress` or without `value`.
   */
  animated?: boolean;
  height?: number;
  color?: string;
  trackColor?: string;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  progress,
  animated = false,
  height = 6,
  color,
  trackColor,
  accessibilityLabel,
  testID,
  style,
}) => {
  const T = useT();
  const indeterminate = value === undefined && progress === undefined;
  const slide = useRef(new Animated.Value(0)).current;
  const [trackWidth, setTrackWidth] = React.useState(0);

  useEffect(() => {
    if (!indeterminate) return;
    const loop = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: DURATION.loop,
        easing: EASE.symmetric,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [indeterminate, slide]);

  const onLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);
  const clamped = Math.max(0, Math.min(1, value ?? 0));
  const segment = trackWidth * 0.34;
  const fillColor = color ?? T.action;
  const fillID = testID ? `${testID}-fill` : undefined;

  return (
    <View
      testID={testID}
      onLayout={onLayout}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={value === undefined ? undefined : { min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[
        { height, borderRadius: height / 2, backgroundColor: trackColor ?? T.line, overflow: 'hidden' },
        style,
      ]}
    >
      {indeterminate ? (
        <Animated.View
          style={{
            width: segment,
            height,
            borderRadius: height / 2,
            backgroundColor: fillColor,
            transform: [
              {
                translateX: slide.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-segment, trackWidth],
                }),
              },
            ],
          }}
        />
      ) : progress ? (
        <AnimatedFill
          progress={progress}
          trackWidth={trackWidth}
          height={height}
          radius={height / 2}
          color={fillColor}
          testID={fillID}
        />
      ) : animated ? (
        <EasedFill value={clamped} trackWidth={trackWidth} height={height} color={fillColor} testID={fillID} />
      ) : (
        <View
          testID={fillID}
          style={{
            width: `${clamped * 100}%`,
            height,
            borderRadius: height / 2,
            backgroundColor: fillColor,
          }}
        />
      )}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────

/**
 * The size an `ActivityIndicator` is given: Android sizes its native
 * ProgressBar to a number, iOS knows only 'small' (20) and 'large' (36).
 */
export function spinnerIndicatorSize(size: number, os: string = Platform.OS): number | 'small' | 'large' {
  if (os === 'android') return size;
  return size >= 30 ? 'large' : 'small';
}

export const Spinner: React.FC<{ size?: number; color?: string; testID?: string }> = ({
  size = 20,
  color,
  testID,
}) => {
  const T = useT();
  // The platform's own indicator, in a box of the requested size so a row
  // keeps its layout whether it spins or shows its icon.
  return (
    <View testID={testID} style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator testID="spinner-indicator" size={spinnerIndicatorSize(size)} color={color ?? T.text2} />
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// CircleButton: the round play / pause button of rows and cards (`.pb`)
// ─────────────────────────────────────────────────────────────

/** The spinner a busy CircleButton shows in place of its glyph (dp). */
export const CIRCLE_BUSY_SPINNER = 20;

/** Lip of a CircleButton: the control lip up to 48dp, the card lip above. */
export function circleLip(size: number): number {
  return size > 48 ? LIP.md : LIP.sm;
}

export interface CircleButtonProps {
  icon: IconName;
  onPress?: () => void;
  accessibilityLabel: string;
  /**
   * 'neutral': the raised surface on its lip, text glyph (narrator rows,
   * library rows).
   * 'surface': the surface colour on its lip, for a row that is itself
   * surface-2 (narrator rows inside a sheet).
   * 'action': the action colour on its lip (the item that is playing,
   * sample players, the mini player).
   */
  variant?: 'neutral' | 'surface' | 'action';
  /** Visible diameter; the touch target is always at least 48dp. */
  size?: number;
  disabled?: boolean;
  /** A 20dp spinner in place of the glyph, same face size; presses are ignored. */
  busy?: boolean;
  /** Wait before the sink starts (default `PRESS_DELAY_MS`; 0 outside scrolling content). */
  pressDelay?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export const CircleButton: React.FC<CircleButtonProps> = ({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'neutral',
  size = 42,
  disabled,
  busy,
  pressDelay,
  testID,
  style,
}) => {
  const T = useT();
  const lip = circleLip(size);
  const slop = Math.max(0, (T.touch - size - lip) / 2);
  const action = variant === 'action';
  const glyph = action ? T.onAction : T.text;
  const glyphSize = Math.max(20, Math.round(size * 0.45));
  return (
    <Tactile
      color={action ? T.action : variant === 'surface' ? T.surface : T.surface2}
      lipColor={action ? T.actionLip : T.lip}
      lip={lip}
      radius={size / 2}
      onPress={disabled || busy ? undefined : onPress ?? (() => undefined)}
      disabled={disabled || busy}
      dimWhenDisabled={!!disabled}
      pressDelay={pressDelay}
      hitSlop={{ top: slop, bottom: slop, left: slop, right: slop }}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: !!busy }}
      testID={testID}
      style={style}
      faceStyle={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      {busy ? (
        <Spinner size={CIRCLE_BUSY_SPINNER} color={glyph} testID={testID ? `${testID}-spinner` : undefined} />
      ) : (
        <Icon name={icon} size={glyphSize} color={glyph} />
      )}
    </Tactile>
  );
};

// ─────────────────────────────────────────────────────────────
// SectionLabel and SectionHeader: "Hazır anlatıcılar", shelf headings
// ─────────────────────────────────────────────────────────────

/** A Baloo 2 section heading (no uppercase in the playful design). */
export const SectionLabel: React.FC<{ children: string; style?: StyleProp<ViewStyle> }> = ({
  children,
  style,
}) => {
  const text = useTextStyles();
  return (
    <View style={style}>
      <Text accessibilityRole="header" style={text.heading}>
        {children}
      </Text>
    </View>
  );
};

export interface SectionHeaderProps {
  title: string;
  /** A category dot before the title (`.dot`). */
  dotColor?: string;
  /** "Tümü" at the right. */
  linkLabel?: string;
  onLinkPress?: () => void;
  /** Screen reader label of the link ("Türk klasikleri, tümünü gör"); default the link text. */
  linkAccessibilityLabel?: string;
  /** 'section' Baloo 2 20 (default), 'sub' Baloo 2 17 (detail sub-heads). */
  size?: 'section' | 'sub';
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Diameter of the category dot before a section title (dp). */
const SECTION_DOT = 9;

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  dotColor,
  linkLabel,
  onLinkPress,
  linkAccessibilityLabel,
  size = 'section',
  testID,
  style,
}) => {
  const text = useTextStyles();
  // A text link has no face: it dims while held and never moves.
  const tint = usePressTint();
  return (
    <View
      testID={testID}
      style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
        {dotColor ? (
          <View
            testID={testID ? `${testID}-dot` : undefined}
            style={{ width: SECTION_DOT, height: SECTION_DOT, borderRadius: SECTION_DOT / 2, backgroundColor: dotColor }}
          />
        ) : null}
        <Text
          accessibilityRole="header"
          numberOfLines={1}
          style={[size === 'sub' ? text.subheading : text.heading, { flexShrink: 1 }]}
        >
          {title}
        </Text>
      </View>
      {linkLabel && onLinkPress ? (
        <Pressable
          onPress={onLinkPress}
          onPressIn={tint.onPressIn}
          onPressOut={tint.onPressOut}
          unstable_pressDelay={PRESS_DELAY_MS}
          accessibilityRole="button"
          accessibilityLabel={linkAccessibilityLabel ?? linkLabel}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          testID={testID ? `${testID}-link` : undefined}
          // The title gives way, never the link: a squeezed link wrapped its
          // second word into a line the row had no room for ("Tümünü").
          style={styles.link}
        >
          <Animated.Text numberOfLines={1} style={[text.link, { opacity: tint.opacity }]}>
            {linkLabel}
          </Animated.Text>
        </Pressable>
      ) : null}
    </View>
  );
};

// Colour-free layout shared by every palette.
const styles = StyleSheet.create({
  link: { flexShrink: 0 },
});
