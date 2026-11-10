/**
 * MinuteWheel: the duration picker of the sleep timer (design v4 playful,
 * SPEC-audio 7.5, SPEC-design 3.9).
 *
 * A vertical list that snaps to one whole minute, 1 to 180, no wrap. Three
 * rows are visible: the selected minute on a rounded band of the canvas
 * colour with one "dk" beside it, and its neighbours. Every row draws its
 * number once, in Baloo 2 with tabular digits; its size and opacity come
 * from the scroll position on the native driver, so a number grows smoothly
 * as it reaches the band instead of jumping between styles, and a scroll
 * re-renders no row. The initial offset is set once and never sent again
 * (re-sending it on every minute made the list run ahead of the finger).
 *
 * Only the rows near the band follow the scroll (`WHEEL_LIVE_ROWS` on each
 * side of the selected minute, and every row on the way of a scroll from
 * code). A row one pitch or more from the band has the neighbour size and
 * opacity anyway (the interpolation is clamped), so the others are plain
 * texts drawn with those values: mounting the wheel creates a few dozen
 * native-driven nodes instead of about a thousand (LR-3). A minute change
 * re-renders the two rows that enter and leave that window, no other.
 *
 * Tapping a neighbour selects it (one tap target over the rows, mapped by
 * where it was touched). Minus and plus at the sides (48dp round tactile
 * buttons on their lip) move one minute per tap and repeat while held; with
 * the wheel's adjustable actions they are the accessible way to set a value.
 *
 * `value` is where the wheel opens. `onChange` fires for every minute the
 * wheel passes (the caller updates its stop line and decides when the value
 * has rested). To move the wheel from outside use the ref:
 * `scrollToMinute(25)` (animated, reported) or `setMinute(25)` (not reported).
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  GestureResponderEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextStyle,
  View,
} from 'react-native';
import { Icon } from '../design/Icon';
import { useSurfaceLevel } from '../design/SurfaceLevel';
import { usePressSink } from '../design/Tactile';
import { LIP, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { disabledFace, raisedFace } from '../../theme/surfaces';

export const WHEEL_ROW_HEIGHT = 36;
export const WHEEL_VISIBLE_ROWS = 3;
/** Height of the visible rows. */
export const WHEEL_HEIGHT = WHEEL_ROW_HEIGHT * WHEEL_VISIBLE_ROWS;
/** Space above the wheel inside its block (the wheel block is WHEEL_TOP_PAD + WHEEL_HEIGHT). */
export const WHEEL_TOP_PAD = SPACE.xs;
const WHEEL_PAD = WHEEL_ROW_HEIGHT * Math.floor(WHEEL_VISIBLE_ROWS / 2);
/** Hold: first repeat after this long, then one step per interval. */
export const WHEEL_REPEAT_DELAY_MS = 400;
export const WHEEL_REPEAT_INTERVAL_MS = 90;
/** Size and opacity of a row one pitch away from the band (the band's row is 1, 1). */
export const WHEEL_NEIGHBOUR_SCALE = 0.6;
export const WHEEL_NEIGHBOUR_OPACITY = 0.5;
/**
 * Rows on each side of the selected minute that follow the scroll on the
 * native driver. The JS side learns the minute a moment after the native
 * scroll, so this is far more than the one row beyond the band that can
 * change size: a fling would have to run this many rows ahead of JS before
 * a row reached the band drawn at the neighbour size.
 */
export const WHEEL_LIVE_ROWS = 8;
/** A row away from the band: what the clamped interpolation gives it, as plain values. */
const RESTING_ROW: TextStyle = {
  opacity: WHEEL_NEIGHBOUR_OPACITY,
  transform: [{ scale: WHEEL_NEIGHBOUR_SCALE }],
};
/** The numbers grow with the system font only this far (fixed row pitch). */
const WHEEL_MAX_FONT_SCALE = 1.3;
/** Half the width of "180" in Baloo 2 34 tabular digits at font scale 1 (dp). */
const WIDEST_HALF = 30;

