/**
 * Motion tokens (docs/release-pass/SPEC-design.md 1.7). Every duration,
 * curve and spring of the app comes from here; a source scan
 * (`designScan.test.ts`) bans numeric `duration:` literals, `useNativeDriver:
 * false` and `LayoutAnimation` everywhere else.
 *
 * Reduced motion: translates and scales are applied at once (`setValue`, or
 * duration 0 in Reanimated); opacity cross-fades keep `DURATION.fast`.
 * Reanimated code reads `useReducedMotion` from Reanimated; React Native
 * `Animated` code reads the hook below.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, EasingFunction } from 'react-native';

/** Durations in ms. */
export const DURATION = {
  /** Sink and tint in. */
  pressIn: 70,
  /** Rise and tint out. */
  pressOut: 120,
  /** Cross-fades: compact segment pill, options dim, seek knob grab, slider drag step. */
  fast: 120,
  /** State changes in place: switch knob, slider tap, tab pill, dialog enter. */
  base: 200,
  /** Things that appear: snackbar, dock, first content fade-in. */
  enter: 240,
  /** Things that leave: snackbar, dock, dialog. */
  exit: 160,
  sheetEnter: 280,
  sheetExit: 200,
  /** Indeterminate progress bar. */
  loop: 1400,
  /** Skeleton pulse (floor opacity 0.7). */
  pulse: 1600,
} as const;

export type MotionKind = keyof typeof DURATION;

/** Cubic-bezier control points, for RN `Easing.bezier` or Reanimated `Easing.bezier`. */
export const CURVE = {
  /** Decelerate: enters, state changes, presses. */
  standard: [0.2, 0, 0, 1],
  /** Accelerate: leaving. */
  exit: [0.3, 0, 1, 1],
  /** Loops: now-playing bars, progress loop. */
  symmetric: [0.4, 0, 0.2, 1],
} as const;

export const EASE: Record<'standard' | 'exit' | 'symmetric' | 'linear', EasingFunction> = {
  standard: Easing.bezier(...CURVE.standard),
  exit: Easing.bezier(...CURVE.exit),
  symmetric: Easing.bezier(...CURVE.symmetric),
  /** Playback progress only. */
  linear: Easing.linear,
};

/** Damping ratio 0.73: about 3 % overshoot, settles in about 300 ms. */
export const SPRING_SNAPPY = { stiffness: 320, damping: 26, mass: 1 } as const;

/** Damping ratio 0.9: no visible overshoot; sheet drag release. */
export const SPRING_SHEET = { stiffness: 420, damping: 37, mass: 1 } as const;

/** Damping ratio of a spring config: damping / (2 * sqrt(stiffness * mass)). */
export function dampingRatio(spring: { stiffness: number; damping: number; mass: number }): number {
  return spring.damping / (2 * Math.sqrt(spring.stiffness * spring.mass));
}

/**
 * How long a pressable inside scrolling content waits before its sink or
 * tint starts (Android's TAP_TIMEOUT), so a swipe never flickers a card.
 */
export const PRESS_DELAY_MS = 100;

/** Opacity of a faceless press target (no lip) while it is held. */
export const PRESS_TINT = 0.6;

/** The curve a kind of motion uses: leaving accelerates, loops are symmetric, the rest decelerates. */
export function easingFor(kind: MotionKind): EasingFunction {
  if (kind === 'exit' || kind === 'sheetExit') return EASE.exit;
  if (kind === 'loop' || kind === 'pulse') return EASE.symmetric;
  return EASE.standard;
}

/**
 * Whether the system asks for reduced motion. False until the first answer
 * arrives, then follows the setting live. A change event wins over a query
 * answer that arrives after it (that answer may predate the change). Until
 * a change event the state is still the initial false, so only a "reduced"
 * answer is applied: the usual "off" answer schedules no render.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    let changed = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(value => {
        if (alive && !changed && value) setReduced(true);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', value => {
      changed = true;
      setReduced(!!value);
    });
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

export interface AnimateToOptions {
  /**
   * The value drives an opacity: under reduced motion it still cross-fades,
   * in `DURATION.fast`, instead of jumping.
   */
  fade?: boolean;
  /** Called when the motion ends (at once, with true, when the value jumps). */
  onDone?: (finished: boolean) => void;
}

/**
 * Moves a native-driven value to `toValue` with the duration and curve of
 * `kind`, and starts it. Under reduced motion a translate or scale is set at
 * once and nothing is returned; pass `fade` for an opacity, which keeps a
 * short cross-fade. Returns the started animation so the caller can stop it.
 */
export function animateTo(
  value: Animated.Value,
  toValue: number,
  kind: MotionKind,
  reduced: boolean,
  options: AnimateToOptions = {},
): Animated.CompositeAnimation | null {
  if (reduced && !options.fade) {
    value.stopAnimation();
    value.setValue(toValue);
    options.onDone?.(true);
    return null;
  }
  const animation = Animated.timing(value, {
    toValue,
    duration: reduced ? DURATION.fast : DURATION[kind],
    easing: easingFor(kind),
    useNativeDriver: true,
  });
  animation.start(options.onDone ? ({ finished }) => options.onDone?.(finished) : undefined);
  return animation;
}
