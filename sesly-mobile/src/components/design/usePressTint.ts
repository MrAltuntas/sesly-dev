/**
 * usePressTint: the press answer of a target without a lip (text buttons,
 * plain icon buttons, plain rows, setting and switch rows, segments,
 * unfocused tabs, the cover bookmark, links). Such a target never moves; it
 * dims to `PRESS_TINT` while held (docs/release-pass/SPEC-design.md 1.3, rule
 * 2). A face with a visible lip sinks instead (`usePressSink` in Tactile).
 *
 *   const { opacity, onPressIn, onPressOut } = usePressTint(disabled);
 *   <Pressable onPressIn={onPressIn} onPressOut={onPressOut}>
 *     <Animated.View style={{ opacity }}>...</Animated.View>
 *   </Pressable>
 *
 * One native-driven value: 1 at rest, `PRESS_TINT` pressed, in
 * `DURATION.pressIn` and back in `DURATION.pressOut`. A disabled target
 * starts nothing and is shown at rest; one disabled while held goes back to
 * rest at once (`reset`, also for a caller that knows better, such as a tab
 * that a press has just focused).
 *
 * Back to rest at once is a native timing to 1 in duration 0, never
 * `setValue(1)`. When an animation on the native driver ends, native sends
 * its value and JS writes it back to the node and commits it to the view
 * (Fabric), even for an animation JS has stopped. While JS is busy (a tab
 * that mounts a heavy screen), the end event of the press-in (0.6) can
 * arrive after a `setValue(1)` and leave the target dimmed for good (V5R-01).
 * A timing started after it ends after it, so its 1 is the last word.
 */

import { useCallback, useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { DURATION, EASE, PRESS_TINT } from '../../theme/motion';

export interface PressTint {
  /** 1 at rest, `PRESS_TINT` while pressed. Put it on the view that dims. */
  opacity: Animated.Value;
  onPressIn: () => void;
  onPressOut: () => void;
  /**
   * Back to rest at once if a press has dimmed the target and nothing has
   * sent it back yet; otherwise nothing. A later press-out then starts
   * nothing.
   */
  reset: () => void;
}

export function usePressTint(disabled = false): PressTint {
  const opacity = useRef(new Animated.Value(1)).current;
  // From a press-in until a press-out or a reset has sent the value back to rest.
  const away = useRef(false);

  const animate = useCallback(
    (toValue: number, duration: number) => {
      Animated.timing(opacity, { toValue, duration, easing: EASE.standard, useNativeDriver: true }).start();
    },
    [opacity],
  );

  const reset = useCallback(() => {
    if (!away.current) return;
    away.current = false;
    // Stops a press-in still in flight; see the header for why not setValue.
    Animated.timing(opacity, { toValue: 1, duration: 0, useNativeDriver: true }).start();
  }, [opacity]);

  // Disabled while held: back to rest at once, so nothing stays dimmed.
  useEffect(() => {
    if (disabled) reset();
  }, [disabled, reset]);

  const onPressIn = useCallback(() => {
    if (disabled) return;
    away.current = true;
    animate(PRESS_TINT, DURATION.pressIn);
  }, [animate, disabled]);

  // Pressability may deliver it up to its minimum press duration late, after
  // a disable or a reset: then the value is already on its way to rest.
  const onPressOut = useCallback(() => {
    if (!away.current) return;
    away.current = false;
    animate(1, DURATION.pressOut);
  }, [animate]);

  return { opacity, onPressIn, onPressOut, reset };
}
