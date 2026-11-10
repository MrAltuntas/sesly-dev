/**
 * Tactile: the playful press surface (design/v4/playful, README "Key ideas"
 * 1). Every card and button sits on a darker lip, its bottom edge, and sinks
 * onto it while pressed, like a Yoto card or a Duolingo button.
 *
 * The lip is a second rounded layer behind the face, `lip` dp lower; the
 * container reserves that space below the face, so the lip is part of the
 * layout and needs no shadow (Android draws it exactly). On press the face
 * moves down by exactly `lip` with a native-driver transform, covering the
 * lip (docs/release-pass/SPEC-design.md 1.3: only a face with a visible lip
 * sinks; a target without one dims with `usePressTint` instead).
 *
 *   <Tactile color={T.action} lipColor={T.actionLip} radius={20} onPress={go}>
 *     ...content of the face...
 *   </Tactile>
 *
 * `style` positions the whole control (margins, flex, width). `faceStyle`
 * lays out the face (height, padding, alignment). The background and the
 * radius belong to the face; `testID` sits on the pressable and the face is
 * `${testID}-face`, the lip `${testID}-lip`.
 *
 * Presses wait `PRESS_DELAY_MS` before the sink starts, so a swipe through a
 * list never flickers a card; a tap shorter than that still shows the full
 * sink. Controls outside scrolling content that must answer at touch-down
 * (the player transport, steppers, tabs, docks) pass `pressDelay={0}`.
 *
 * The face must be opaque: a translucent face shows the lip layer through
 * it (a dark slab). Mix tints over their container (`mix`) instead.
 *
 * A press that starts heavy work (it opens a screen or a sheet) runs that
 * work in the next frame (`useNextFramePress`), so the frame with the sink
 * or the tint is drawn before JS is busy with the mount (LR-4: the mini
 * player and the player's tiles showed no press state for up to 2.4 s).
 */

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  AccessibilityRole,
  AccessibilityState,
  AccessibilityValue,
  Animated,
  Insets,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { LIP, RADIUS } from '../../theme/theme';
import { DURATION, EASE, PRESS_DELAY_MS } from '../../theme/motion';

export { usePressTint } from './usePressTint';
export type { PressTint } from './usePressTint';

/** Opacity of a dimmed control (`dimmed`, or disabled with `dimWhenDisabled`). */
export const TACTILE_DIM_OPACITY = 0.5;

/** Translucent faces already reported, so a list of them warns once per colour. */
const warnedFaces = new Set<string>();

/** Development guard: a translucent face on a visible lip shows the lip through it. */
function warnTranslucentFace(color: string, lipColor: string) {
  if (typeof color !== 'string' || !color.startsWith('rgba(') || lipColor === 'transparent') return;
  if (warnedFaces.has(color)) return;
  warnedFaces.add(color);
  console.warn(
    `Tactile: the translucent face ${color} shows its lip through it. ` +
      'Use an opaque colour (mix the tint over its container).',
  );
}

/**
 * The press animation: one native-driven value, 0 at rest and 1 pressed,
 * turned into a downward offset of `lip` dp. Exposed for components that
 * draw their own face (and for the tests). Pass the same constant the lip is
 * drawn with, so the face sinks by exactly its lip. A disabled control never
 * sinks, and one disabled while held rises at once.
 */
export function usePressSink(lip: number, enabled = true) {
  const press = useRef(new Animated.Value(0)).current;
  const pressed = useRef(false);
  const animate = useCallback(
    (toValue: 0 | 1) => {
      Animated.timing(press, {
        toValue,
        duration: toValue ? DURATION.pressIn : DURATION.pressOut,
        easing: EASE.standard,
        useNativeDriver: true,
      }).start();
    },
    [press],
  );

  useEffect(() => {
    if (enabled || !pressed.current) return;
    pressed.current = false;
    press.stopAnimation();
    press.setValue(0);
  }, [enabled, press]);

  const onPressIn = useCallback(() => {
    if (!enabled) return;
    pressed.current = true;
    animate(1);
  }, [animate, enabled]);
  const onPressOut = useCallback(() => {
    pressed.current = false;
    animate(0);
  }, [animate]);
  const translateY = useMemo(
    () => press.interpolate({ inputRange: [0, 1], outputRange: [0, lip], extrapolate: 'clamp' }),
    [press, lip],
  );
  return { press, translateY, onPressIn, onPressOut };
}