export interface MinuteWheelHandle {
  /** Scroll the wheel to a minute; `onChange` reports it. */
  scrollToMinute: (minutes: number) => void;
  /** Move the wheel to a minute without reporting it (the caller applies it itself). */
  setMinute: (minutes: number, animated?: boolean) => void;
}

export interface MinuteWheelProps {
  /** The minute the wheel opens on. Later changes are ignored: use the ref. */
  value: number;
  min: number;
  max: number;
  onChange: (minutes: number) => void;
  /** "dk" beside the selected minute. */
  unit: string;
  accessibilityLabel: string;
  /** Read after the value ("Dokununca zamanlayıcı açılır"). */
  accessibilityHint?: string;
  /** Spoken value: (37) => "37 dakika". Keep it stable (useCallback). */
  valueText: (minutes: number) => string;
  decrementLabel: string;
  incrementLabel: string;
  /**
   * Draw only the rows that follow the scroll (`WHEEL_LIVE_ROWS` around the
   * selected minute); the others are spacers of their height, so the offsets
   * stay the same. Mounting then costs a few dozen texts instead of 180: the
   * timer sheet passes it until the wheel is in use (LR-4R). Turned off, the
   * rest of the rows come in around the ones already drawn.
   */
  deferRows?: boolean;
  testID?: string;
}

/** Minute under the centre line for a scroll offset. */
export function minuteAtOffset(offsetY: number, min: number, max: number): number {
  const index = Math.round(offsetY / WHEEL_ROW_HEIGHT);
  return Math.min(max, Math.max(min, min + index));
}

/** Minute of a tap at `locationY` inside the rows (row 0 is `min`). */
export function minuteAtTap(locationY: number, min: number, max: number): number {
  const index = Math.floor(locationY / WHEEL_ROW_HEIGHT);
  return Math.min(max, Math.max(min, min + index));
}

interface RowProps {
  minute: number;
  /** Position from `min`: the scroll offset that centres this row is index x pitch. */
  index: number;
  scrollY: Animated.Value;
  style: TextStyle;
  testID: string;
  /** Near the band: sized and faded by the scroll position. Else drawn at rest. */
  live: boolean;
}

/**
 * One minute: a single Text. Near the band it is sized and faded by the
 * scroll position and never re-renders while scrolling; further away it is a
 * plain text at the neighbour size (`RESTING_ROW`).
 */
const Row = React.memo<RowProps>(({ live, ...rest }) =>
  live ? (
    <LiveRow {...rest} />
  ) : (
    <Text maxFontSizeMultiplier={WHEEL_MAX_FONT_SCALE} testID={rest.testID} style={[rest.style, RESTING_ROW]}>
      {rest.minute}
    </Text>
  ),
);
Row.displayName = 'MinuteWheelRow';

const LiveRow: React.FC<Omit<RowProps, 'live'>> = ({ minute, index, scrollY, style, testID }) => {
  const motion = useMemo(() => {
    const inputRange = [
      (index - 1) * WHEEL_ROW_HEIGHT,
      index * WHEEL_ROW_HEIGHT,
      (index + 1) * WHEEL_ROW_HEIGHT,
    ];
    return {
      opacity: scrollY.interpolate({
        inputRange,
        outputRange: [WHEEL_NEIGHBOUR_OPACITY, 1, WHEEL_NEIGHBOUR_OPACITY],
        extrapolate: 'clamp',
      }),
      transform: [
        {
          scale: scrollY.interpolate({
            inputRange,
            outputRange: [WHEEL_NEIGHBOUR_SCALE, 1, WHEEL_NEIGHBOUR_SCALE],
            extrapolate: 'clamp',
          }),
        },
      ],
    };
  }, [scrollY, index]);
  return (
    <Animated.Text maxFontSizeMultiplier={WHEEL_MAX_FONT_SCALE} testID={testID} style={[style, motion]}>
      {minute}
    </Animated.Text>
  );
};

const NUDGE = 48;

interface NudgeProps {
  icon: 'minus' | 'plus';
  disabled: boolean;
  onHoldStart: () => void;
  onHoldEnd: () => void;
  accessibilityLabel: string;
  testID: string;
  styles: Styles;
  T: Theme;
}