/**
 * The press handler of a control whose press starts heavy work (navigating
 * to a screen, opening a sheet): it runs `onPress` in the next frame, so the
 * press state the touch started (the sink or the tint, on the native driver)
 * is committed and moving before the mount takes the JS thread. Pass it as
 * the pressable's `onPress`; `onPressIn` / `onPressOut` stay immediate.
 *
 * Taps within one frame run it once; an unmount cancels a pending run. The
 * latest `onPress` runs, so the caller may pass a new function every render.
 * Returns undefined for no `onPress`.
 */
export function useNextFramePress(onPress?: () => void): (() => void) | undefined {
  const latest = useRef(onPress);
  latest.current = onPress;
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );
  const run = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      latest.current?.();
    });
  }, []);
  return onPress ? run : undefined;
}

export interface TactileProps {
  /** Face colour. Opaque (see the header). */
  color: string;
  /** Lip colour (the darker edge). */
  lipColor: string;
  /** Lip height in dp. Default `LIP.md` (3). */
  lip?: number;
  /** Corner radius of face and lip. Default `RADIUS.lg` (20). */
  radius?: number;
  /** Optional ring on the face (a selected narrator card), 2dp by default. */
  borderColor?: string;
  borderWidth?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Dim a disabled control (default true). Buttons draw a disabled face instead. */
  dimWhenDisabled?: boolean;
  /** Draw the control dimmed while it stays pressable (an unavailable choice). */
  dimmed?: boolean;
  /**
   * Milliseconds a press waits before the sink starts (default
   * `PRESS_DELAY_MS`, 100). 0 for controls that answer at touch-down.
   */
  pressDelay?: number;
  hitSlop?: Insets | number;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  accessibilityValue?: AccessibilityValue;
  testID?: string;
  /** Outer box: margins, flex, width, alignSelf. */
  style?: StyleProp<ViewStyle>;
  /** Face layout: height, padding, direction, alignment. */
  faceStyle?: StyleProp<ViewStyle>;
  /** Clip the face's children to its corners (covers, pictures). */
  clip?: boolean;
  children?: React.ReactNode;
}

export const Tactile: React.FC<TactileProps> = ({
  color,
  lipColor,
  lip = LIP.md,
  radius = RADIUS.lg,
  borderColor,
  borderWidth,
  onPress,
  onLongPress,
  disabled,
  dimWhenDisabled = true,
  dimmed,
  pressDelay = PRESS_DELAY_MS,
  hitSlop,
  accessibilityRole = 'button',
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  accessibilityValue,
  testID,
  style,
  faceStyle,
  clip,
  children,
}) => {
  const interactive = !!(onPress || onLongPress) && !disabled;
  const { translateY, onPressIn, onPressOut } = usePressSink(lip, interactive);

  useEffect(() => {
    if (__DEV__) warnTranslucentFace(color, lipColor);
  }, [color, lipColor]);

  const face = (
    <>
      <View
        pointerEvents="none"
        testID={testID ? `${testID}-lip` : undefined}
        style={[styles.layer, { top: lip, borderRadius: radius, backgroundColor: lipColor }]}
      />
      <Animated.View
        testID={testID ? `${testID}-face` : undefined}
        style={[
          {
            backgroundColor: color,
            borderRadius: radius,
            borderColor,
            borderWidth: borderColor ? borderWidth ?? 2 : 0,
            overflow: clip ? 'hidden' : undefined,
            transform: [{ translateY }],
          },
          faceStyle,
        ]}
      >
        {children}
      </Animated.View>
    </>
  );

  // A dimmed group is composited offscreen, so Android fades it as one layer
  // instead of showing the lip through the half-transparent face.
  const dim = !!dimmed || (!!disabled && dimWhenDisabled);
  const outer: StyleProp<ViewStyle> = [
    { paddingBottom: lip, opacity: dim ? TACTILE_DIM_OPACITY : 1 },
    style,
  ];

  // A disabled control stays a (disabled) pressable, so nothing above it
  // receives the press either.
  if (!onPress && !onLongPress && !disabled) {
    return (
      <View testID={testID} needsOffscreenAlphaCompositing={dim} style={outer}>
        {face}
      </View>
    );
  }

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      unstable_pressDelay={pressDelay}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      accessibilityValue={accessibilityValue}
      needsOffscreenAlphaCompositing={dim}
      testID={testID}
      style={outer}
    >
      {face}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});