/** A round tactile button that repeats while held (its own face: Tactile has no press-in hook). */
const Nudge: React.FC<NudgeProps> = ({
  icon,
  disabled,
  onHoldStart,
  onHoldEnd,
  accessibilityLabel,
  testID,
  styles,
  T,
}) => {
  const level = useSurfaceLevel();
  const { translateY, onPressIn, onPressOut } = usePressSink(LIP.sm, !disabled);
  return (
    <Pressable
      onPressIn={() => {
        onPressIn();
        onHoldStart();
      }}
      onPressOut={() => {
        onPressOut();
        onHoldEnd();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      testID={testID}
      style={styles.nudge}
    >
      <View pointerEvents="none" style={styles.nudgeLip} testID={`${testID}-lip`} />
      <Animated.View
        testID={`${testID}-face`}
        style={[
          styles.nudgeFace,
          { backgroundColor: disabled ? disabledFace(T, level) : raisedFace(T, level) },
          { transform: [{ translateY }] },
        ]}
      >
        <Icon name={icon} size={20} color={disabled ? T.text3 : T.text} />
      </Animated.View>
    </Pressable>
  );
};

const MinuteWheelBase = forwardRef<MinuteWheelHandle, MinuteWheelProps>(function MinuteWheel(
  {
    value,
    min,
    max,
    onChange,
    unit,
    accessibilityLabel,
    accessibilityHint,
    valueText,
    decrementLabel,
    incrementLabel,
    deferRows = false,
    testID = 'minute-wheel',
  },
  ref,
) {
  const T = useT();
  const styles = stylesFor(T);
  const clamp = useCallback((n: number) => Math.min(max, Math.max(min, Math.round(n))), [min, max]);

  const [selected, setSelected] = useState(() => clamp(value));
  const selectedRef = useRef(selected);
  const scrollRef = useRef<ScrollView>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Sent once: the native list must never be told where it is again while
  // the finger moves it (r14-wheel-offset).
  const initialOffset = useRef({ x: 0, y: (clamp(value) - min) * WHEEL_ROW_HEIGHT }).current;
  const scrollY = useRef(new Animated.Value(initialOffset.y)).current;

  const minutes = useMemo(
    () => Array.from({ length: max - min + 1 }, (_, index) => min + index),
    [min, max],
  );

  // The minute an animated scroll from code is on its way to. The scroll
  // reports the minutes it passes on the way; they are not choices (a quick
  // pick from 25 to 9 would report 24 to 10, and a tapped neighbour the old
  // minute again), so they are not reported until it arrives or a finger
  // takes the wheel.
  const targetRef = useRef<number | null>(null);

  // The minute under the band as the scroll last reported it, also on the
  // way of a scroll from code (the selected minute is already its target).
  const atRef = useRef(selected);
  // While a scroll from code travels: the minute it left. The rows between
  // it and the target stay live, so the numbers it passes grow on the band.
  const [travelFrom, setTravelFromState] = useState<number | null>(null);
  const travelFromRef = useRef<number | null>(null);
  const setTravelFrom = useCallback((minute: number | null) => {
    if (travelFromRef.current === minute) return;
    travelFromRef.current = minute;
    setTravelFromState(minute);
  }, []);

  /** Select a minute from code (buttons, taps, the ref): state, callback, scroll. */
  const select = useCallback(
    (next: number, options: { animated: boolean; notify: boolean }) => {
      const minute = clamp(next);
      targetRef.current = options.animated && minute !== selectedRef.current ? minute : null;
      if (options.animated && minute !== atRef.current) {
        setTravelFrom(atRef.current);
      } else {
        // A jump: the scroll is there at once.
        atRef.current = minute;
        setTravelFrom(null);
      }
      scrollRef.current?.scrollTo({ y: (minute - min) * WHEEL_ROW_HEIGHT, animated: options.animated });
      if (minute === selectedRef.current) return;
      selectedRef.current = minute;
      setSelected(minute);
      if (options.notify) onChangeRef.current(minute);
    },
    [clamp, min, setTravelFrom],
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollToMinute: (next: number) => select(next, { animated: true, notify: true }),
      setMinute: (next: number, animated = true) => select(next, { animated, notify: false }),
    }),
    [select],
  );

  // The JS side of the native scroll value: the minute under the band.
  const limits = useRef({ min, max });
  limits.current = { min, max };
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
        useNativeDriver: true,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const minute = minuteAtOffset(
            event.nativeEvent.contentOffset.y,
            limits.current.min,
            limits.current.max,
          );
          atRef.current = minute;
          if (targetRef.current !== null) {
            // On the way to a minute chosen in code: already selected and reported.
            if (minute === targetRef.current) {
              targetRef.current = null;
              setTravelFrom(null);
            }
            return;
          }
          // Arrived, or a finger took the wheel: the selection follows the scroll again.
          setTravelFrom(null);
          if (minute === selectedRef.current) return;
          selectedRef.current = minute;
          setSelected(minute);
          onChangeRef.current(minute);
        },
      }),
    [scrollY, setTravelFrom],
  );
  const clearTarget = useCallback(() => {
    targetRef.current = null;
  }, []);

  // Minus and plus: one minute per tap, repeating while held.
  const holdTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopHold = useCallback(() => {
    if (holdTimeout.current) clearTimeout(holdTimeout.current);
    if (holdInterval.current) clearInterval(holdInterval.current);
    holdTimeout.current = null;
    holdInterval.current = null;
  }, []);
  useEffect(() => stopHold, [stopHold]);

  const nudge = useCallback(
    (delta: number) => {
      const next = clamp(selectedRef.current + delta);
      if (next === selectedRef.current) {
        stopHold();
        return;
      }
      select(next, { animated: false, notify: true });
    },
    [clamp, select, stopHold],
  );

  const startHold = (delta: number) => {
    stopHold();
    nudge(delta);
    holdTimeout.current = setTimeout(() => {
      holdInterval.current = setInterval(() => nudge(delta), WHEEL_REPEAT_INTERVAL_MS);
    }, WHEEL_REPEAT_DELAY_MS);
  };

  const handleTap = useCallback(
    (event: GestureResponderEvent) =>
      select(minuteAtTap(event.nativeEvent.locationY, min, max), { animated: true, notify: true }),
    [select, min, max],
  );

  const atMin = selected <= min;
  const atMax = selected >= max;
  // "dk" clears the widest number ("180") at the font size the rows reach.
  const fontScale = Math.min(PixelRatio.getFontScale(), WHEEL_MAX_FONT_SCALE);
  const unitOffset = { marginLeft: Math.ceil(WIDEST_HALF * fontScale) + SPACE.tight };
  // The rows that follow the scroll: around the band and on the way of a scroll from code.
  const liveFrom = Math.min(selected, travelFrom ?? selected) - WHEEL_LIVE_ROWS;
  const liveTo = Math.max(selected, travelFrom ?? selected) + WHEEL_LIVE_ROWS;
  // The rows drawn: all of them, or while deferred only the live ones.
  const drawFrom = deferRows ? Math.max(min, liveFrom) : min;
  const drawTo = deferRows ? Math.min(max, liveTo) : max;

  return (
    <View style={styles.wrap} testID={testID}>
      <Nudge
        icon="minus"
        disabled={atMin}
        onHoldStart={() => startHold(-1)}
        onHoldEnd={stopHold}
        accessibilityLabel={decrementLabel}
        testID={`${testID}-minus`}
        styles={styles}
        T={T}
      />

      <View
        style={styles.wheel}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityValue={{ min, max, now: selected, text: valueText(selected) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'increment') nudge(1);
          if (event.nativeEvent.actionName === 'decrement') nudge(-1);
        }}
        testID={`${testID}-value`}
      >
        <View pointerEvents="none" style={styles.band} testID={`${testID}-band`} />
        <Animated.ScrollView
          ref={scrollRef}
          testID={`${testID}-scroll`}
          showsVerticalScrollIndicator={false}
          snapToInterval={WHEEL_ROW_HEIGHT}
          decelerationRate="fast"
          scrollEventThrottle={16}
          onScroll={onScroll}
          // A finger on the wheel ends a scroll from code: from here it reports again.
          onScrollBeginDrag={clearTarget}
          nestedScrollEnabled
          contentOffset={initialOffset}
          onLayout={() =>
            scrollRef.current?.scrollTo({
              y: (selectedRef.current - min) * WHEEL_ROW_HEIGHT,
              animated: false,
            })
          }
          contentContainerStyle={styles.content}
        >
          {/* One tap target for every row; the rows themselves take no touches. */}
          <Pressable
            onPress={handleTap}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            testID={`${testID}-tap`}
          >
            <View pointerEvents="none">
              {drawFrom > min ? (
                <View
                  style={{ height: (drawFrom - min) * WHEEL_ROW_HEIGHT }}
                  testID={`${testID}-spacer-before`}
                />
              ) : null}
              {minutes.slice(drawFrom - min, drawTo - min + 1).map(minute => (
                <Row
                  key={minute}
                  minute={minute}
                  index={minute - min}
                  scrollY={scrollY}
                  style={styles.row}
                  testID={`${testID}-row-${minute}`}
                  live={minute >= liveFrom && minute <= liveTo}
                />
              ))}
              {drawTo < max ? (
                <View
                  style={{ height: (max - drawTo) * WHEEL_ROW_HEIGHT }}
                  testID={`${testID}-spacer-after`}
                />
              ) : null}
            </View>
          </Pressable>
        </Animated.ScrollView>
        <Text
          pointerEvents="none"
          maxFontSizeMultiplier={WHEEL_MAX_FONT_SCALE}
          style={[styles.unit, unitOffset]}
          testID={`${testID}-unit`}
        >
          {unit}
        </Text>
      </View>

      <Nudge
        icon="plus"
        disabled={atMax}
        onHoldStart={() => startHold(1)}
        onHoldEnd={stopHold}
        accessibilityLabel={incrementLabel}
        testID={`${testID}-plus`}
        styles={styles}
        T={T}
      />
    </View>
  );
});

/** Memoised: the timer sheet passes stable callbacks, so a sheet render skips the 180 rows. */
export const MinuteWheel = React.memo(MinuteWheelBase);
MinuteWheel.displayName = 'MinuteWheel';

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, paddingTop: WHEEL_TOP_PAD },
    nudge: { width: NUDGE, height: NUDGE + LIP.sm },
    nudgeLip: {
      position: 'absolute',
      left: 0,
      top: LIP.sm,
      width: NUDGE,
      height: NUDGE,
      borderRadius: NUDGE / 2,
      backgroundColor: T.lip,
    },
    nudgeFace: {
      width: NUDGE,
      height: NUDGE,
      borderRadius: NUDGE / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    wheel: { flex: 1, height: WHEEL_HEIGHT },
    content: { paddingVertical: WHEEL_PAD },
    // The selected row sits on a rounded band of the canvas colour.
    band: {
      position: 'absolute',
      left: SPACE.sm,
      right: SPACE.sm,
      top: WHEEL_PAD - SPACE.tight,
      height: WHEEL_ROW_HEIGHT + 2 * SPACE.tight,
      borderRadius: T.r.md,
      backgroundColor: T.bg,
    },
    row: {
      fontFamily: T.fontDisplay,
      fontSize: 34,
      lineHeight: 46,
      color: T.text,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
      // Taller than its 36dp pitch on purpose: it spills evenly over both edges.
      marginVertical: -5, // geometry: (46 - 36) / 2, the row pitch
    },
    unit: {
      position: 'absolute',
      left: '50%',
      // On the digits' baseline: the band's row centre plus about a third of the 34sp digits.
      top: WHEEL_PAD + WHEEL_ROW_HEIGHT / 2 - SPACE.xs,
      fontFamily: T.fontBody,
      fontSize: 14,
      lineHeight: 20,
      color: T.text2,
    },
  });

type Styles = ReturnType<typeof makeStyles>;
const stylesFor = themedStyles(makeStyles);

export default MinuteWheel;
